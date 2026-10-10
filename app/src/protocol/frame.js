// Frame encode/decode for the Nothing/CMF RFCOMM protocol.
// Layout and CRC: docs/protocol-research.md section 2 (CONFIRMED in ear-web and BudsLink).
//
//   55 | 60 01 | cmdLo cmdHi | lenLo lenHi | seq | payload... | crcLo crcHi

export const MAGIC = 0x55;
export const HEADER_LEN = 8;
export const CRC_LEN = 2;
// Control bytes we send. Bit 0x20 of the little-endian control word means "CRC present".
const CONTROL = [0x60, 0x01];
const CRC_FLAG = 0x20;
const MAX_BUFFER = 4096;

// CRC-16/MODBUS: init 0xFFFF, reflected poly 0xA001, no final xor. Appended little-endian.
export function crc16(bytes, end = bytes.length) {
  let crc = 0xffff;
  for (let i = 0; i < end; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

export function encodeFrame(command, payload = [], seq = 1) {
  const len = payload.length;
  const out = new Uint8Array(HEADER_LEN + len + CRC_LEN);
  out.set([MAGIC, ...CONTROL, command & 0xff, (command >> 8) & 0xff, len & 0xff, (len >> 8) & 0xff, seq & 0xff]);
  out.set(payload, HEADER_LEN);
  const crc = crc16(out, HEADER_LEN + len);
  out[HEADER_LEN + len] = crc & 0xff;
  out[HEADER_LEN + len + 1] = crc >> 8;
  return out;
}

// Decode one complete frame. Throws on anything malformed.
export function decodeFrame(bytes) {
  const f = tryRead(bytes, 0);
  if (!f || f.error) throw new Error(f ? f.error : 'incomplete frame');
  if (f.size !== bytes.length) throw new Error('trailing bytes after frame');
  return f.frame;
}

// Returns {frame, size}, {error, size} or null when more bytes are needed.
function tryRead(buf, i) {
  if (buf.length - i < HEADER_LEN) return null;
  const control = buf[i + 1] | (buf[i + 2] << 8);
  const hasCrc = (control & CRC_FLAG) !== 0;
  const len = buf[i + 5] | (buf[i + 6] << 8);
  const size = HEADER_LEN + len + (hasCrc ? CRC_LEN : 0);
  if (size > MAX_BUFFER) return { error: 'length out of range', size: 1 };
  if (buf.length - i < size) return null;
  if (hasCrc) {
    const want = buf[i + HEADER_LEN + len] | (buf[i + HEADER_LEN + len + 1] << 8);
    if (crc16(buf.subarray(i, i + HEADER_LEN + len)) !== want) return { error: 'bad crc', size: 1 };
  }
  const raw = buf.slice(i, i + size);
  return {
    size,
    frame: {
      command: buf[i + 3] | (buf[i + 4] << 8),
      seq: buf[i + 7],
      payload: raw.slice(HEADER_LEN, HEADER_LEN + len),
      raw,
    },
  };
}

// Streaming parser: feed it serial chunks in any size, it emits whole frames.
// Handles frames split across chunks, several frames in one chunk, and junk between frames.
export class FrameParser {
  constructor(onFrame, onError = () => {}) {
    this.onFrame = onFrame;
    this.onError = onError;
    this.buf = new Uint8Array(0);
  }

  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    let i = 0;
    while (i < merged.length) {
      if (merged[i] !== MAGIC) { i++; continue; }
      const r = tryRead(merged, i);
      if (!r) break; // wait for more bytes
      if (r.error) { this.onError(r.error, merged.slice(i, i + HEADER_LEN)); i += r.size; continue; }
      this.onFrame(r.frame);
      i += r.size;
    }
    this.buf = merged.slice(i);
    if (this.buf.length > MAX_BUFFER) this.buf = new Uint8Array(0);
  }

  reset() { this.buf = new Uint8Array(0); }
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
export const fromHex = (hex) => Uint8Array.from(hex.replace(/[^0-9a-f]/gi, '').match(/../g) ?? [], (h) => parseInt(h, 16));
