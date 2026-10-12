// macOS control channel to the headphones over Bluetooth RFCOMM (IOBluetooth).
// Everything Bluetooth runs on one worker thread with its own run loop, so callbacks arrive there
// and the window never blocks. The app side sends bytes through a queue; incoming bytes and the
// close event go out through `on_event`.
use std::cell::Cell;
use std::ffi::c_void;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_foundation::{NSDate, NSDefaultRunLoopMode, NSRunLoop, NSString};
use objc2_io_bluetooth::{IOBluetoothDevice, IOBluetoothRFCOMMChannel, IOBluetoothSDPUUID};

pub enum Event {
    Data(Vec<u8>),
    Closed,
}
pub type OnEvent = Arc<dyn Fn(Event) + Send + Sync>;

enum Cmd {
    Send(Vec<u8>, Sender<Result<(), String>>),
    Close,
}
static LINK: Mutex<Option<Sender<Cmd>>> = Mutex::new(None);

struct Ivars {
    on_event: OnEvent,
    closed: Cell<bool>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "SpecialAudioRfcommDelegate"]
    #[ivars = Ivars]
    struct Delegate;

    impl Delegate {
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
            self.ivars().closed.set(true);
        }
    }
);

impl Delegate {
    fn new(on_event: OnEvent) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Ivars { on_event, closed: Cell::new(false) });
        unsafe { msg_send![super(this), init] }
    }
}

fn pump(seconds: f64) {
    unsafe {
        let until = NSDate::dateWithTimeIntervalSinceNow(seconds);
        NSRunLoop::currentRunLoop().runMode_beforeDate(NSDefaultRunLoopMode, &until);
    }
}

fn open(address: &str, service: u128, on_event: OnEvent) -> Result<(Retained<IOBluetoothRFCOMMChannel>, Retained<Delegate>), String> {
    unsafe {
        // system_profiler gives AA:BB:CC:DD:EE:FF; IOBluetooth takes aa-bb-cc-dd-ee-ff
        let addr = NSString::from_str(&address.trim().to_lowercase().replace(':', "-"));
        let device = IOBluetoothDevice::deviceWithAddressString(Some(&addr)).ok_or("Headphones not found. Are they connected?")?;
        let uuid_bytes = service.to_be_bytes();
        let uuid = IOBluetoothSDPUUID::uuidWithBytes_length(uuid_bytes.as_ptr() as *const c_void, 16).ok_or("bad service id")?;

        // Paired devices usually have their services cached; otherwise ask the headphones (async).
        let mut record = device.getServiceRecordForUUID(Some(&uuid));
        if record.is_none() {
            device.performSDPQuery(None);
            let started = Instant::now();
            while record.is_none() && started.elapsed() < Duration::from_secs(8) {
                pump(0.1);
                record = device.getServiceRecordForUUID(Some(&uuid));
            }
        }
        let record = record.ok_or("These headphones don't offer the control channel. Are they turned on and in range?")?;
        let mut channel_id: u8 = 0;
        if record.getRFCOMMChannelID(&mut channel_id) != 0 {
            return Err("Could not find the control channel on the headphones.".into());
        }

        let delegate = Delegate::new(on_event);
        let mut channel: Option<Retained<IOBluetoothRFCOMMChannel>> = None;
        let target: &AnyObject = &delegate;
        let status = device.openRFCOMMChannelSync_withChannelID_delegate(Some(&mut channel), channel_id, Some(target));
        match channel {
            Some(ch) if status == 0 => Ok((ch, delegate)),
            _ => Err("Could not open the control channel. Close Nothing X on your phone and try again.".into()),
        }
    }
}

fn worker(address: String, service: u128, on_event: OnEvent, cmds: Receiver<Cmd>, ready: Sender<Result<(), String>>) {
    let (channel, delegate) = match open(&address, service, on_event.clone()) {
        Ok(v) => v,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let _ = ready.send(Ok(()));
    loop {
        pump(0.02);
        while let Ok(cmd) = cmds.try_recv() {
            match cmd {
                Cmd::Send(mut bytes, reply) => {
                    let status = unsafe { channel.writeSync_length(bytes.as_mut_ptr() as *mut c_void, bytes.len() as u16) };
                    let _ = reply.send(if status == 0 { Ok(()) } else { Err(format!("send failed ({status:#x})")) });
                }
                Cmd::Close => {
                    unsafe { channel.closeChannel() };
                    return;
                }
            }
        }
        if delegate.ivars().closed.get() {
            *LINK.lock().unwrap() = None;
            on_event(Event::Closed);
            return;
        }
    }
}

pub fn connect(address: &str, service: u128, on_event: OnEvent) -> Result<(), String> {
    disconnect();
    let (cmd_tx, cmd_rx) = channel();
    let (ready_tx, ready_rx) = channel();
    let address = address.to_string();
    std::thread::spawn(move || worker(address, service, on_event, cmd_rx, ready_tx));
    ready_rx.recv_timeout(Duration::from_secs(20)).map_err(|_| "The headphones didn't answer.".to_string())??;
    *LINK.lock().unwrap() = Some(cmd_tx);
    Ok(())
}

pub fn send(bytes: &[u8]) -> Result<(), String> {
    let tx = LINK.lock().unwrap().clone().ok_or("not connected")?;
    let (reply_tx, reply_rx) = channel();
    tx.send(Cmd::Send(bytes.to_vec(), reply_tx)).map_err(|_| "not connected".to_string())?;
    reply_rx.recv_timeout(Duration::from_secs(3)).map_err(|_| "send timed out".to_string())?
}

pub fn disconnect() {
    if let Some(tx) = LINK.lock().unwrap().take() {
        let _ = tx.send(Cmd::Close);
    }
}
