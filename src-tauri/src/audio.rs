// Visualizer levels: what the computer is playing, as 16 band levels (0..1), ~30 times a second.
// Windows only (WASAPI loopback). Nothing is recorded or stored: each tick the newest samples are turned
// into levels and thrown away. The page starts it while music plays and stops it otherwise.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

pub const BANDS: usize = 16;
const FFT_N: usize = 2048;
static RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn visualizer_start(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        if RUNNING.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        std::thread::spawn(move || {
            if let Err(e) = win::run(&app) {
                eprintln!("visualizer: {e}");
            }
            RUNNING.store(false, Ordering::SeqCst);
        });
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("not supported on this system".into())
    }
}

#[tauri::command]
pub fn visualizer_stop() {
    RUNNING.store(false, Ordering::SeqCst);
}

// Mono samples (oldest first, length FFT_N) -> band levels 0..1, log-spaced 50 Hz..16 kHz.
pub fn band_levels(samples: &[f32], rate: f32) -> [f32; BANDS] {
    let n = samples.len();
    let mut re: Vec<f32> = samples
        .iter()
        .enumerate()
        .map(|(i, s)| s * (0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos()))
        .collect();
    let mut im = vec![0.0; n];
    fft(&mut re, &mut im);
    let bin_hz = rate / n as f32;
    let mut out = [0.0; BANDS];
    for (k, level) in out.iter_mut().enumerate() {
        let lo = 50.0 * (320.0f32).powf(k as f32 / BANDS as f32);
        let hi = 50.0 * (320.0f32).powf((k + 1) as f32 / BANDS as f32);
        let (a, b) = ((lo / bin_hz) as usize, ((hi / bin_hz) as usize).max((lo / bin_hz) as usize + 1));
        let peak = (a..b.min(n / 2)).map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt()).fold(0.0, f32::max);
        // full-scale sine with a Hann window peaks at n/4; map -60..0 dB to 0..1
        let db = 20.0 * (peak / (n as f32 / 4.0)).max(1e-6).log10();
        *level = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
    }
    out
}

fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f32::consts::PI / len as f32;
        for start in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (s, c) = (ang * k as f32).sin_cos();
                let (p, q) = (start + k, start + k + len / 2);
                let (vr, vi) = (re[q] * c - im[q] * s, re[q] * s + im[q] * c);
                re[q] = re[p] - vr;
                im[q] = im[p] - vi;
                re[p] += vr;
                im[p] += vi;
            }
        }
        len <<= 1;
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::collections::VecDeque;
    use tauri::Emitter;
    use wasapi::{get_default_device, Direction, SampleType, StreamMode, WaveFormat};

    const RATE: usize = 48000;

    pub fn run(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let _ = wasapi::initialize_mta();
        let device = get_default_device(&Direction::Render)?;
        let mut client = device.get_iaudioclient()?;
        let format = WaveFormat::new(32, 32, &SampleType::Float, RATE, 2, None);
        let (period, _) = client.get_device_period()?;
        // Render device + Capture direction = loopback of what is playing. Polling: loopback sends no
        // events while the output is silent.
        let mode = StreamMode::PollingShared { autoconvert: true, buffer_duration_hns: period * 4 };
        client.initialize_client(&format, &Direction::Capture, &mode)?;
        let capture = client.get_audiocaptureclient()?;
        client.start_stream()?;

        let mut bytes: VecDeque<u8> = VecDeque::new();
        let mut window: VecDeque<f32> = VecDeque::from(vec![0.0; FFT_N]);
        while RUNNING.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(33));
            capture.read_from_device_to_deque(&mut bytes)?;
            if bytes.len() < 8 {
                window.extend(std::iter::repeat(0.0).take(RATE / 30)); // silence
            }
            while bytes.len() >= 8 {
                let mut f = [0u8; 8];
                f.iter_mut().for_each(|b| *b = bytes.pop_front().unwrap_or(0));
                let l = f32::from_le_bytes([f[0], f[1], f[2], f[3]]);
                let r = f32::from_le_bytes([f[4], f[5], f[6], f[7]]);
                window.push_back((l + r) * 0.5);
            }
            while window.len() > FFT_N {
                window.pop_front();
            }
            let levels = band_levels(window.make_contiguous(), RATE as f32);
            let _ = app.emit("audio-levels", levels.to_vec());
        }
        client.stop_stream()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_lights_its_band() {
        let rate = 48000.0;
        let tone: Vec<f32> = (0..FFT_N).map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / rate).sin()).collect();
        let l = band_levels(&tone, rate);
        let loudest = (0..BANDS).max_by(|&a, &b| l[a].total_cmp(&l[b])).unwrap();
        let band_of_1k = (0..BANDS).find(|&k| 50.0 * 320f32.powf((k + 1) as f32 / BANDS as f32) > 1000.0).unwrap();
        assert_eq!(loudest, band_of_1k);
        assert!(l[loudest] > 0.9);
        assert!(band_levels(&vec![0.0; FFT_N], rate).iter().all(|&v| v == 0.0));
    }
}
