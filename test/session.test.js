import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../app/src/device/session.js';
import { MockHeadphones } from '../app/src/device/mock.js';
import { cmd } from '../app/src/protocol/commands.js';
import { draftCmd } from '../app/src/protocol/drafts.js';
import { parseFrame } from '../app/src/protocol/parser.js';

// A transport that records writes and never replies.
function silentTransport(kind = 'serial') {
  const sent = [];
  return { kind, sent, onData() {}, onClose() {}, async connect() {}, async disconnect() {}, async send(b) { sent.push(b); } };
}

test('real transport: draft commands throw before anything is sent', async () => {
  const t = silentTransport('serial');
  const s = new Session(t);
  assert.throws(() => s.request(draftCmd.setEq('rock')), /not confirmed yet/);
  assert.equal(t.sent.length, 0);
});

test('no reply: one retry, then the request fails', async () => {
  const t = silentTransport('serial');
  const s = new Session(t);
  const start = Date.now();
  await assert.rejects(s.request(cmd.getBattery()), /did not reply/);
  assert.equal(t.sent.length, 2);
  assert.ok(Date.now() - start >= 2000);
});

test('sends are spaced at least 150 ms apart', async () => {
  const mock = new MockHeadphones();
  const s = new Session(mock);
  await s.connect();
  const times = [];
  s.on('tx', () => times.push(Date.now()));
  await Promise.all([s.request(cmd.getBattery()), s.request(cmd.getFirmware()), s.request(cmd.getAnc())]);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 148, `gap ${times[i] - times[i - 1]}`);
  await s.disconnect();
});

test('demo device: set noise control, then read back the confirmed state', async () => {
  const mock = new MockHeadphones();
  const s = new Session(mock);
  await s.connect();
  await s.request(cmd.setAnc('transparency'));
  const reply = await s.request(cmd.getAnc());
  assert.deepEqual(parseFrame(reply), { anc: 'transparency' });
  await s.disconnect();
});
