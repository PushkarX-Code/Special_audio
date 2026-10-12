// PC equalizer (Windows): 10 bands for everything the computer plays, through Equalizer APO, the free
// system-wide equalizer. The app writes its own file (special-audio.txt) next to Equalizer APO's
// config.txt and adds one "Include:" line to config.txt. Nothing else in that folder is touched.
use serde::Serialize;

pub const FREQS: [u32; 10] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FILE: &str = "special-audio.txt";
const INCLUDE: &str = "Include: special-audio.txt";

#[derive(Serialize)]
pub struct PcEqStatus {
    supported: bool, // Windows only
    installed: bool, // Equalizer APO found
    writable: bool,  // the app may write its file in the config folder
}

/// The text written to special-audio.txt.
pub fn config_text(enabled: bool, preamp: f32, bands: &[f32]) -> Result<String, String> {
    if bands.len() != FREQS.len() || !preamp.is_finite() || bands.iter().any(|g| !g.is_finite()) {
        return Err("invalid equalizer values".into());
    }
    let mut out = String::from("# Special Audio PC equalizer. Written by the app: change it in Special Audio.\n");
    if enabled {
        let points: Vec<String> = FREQS.iter().zip(bands).map(|(f, g)| format!("{f} {:.1}", g.clamp(-15.0, 15.0))).collect();
        out += &format!("Preamp: {:.1} dB\nGraphicEQ: {}\n", preamp.clamp(-30.0, 0.0), points.join("; "));
    }
    Ok(out)
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::path::PathBuf;

    pub fn config_dir() -> Option<PathBuf> {
        let dir = PathBuf::from(std::env::var_os("ProgramFiles")?).join("EqualizerAPO").join("config");
        dir.join("config.txt").exists().then_some(dir)
    }

    pub fn can_write(dir: &std::path::Path) -> bool {
        std::fs::OpenOptions::new().create(true).append(true).open(dir.join(FILE)).is_ok()
    }

    pub fn write(dir: &std::path::Path, text: &str) -> std::io::Result<()> {
        std::fs::write(dir.join(FILE), text)?;
        let main = dir.join("config.txt");
        let current = std::fs::read_to_string(&main).unwrap_or_default();
        if !current.lines().any(|l| l.trim().eq_ignore_ascii_case(INCLUDE)) {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().append(true).open(&main)?;
            write!(f, "\r\n{INCLUDE}\r\n")?;
        }
        Ok(())
    }

    /// Runs a program elevated (Windows shows its permission prompt) and waits for it.
    pub fn run_elevated(program: &str, args: &str) -> Result<(), String> {
        let quote = |v: &str| format!("'{}'", v.replace('\'', "''"));
        let mut script = format!("Start-Process -FilePath {} -Verb RunAs -Wait", quote(program));
        if !args.is_empty() {
            script += &format!(" -ArgumentList {}", quote(args));
        }
        let ok = std::process::Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
            .status()
            .map_err(|e| e.to_string())?
            .success();
        if ok { Ok(()) } else { Err("Permission was not given".into()) }
    }
}

#[tauri::command]
pub fn pc_eq_status() -> PcEqStatus {
    #[cfg(windows)]
    {
        match win::config_dir() {
            Some(dir) => PcEqStatus { supported: true, installed: true, writable: win::can_write(&dir) },
            None => PcEqStatus { supported: true, installed: false, writable: false },
        }
    }
    #[cfg(not(windows))]
    PcEqStatus { supported: false, installed: false, writable: false }
}

#[tauri::command]
pub fn pc_eq_apply(enabled: bool, preamp: f32, bands: Vec<f32>) -> Result<(), String> {
    let text = config_text(enabled, preamp, &bands)?;
    #[cfg(windows)]
    {
        let dir = win::config_dir().ok_or("Equalizer APO is not installed")?;
        win::write(&dir, &text).map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => "permission".to_string(),
            _ => e.to_string(),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err("The PC equalizer is available on Windows".into())
    }
}

/// One-time: lets the signed-in user write Equalizer APO's config folder (Users group, modify).
#[tauri::command]
pub fn pc_eq_allow() -> Result<(), String> {
    #[cfg(windows)]
    {
        let dir = win::config_dir().ok_or("Equalizer APO is not installed")?;
        win::run_elevated("icacls", &format!("\"{}\" /grant *S-1-5-32-545:(OI)(CI)M", dir.display()))
    }
    #[cfg(not(windows))]
    Err("The PC equalizer is available on Windows".into())
}

/// Opens Equalizer APO's Configurator, where the user ticks the headphones it should work on.
#[tauri::command]
pub fn pc_eq_configure() -> Result<(), String> {
    #[cfg(windows)]
    {
        let dir = win::config_dir().ok_or("Equalizer APO is not installed")?;
        let exe = dir.parent().map(|p| p.join("Configurator.exe")).ok_or("Configurator not found")?;
        win::run_elevated(&exe.to_string_lossy(), "")
    }
    #[cfg(not(windows))]
    Err("The PC equalizer is available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_graphic_eq_line() {
        let t = config_text(true, -4.0, &[4.0, 3.0, 0.0, 0.0, -1.5, 0.0, 0.0, 2.0, 3.0, 20.0]).unwrap();
        assert!(t.contains("Preamp: -4.0 dB\n"));
        assert!(t.contains("GraphicEQ: 31 4.0; 62 3.0; 125 0.0; 250 0.0; 500 -1.5; 1000 0.0; 2000 0.0; 4000 2.0; 8000 3.0; 16000 15.0\n"));
        assert!(!config_text(false, 0.0, &[0.0; 10]).unwrap().contains("GraphicEQ"));
        assert!(config_text(true, 0.0, &[0.0; 3]).is_err());
        assert!(config_text(true, f32::NAN, &[0.0; 10]).is_err());
    }
}
