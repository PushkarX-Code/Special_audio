# Special Audio

Unofficial desktop companion for the **CMF Headphone Pro**. Connect, see battery and firmware, switch noise control, spatial audio, EQ and Low Lag mode. No account, no sign-in.

> Unofficial. Not affiliated with Nothing Technology Ltd. Use at your own risk.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Protocol research ([docs/protocol-research.md](docs/protocol-research.md)) | Done |
| 3 | Full UI + Demo mode (no headphones needed) | Done |
| 1–2 | Capture analysis + protocol tests from real traffic | Waiting for the Bluetooth capture |
| 4 | Real connection, read-only | Next |
| 5 | Write commands, one feature at a time | — |
| 6 | Desktop app builds (Windows .exe, macOS .dmg) via Tauri | — |

## Run it locally

Needs [Node.js](https://nodejs.org) 20+ (no packages to install).

```
npm start      # http://localhost:5173  -> click "Demo mode"
npm test       # protocol + safety tests
```

## Safety

- Only commands confirmed by two independent sources (later: by your own capture) can reach real headphones. Everything else throws before it is sent.
- No firmware, reset or pairing commands exist in the code at all.
- One command per 150 ms, every command waits for the device reply, one retry.
- Raw Bluetooth logs are git-ignored: they contain addresses and serial numbers.

## Layout

```
app/                 the app (plain HTML, CSS, ES modules, no build step)
  src/protocol/      frame + CRC, confirmed commands, draft commands, allowlist, parser
  src/device/        session (rate limit, retry), controller (state), demo device
  src/ui/            hero gauge, background, EQ visual, controls, developer panel
docs/                protocol research
test/                node:test suites (fixtures from the capture go in test/fixtures)
tools/               dev server, capture scripts
```

Fonts: Doto and Space Mono, SIL Open Font License (see `app/fonts/`).
