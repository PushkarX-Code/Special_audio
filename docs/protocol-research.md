# Phase 0: Protocol research

Target device: **CMF Headphone Pro**, internal model code **B175**.

## Sources

| # | Source | Licence | Version read | How we use it |
|---|---|---|---|---|
| S1 | [radiance-project/ear-web](https://github.com/radiance-project/ear-web) (Ear (web), earweb.bttl.xyz) | AGPL-3.0 | `d076e13`, 2026-10-07 | Facts only, no code copied |
| S2 | [maniacx/BudsLink](https://github.com/maniacx/BudsLink) (BudsLink, Nothing/CMF module) | GPL-3.0 | `13a234c`, 2026-10-07 | Facts only, no code copied |
| S3 | `ear_config_file.json` shipped inside S1, a capability table taken from the official app | n/a | as S1 | Feature flags for B175 |
| S4 | Google Fast Pair Message Stream spec | public | n/a | Model ID message |

Not reachable from the build environment: Bharadwaj Raju's Ear (2) write-up (blog domain does not resolve; its code `ear2ctl` is on Codeberg, which is blocked here) and the EarA-linux dev.to post. Both cover earbuds only and add nothing S1 and S2 do not already show.

Both S1 and S2 are copyleft. This repo is MIT, so we take **protocol facts only** (byte layouts are not copyrightable) and write all code ourselves. S1 also ships Nothing's proprietary Ndot font files; we do not.

**Status key**
- **CONFIRMED**: same bytes in S1 and S2 (or later, seen in the capture).
- **UNVERIFIED**: one source only, or the sources disagree.

Nothing below gets into `commands.js` until the capture backs it up for B175.

## 1. Transport

| Item | Value | Status |
|---|---|---|
| Link | Bluetooth Classic RFCOMM (SPP), **not** BLE | CONFIRMED (S1, S2) |
| Control service UUID | `aeac4a03-dff5-498f-843a-34487cf133eb` | CONFIRMED (S1 `connectSPP`, S2 `NothingBudsUUID`) |
| Fast Pair service UUID | `df21fe2c-2515-4fdb-8886-f12c4d67927c` | CONFIRMED (S1, S2 `GfpsUUID`) |
| Web Serial call | `navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [UUID], filters: [{ bluetoothServiceClassId: UUID }] })` then `port.open({ baudRate: 9600 })` | S1, working in production |
| Baud rate | Ignored over RFCOMM, but `open()` requires a value. S1 uses 9600. | S1 |

## 2. Frame layout

```
offset  0     1     2     3       4       5       6       7     8 .. 8+n-1   8+n    9+n
      +-----+-----+-----+-------+-------+-------+-------+-----+------------+------+------+
      | 55  | 60  | 01  | cmdLo | cmdHi | lenLo | lenHi | seq |  payload   | crcLo| crcHi|
      +-----+-----+-----+-------+-------+-------+-------+-----+------------+------+------+
```

| Field | Detail | Status |
|---|---|---|
| Magic | `0x55` | CONFIRMED |
| Control | bytes 1–2, sent as `60 01`. S2 reads them as a little-endian word; **bit `0x20` set means a CRC is present**. Incoming frames may arrive without a CRC. | CONFIRMED value; CRC-flag rule UNVERIFIED (S2 only) |
| Command | bytes 3–4, uint16 little-endian | CONFIRMED |
| Length | payload length. S1 writes byte 5 only and byte 6 = 0; S2 reads bytes 5–6 as uint16 LE | CONFIRMED (same for payloads < 256) |
| Seq / operation id | byte 7, counts 1..250 and wraps. Replies echo it. S2 matches replies to requests with it. | CONFIRMED |
| Payload | `len` bytes | CONFIRMED |
| CRC | **CRC-16/MODBUS**: init `0xFFFF`, reflected poly `0xA001`, no final XOR, over bytes `0 .. 7+len`, appended **little-endian** | CONFIRMED (S1 bitwise, S2 table: same algorithm) |

### Command-ID families (pattern seen across every opcode in S1 and S2)

| High byte | Meaning |
|---|---|
| `0xC0xx` | GET request (host to device) |
| `0x40xx` | reply to a GET, same low byte |
| `0xF0xx` | SET request (host to device) |
| `0xE0xx`, `0x60xx`, `0x70xx` | unsolicited push from the device (state changed on the headphones themselves) |

### Parser notes

- S1 assumes one frame per serial chunk. Split or merged chunks break it. S2 buffers and scans for `0x55`, which is what our streaming parser must do.
- S2 clears the buffer if it grows past 300 bytes without a full frame.

## 3. Commands

"Seen for B175" says whether the source explicitly enables this feature for model B175, not just for the family.

| Feature | GET | Reply / push | SET and payload | Decoding | Seen for B175 | Status |
|---|---|---|---|---|---|---|
| **Model ID** | `C01C` | `401C` | — | payload `[lo, hi]`, e.g. `75 B1` gives `"B175"` | S2 | UNVERIFIED |
| Model ID (alt) | — | 7-byte Fast Pair message on the Fast Pair UUID: `03 01 00 03 <id×3>` | — | B175 ids `563DA5` green, `73C9EB` white, `1EFB39` black | S1 (+ S4 format) | UNVERIFIED |
| **Firmware** | `C042` | `4042` | — | payload is an ASCII string | S1, S2 (all models) | CONFIRMED |
| **Battery** | `C007` | `4007`, push `E001` | — | `[count, (devId, lvl)…]`, `lvl & 0x7F` = %, `lvl & 0x80` = charging. Headphone `devId = 0x06` | S1 (`stereo`), S2 (`batterySingle`) | CONFIRMED |
| **Noise control** | `C01E` | `401E`, push `E003` (S1 also `6003`) | `F00F` `[01, mode, 00]` | mode = `payload[1]`: `05` Off, `07` Transparency, `01` ANC High, `02` ANC Mid, `03` ANC Low, `04` ANC Adaptive | S1, S2 (B175 config) | **CONFIRMED** |
| **EQ preset** | `C050` | `4050` (S1) or `401F` (S2) | S1 `F01D` `[idx, 00]`; S2 `F010` `[idx, 00]` | `idx = payload[0]` | S1, S2 | **UNVERIFIED (sources disagree)** |
| **Spatial audio** | `C04F` | `404F` | `F052` `[mode, head]` | mode `0` Off, `2` Concert, `3` Theatre (Cinema); head `1` = head-tracked | S1 only | **UNVERIFIED** |
| **Low Lag** | `C041` | `4041`, push `7040` | `F040` `[01 = on / 02 = off, 00]` | `payload[0] == 1` means on | S2 (`lowLatencyMode: true`); S1 sends it to every model | CONFIRMED (bytes); B175 support from S2 only |

### EQ conflict, which the capture must settle

| idx | S1 (ear-web, B175 page) | S2 (BudsLink, B175 config) |
|---|---|---|
| 0 | Dirac Opteo (hidden button) | Balanced |
| 1 | Rock | Voice |
| 2 | Electronic | More treble |
| 3 | Pop | More bass |
| 4 | Enhance vocals | — |
| 5 | Classical | Custom |
| 6 | Custom | — |

S2's B175 file starts with the comment `// Nothing Headphone (1)`, so it looks like a copy of another model's file. S1's list looks more likely to be right, but neither is proof.

### Spatial audio risk

The official capability table (S3) gives B175 `spatialAudio: 28` (`0x1C`) = bits `0x04 | 0x08 | 0x10`. S1 maps `0x08` to Concert and `0x10` to Theatre. **Bit `0x04` has no known mapping.** B175 also has `audiodo: 1`, and S1 says Audiodo-based spatial audio uses a separate SDK and pushes (`E029` / `6029`). Spatial may therefore use different commands from the table above. BudsLink does not implement spatial audio for B175 at all.

### B175 capabilities from the official table (S3)

| Key | Value | Meaning |
|---|---|---|
| `ancLevel` | `63` (`0x3F`) | Transparency, High/Low, Mid, Adaptive: four ANC strengths |
| `spatialAudio` | `28` | see above |
| `customEQ` | 3 bands: low 140 Hz, peak 980 Hz, high 3500 Hz | v2 Custom EQ |
| `deviceType` | `6` | single-unit headphone (matches battery devId `0x06`) |
| `audiodo` | `1` | Personal Sound Profile is Audiodo-based (v2, read-only first) |
| `isUseGattOverBREDR` | `1` | some features may use GATT over Classic. Watch for this in the capture. |

## 4. Never send

We have no reason to send these, and they are excluded from the allowlist:

- Firmware / OTA (B175 `otaProtocol: 2`), any opcode we have not seen in the capture
- Factory reset, pairing, dual-connection management (`F01A`, `F01B`)
- Ring / find device (`F002`): harmless, but out of scope for v1
- UTC time set (`F00A`): S1 sends it at connect; we will only if the official app does in the capture

## 5. What the capture must answer

1. EQ: which SET opcode (`F01D` or `F010`) and which index belongs to which preset name.
2. Spatial: does the app use `F052` / `404F`, and what are the bytes for Off, Cinema, Concert and the unknown `0x04` mode?
3. Model ID: does the app send `C01C`, and does the reply read `75 B1`?
4. Low Lag: `F040` with `01` / `02`?
5. Do incoming frames carry a CRC (control bit `0x20`)?
6. The connect-time sequence: everything the app sends in the first seconds. This defines our safe read-only init.

## 6. What this changes in the plan

- **Transport stays Web Serial (RFCOMM).** BLE is not needed.
- **The model check is possible** (problem 5 from the planning chat): read the model ID after connecting and lock to read-only unless it is B175.
- **ANC levels are in scope for v1**: High, Mid, Low and Adaptive, all confirmed by both sources for B175.
