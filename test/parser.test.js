import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame } from '../app/src/protocol/parser.js';

const f = (command, payload) => ({ command, payload: Uint8Array.from(payload) });

test('battery: headphone device id 0x06, charging bit', () => {
  assert.deepEqual(parseFrame(f(0x4007, [1, 0x06, 82])), { battery: { level: 82, charging: false } });
  assert.deepEqual(parseFrame(f(0xe001, [1, 0x06, 0x80 | 40])), { battery: { level: 40, charging: true } });
});

test('battery: truncated payload is ignored', () => {
  assert.equal(parseFrame(f(0x4007, [1, 0x06])), null);
  assert.equal(parseFrame(f(0x4007, [])), null);
});

test('noise control bytes map to modes and levels', () => {
  assert.deepEqual(parseFrame(f(0x401e, [1, 0x05, 0])), { anc: 'off' });
  assert.deepEqual(parseFrame(f(0x401e, [1, 0x07, 0])), { anc: 'transparency' });
  assert.deepEqual(parseFrame(f(0xe003, [1, 0x01, 0])), { anc: 'anc', ancLevel: 'high' });
  assert.deepEqual(parseFrame(f(0x401e, [1, 0x04, 0])), { anc: 'anc', ancLevel: 'adaptive' });
  assert.equal(parseFrame(f(0x401e, [1, 0x09, 0])), null);
});

test('firmware is an ascii string', () => {
  assert.deepEqual(parseFrame(f(0x4042, [...'1.0.2.3'].map((c) => c.charCodeAt(0)))), { firmware: '1.0.2.3' });
});

test('model id 75 B1 reads as B175', () => {
  assert.deepEqual(parseFrame(f(0x401c, [0x75, 0xb1])), { model: 'B175' });
});

test('unknown frames produce no state change', () => {
  assert.equal(parseFrame(f(0x1234, [1, 2, 3])), null);
});
