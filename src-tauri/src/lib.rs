// Desktop shell: main window, menu bar / tray mini panel, notifications, start at login and updates.
mod audio;
mod pc_eq;
#[cfg(target_os = "macos")]
mod mac_eq;
#[cfg(target_os = "macos")]
mod mac_link;
mod bluetooth;
mod media;
mod rfcomm;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
async fn audio_devices() -> Vec<bluetooth::AudioDevice> {
    tauri::async_runtime::spawn_blocking(bluetooth::connected).await.unwrap_or_default()
}

#[tauri::command]
async fn rfcomm_connect(app: AppHandle, address: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || rfcomm::connect(app, &address))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn rfcomm_send(bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || rfcomm::send(&bytes)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn rfcomm_disconnect() {
    rfcomm::disconnect();
}

#[tauri::command]
async fn now_playing() -> Option<media::NowPlaying> {
    tauri::async_runtime::spawn_blocking(media::now_playing).await.ok().flatten()
}

#[tauri::command]
async fn media_control(action: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || media::control(&action)).await.unwrap_or(false)
}

/// Opens the user's mail app addressed to the developer. The address is not shown in the app.
#[tauri::command]
fn contact() {
    let url = concat!("mailto:", "email.puskar", "@", "gmail.com", "?subject=Special%20Audio");
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = url;
}

/// Opens one of a few fixed web pages in the browser. Anything else is refused.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    const ALLOWED: [&str; 3] = [
        "https://sourceforge.net/projects/equalizerapo/",
        "https://github.com/PushkarX-Code/Special_audio",
        "https://github.com/PushkarX-Code/Special_audio/releases",
    ];
    if !ALLOWED.contains(&url.as_str()) {
        return Err("not allowed".into());
    }
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    Ok(())
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
fn open_bluetooth_settings() {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.BluetoothSettings").spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", "ms-settings:bluetooth"]).spawn();
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(app: AppHandle, on: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    if on { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())
}

#[tauri::command]
fn open_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("mini") {
        let _ = w.hide();
    }
    show_main(&app);
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
}

/// Checks GitHub for a newer release. The page shows the update screen; nothing installs without a click.
#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.date().to_string()),
    }))
}

/// Downloads and installs the newest release, reporting progress as "update-progress" {done, total},
/// then restarts the app.
#[tauri::command]
async fn update_install(app: AppHandle) -> Result<(), String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Err("No update available".into()) };
    let mut done: u64 = 0;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk as u64;
                let _ = progress.emit("update-progress", serde_json::json!({ "done": done, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn toggle_mini(app: &AppHandle) {
    let Some(w) = app.get_webview_window("mini") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    // macOS menu bar is at the top, the Windows taskbar at the bottom.
    #[cfg(target_os = "macos")]
    let _ = w.move_window(Position::TrayCenter);
    #[cfg(not(target_os = "macos"))]
    let _ = w.move_window(Position::TrayBottomCenter);
    let _ = w.show();
    let _ = w.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_positioner::init())
        .invoke_handler(tauri::generate_handler![
            audio_devices,
            notify,
            open_bluetooth_settings,
            autostart_get,
            autostart_set,
            app_version,
            open_main,
            update_check,
            update_install,
            rfcomm_connect,
            rfcomm_send,
            rfcomm_disconnect,
            now_playing,
            media_control,
            contact,
            audio::visualizer_start,
            audio::visualizer_stop,
            pc_eq::pc_eq_status,
            pc_eq::pc_eq_apply,
            pc_eq::pc_eq_allow,
            pc_eq::pc_eq_configure,
            open_url
        ])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Special Audio", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            // macOS: monochrome template icon that follows the menu bar colour. Windows: the colour app icon.
            #[cfg(target_os = "macos")]
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            #[cfg(not(target_os = "macos"))]
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
            TrayIconBuilder::with_id("tray")
                .icon(icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Special Audio")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle_mini(tray.app_handle());
                    }
                })
                .build(app)?;

            // Started at login: stay in the menu bar / tray instead of opening the window.
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // Updates: the page checks on launch and every few hours, and shows the update screen.
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the main window keeps the app running in the menu bar / tray.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(false) if window.label() == "mini" => {
                let _ = window.hide();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building Special Audio")
        .run(|app, event| {
            // macOS: clicking the Dock icon brings the window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
