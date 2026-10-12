// Incoming frames -> state patches, e.g. {battery: {level: 82, charging: false}} or {anc: 'transparency'}.
// Byte positions are payload offsets (frame offset minus the 8-byte header).
// Sources as in commands.js: S1 = ear-web, S2 = BudsLink.
import { ANC_BYTES } from './commands.js';
import { EQ_PRESETS, SPATIAL_BYTES, LOW_LAG_BYTES, CUSTOM_PRESET_INDEX, decodeCustomEq, CODECS, CONTROL_SLOTS, CONTROL_ACTIONS, SLOT_ACTIONS } from './drafts.js';

export const IN = {
  BATTERY_REPLY: 0x4007, // S1, S2
  BATTERY_PUSH: 0xe001,  // S1, S2
  FIRMWARE: 0x4042,      // S1, S2
  ANC_REPLY: 0x401e,     // S1, S2
  ANC_PUSH: 0xe003,      // S1, S2
  ANC_PUSH_ALT: 0x6003,  // S1 only
  MODEL: 0x401c,         // S2 only (draft)
  EQ: 0x4050,            // S1 (draft)
  EQ_ALT: 0x401f,        // S2 (draft)
  CUSTOM_EQ: 0x4044,     // S1, S2 (draft)
  CODEC: 0x4029,         // S1 (draft)
  CONTROLS: 0x4018,      // S1, S2 (draft)
  SPATIAL: 0x404f,       // S1 (draft)
  LOW_LAG_REPLY: 0x4041, // S1, S2
  LOW_LAG_PUSH: 0x7040,  // S2 only
};

export const INCOMING_NAMES = {
  [IN.BATTERY_REPLY]: 'battery', [IN.BATTERY_PUSH]: 'battery (push)',
  [IN.FIRMWARE]: 'firmware',
  [IN.ANC_REPLY]: 'noise control', [IN.ANC_PUSH]: 'noise control (push)', [IN.ANC_PUSH_ALT]: 'noise control (push)',
  [IN.MODEL]: 'model', [IN.EQ]: 'eq preset', [IN.EQ_ALT]: 'eq preset', [IN.CUSTOM_EQ]: 'custom eq', [IN.CODEC]: 'audio codec', [IN.CONTROLS]: 'button controls', [IN.SPATIAL]: 'spatial audio',
  [IN.LOW_LAG_REPLY]: 'low lag', [IN.LOW_LAG_PUSH]: 'low lag (push)',
};

const HEADPHONE_DEVICE_ID = 0x06; // S1 deviceIdToKey "stereo", S2 BatteryType.SINGLE
const ANC_BY_BYTE = Object.fromEntries(Object.entries(ANC_BYTES).map(([k, v]) => [v, k]));

// Noise byte -> {anc, ancLevel}. ANC strengths all mean anc = 'anc'.
function noiseFromByte(b) {
  const name = ANC_BY_BYTE[b];
  if (!name) return null;
  if (name === 'off' || name === 'transparency') return { anc: name };
  return { anc: 'anc', ancLevel: name };
}

export function parseFrame({ command, payload: p }) {
  switch (command) {
    case IN.BATTERY_REPLY:
    case IN.BATTERY_PUSH: {
      // [count, (deviceId, level)...]: level & 0x7F = percent, level & 0x80 = charging (S1 readBattery, S2)
      const count = p[0] ?? 0;
      let pick = null;
      for (let i = 0; i < count && 2 + i * 2 < p.length; i++) {
        const id = p[1 + i * 2], raw = p[2 + i * 2];
        if (pick === null || id === HEADPHONE_DEVICE_ID) pick = raw;
      }
      if (pick === null) return null;
      return { battery: { level: Math.min(100, pick & 0x7f), charging: (pick & 0x80) !== 0 } };
    }
    case IN.FIRMWARE:
      return { firmware: String.fromCharCode(...p).replace(/\0/g, '').trim() };
    case IN.ANC_REPLY:
    case IN.ANC_PUSH:
    case IN.ANC_PUSH_ALT:
      return noiseFromByte(p[1]); // mode is payload[1] (S1 readANC: frame[9], S2 payload[1])
    case IN.MODEL: {
      if (p.length < 2) return null;
      return { model: ((p[1] << 8) | p[0]).toString(16).toUpperCase() }; // 75 B1 -> "B175"
    }
    case IN.EQ:
    case IN.EQ_ALT: {
      if (p[0] === CUSTOM_PRESET_INDEX) return { eq: 'custom' };
      const preset = EQ_PRESETS.find((x) => x.index === p[0]);
      return preset ? { eq: preset.id } : null;
    }
    case IN.CODEC: {
      const name = Object.keys(CODECS).find((k) => CODECS[k] === p[0]);
      return name ? { codec: name } : null;
    }
    case IN.CONTROLS: {
      const controls = {};
      for (let i = 0, o = 1; i < (p[0] ?? 0) && o + 3 < p.length; i++, o += 4) {
        const slot = CONTROL_SLOTS.find((x) => x.button === p[o + 1] && x.type === p[o + 2]);
        const action = slot && SLOT_ACTIONS[slot.id].find((a) => CONTROL_ACTIONS[a].code === p[o + 3]);
        if (slot && action) controls[slot.id] = action;
      }
      return Object.keys(controls).length ? { controls } : null;
    }
    case IN.CUSTOM_EQ: {
      const bands = decodeCustomEq(p);
      return bands ? { customEq: bands } : null;
    }
    case IN.SPATIAL: {
      const found = Object.entries(SPATIAL_BYTES).find(([, [m]]) => m === p[0]);
      return found ? { spatial: found[0] } : null;
    }
    case IN.LOW_LAG_REPLY:
    case IN.LOW_LAG_PUSH:
      return { lowLag: p[0] === LOW_LAG_BYTES.on };
    default:
      return null;
  }
}
