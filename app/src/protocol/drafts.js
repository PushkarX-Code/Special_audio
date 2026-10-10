// DRAFT outgoing commands: one source only, or the sources disagree.
// The guard lets these reach the demo device only. They move to commands.js once the capture confirms them.
//   S1 = radiance-project/ear-web @ d076e13
//   S2 = maniacx/BudsLink @ 13a234c

export const DOP = {
  GET_MODEL: 0xc01c,   // S2 DEVICE_MODEL_GET only
  GET_EQ: 0xc050,      // S1 getListeningMode(), S2 LISTENING_MODE_GET
  SET_EQ: 0xf01d,      // S1 setListeningMode(). S2 uses 0xF010 instead: conflict
  GET_SPATIAL: 0xc04f, // S1 getSpatialAudio() only
  SET_SPATIAL: 0xf052, // S1 setSpatialAudio_BT() only
  GET_LOW_LAG: 0xc041, // S1 sendLatencyModeRead(), S2 LATENCY_GET. B175 support: S2 only
  SET_LOW_LAG: 0xf040, // S1 setLatency(), S2 setLatency(). B175 support: S2 only
};

export const DRAFT_OUTGOING = {
  [DOP.GET_MODEL]: 'GET model',
  [DOP.GET_EQ]: 'GET eq preset',
  [DOP.SET_EQ]: 'SET eq preset',
  [DOP.GET_SPATIAL]: 'GET spatial audio',
  [DOP.SET_SPATIAL]: 'SET spatial audio',
  [DOP.GET_LOW_LAG]: 'GET low lag',
  [DOP.SET_LOW_LAG]: 'SET low lag',
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

// [mode, head] from S1 SPATIAL_AUDIO_MODES. "Cinema" is assumed to be S1's "Theatre".
export const SPATIAL_BYTES = { off: [0, 0], concert: [2, 0], cinema: [3, 0] };

// 01 = on, 02 = off. S1 and S2 setLatency().
export const LOW_LAG_BYTES = { on: 0x01, off: 0x02 };

export const draftCmd = {
  getModel: () => ({ command: DOP.GET_MODEL, payload: [] }),
  getEq: () => ({ command: DOP.GET_EQ, payload: [] }),
  setEq: (id) => {
    const p = EQ_PRESETS.find((x) => x.id === id);
    if (!p) throw new Error(`unknown eq preset: ${id}`);
    return { command: DOP.SET_EQ, payload: [p.index, 0x00] };
  },
  getSpatial: () => ({ command: DOP.GET_SPATIAL, payload: [] }),
  setSpatial: (mode) => {
    const b = SPATIAL_BYTES[mode];
    if (!b) throw new Error(`unknown spatial mode: ${mode}`);
    return { command: DOP.SET_SPATIAL, payload: [...b] };
  },
  getLowLag: () => ({ command: DOP.GET_LOW_LAG, payload: [] }),
  setLowLag: (on) => ({ command: DOP.SET_LOW_LAG, payload: [on ? LOW_LAG_BYTES.on : LOW_LAG_BYTES.off, 0x00] }),
};
