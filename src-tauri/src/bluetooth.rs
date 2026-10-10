// Lists the Bluetooth audio devices the operating system currently has connected.
// Works for any headphones: name always, battery when the OS exposes it.
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AudioDevice {
    pub name: String,
    pub address: Option<String>,
    pub battery: Option<u8>,
}

#[cfg(target_os = "macos")]
pub fn connected() -> Vec<AudioDevice> {
    use serde_json::Value;
    // system_profiler reports connected devices with battery for many headphones. ~0.5 s, run off the UI thread.
    let Ok(out) = std::process::Command::new("/usr/sbin/system_profiler")
        .args(["SPBluetoothDataType", "-json"])
        .output()
    else {
        return vec![];
    };
    let Ok(json) = serde_json::from_slice::<Value>(&out.stdout) else { return vec![] };
    let percent = |v: &Value| v.as_str().and_then(|s| s.trim_end_matches('%').trim().parse::<u8>().ok());
    let mut devices = vec![];
    for section in json["SPBluetoothDataType"].as_array().into_iter().flatten() {
        for item in section["device_connected"].as_array().into_iter().flatten() {
            for (name, p) in item.as_object().into_iter().flatten() {
                let minor = p["device_minorType"].as_str().unwrap_or("");
                if ["Keyboard", "Mouse", "Trackpad", "Gamepad", "Phone", "Computer"].iter().any(|m| minor.contains(m)) {
                    continue;
                }
                let battery = percent(&p["device_batteryLevelMain"])
                    .or_else(|| percent(&p["device_batteryLevel"]))
                    .or_else(|| {
                        match (percent(&p["device_batteryLevelLeft"]), percent(&p["device_batteryLevelRight"])) {
                            (Some(l), Some(r)) => Some(l.min(r)),
                            (l, r) => l.or(r),
                        }
                    });
                devices.push(AudioDevice {
                    name: name.clone(),
                    address: p["device_address"].as_str().map(str::to_string),
                    battery,
                });
            }
        }
    }
    devices
}

#[cfg(windows)]
pub fn connected() -> Vec<AudioDevice> {
    use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothMajorClass};
    use windows::Devices::Enumeration::DeviceInformation;

    let mut devices = vec![];
    let Ok(selector) = BluetoothDevice::GetDeviceSelectorFromPairingState(true) else { return devices };
    let Ok(infos) = DeviceInformation::FindAllAsyncAqsFilter(&selector).and_then(|op| op.get()) else {
        return devices;
    };
    let count = infos.Size().unwrap_or(0);
    for i in 0..count {
        let Ok(info) = infos.GetAt(i) else { continue };
        let Ok(id) = info.Id() else { continue };
        let Ok(dev) = BluetoothDevice::FromIdAsync(&id).and_then(|op| op.get()) else { continue };
        if dev.ConnectionStatus().ok() != Some(BluetoothConnectionStatus::Connected) {
            continue;
        }
        let is_audio = dev
            .ClassOfDevice()
            .and_then(|c| c.MajorClass())
            .map(|m| m == BluetoothMajorClass::AudioVideo)
            .unwrap_or(true);
        if !is_audio {
            continue;
        }
        devices.push(AudioDevice {
            name: dev.Name().map(|n| n.to_string()).unwrap_or_default(),
            address: dev.BluetoothAddress().ok().map(|a| format!("{a:012X}")),
            battery: None, // generic battery on Windows comes later; CMF battery comes from the headphones directly
        });
    }
    devices
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn connected() -> Vec<AudioDevice> {
    vec![]
}
