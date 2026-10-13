// macOS system equalizer and visualizer input, for every output device, with no driver to install.
// A Core Audio process tap (macOS 14.2+) receives what the computer plays. While the EQ is on, the tap
// mutes the original sound and this file plays it again, through the EQ, on the current output.
// The tap needs the "System Audio Recording" permission, asked once.
//
// Safety net: if the output stops being fed (the audio callback goes quiet) the tap is removed at once,
// which gives the original sound back. Quitting the app also removes it.
use std::collections::VecDeque;
use std::ffi::{c_void, CStr};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AllocAnyThread;
use objc2_core_audio::*;
use objc2_core_audio_types::{AudioBuffer, AudioBufferList, AudioTimeStamp};
use objc2_core_foundation::CFDictionary;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

pub const FREQS: [f32; 10] = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
const RING: usize = 4096;

// ---------- Core Audio property helpers ----------
const GLOBAL: u32 = kAudioObjectPropertyScopeGlobal;
const INPUT: u32 = kAudioObjectPropertyScopeInput;
const OUTPUT: u32 = kAudioObjectPropertyScopeOutput;

fn addr(selector: u32, scope: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress { mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain }
}

unsafe fn get<T: Copy>(object: u32, selector: u32, scope: u32) -> Option<T> {
    let a = addr(selector, scope);
    let mut value = std::mem::MaybeUninit::<T>::uninit();
    let mut size = std::mem::size_of::<T>() as u32;
    let status = AudioObjectGetPropertyData(
        object,
        NonNull::from(&a),
        0,
        std::ptr::null(),
        NonNull::from(&mut size),
        NonNull::new_unchecked(value.as_mut_ptr() as *mut c_void),
    );
    (status == 0).then(|| value.assume_init())
}

unsafe fn get_string(object: u32, selector: u32) -> Option<String> {
    let p: *mut c_void = get(object, selector, GLOBAL)?; // CFStringRef, owned
    let s = Retained::from_raw(p as *mut NSString)?;
    Some(s.to_string())
}

/// Channels per stream of a device in one direction.
unsafe fn stream_channels(device: u32, scope: u32) -> Vec<u32> {
    let a = addr(kAudioDevicePropertyStreamConfiguration, scope);
    let mut size = 0u32;
    if AudioObjectGetPropertyDataSize(device, NonNull::from(&a), 0, std::ptr::null(), NonNull::from(&mut size)) != 0 || size == 0 {
        return vec![];
    }
    let mut buf = vec![0u64; (size as usize).div_ceil(8)];
    if AudioObjectGetPropertyData(device, NonNull::from(&a), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::new_unchecked(buf.as_mut_ptr() as *mut c_void)) != 0 {
        return vec![];
    }
    let list = buf.as_ptr() as *const AudioBufferList;
    let n = (*list).mNumberBuffers as usize;
    let first = std::ptr::addr_of!((*list).mBuffers) as *const AudioBuffer;
    (0..n).map(|i| (*first.add(i)).mNumberChannels).collect()
}

fn default_output_id() -> Option<u32> {
    unsafe { get::<u32>(kAudioObjectSystemObject as u32, kAudioHardwarePropertyDefaultOutputDevice, GLOBAL).filter(|&d| d != 0) }
}

pub struct OutputInfo {
    pub name: String,
    pub bluetooth: bool,
    pub details: Vec<(String, String)>,
}

/// The current sound output (built-in, wired, USB, HDMI, AirPlay, Bluetooth) and what Core Audio knows about it.
pub fn default_output() -> Option<OutputInfo> {
    let id = default_output_id()?;
    unsafe {
        let name = get_string(id, kAudioObjectPropertyName)?;
        let transport: u32 = get(id, kAudioDevicePropertyTransportType, GLOBAL).unwrap_or(0);
        let connection = match &transport.to_be_bytes() {
            b"bltn" => "Built-in",
            b"usb " => "USB",
            b"blue" | b"blea" => "Bluetooth",
            b"hdmi" => "HDMI",
            b"dprt" => "DisplayPort",
            b"airp" => "AirPlay",
            b"thun" => "Thunderbolt",
            b"virt" => "Virtual",
            b"grup" => "Aggregate",
            b"pci " => "PCI",
            b"fwir" => "FireWire",
            _ => "Other",
        };
        let mut details = vec![("Type".into(), "Sound output".into()), ("Connection".into(), connection.into())];
        if let Some(maker) = get_string(id, kAudioObjectPropertyManufacturer) {
            details.push(("Maker".into(), maker));
        }
        if let Some(rate) = get::<f64>(id, kAudioDevicePropertyNominalSampleRate, GLOBAL) {
            details.push(("Sample rate".into(), format!("{:.1} kHz", rate / 1000.0)));
        }
        let channels: u32 = stream_channels(id, OUTPUT).iter().sum();
        if channels > 0 {
            details.push(("Channels".into(), channels.to_string()));
        }
        if let Some(uid) = get_string(id, kAudioDevicePropertyDeviceUID) {
            details.push(("Device ID".into(), uid));
        }
        Some(OutputInfo { name, bluetooth: connection == "Bluetooth", details })
    }
}

// ---------- process tap API (looked up at run time: it only exists on macOS 14.2+) ----------
type CreateTap = unsafe extern "C" fn(*mut AnyObject, *mut u32) -> i32;
type DestroyTap = unsafe extern "C" fn(u32) -> i32;

fn tap_api() -> Option<(CreateTap, DestroyTap)> {
    static API: OnceLock<Option<(usize, usize)>> = OnceLock::new();
    let (c, d) = (*API.get_or_init(|| unsafe {
        let c = libc::dlsym(libc::RTLD_DEFAULT, c"AudioHardwareCreateProcessTap".as_ptr());
        let d = libc::dlsym(libc::RTLD_DEFAULT, c"AudioHardwareDestroyProcessTap".as_ptr());
        (!c.is_null() && !d.is_null()).then_some((c as usize, d as usize))
    }))?;
    unsafe { Some((std::mem::transmute::<usize, CreateTap>(c), std::mem::transmute::<usize, DestroyTap>(d))) }
}

pub fn supported() -> bool {
    tap_api().is_some()
}

// ---------- permission (System Audio Recording) ----------
// 0 allowed, 1 denied, 2 not asked yet. Uses the system's TCC library, like Apple's own sample code does.
type Preflight = unsafe extern "C" fn(*const c_void, *const c_void) -> i32;
type Request = unsafe extern "C" fn(*const c_void, *const c_void, *const c_void);

fn tcc() -> Option<(Preflight, Request)> {
    static TCC: OnceLock<Option<(usize, usize)>> = OnceLock::new();
    let (p, r) = (*TCC.get_or_init(|| unsafe {
        let lib = libc::dlopen(c"/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC".as_ptr(), libc::RTLD_NOW);
        if lib.is_null() {
            return None;
        }
        let p = libc::dlsym(lib, c"TCCAccessPreflight".as_ptr());
        let r = libc::dlsym(lib, c"TCCAccessRequest".as_ptr());
        (!p.is_null() && !r.is_null()).then_some((p as usize, r as usize))
    }))?;
    unsafe { Some((std::mem::transmute::<usize, Preflight>(p), std::mem::transmute::<usize, Request>(r))) }
}

fn service() -> Retained<NSString> {
    NSString::from_str("kTCCServiceAudioCapture")
}

/// Some(true) allowed, Some(false) denied, None not asked yet (or unknown).
pub fn permission() -> Option<bool> {
    let (preflight, _) = tcc()?;
    match unsafe { preflight(Retained::as_ptr(&service()) as *const c_void, std::ptr::null()) } {
        0 => Some(true),
        1 => Some(false),
        _ => None,
    }
}

/// Shows the system's permission prompt and waits for the answer.
fn ask_permission() -> bool {
    let Some((_, request)) = tcc() else { return true };
    let (tx, rx) = channel::<bool>();
    let block = block2::RcBlock::new(move |granted: u8| {
        let _ = tx.send(granted != 0);
    });
    unsafe { request(Retained::as_ptr(&service()) as *const c_void, std::ptr::null(), &*block as *const _ as *const c_void) };
    rx.recv_timeout(Duration::from_secs(120)).unwrap_or(false)
}

const PERMISSION_TEXT: &str = "Allow Special Audio in System Settings → Privacy & Security → Screen & System Audio Recording (System Audio Recording Only), then turn the EQ on again.";

// ---------- EQ ----------
#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    on: bool,
}

impl Biquad {
    // Peaking filter (RBJ cookbook), one octave wide.
    fn peak(freq: f32, gain_db: f32, rate: f32) -> Self {
        if gain_db.abs() < 0.05 || freq >= rate * 0.45 {
            return Self::default();
        }
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / rate;
        let alpha = w0.sin() / (2.0 * 1.41);
        let cos = w0.cos();
        let a0 = 1.0 + alpha / a;
        Self {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * cos) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * cos) / a0,
            a2: (1.0 - alpha / a) / a0,
            on: true,
        }
    }
}

#[derive(Clone, Copy)]
struct Params {
    enabled: bool,
    preamp: f32,
    bands: [f32; 10],
    version: u64,
}

struct Shared {
    params: Mutex<Params>,
    ring: Mutex<VecDeque<f32>>,
    rate: Mutex<f32>,
    want_levels: AtomicBool,
    last_callback: AtomicU64, // ms since START, written by the audio callback
}

static START: OnceLock<Instant> = OnceLock::new();
fn now_ms() -> u64 {
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

fn shared() -> &'static Arc<Shared> {
    static S: OnceLock<Arc<Shared>> = OnceLock::new();
    S.get_or_init(|| {
        Arc::new(Shared {
            params: Mutex::new(Params { enabled: false, preamp: 0.0, bands: [0.0; 10], version: 0 }),
            ring: Mutex::new(VecDeque::with_capacity(RING)),
            rate: Mutex::new(48000.0),
            want_levels: AtomicBool::new(false),
            last_callback: AtomicU64::new(0),
        })
    })
}

const MAX_CH: usize = 16;

// Lives on the audio thread while the engine runs.
struct Dsp {
    shared: Arc<Shared>,
    eq: bool, // false: visualizer only (the original sound plays as usual)
    rate: f32,
    in_offset: usize, // input buffers before the tap's (the output device's own inputs)
    version: u64,
    gain: f32,
    filters: [Biquad; 10],
    state: [[[f32; 2]; 10]; MAX_CH],
}

impl Dsp {
    fn refresh(&mut self) {
        let Ok(p) = self.shared.params.try_lock() else { return };
        if p.version == self.version {
            return;
        }
        let p = *p;
        self.version = p.version;
        if p.enabled {
            self.gain = 10f32.powf(p.preamp.clamp(-30.0, 0.0) / 20.0);
            for (i, f) in self.filters.iter_mut().enumerate() {
                *f = Biquad::peak(FREQS[i], p.bands[i].clamp(-15.0, 15.0), self.rate);
            }
        } else {
            self.gain = 1.0;
            self.filters = [Biquad::default(); 10];
        }
    }

    unsafe fn process(&mut self, input: *const AudioBufferList, output: *mut AudioBufferList) {
        self.shared.last_callback.store(now_ms(), Ordering::Relaxed);
        self.refresh();
        let ins = buffers(input as *mut AudioBufferList);
        let outs = buffers(output);
        let tap = &ins[self.in_offset.min(ins.len())..];

        // input layout: one interleaved buffer, or one buffer per channel
        let (in_ch, frames) = match tap.first() {
            Some(b) if tap.len() == 1 => {
                let ch = b.mNumberChannels.max(1) as usize;
                (ch, b.mDataByteSize as usize / 4 / ch)
            }
            Some(b) => (tap.len(), b.mDataByteSize as usize / 4),
            None => (0, 0),
        };
        let sample = |c: usize, i: usize| -> f32 {
            if tap.len() == 1 {
                *(tap[0].mData as *const f32).add(i * in_ch + c)
            } else {
                *(tap[c].mData as *const f32).add(i)
            }
        };

        if in_ch > 0 && self.shared.want_levels.load(Ordering::Relaxed) {
            if let Ok(mut ring) = self.shared.ring.try_lock() {
                for i in 0..frames {
                    let mono = (sample(0, i) + sample((in_ch > 1) as usize, i)) * 0.5;
                    if ring.len() >= RING {
                        ring.pop_front();
                    }
                    ring.push_back(mono);
                }
            }
        }

        let mut g = 0; // output channel across all output buffers
        for b in outs.iter_mut() {
            let ch = b.mNumberChannels.max(1) as usize;
            let out_frames = b.mDataByteSize as usize / 4 / ch;
            let data = b.mData as *mut f32;
            if data.is_null() {
                g += ch;
                continue;
            }
            for c in 0..ch {
                let gc = g + c;
                for i in 0..out_frames {
                    let mut y = 0.0;
                    if self.eq && in_ch > 0 && i < frames {
                        y = sample(gc % in_ch, i) * self.gain;
                        if gc < MAX_CH {
                            for (k, f) in self.filters.iter().enumerate() {
                                if !f.on {
                                    continue;
                                }
                                let s = &mut self.state[gc][k];
                                let out = f.b0 * y + s[0];
                                s[0] = f.b1 * y - f.a1 * out + s[1];
                                s[1] = f.b2 * y - f.a2 * out;
                                y = out;
                            }
                        }
                        y = y.clamp(-1.0, 1.0);
                    }
                    *data.add(i * ch + c) = y;
                }
            }
            g += ch;
        }
    }
}

unsafe fn buffers<'a>(list: *mut AudioBufferList) -> &'a mut [AudioBuffer] {
    if list.is_null() {
        return &mut [];
    }
    let n = (*list).mNumberBuffers as usize;
    std::slice::from_raw_parts_mut(std::ptr::addr_of_mut!((*list).mBuffers) as *mut AudioBuffer, n)
}

unsafe extern "C-unwind" fn io_proc(
    _device: AudioObjectID,
    _now: NonNull<AudioTimeStamp>,
    input: NonNull<AudioBufferList>,
    _input_time: NonNull<AudioTimeStamp>,
    output: NonNull<AudioBufferList>,
    _output_time: NonNull<AudioTimeStamp>,
    data: *mut c_void,
) -> i32 {
    if let Some(dsp) = (data as *mut Dsp).as_mut() {
        dsp.process(input.as_ptr(), output.as_ptr());
    }
    0
}

// ---------- engine ----------
struct Running {
    tap: u32,
    aggregate: u32,
    proc_id: AudioDeviceIOProcID,
    dsp: *mut Dsp,
    output: u32,
    eq: bool,
    started: u64,
}
unsafe impl Send for Running {}

impl Running {
    fn stop(self) {
        unsafe {
            AudioDeviceStop(self.aggregate, self.proc_id);
            AudioDeviceDestroyIOProcID(self.aggregate, self.proc_id);
            AudioHardwareDestroyAggregateDevice(self.aggregate);
            if let Some((_, destroy)) = tap_api() {
                destroy(self.tap);
            }
            drop(Box::from_raw(self.dsp));
        }
    }
}

fn any<T: objc2::Message>(r: Retained<T>) -> Retained<AnyObject> {
    unsafe { Retained::cast_unchecked(r) }
}

fn dict(pairs: Vec<(&CStr, Retained<AnyObject>)>) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<Retained<NSString>> = pairs.iter().map(|(k, _)| NSString::from_str(k.to_str().unwrap_or(""))).collect();
    let key_refs: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
    let values: Vec<Retained<AnyObject>> = pairs.into_iter().map(|(_, v)| v).collect();
    NSDictionary::from_retained_objects(&key_refs, &values)
}

unsafe fn start(eq: bool, output: u32) -> Result<Running, String> {
    let (create, destroy) = tap_api().ok_or("The system EQ needs macOS 14.2 or later.")?;
    let out_uid = get_string(output, kAudioDevicePropertyDeviceUID).ok_or("Could not read the sound output.")?;

    let none: Retained<NSArray<NSNumber>> = NSArray::new();
    let desc = CATapDescription::initStereoGlobalTapButExcludeProcesses(CATapDescription::alloc(), &none);
    desc.setPrivate(true);
    desc.setMuteBehavior(if eq { CATapMuteBehavior::MutedWhenTapped } else { CATapMuteBehavior::Unmuted });
    desc.setName(&NSString::from_str("Special Audio"));
    let mut tap = 0u32;
    let status = create(Retained::as_ptr(&desc) as *mut AnyObject, &mut tap);
    if status != 0 || tap == 0 {
        return Err(format!("Could not start the system EQ (code {status})."));
    }
    let tap_uid = desc.UUID().UUIDString();

    static COUNT: AtomicU64 = AtomicU64::new(0);
    let agg_uid = format!("app.specialaudio.eq.{}.{}", std::process::id(), COUNT.fetch_add(1, Ordering::Relaxed));
    let sub = dict(vec![(kAudioSubDeviceUIDKey, any(NSString::from_str(&out_uid)))]);
    let tap_entry = dict(vec![
        (kAudioSubTapUIDKey, any(tap_uid)),
        (kAudioSubTapDriftCompensationKey, any(NSNumber::new_bool(true))),
    ]);
    let description = dict(vec![
        (kAudioAggregateDeviceNameKey, any(NSString::from_str("Special Audio EQ"))),
        (kAudioAggregateDeviceUIDKey, any(NSString::from_str(&agg_uid))),
        (kAudioAggregateDeviceMainSubDeviceKey, any(NSString::from_str(&out_uid))),
        (kAudioAggregateDeviceIsPrivateKey, any(NSNumber::new_bool(true))),
        (kAudioAggregateDeviceIsStackedKey, any(NSNumber::new_bool(false))),
        (kAudioAggregateDeviceTapAutoStartKey, any(NSNumber::new_bool(true))),
        (kAudioAggregateDeviceSubDeviceListKey, any(NSArray::from_retained_slice(&[sub]))),
        (kAudioAggregateDeviceTapListKey, any(NSArray::from_retained_slice(&[tap_entry]))),
    ]);
    let cf = &*(Retained::as_ptr(&description) as *const CFDictionary);
    let mut aggregate = 0u32;
    let status = AudioHardwareCreateAggregateDevice(cf, NonNull::from(&mut aggregate));
    if status != 0 || aggregate == 0 {
        destroy(tap);
        return Err(format!("Could not start the system EQ (code {status})."));
    }

    let rate = get::<f64>(aggregate, kAudioDevicePropertyNominalSampleRate, GLOBAL).unwrap_or(48000.0) as f32;
    *shared().rate.lock().unwrap() = rate;
    let in_offset = stream_channels(output, INPUT).len();
    let dsp = Box::into_raw(Box::new(Dsp {
        shared: shared().clone(),
        eq,
        rate,
        in_offset,
        version: u64::MAX,
        gain: 1.0,
        filters: [Biquad::default(); 10],
        state: [[[0.0; 2]; 10]; MAX_CH],
    }));
    let mut proc_id: AudioDeviceIOProcID = None;
    let mut status = AudioDeviceCreateIOProcID(aggregate, Some(io_proc), dsp as *mut c_void, NonNull::from(&mut proc_id));
    if status == 0 {
        disable_device_inputs(aggregate, proc_id, in_offset);
        status = AudioDeviceStart(aggregate, proc_id);
    }
    let running = Running { tap, aggregate, proc_id, dsp, output, eq, started: now_ms() };
    if status != 0 {
        running.stop();
        return Err(format!("Could not start the system EQ (code {status})."));
    }
    Ok(running)
}

// Only the tap's input is used. Leaving the output device's own microphone off keeps Bluetooth
// headphones in their high-quality music mode.
unsafe fn disable_device_inputs(aggregate: u32, proc_id: AudioDeviceIOProcID, device_inputs: usize) {
    let streams = stream_channels(aggregate, INPUT).len();
    if device_inputs == 0 || streams == 0 {
        return;
    }
    // AudioHardwareIOProcStreamUsage: { mIOProc: *void, mNumberStreams: u32, mStreamIsOn: [u32] }
    let mut buf = vec![0u8; 16 + 4 * streams];
    let proc_ptr = proc_id.map_or(std::ptr::null(), |p| p as *const c_void);
    std::ptr::write_unaligned(buf.as_mut_ptr() as *mut *const c_void, proc_ptr);
    std::ptr::write_unaligned(buf.as_mut_ptr().add(8) as *mut u32, streams as u32);
    for i in 0..streams {
        std::ptr::write_unaligned(buf.as_mut_ptr().add(12 + 4 * i) as *mut u32, (i >= device_inputs) as u32);
    }
    let a = addr(kAudioDevicePropertyIOProcStreamUsage, INPUT);
    AudioObjectSetPropertyData(aggregate, NonNull::from(&a), 0, std::ptr::null(), buf.len() as u32, NonNull::new_unchecked(buf.as_mut_ptr() as *mut c_void));
}

struct Engine {
    running: Option<Running>,
    started_thread: bool,
    last_error: Option<String>,
    waiters: Vec<Sender<Result<(), String>>>,
}

fn engine() -> &'static Mutex<Engine> {
    static E: OnceLock<Mutex<Engine>> = OnceLock::new();
    E.get_or_init(|| Mutex::new(Engine { running: None, started_thread: false, last_error: None, waiters: vec![] }))
}

// One background thread keeps the engine matching what is wanted: follows the default output,
// restarts after errors only when asked again, and removes the tap if the audio callback stops.
fn ensure_thread() {
    let mut e = engine().lock().unwrap();
    if e.started_thread {
        return;
    }
    e.started_thread = true;
    std::thread::spawn(|| loop {
        tick();
        std::thread::sleep(Duration::from_millis(500));
    });
}

fn tick() {
    let s = shared();
    let eq_on = s.params.lock().map(|p| p.enabled).unwrap_or(false);
    let levels = s.want_levels.load(Ordering::Relaxed) && permission() == Some(true);
    let mut e = engine().lock().unwrap();
    let output = default_output_id();
    let want = eq_on || levels;

    if let Some(r) = &e.running {
        let stalled = r.eq && now_ms().saturating_sub(r.started) > 3000 && now_ms().saturating_sub(s.last_callback.load(Ordering::Relaxed)) > 1500;
        if !want || r.eq != eq_on || Some(r.output) != output || stalled {
            let r = e.running.take().unwrap();
            r.stop();
            if stalled {
                s.params.lock().unwrap().enabled = false;
                e.last_error = Some("The system EQ stopped, so the normal sound is back. Turn it on to try again.".into());
                return;
            }
        }
    }
    if want && e.running.is_none() && e.last_error.is_none() {
        if let Some(output) = output {
            match unsafe { start(eq_on, output) } {
                Ok(r) => e.running = Some(r),
                Err(err) => {
                    if eq_on {
                        s.params.lock().unwrap().enabled = false;
                    }
                    e.last_error = Some(err);
                }
            }
        }
    }
    let result = match (&e.last_error, &e.running) {
        (Some(err), _) => Err(err.clone()),
        (None, Some(_)) => Ok(()),
        (None, None) if !want => Ok(()),
        _ => return, // still waiting for an output
    };
    for w in e.waiters.drain(..) {
        let _ = w.send(result.clone());
    }
}

/// Turns the system EQ on or off and sets the curve. Blocks until it is running (or failed).
pub fn apply(enabled: bool, preamp: f32, bands: &[f32]) -> Result<(), String> {
    if enabled {
        if !supported() {
            return Err("The system EQ needs macOS 14.2 or later.".into());
        }
        match permission() {
            Some(true) => {}
            Some(false) => return Err(PERMISSION_TEXT.into()),
            None => {
                if !ask_permission() {
                    return Err(PERMISSION_TEXT.into());
                }
            }
        }
    }
    let s = shared();
    {
        let mut p = s.params.lock().unwrap();
        p.enabled = enabled;
        p.preamp = preamp;
        for (i, g) in bands.iter().take(10).enumerate() {
            p.bands[i] = *g;
        }
        p.version = p.version.wrapping_add(1);
    }
    let (tx, rx) = channel();
    {
        let mut e = engine().lock().unwrap();
        e.last_error = None;
        e.waiters.push(tx);
    }
    ensure_thread();
    if !enabled {
        return Ok(());
    }
    rx.recv_timeout(Duration::from_secs(6)).unwrap_or(Err("The system EQ didn't start. Try again.".into()))
}

/// Visualizer: start or stop reading what plays. Only when the permission is already given; it never asks.
pub fn set_levels(on: bool) -> bool {
    if on && (!supported() || permission() != Some(true)) {
        return false;
    }
    shared().want_levels.store(on, Ordering::Relaxed);
    if on {
        engine().lock().unwrap().last_error = None;
        ensure_thread();
    }
    true
}

/// The newest `n` samples (mono) and the sample rate, while the engine runs.
pub fn recent(n: usize) -> Option<(Vec<f32>, f32)> {
    if engine().lock().ok()?.running.is_none() {
        return None;
    }
    let ring = shared().ring.lock().ok()?;
    let mut v: Vec<f32> = ring.iter().rev().take(n).rev().copied().collect();
    if v.len() < n {
        let mut padded = vec![0.0; n - v.len()];
        padded.append(&mut v);
        v = padded;
    }
    Some((v, *shared().rate.lock().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_band_is_bypassed_and_boost_raises_its_frequency() {
        assert!(!Biquad::peak(1000.0, 0.0, 48000.0).on);
        let f = Biquad::peak(1000.0, 6.0, 48000.0);
        // gain at the centre frequency: |H(e^jw0)|
        let w = 2.0 * std::f32::consts::PI * 1000.0 / 48000.0;
        let (c1, s1, c2, s2) = (w.cos(), -w.sin(), (2.0 * w).cos(), -(2.0 * w).sin());
        let num = ((f.b0 + f.b1 * c1 + f.b2 * c2).powi(2) + (f.b1 * s1 + f.b2 * s2).powi(2)).sqrt();
        let den = ((1.0 + f.a1 * c1 + f.a2 * c2).powi(2) + (f.a1 * s1 + f.a2 * s2).powi(2)).sqrt();
        let db = 20.0 * (num / den).log10();
        assert!((db - 6.0).abs() < 0.1, "{db}");
    }
}
