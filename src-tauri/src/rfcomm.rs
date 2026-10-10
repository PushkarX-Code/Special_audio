// Private control channel to the headphones (Bluetooth RFCOMM, the same one the official app uses).
// Bytes go in and out unchanged; framing, the allowlist and rate limits live in the app (src/protocol).
//   Service UUID: aeac4a03-dff5-498f-843a-34487cf133eb (docs/protocol-research.md, CONFIRMED)
// Incoming bytes are emitted as the "rfcomm-data" event; a closed link emits "rfcomm-closed".

#[cfg(windows)]
mod imp {
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter};
    use windows::core::GUID;
    use windows::Devices::Bluetooth::{BluetoothCacheMode, BluetoothDevice};
    use windows::Devices::Bluetooth::Rfcomm::RfcommServiceId;
    use windows::Networking::Sockets::StreamSocket;
    use windows::Storage::Streams::{DataReader, DataWriter, InputStreamOptions};

    const SERVICE: u128 = 0xaeac4a03_dff5_498f_843a_34487cf133eb;

    struct Link {
        socket: StreamSocket,
        writer: DataWriter,
    }
    static LINK: Mutex<Option<Link>> = Mutex::new(None);

    fn err(e: windows::core::Error) -> String {
        e.message().to_string()
    }

    pub fn connect(app: AppHandle, address: &str) -> Result<(), String> {
        disconnect();
        let addr = u64::from_str_radix(address.trim(), 16).map_err(|_| "bad Bluetooth address".to_string())?;
        let device = BluetoothDevice::FromBluetoothAddressAsync(addr).and_then(|o| o.get()).map_err(err)?;
        let id = RfcommServiceId::FromUuid(GUID::from_u128(SERVICE)).map_err(err)?;
        let result = device
            .GetRfcommServicesForIdWithCacheModeAsync(&id, BluetoothCacheMode::Uncached)
            .and_then(|o| o.get())
            .map_err(err)?;
        let services = result.Services().map_err(err)?;
        if services.Size().map_err(err)? == 0 {
            return Err("These headphones don't offer the control channel. Are they turned on and in range?".into());
        }
        let service = services.GetAt(0).map_err(err)?;
        let socket = StreamSocket::new().map_err(err)?;
        socket
            .ConnectAsync(&service.ConnectionHostName().map_err(err)?, &service.ConnectionServiceName().map_err(err)?)
            .and_then(|o| o.get())
            .map_err(|e| format!("Could not open the control channel ({}). Close Nothing X on your phone and try again.", err(e)))?;
        let writer = DataWriter::CreateDataWriter(&socket.OutputStream().map_err(err)?).map_err(err)?;
        let reader = DataReader::CreateDataReader(&socket.InputStream().map_err(err)?).map_err(err)?;
        reader.SetInputStreamOptions(InputStreamOptions::Partial).map_err(err)?;
        *LINK.lock().unwrap() = Some(Link { socket, writer });

        std::thread::spawn(move || {
            loop {
                let n = match reader.LoadAsync(1024).and_then(|o| o.get()) {
                    Ok(n) if n > 0 => n as usize,
                    _ => break,
                };
                let mut buf = vec![0u8; n];
                if reader.ReadBytes(&mut buf).is_err() {
                    break;
                }
                let _ = app.emit("rfcomm-data", buf);
            }
            let was_open = LINK.lock().unwrap().take().is_some();
            if was_open {
                let _ = app.emit("rfcomm-closed", "lost");
            }
        });
        Ok(())
    }

    pub fn send(bytes: &[u8]) -> Result<(), String> {
        let guard = LINK.lock().unwrap();
        let link = guard.as_ref().ok_or("not connected")?;
        link.writer.WriteBytes(bytes).map_err(err)?;
        link.writer.StoreAsync().and_then(|o| o.get()).map_err(err)?;
        Ok(())
    }

    pub fn disconnect() {
        if let Some(link) = LINK.lock().unwrap().take() {
            let _ = link.socket.Close();
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::AppHandle;
    pub fn connect(_: AppHandle, _: &str) -> Result<(), String> {
        Err("Headphone controls on this computer arrive in a later update.".into())
    }
    pub fn send(_: &[u8]) -> Result<(), String> {
        Err("not connected".into())
    }
    pub fn disconnect() {}
}

pub use imp::*;
