// Desktop shell: main window, menu bar / tray mini panel, notifications, start at login and updates.
mod bluetooth;
mod media;
mod rfcomm;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
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

/// Checks GitHub for a newer release. Asks before installing; `quiet` skips the "up to date" message.
#[tauri::command]
async fn check_for_update(app: AppHandle, quiet: bool) -> Result<Option<String>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        if !quiet {
            app.dialog().message("You have the latest version.").title("Special Audio").show(|_| {});
        }
        return Ok(None);
    };
    let version = update.version.clone();
    let install = app
        .dialog()
        .message(format!("Special Audio {version} is available. Install it now? The app restarts when it's done."))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom("Install".into(), "Later".into()))
        .blocking_show();
    if install {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(Some(version))
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
            check_for_update,
            rfcomm_connect,
            rfcomm_send,
            rfcomm_disconnect,
            now_playing,
            media_control,
            contact
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

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = check_for_update(handle, true).await;
            });
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
