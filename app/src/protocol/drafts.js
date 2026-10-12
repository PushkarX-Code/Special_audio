// DRAFT outgoing commands: one source only, or the sources disagree.
// The guard lets these reach the demo device, or real headphones when the user turns on Settings → Experimental
// controls. They move to commands.js once the capture confirms them.
//   S1 = radiance-project/ear-web @ d076e13
//   S2 = maniacx/BudsLink @ 13a234c

export const DOP = {
  GET_MODEL: 0xc01c,   // S2 DEVICE_MODEL_GET only
  GET_EQ: 0xc050,      // S1 getListeningMode(), S2 LISTENING_MODE_GET
  SET_EQ: 0xf01d,      // S1 setListeningMode(). S2 uses 0xF010 instead: conflict
  SET_EQ_ALT: 0xf010,  // S2 LISTENING_MODE_SET. Tried only if SET_EQ doesn't change the preset
  GET_SPATIAL: 0xc04f, // S1 getSpatialAudio() only
  SET_SPATIAL: 0xf052, // S1 setSpatialAudio_BT() only
  GET_LOW_LAG: 0xc041, // S1 sendLatencyModeRead(), S2 LATENCY_GET. B175 support: S2 only
  SET_LOW_LAG: 0xf040, // S1 setLatency(), S2 setLatency(). B175 support: S2 only
  GET_CUSTOM_EQ: 0xc044, // S1 getCustomEQ(), S2 CUSTOM_EQ_GET. Reply 0x4044
  SET_CUSTOM_EQ: 0xf041, // S1 setCustomEQ_BT(), S2 CUSTOM_EQ_SET
};

export const DRAFT_OUTGOING = {
  [DOP.GET_MODEL]: 'GET model',
  [DOP.GET_EQ]: 'GET eq preset',
  [DOP.SET_EQ]: 'SET eq preset',
  [DOP.SET_EQ_ALT]: 'SET eq preset (alt)',
  [DOP.GET_SPATIAL]: 'GET spatial audio',
  [DOP.SET_SPATIAL]: 'SET spatial audio',
  [DOP.GET_LOW_LAG]: 'GET low lag',
  [DOP.SET_LOW_LAG]: 'SET low lag',
  [DOP.GET_CUSTOM_EQ]: 'GET custom eq',
  [DOP.SET_CUSTOM_EQ]: 'SET custom eq',
};

// Index order from S1 MainControl_forretress.html. S2 disagrees (see research doc).
export const EQ_PRESETS = [
  { id: 'dirac', label: 'Dirac Opteo', index: 0 },
  { id: 'pop', label: 'Pop', index: 3 },
  { id: 'rock', label: 'Rock', index: 1 },
  { id: 'classical', label: 'Classical', index: 5 },
  { id: 'electronic', label: 'Electronic', index: 2 },
  { id: 'vocals', label: 'Vocals', index: 4 },
];
// The custom EQ slot (S1 B175 page: index 6). Selected when the user edits Bass / Mid / Treble.
export const CUSTOM_PRESET_INDEX = 6;

// Custom EQ, 3 bands. Shape and filter values from the official capability table (S3, B175):
// low shelf 140 Hz Q 0.8, peak 980 Hz Q 0.7, high shelf 3500 Hz Q 1.0, gain -6..+6 dB.
// Payload layout (S1 createEQPacket, S2 setCustomEq agree): [count, overall gain f32] then per band
// [type, gain f32, freq f32, Q f32], then 3 zero bytes per band. Floats are little-endian.
// Band order on the wire: peak (mid), high shelf (treble), low shelf (bass). Types: 0 low shelf, 1 peak, 2 high shelf.
export const CUSTOM_EQ_BANDS = [
  { key: 'mid', type: 1, freq: 980, q: 0.7 },
  { key: 'treble', type: 2, freq: 3500, q: 1.0 },
  { key: 'bass', type: 0, freq: 140, q: 0.8 },
];
export const CUSTOM_EQ_RANGE = 6;
const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return [...b]; };
const clampGain = (v) => Math.max(-CUSTOM_EQ_RANGE, Math.min(CUSTOM_EQ_RANGE, Math.round(Number(v) * 2) / 2 || 0));

// [bass, mid, treble] in dB -> payload bytes.
export function encodeCustomEq([bass, mid, treble]) {
  const gain = { bass: clampGain(bass), mid: clampGain(mid), treble: clampGain(treble) };
  // Overall gain lowers the output by the biggest boost so it doesn't clip (S1: -max(gain, 0)).
  const out = [CUSTOM_EQ_BANDS.length, ...f32(-Math.max(0, gain.bass, gain.mid, gain.treble))];
  for (const b of CUSTOM_EQ_BANDS) out.push(b.type, ...f32(gain[b.key]), ...f32(b.freq), ...f32(b.q));
  return [...out, ...new Array(CUSTOM_EQ_BANDS.length * 3).fill(0)];
}

// Reply payload -> [bass, mid, treble], or null if it's too short.
export function decodeCustomEq(p) {
  if (!p || p.length < 5 + CUSTOM_EQ_BANDS.length * 13) return null;
  const read = (o) => new DataView(Uint8Array.from(p.slice(o, o + 4)).buffer).getFloat32(0, true);
  const g = {};
  CUSTOM_EQ_BANDS.forEach((b, i) => (g[b.key] = clampGain(read(6 + i * 13))));
  return [g.bass, g.mid, g.treble];
}


// [mode, head] from S1 SPATIAL_AUDIO_MODES. "Cinema" is assumed to be S1's "Theatre".
export const SPATIAL_BYTES = { off: [0, 0], concert: [2, 0], cinema: [3, 0] };

// 01 = on, 02 = off. S1 and S2 setLatency().
export const LOW_LAG_BYTES = { on: 0x01, off: 0x02 };

export const draftCmd = {
  getModel: () => ({ command: DOP.GET_MODEL, payload: [] }),
  getEq: () => ({ command: DOP.GET_EQ, payload: [] }),
  setEq: (id, command = DOP.SET_EQ) => {
    const p = EQ_PRESETS.find((x) => x.id === id);
    if (!p) throw new Error(`unknown eq preset: ${id}`);
    if (command !== DOP.SET_EQ && command !== DOP.SET_EQ_ALT) throw new Error('not an eq opcode');
    return { command, payload: [p.index, 0x00] };
  },
  getSpatial: () => ({ command: DOP.GET_SPATIAL, payload: [] }),
  setSpatial: (mode) => {
    const b = SPATIAL_BYTES[mode];
    if (!b) throw new Error(`unknown spatial mode: ${mode}`);
    return { command: DOP.SET_SPATIAL, payload: [...b] };
  },
  getLowLag: () => ({ command: DOP.GET_LOW_LAG, payload: [] }),
  setLowLag: (on) => ({ command: DOP.SET_LOW_LAG, payload: [on ? LOW_LAG_BYTES.on : LOW_LAG_BYTES.off, 0x00] }),
  getCustomEq: () => ({ command: DOP.GET_CUSTOM_EQ, payload: [] }),
  setCustomEq: (bands) => ({ command: DOP.SET_CUSTOM_EQ, payload: encodeCustomEq(bands) }),
  selectCustom: (command = DOP.SET_EQ) => ({ command, payload: [CUSTOM_PRESET_INDEX, 0x00] }),
};
