// Lists the devices the computer has connected: Bluetooth devices of any brand and kind, plus the
// current sound output (built-in, wired, USB, HDMI…) when it isn't one of them. For each device: its
// name, battery when the device reports it, and every detail the system knows about it. Sound devices
// come first. Everything is read locally; nothing leaves the computer.
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct AudioDevice {
    pub name: String,
    pub address: Option<String>,
    pub battery: Option<u8>,
    /// headphones, speaker, sound output, keyboard, …
    pub kind: String,
    /// plays sound
    pub audio: bool,
    /// label, value; in display order
    pub details: Vec<(String, String)>,
}

fn pretty_address(raw: &str) -> String {
    let hex: String = raw.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_uppercase();
    if hex.len() != 12 {
        return raw.to_string();
    }
    hex.as_bytes().chunks(2).map(|c| std::str::from_utf8(c).unwrap_or("")).collect::<Vec<_>>().join(":")
}

/// Sound devices first, then the sound output, then everything else.
fn ordered(bt: Vec<AudioDevice>, output: Option<AudioDevice>) -> Vec<AudioDevice> {
    let (mut list, rest): (Vec<_>, Vec<_>) = bt.into_iter().partition(|d| d.audio);
    list.extend(output);
    list.extend(rest);
    list
}

#[cfg(target_os = "macos")]
pub fn connected() -> Vec<AudioDevice> {
    use serde_json::Value;
    // ~0.5 s, run off the UI thread.
    let json = std::process::Command::new("/usr/sbin/system_profiler")
        .args(["SPBluetoothDataType", "-json"])
        .output()
        .ok()
        .and_then(|out| serde_json::from_slice::<Value>(&out.stdout).ok())
        .unwrap_or(Value::Null);
    let percent = |v: &Value| v.as_str().and_then(|s| s.trim_end_matches('%').trim().parse::<u8>().ok());
    let mut devices = vec![];
    for section in json["SPBluetoothDataType"].as_array().into_iter().flatten() {
        for item in section["device_connected"].as_array().into_iter().flatten() {
            for (name, p) in item.as_object().into_iter().flatten() {
                let minor = p["device_minorType"].as_str().unwrap_or("").to_string();
                let services = p["device_services"].as_str().unwrap_or("");
                let audio = ["A2DP", "HFP", "Headset", "Handsfree", "LEA"].iter().any(|s| services.contains(s))
                    || ["Headphones", "Headset", "Speaker", "Loudspeaker", "Audio"].iter().any(|m| minor.contains(m));
                let (left, right) = (percent(&p["device_batteryLevelLeft"]), percent(&p["device_batteryLevelRight"]));
                let battery = percent(&p["device_batteryLevelMain"]).or_else(|| percent(&p["device_batteryLevel"])).or(match (left, right) {
                    (Some(l), Some(r)) => Some(l.min(r)),
                    (l, r) => l.or(r),
                });
                let mut details = vec![];
                for (key, value) in p.as_object().into_iter().flatten() {
                    let text = match value {
                        Value::String(s) => s.clone(),
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => (if *b { "Yes" } else { "No" }).to_string(),
                        Value::Array(a) => a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", "),
                        _ => continue,
                    };
                    if text.is_empty() {
                        continue;
                    }
                    let label = mac_label(key);
                    let text = if key == "device_address" { pretty_address(&text) } else { text };
                    details.push((mac_rank(key), label, text));
                }
                details.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
                devices.push(AudioDevice {
                    name: name.clone(),
                    address: p["device_address"].as_str().map(str::to_string),
                    battery,
                    kind: if minor.is_empty() { "device".into() } else { minor.to_lowercase() },
                    audio,
                    details: details.into_iter().map(|(_, k, v)| (k, v)).collect(),
                });
            }
        }
    }
    let output = crate::mac_eq::default_output().filter(|o| !o.bluetooth).map(|o| AudioDevice {
        name: o.name,
        address: None,
        battery: None,
        kind: "sound output".into(),
        audio: true,
        details: o.details,
    });
    ordered(devices, output)
}

#[cfg(target_os = "macos")]
fn mac_label(key: &str) -> String {
    let k = key.strip_prefix("device_").unwrap_or(key);
    let known = match k {
        "address" => "Address",
        "minorType" => "Type",
        "vendorID" => "Vendor ID",
        "productID" => "Product ID",
        "firmwareVersion" => "Firmware",
        "batteryLevelMain" | "batteryLevel" => "Battery",
        "batteryLevelLeft" => "Battery left",
        "batteryLevelRight" => "Battery right",
        "batteryLevelCase" => "Battery case",
        "services" => "Profiles",
        "rssi" => "Signal (RSSI)",
        "serialNumber" => "Serial number",
        "serialNumberLeft" => "Serial number left",
        "serialNumberRight" => "Serial number right",
        "caseVersion" => "Case firmware",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_string();
    }
    // camelCase → "Camel case"
    let mut out = String::new();
    for (i, c) in k.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            out.push(' ');
            out.extend(c.to_lowercase());
        } else if i == 0 {
            out.extend(c.to_uppercase());
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(target_os = "macos")]
fn mac_rank(key: &str) -> u8 {
    match key.strip_prefix("device_").unwrap_or(key) {
        "minorType" => 0,
        "batteryLevelMain" | "batteryLevel" => 1,
        "batteryLevelLeft" | "batteryLevelRight" | "batteryLevelCase" => 2,
        "vendorID" | "productID" => 3,
        "firmwareVersion" | "caseVersion" => 4,
        "address" => 5,
        "services" => 6,
        _ => 9,
    }
}

#[cfg(windows)]
pub fn connected() -> Vec<AudioDevice> {
    use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothMajorClass};
    use windows::Devices::Enumeration::DeviceInformation;

    let mut devices = vec![];
    let nodes = win::pnp_nodes();
    let infos = BluetoothDevice::GetDeviceSelectorFromPairingState(true).and_then(|s| DeviceInformation::FindAllAsyncAqsFilter(&s)).and_then(|op| op.get());
    if let Ok(infos) = infos {
        for i in 0..infos.Size().unwrap_or(0) {
            let Ok(info) = infos.GetAt(i) else { continue };
            let Ok(id) = info.Id() else { continue };
            let Ok(dev) = BluetoothDevice::FromIdAsync(&id).and_then(|op| op.get()) else { continue };
            if dev.ConnectionStatus().ok() != Some(BluetoothConnectionStatus::Connected) {
                continue;
            }
            let class = dev.ClassOfDevice().ok();
            let major = class.as_ref().and_then(|c| c.MajorClass().ok());
            let minor = class.as_ref().and_then(|c| c.MinorClass().ok());
            let audio = major.map(|m| m == BluetoothMajorClass::AudioVideo).unwrap_or(true);
            let raw = dev.BluetoothAddress().ok().map(|a| format!("{a:012X}"));
            let mine: Vec<&win::Node> = raw.as_ref().map(|a| nodes.iter().filter(|n| n.id.contains(a.as_str())).collect()).unwrap_or_default();
            let battery = mine.iter().find_map(|n| n.battery);
            let kind = win::kind(major, minor, class.as_ref().and_then(|c| c.RawValue().ok()).unwrap_or(0));

            let mut details = vec![("Type".to_string(), win::title(&kind))];
            if let Some(b) = battery {
                details.push(("Battery".into(), format!("{b}%")));
            }
            if let Some((source, vendor, product)) = mine.iter().flat_map(|n| n.hwids.iter()).find_map(|h| win::vid_pid(h)) {
                if let Some(maker) = win::maker(source, vendor) {
                    details.push(("Maker".into(), maker.into()));
                }
                details.push(("Vendor ID".into(), format!("0x{vendor:04X}")));
                details.push(("Product ID".into(), format!("0x{product:04X}")));
            }
            if let Some(a) = &raw {
                details.push(("Address".into(), pretty_address(a)));
            }
            let mut profiles: Vec<String> = mine.iter().filter_map(|n| win::profile(&n.id)).collect();
            profiles.sort();
            profiles.dedup();
            if !profiles.is_empty() {
                details.push(("Profiles".into(), profiles.join(", ")));
            }
            if let Some(v) = mine.iter().find_map(|n| n.driver.clone()) {
                details.push(("Driver".into(), v));
            }
            if let Some(c) = class.as_ref().and_then(|c| c.RawValue().ok()) {
                details.push(("Device class".into(), format!("0x{c:06X}")));
            }
            devices.push(AudioDevice {
                name: dev.Name().map(|n| n.to_string()).unwrap_or_default(),
                address: raw,
                battery,
                kind,
                audio,
                details,
            });
        }
    }
    // The sound output, unless it is one of the Bluetooth devices above ("Headphones (Name)").
    let output = win::default_output().filter(|o| !devices.iter().any(|d| d.audio && !d.name.is_empty() && o.name.contains(&d.name)));
    ordered(devices, output)
}

#[cfg(windows)]
mod win {
    use super::AudioDevice;
    use windows::core::{Interface, HSTRING};
    use windows::Devices::Bluetooth::{BluetoothMajorClass, BluetoothMinorClass};
    use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind};
    use windows_collections::IIterable;
    use windows::Foundation::IPropertyValue;

    const BATTERY: &str = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2"; // DEVPKEY_Bluetooth_Battery
    const HWIDS: &str = "{A45C254E-DF1C-4EFD-8020-67D146A850E0} 3"; // DEVPKEY_Device_HardwareIds
    const DRIVER: &str = "{A8B865DD-2E3D-4094-AD97-E593A70C75D6} 3"; // DEVPKEY_Device_DriverVersion

    pub struct Node {
        pub id: String, // device instance id, upper case; ends with the device address
        pub battery: Option<u8>,
        pub hwids: Vec<String>,
        pub driver: Option<String>,
    }

    /// The Bluetooth device nodes Windows has (one per profile), with battery, hardware ids and driver.
    pub fn pnp_nodes() -> Vec<Node> {
        let props: Vec<HSTRING> = [BATTERY, HWIDS, DRIVER].iter().map(|k| HSTRING::from(*k)).collect();
        let props = IIterable::<HSTRING>::from(props);
        let find = |aqs: &str| {
            DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(&HSTRING::from(aqs), &props, DeviceInformationKind::Device).and_then(|op| op.get())
        };
        let Ok(infos) = find("System.Devices.DeviceInstanceId:~<\"BTHENUM\"").or_else(|_| find("")) else { return vec![] };
        let mut nodes = vec![];
        for i in 0..infos.Size().unwrap_or(0) {
            let Ok(info) = infos.GetAt(i) else { continue };
            let id = info.Id().map(|s| s.to_string().to_uppercase()).unwrap_or_default();
            if !id.starts_with("BTHENUM") {
                continue;
            }
            let Ok(map) = info.Properties() else { continue };
            let value = |key: &str| map.Lookup(&HSTRING::from(key)).ok().and_then(|v| v.cast::<IPropertyValue>().ok());
            let battery = value(BATTERY).and_then(|v| v.GetUInt8().ok()).filter(|b| *b <= 100);
            let hwids = value(HWIDS)
                .and_then(|v| {
                    let mut arr = windows::core::Array::<HSTRING>::new();
                    v.GetStringArray(&mut arr).ok().map(|_| arr.iter().map(|s| s.to_string()).collect())
                })
                .unwrap_or_default();
            let driver = value(DRIVER).and_then(|v| v.GetString().ok()).map(|s| s.to_string()).filter(|s| !s.is_empty());
            nodes.push(Node { id, battery, hwids, driver });
        }
        nodes
    }

    /// "BTHENUM\{0000110B-…}_VID&0001004C_PID&2002" → (source, vendor, product)
    pub fn vid_pid(hwid: &str) -> Option<(u16, u16, u16)> {
        let up = hwid.to_uppercase();
        let v = up.split("VID&").nth(1)?.get(0..8)?;
        let p = up.split("PID&").nth(1)?.get(0..4)?;
        let source = u16::from_str_radix(&v[0..4], 16).ok()?;
        let vendor = u16::from_str_radix(&v[4..8], 16).ok()?;
        let product = u16::from_str_radix(p, 16).ok()?;
        (vendor != 0).then_some((source, vendor, product))
    }

    /// Bluetooth SIG company ids (source 1) for a few well-known makers.
    pub fn maker(source: u16, vendor: u16) -> Option<&'static str> {
        if source != 1 {
            return None;
        }
        Some(match vendor {
            0x0006 => "Microsoft",
            0x004C => "Apple",
            0x0075 => "Samsung",
            0x009E => "Bose",
            0x00E0 => "Google",
            0x012D => "Sony",
            _ => return None,
        })
    }

    /// Profile name from a node id like "BTHENUM\{0000110B-0000-1000-8000-00805F9B34FB}_…".
    pub fn profile(id: &str) -> Option<String> {
        let uuid = id.split('{').nth(1)?.get(0..8)?;
        if !uuid.starts_with("0000") {
            return None;
        }
        Some(
            match &uuid[4..8] {
                "1108" | "1112" => "Headset",
                "110A" => "Audio source",
                "110B" => "Audio (A2DP)",
                "110C" | "110E" | "110F" => "Remote control (AVRCP)",
                "111E" | "111F" => "Hands-free (HFP)",
                "1124" => "Input (HID)",
                "1101" => "Serial port",
                "1105" => "File transfer (OPP)",
                "1115" | "1116" | "1117" => "Network (PAN)",
                "112F" => "Phone book (PBAP)",
                "1132" => "Messages (MAP)",
                "1200" => "Device info",
                "1203" => "Generic audio",
                _ => return None,
            }
            .to_string(),
        )
    }

    pub fn kind(major: Option<BluetoothMajorClass>, minor: Option<BluetoothMinorClass>, raw: u32) -> String {
        use BluetoothMinorClass as M;
        let m = minor.unwrap_or(M::Uncategorized);
        let s = match major {
            Some(BluetoothMajorClass::AudioVideo) => {
                if m == M::AudioVideoHeadphones {
                    "headphones"
                } else if m == M::AudioVideoWearableHeadset || m == M::AudioVideoHandsFree {
                    "headset"
                } else if m == M::AudioVideoLoudspeaker || m == M::AudioVideoPortableAudio || m == M::AudioVideoHifiAudioDevice {
                    "speaker"
                } else if m == M::AudioVideoCarAudio {
                    "car audio"
                } else if m == M::AudioVideoMicrophone {
                    "microphone"
                } else {
                    "audio device"
                }
            }
            Some(BluetoothMajorClass::Peripheral) => {
                // peripheral minor class: keyboard and pointer are flag bits
                let bits = (raw >> 2) & 0x3F;
                if bits & 0x10 != 0 && bits & 0x20 == 0 {
                    "keyboard"
                } else if bits & 0x20 != 0 {
                    "mouse"
                } else if m == M::PeripheralGamepad || m == M::PeripheralJoystick {
                    "game controller"
                } else {
                    "accessory"
                }
            }
            Some(BluetoothMajorClass::Phone) => "phone",
            Some(BluetoothMajorClass::Computer) => "computer",
            Some(BluetoothMajorClass::Wearable) => "wearable",
            Some(BluetoothMajorClass::Toy) => "toy",
            Some(BluetoothMajorClass::Health) => "health device",
            Some(BluetoothMajorClass::Imaging) => "printer or camera",
            _ => "device",
        };
        s.to_string()
    }

    pub fn title(kind: &str) -> String {
        let mut c = kind.chars();
        c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
    }

    /// The current sound output (speakers, wired headphones, USB, HDMI…) and its format.
    pub fn default_output() -> Option<AudioDevice> {
        let _ = wasapi::initialize_mta();
        let dev = wasapi::get_default_device(&wasapi::Direction::Render).ok()?;
        let name = dev.get_friendlyname().ok()?;
        let mut details = vec![("Type".to_string(), "Sound output".to_string())];
        if let Some(desc) = dev.get_description().ok().filter(|d| !d.is_empty() && *d != name) {
            details.push(("Output".into(), desc));
        }
        if let Some(f) = dev.get_iaudioclient().ok().and_then(|c| c.get_mixformat().ok()) {
            details.push(("Sample rate".into(), format!("{:.1} kHz", f.get_samplespersec() as f64 / 1000.0)));
            details.push(("Channels".into(), f.get_nchannels().to_string()));
            details.push(("Bit depth".into(), format!("{}-bit", f.get_bitspersample())));
        }
        if let Ok(id) = dev.get_id() {
            details.push(("Device ID".into(), id));
        }
        Some(AudioDevice { name, address: None, battery: None, kind: "sound output".into(), audio: true, details })
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn connected() -> Vec<AudioDevice> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_addresses_and_puts_sound_devices_first() {
        assert_eq!(pretty_address("a1b2c3d4e5f6"), "A1:B2:C3:D4:E5:F6");
        assert_eq!(pretty_address("a1-b2-c3-d4-e5-f6"), "A1:B2:C3:D4:E5:F6");
        let dev = |name: &str, audio| AudioDevice { name: name.into(), audio, ..Default::default() };
        let list = ordered(vec![dev("Mouse", false), dev("Buds", true)], Some(dev("Speakers", true)));
        let names: Vec<_> = list.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, ["Buds", "Speakers", "Mouse"]);
    }
}
