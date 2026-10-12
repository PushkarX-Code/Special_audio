import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../app/src/device/controller.js';
import { MockHeadphones } from '../app/src/device/mock.js';
import { encodeFrame } from '../app/src/protocol/frame.js';
import { DOP } from '../app/src/protocol/drafts.js';
import { OP } from '../app/src/protocol/commands.js';

// A "real" headphone (kind native) that ignores the S1 EQ opcode and only understands S2's 0xF010.
function realHeadphones() {
  const m = new MockHeadphones();
  m.kind = 'native';
  m.sentOps = [];
  const send = m.send.bind(m);
  m.send = (bytes) => {
    const command = bytes[3] | (bytes[4] << 8), seq = bytes[7], payload = [...bytes.slice(8, bytes.length - 2)];
    m.sentOps.push(command);
    if (command === DOP.SET_EQ) return send(encodeFrame(OP.GET_BATTERY, [], seq)); // replied to, but no effect
    if (command === DOP.SET_EQ_ALT) return send(encodeFrame(DOP.SET_EQ, payload, seq));
    return send(bytes);
  };
  return m;
}

test('real headphones: EQ stays locked until Experimental controls are on', async () => {
  const c = new Controller();
  const dev = realHeadphones();
  await c.connect(dev);
  assert.equal(c.state.features.eq, false);
  assert.equal(c.state.features.anc, true);
  assert.ok(!dev.sentOps.includes(DOP.GET_EQ), 'no draft reads while experimental is off');
  await c.setEq('rock');
  assert.ok(!dev.sentOps.includes(DOP.SET_EQ));

  await c.setExperimental(true);
  assert.equal(c.state.features.eq, true);
  assert.equal(c.state.features.customEq, true);
  assert.ok(dev.sentOps.includes(DOP.GET_EQ));
  await c.disconnect();
});

test('real headphones: EQ falls back to the other opcode and remembers it', async () => {
  const c = new Controller();
  let learned = null;
  c.onEqOpLearned = (op) => (learned = op);
  c.setExperimental(true);
  const dev = realHeadphones();
  await c.connect(dev);
  await c.setEq('rock');
  assert.equal(c.state.eq, 'rock');
  assert.equal(learned, DOP.SET_EQ_ALT);
  dev.sentOps.length = 0;
  await c.setEq('pop');
  assert.equal(c.state.eq, 'pop');
  assert.ok(!dev.sentOps.includes(DOP.SET_EQ), 'goes straight to the opcode that worked');
  await c.disconnect();
});

test('custom EQ: bytes match the documented layout and survive a round trip', async () => {
  const { encodeCustomEq, decodeCustomEq } = await import('../app/src/protocol/drafts.js');
  const p = encodeCustomEq([4, -2.5, 1]);
  assert.equal(p.length, 53);
  assert.equal(p[0], 3);
  assert.deepEqual(p.slice(1, 5), [0x00, 0x00, 0x80, 0xc0]); // overall gain -4.0 (LE float)
  assert.equal(p[5], 1); // first band: peak (mid)
  assert.deepEqual(p.slice(10, 14), [0x00, 0x00, 0x75, 0x44]); // 980 Hz
  assert.deepEqual(decodeCustomEq(p), [4, -2.5, 1]);
  assert.deepEqual(decodeCustomEq(encodeCustomEq([9, -9, 0.26])), [6, -6, 0.5]); // clamped, 0.5 dB steps
});

test('custom EQ reaches the headphones and is read back', async () => {
  const c = new Controller();
  c.setExperimental(true);
  const dev = realHeadphones();
  await c.connect(dev);
  assert.equal(c.state.features.customEq, true);
  await c.setCustomEq([3, 0, -1.5]);
  assert.deepEqual(c.state.customEq, [3, 0, -1.5]);
  assert.deepEqual(dev.state.customEq, [3, 0, -1.5]);
  await c.disconnect();
});
