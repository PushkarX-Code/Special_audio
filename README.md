# Special Audio

A desktop app for the **CMF Headphone Pro** on Windows and Mac. Check battery, switch noise control, spatial audio, EQ and Low Lag mode from your computer. No account, no sign-in.

> Unofficial. Not affiliated with Nothing Technology Ltd. Use at your own risk.

![Special Audio, dark mode](docs/screenshots/desktop-dark.png)

![Special Audio, light mode](docs/screenshots/desktop-light.png)

## Install (one command, no security warnings)

**Mac**: open the **Terminal** app (press `⌘ Space`, type *Terminal*, press Enter), paste this line and press Enter:

```
curl -fsSL https://raw.githubusercontent.com/PushkarX-Code/Special_audio/main/scripts/install-mac.sh | bash
```

**Windows**: open **PowerShell** (press the Windows key, type *PowerShell*, press Enter), paste this line and press Enter:

```
irm https://raw.githubusercontent.com/PushkarX-Code/Special_audio/main/scripts/install-windows.ps1 | iex
```

It downloads the latest version, installs it and opens it. Run the same line again any time to update.

**Why a command instead of a download button?** The app isn't signed with a paid Apple or Microsoft certificate yet. Files downloaded through a browser get a "from the internet" mark, and macOS and Windows block unsigned apps that carry it. A file downloaded by the command doesn't get that mark, so the app opens normally. You can read exactly what each command does: [Mac script](scripts/install-mac.sh), [Windows script](scripts/install-windows.ps1).

<details>
<summary>Prefer to download the file yourself?</summary>

1. Open the **[Releases page](https://github.com/PushkarX-Code/Special_audio/releases)** and scroll to **Assets** under the newest release.
2. Windows: download the file ending in **`x64-setup.exe`** and double-click it. If you see "Windows protected your PC", click **More info**, then **Run anyway**.
3. Mac: download the file ending in **`universal.dmg`**, open it and drag **Special Audio** into **Applications**. If macOS won't open the app, open **Terminal**, paste this line and press Enter, then open the app again:
   ```
   xattr -cr "/Applications/Special Audio.app"
   ```

</details>

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
scripts/             one-command installers for Mac and Windows
.github/workflows/   automatic Windows + Mac builds
```

Protocol research: [docs/protocol-research.md](docs/protocol-research.md). Fonts: Doto and Space Mono, SIL Open Font License (see `app/fonts/`).

</details>
