// CONFIRMED outgoing commands only: same bytes in both sources for the CMF Headphone Pro (B175).
//   S1 = radiance-project/ear-web @ d076e13
//   S2 = maniacx/BudsLink @ 13a234c
// Evidence: docs/protocol-research.md section 3. Unconfirmed commands live in drafts.js.

export const OP = {
  GET_BATTERY: 0xc007,  // S1 sendBattery(), S2 BATTERY_GET
  GET_FIRMWARE: 0xc042, // S1 getFirmware(), S2 FIRMWARE_GET
  GET_ANC: 0xc01e,      // S1 sendANCread(), S2 ANC_GET
  SET_ANC: 0xf00f,      // S1 setANC_BT(), S2 ANC_SET
};

export const CONFIRMED_OUTGOING = {
  [OP.GET_BATTERY]: 'GET battery',
  [OP.GET_FIRMWARE]: 'GET firmware',
  [OP.GET_ANC]: 'GET noise control',
  [OP.SET_ANC]: 'SET noise control',
};

// Noise control mode byte. S1 setANC_BT()/readANC() and S2 CMFHeadphonePro.js agree.
export const ANC_BYTES = { off: 0x05, transparency: 0x07, high: 0x01, mid: 0x02, low: 0x03, adaptive: 0x04 };

// One builder per feature, returning {command, payload}. The session adds seq and CRC.
export const cmd = {
  getBattery: () => ({ command: OP.GET_BATTERY, payload: [] }),
  getFirmware: () => ({ command: OP.GET_FIRMWARE, payload: [] }),
  getAnc: () => ({ command: OP.GET_ANC, payload: [] }),
  // S1 and S2: payload [01, mode, 00]
  setAnc: (mode) => {
    const b = ANC_BYTES[mode];
    if (b === undefined) throw new Error(`unknown noise mode: ${mode}`);
    return { command: OP.SET_ANC, payload: [0x01, b, 0x00] };
  },
};
