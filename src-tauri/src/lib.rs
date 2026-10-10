// Desktop shell: opens the app from ../app in a native window.
// Native Bluetooth (RFCOMM) commands will be added here in the next phase.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Special Audio");
}
