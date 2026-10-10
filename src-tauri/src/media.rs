// "Now playing" and play/pause/next/previous for the music control bar.
// Windows: system media controls (any app). macOS: Spotify and Apple Music via AppleScript,
// because macOS no longer lets other apps read what's playing.
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub playing: bool,
    pub source: String,
}

#[cfg(windows)]
mod imp {
    use super::NowPlaying;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    fn session() -> Option<Session> {
        Manager::RequestAsync().ok()?.get().ok()?.GetCurrentSession().ok()
    }

    pub fn now_playing() -> Option<NowPlaying> {
        let s = session()?;
        let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = props.Title().ok()?.to_string();
        if title.is_empty() {
            return None;
        }
        Some(NowPlaying {
            title,
            artist: props.Artist().map(|a| a.to_string()).unwrap_or_default(),
            playing: s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).ok() == Some(Status::Playing),
            source: s.SourceAppUserModelId().map(|a| a.to_string()).unwrap_or_default(),
        })
    }

    pub fn control(action: &str) -> bool {
        let Some(s) = session() else { return false };
        let op = match action {
            "toggle" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "previous" => s.TrySkipPreviousAsync(),
            _ => return false,
        };
        op.and_then(|o| o.get()).unwrap_or(false)
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::NowPlaying;
    const APPS: [&str; 2] = ["Spotify", "Music"];

    fn osascript(script: &str) -> Option<String> {
        let out = std::process::Command::new("/usr/bin/osascript").args(["-e", script]).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    // The "is running" check keeps us from launching an app that is closed.
    fn active_app() -> Option<&'static str> {
        APPS.into_iter().find(|app| {
            osascript(&format!(
                "if application \"{app}\" is running then tell application \"{app}\" to return (player state as text)"
            ))
            .is_some_and(|s| s == "playing")
        })
        .or_else(|| {
            APPS.into_iter().find(|app| {
                osascript(&format!(
                    "if application \"{app}\" is running then tell application \"{app}\" to return (player state as text)"
                ))
                .is_some_and(|s| s == "paused")
            })
        })
    }

    pub fn now_playing() -> Option<NowPlaying> {
        let app = active_app()?;
        let out = osascript(&format!(
            "tell application \"{app}\" to return (player state as text) & linefeed & name of current track & linefeed & artist of current track"
        ))?;
        let mut lines = out.lines();
        let playing = lines.next()? == "playing";
        Some(NowPlaying {
            title: lines.next()?.to_string(),
            artist: lines.next().unwrap_or("").to_string(),
            playing,
            source: app.to_string(),
        })
    }

    pub fn control(action: &str) -> bool {
        let verb = match action {
            "toggle" => "playpause",
            "next" => "next track",
            "previous" => "previous track",
            _ => return false,
        };
        let Some(app) = active_app() else { return false };
        osascript(&format!("tell application \"{app}\" to {verb}")).is_some()
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use super::NowPlaying;
    pub fn now_playing() -> Option<NowPlaying> {
        None
    }
    pub fn control(_: &str) -> bool {
        false
    }
}

pub use imp::*;
