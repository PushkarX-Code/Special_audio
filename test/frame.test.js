import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, encodeFrame, decodeFrame, FrameParser, fromHex, toHex } from '../app/src/protocol/frame.js';

// Independent table-driven CRC-16/MODBUS, to check our bitwise version against a second implementation.
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  return c;
});
const crcTable = (bytes) => bytes.reduce((crc, b) => TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8), 0xffff);

test('crc16 matches the CRC-16/MODBUS check value', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x4b37);
});

test('crc16 matches a table implementation on random data', () => {
  for (let i = 0; i < 200; i++) {
    const data = Uint8Array.from({ length: 1 + (i % 40) }, () => Math.floor(Math.random() * 256));
    assert.equal(crc16(data), crcTable([...data]));
  }
});

test('encodeFrame builds header, payload and little-endian crc', () => {
  const f = encodeFrame(0xf00f, [0x01, 0x07, 0x00], 5);
  assert.deepEqual([...f.slice(0, 8)], [0x55, 0x60, 0x01, 0x0f, 0xf0, 0x03, 0x00, 0x05]);
  assert.deepEqual([...f.slice(8, 11)], [0x01, 0x07, 0x00]);
  const crc = crc16(f.slice(0, 11));
  assert.deepEqual([...f.slice(11)], [crc & 0xff, crc >> 8]);
});

test('encode -> decode round trips byte for byte', () => {
  for (const [cmd, payload, seq] of [[0xc007, [], 1], [0xf00f, [1, 5, 0], 250], [0x4042, [...'1.0.0.27'].map((c) => c.charCodeAt(0)), 33]]) {
    const bytes = encodeFrame(cmd, payload, seq);
    const f = decodeFrame(bytes);
    assert.equal(f.command, cmd);
    assert.equal(f.seq, seq);
    assert.deepEqual([...f.payload], payload);
    assert.equal(toHex(f.raw), toHex(bytes));
  }
});

test('decodeFrame rejects a corrupted crc', () => {
  const bytes = encodeFrame(0xc007, [], 1);
  bytes[bytes.length - 1] ^= 0xff;
  assert.throws(() => decodeFrame(bytes), /bad crc/);
});

test('frames without the crc flag decode without a crc', () => {
  // control word 0x0140 has bit 0x20 clear
  const f = decodeFrame(fromHex('55 40 01 07 40 03 00 09 01 06 52'));
  assert.equal(f.command, 0x4007);
  assert.deepEqual([...f.payload], [0x01, 0x06, 0x52]);
});

test('stream parser handles split, merged and noisy chunks', () => {
  const a = encodeFrame(0x4007, [1, 6, 80], 1);
  const b = encodeFrame(0x401e, [1, 7, 0], 2);
  const c = encodeFrame(0xe003, [1, 5, 0], 0);
  const stream = new Uint8Array([0x00, 0x13, ...a, 0xaa, ...b, ...c]);
  for (const cut of [1, 3, 7, 11, 13]) {
    const got = [];
    const p = new FrameParser((f) => got.push(f.command));
    for (let i = 0; i < stream.length; i += cut) p.push(stream.slice(i, i + cut));
    assert.deepEqual(got, [0x4007, 0x401e, 0xe003], `chunk size ${cut}`);
  }
});

test('stream parser recovers after a frame with a bad crc', () => {
  const bad = encodeFrame(0x4007, [1, 6, 80], 1);
  bad[bad.length - 2] ^= 1;
  const good = encodeFrame(0x4042, [0x31], 2);
  const got = [], errors = [];
  const p = new FrameParser((f) => got.push(f.command), (e) => errors.push(e));
  p.push(new Uint8Array([...bad, ...good]));
  assert.deepEqual(got, [0x4042]);
  assert.ok(errors.includes('bad crc'));
});
