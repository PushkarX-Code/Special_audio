# Special Audio

A desktop app for the **CMF Headphone Pro** on Windows and Mac. Check battery, switch noise control, spatial audio, EQ and Low Lag mode from your computer. No account, no sign-in.

> Unofficial. Not affiliated with Nothing Technology Ltd. Use at your own risk.

![Special Audio, dark mode](docs/screenshots/desktop-dark.png)

![Special Audio, light mode](docs/screenshots/desktop-light.png)

## Download

1. Open the **[Releases page](https://github.com/PushkarX-Code/Special_audio/releases)**.
2. Scroll to **Assets** at the bottom of the newest release.
3. Click the file for your computer to download it:

| Your computer | Click this file |
|---|---|
| Windows 10 or 11 | the one ending in **`x64-setup.exe`** |
| Mac (Apple Silicon or Intel) | the one ending in **`universal.dmg`** |

## Install

The app is not signed with a paid certificate yet, so your computer asks you to confirm the first time.

**Windows**
1. Double-click the `.exe` file.
2. If you see "Windows protected your PC", click **More info**, then **Run anyway**.
3. Follow the installer. Open **Special Audio** from the Start menu.

**Mac**
1. Double-click the `.dmg` file and drag **Special Audio** into **Applications**.
2. Open it. If macOS says it can't verify the app, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
3. If it says the app is "damaged", open **Terminal**, paste this line and press Enter, then open the app again:
   ```
   xattr -cr "/Applications/Special Audio.app"
   ```

## What works today

| Feature | Status |
|---|---|
| App installs and opens on Windows and Mac | Yes |
| Demo mode: try every screen without headphones | Yes |
| Connect to real headphones | Coming next |
| Battery, firmware, noise control on real headphones | After connecting works |
| EQ, spatial audio, Low Lag on real headphones | After the Bluetooth capture confirms the commands |

Click **Demo mode** on the first screen to try it.

---

<details>
<summary><b>For developers</b></summary>

### Run from source

Needs [Node.js](https://nodejs.org) 20+.

```
npm install
npm start        # web version at http://localhost:5173
npm test         # protocol and safety tests
npm run tauri dev    # desktop window (needs Rust)
```

### Build installers

GitHub builds them: **Actions → Build app → Run workflow**. That publishes a release with the Windows `.exe`/`.msi` and the Mac `.dmg`. Pull requests build the installers too (download them from the run's Artifacts).

### Safety

- Only commands confirmed by two independent sources (later: by a real capture) can reach real headphones. Everything else throws before it is sent.
- No firmware, reset or pairing commands exist in the code.
- One command per 150 ms. Every command waits for the device reply, with one retry.
- Raw Bluetooth logs are git-ignored: they contain addresses and serial numbers.

### Layout

```
app/                 the interface (plain HTML, CSS, JavaScript, no build step)
  src/protocol/      frame + CRC, confirmed commands, draft commands, allowlist, parser
  src/device/        session (rate limit, retry), controller (state), demo device
  src/ui/            battery gauge, background, EQ visual, controls, developer panel
src-tauri/           desktop app shell (Tauri), icons, Windows/Mac packaging
docs/                protocol research, screenshots
test/                tests (capture fixtures go in test/fixtures)
tools/               dev server
.github/workflows/   automatic Windows + Mac builds
```

Protocol research: [docs/protocol-research.md](docs/protocol-research.md). Fonts: Doto and Space Mono, SIL Open Font License (see `app/fonts/`).

</details>
