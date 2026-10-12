// macOS control channel to the headphones over Bluetooth RFCOMM (IOBluetooth).
// IOBluetooth only works reliably on the app's main thread, so every Bluetooth call is handed to the
// main thread (`run_main`) and the calling worker thread waits for the answer. Opening is
// asynchronous, so the window never freezes. Incoming bytes and the close event go out via `on_event`.
use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::time::Duration;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker};
use objc2_foundation::NSString;
use objc2_io_bluetooth::{IOBluetoothDevice, IOBluetoothRFCOMMChannel, IOBluetoothSDPUUID};

pub enum Event {
    Data(Vec<u8>),
    Closed,
}
pub type OnEvent = Arc<dyn Fn(Event) + Send + Sync>;
pub type RunMain = Arc<dyn Fn(Box<dyn FnOnce() + Send>) + Send + Sync>;
type Reply = Sender<Result<(), String>>;

// Main thread only.
thread_local! {
    static LINK: RefCell<Option<(Retained<IOBluetoothRFCOMMChannel>, Retained<Delegate>)>> = const { RefCell::new(None) };
}

struct Ivars {
    on_event: OnEvent,
    opened: RefCell<Option<Reply>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "SpecialAudioRfcommDelegate"]
    #[ivars = Ivars]
    struct Delegate;

    impl Delegate {
        #[unsafe(method(rfcommChannelOpenComplete:status:))]
        fn rfcomm_open_complete(&self, _channel: *mut AnyObject, status: i32) {
            if let Some(reply) = self.ivars().opened.borrow_mut().take() {
                if status != 0 {
                    LINK.with(|l| l.borrow_mut().take());
                }
                let _ = reply.send(if status == 0 { Ok(()) } else { Err(explain(status)) });
            }
        }

        #[unsafe(method(rfcommChannelData:data:length:))]
        fn rfcomm_data(&self, _channel: *mut AnyObject, data: *mut c_void, length: usize) {
            if data.is_null() || length == 0 {
                return;
            }
            let bytes = unsafe { std::slice::from_raw_parts(data as *const u8, length) }.to_vec();
            (self.ivars().on_event)(Event::Data(bytes));
        }

        #[unsafe(method(rfcommChannelClosed:))]
        fn rfcomm_closed(&self, _channel: *mut AnyObject) {
            let was_open = LINK.with(|l| l.borrow_mut().take()).is_some();
            if was_open {
                (self.ivars().on_event)(Event::Closed);
            }
        }
    }
);

impl Delegate {
    fn new(on_event: OnEvent, opened: Reply) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Ivars { on_event, opened: RefCell::new(Some(opened)) });
        unsafe { msg_send![super(this), init] }
    }
}

// IOReturn codes worth explaining (IOKit/IOReturn.h).
fn explain(status: i32) -> String {
    match status as u32 {
        0xe00002e2 | 0xe00002c1 => "macOS blocked Bluetooth for Special Audio. Allow it in System Settings → Privacy & Security → Bluetooth, then try again.".into(),
        0xe00002d5 => "The headphones' control channel is busy. Close Nothing X on your phone and try again.".into(),
        0xe00002d6 => "The headphones didn't answer in time. Try again.".into(),
        code => format!("Could not open the control channel (code {code:#x}). Close Nothing X on your phone and try again."),
    }
}

// Runs on the main thread. Finds the service and starts opening the channel; `reply` gets the result.
fn open_on_main(address: String, service: u128, on_event: OnEvent, reply: Reply, run_main: RunMain, attempt: u32) {
    unsafe {
        // system_profiler gives AA:BB:CC:DD:EE:FF; IOBluetooth takes aa-bb-cc-dd-ee-ff
        let addr = NSString::from_str(&address.trim().to_lowercase().replace(':', "-"));
        let Some(device) = IOBluetoothDevice::deviceWithAddressString(Some(&addr)) else {
            let _ = reply.send(Err("Headphones not found. Are they connected?".into()));
            return;
        };
        let bytes = service.to_be_bytes();
        let Some(uuid) = IOBluetoothSDPUUID::uuidWithBytes_length(bytes.as_ptr() as *const c_void, 16) else {
            let _ = reply.send(Err("bad service id".into()));
            return;
        };
        let Some(record) = device.getServiceRecordForUUID(Some(&uuid)) else {
            // Not cached yet: ask the headphones, then look again in a second (up to 8 times).
            if attempt == 0 {
                device.performSDPQuery(None);
            }
            if attempt >= 8 {
                let _ = reply.send(Err("These headphones don't offer the control channel. Are they turned on and in range?".into()));
                return;
            }
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(1));
                let rm = run_main.clone();
                run_main(Box::new(move || open_on_main(address, service, on_event, reply, rm, attempt + 1)));
            });
            return;
        };
        let mut channel_id: u8 = 0;
        if record.getRFCOMMChannelID(&mut channel_id) != 0 {
            let _ = reply.send(Err("Could not find the control channel on the headphones.".into()));
            return;
        }
        let delegate = Delegate::new(on_event, reply.clone());
        let mut channel: Option<Retained<IOBluetoothRFCOMMChannel>> = None;
        let target: &AnyObject = &delegate;
        let status = device.openRFCOMMChannelAsync_withChannelID_delegate(Some(&mut channel), channel_id, Some(target));
        match channel {
            Some(ch) if status == 0 => LINK.with(|l| *l.borrow_mut() = Some((ch, delegate))),
            _ => {
                let _ = reply.send(Err(explain(status)));
            }
        }
    }
}

fn close_on_main() {
    if let Some((channel, _delegate)) = LINK.with(|l| l.borrow_mut().take()) {
        unsafe { channel.closeChannel() };
    }
}

/// Call from a worker thread (never the main thread): waits for the main thread to open the link.
pub fn connect(address: &str, service: u128, on_event: OnEvent, run_main: RunMain) -> Result<(), String> {
    let (reply, result) = channel();
    let address = address.to_string();
    let rm = run_main.clone();
    run_main(Box::new(move || {
        close_on_main();
        open_on_main(address, service, on_event, reply, rm, 0);
    }));
    result.recv_timeout(Duration::from_secs(25)).map_err(|_| "The headphones didn't answer.".to_string())?
}

/// Call from a worker thread: writes on the main thread and waits for the result.
pub fn send(bytes: &[u8], run_main: &RunMain) -> Result<(), String> {
    let (reply, result) = channel();
    let mut bytes = bytes.to_vec();
    run_main(Box::new(move || {
        let status = LINK.with(|l| {
            l.borrow().as_ref().map(|(ch, _)| unsafe { ch.writeSync_length(bytes.as_mut_ptr() as *mut c_void, bytes.len() as u16) })
        });
        let _ = reply.send(match status {
            None => Err("not connected".into()),
            Some(0) => Ok(()),
            Some(code) => Err(format!("send failed ({code:#x})")),
        });
    }));
    result.recv_timeout(Duration::from_secs(3)).map_err(|_| "send timed out".to_string())?
}

/// Safe from any thread.
pub fn disconnect(run_main: &RunMain) {
    if MainThreadMarker::new().is_some() {
        close_on_main();
    } else {
        run_main(Box::new(close_on_main));
    }
}
