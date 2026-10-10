import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowed, isAllowed } from '../app/src/protocol/guard.js';
import { OP, cmd } from '../app/src/protocol/commands.js';
import { DOP } from '../app/src/protocol/drafts.js';

test('confirmed opcodes are allowed on real hardware', () => {
  for (const op of Object.values(OP)) assert.ok(isAllowed(op));
});

test('draft opcodes are blocked on real hardware and allowed on the demo device', () => {
  for (const op of Object.values(DOP)) {
    assert.throws(() => assertAllowed(op), /not confirmed yet/);
    assert.ok(isAllowed(op, { allowDraft: true }));
  }
});

test('unknown opcodes always throw, demo or not', () => {
  // examples: ring 0xF002, UTC time 0xF00A, dual connect 0xF01B, and arbitrary values
  for (const op of [0xf002, 0xf00a, 0xf01a, 0xf01b, 0x0000, 0xffff, 0xc001, 0xf001]) {
    assert.throws(() => assertAllowed(op), /not on the allowlist/);
    assert.throws(() => assertAllowed(op, { allowDraft: true }), /not on the allowlist/);
  }
});

test('setAnc builds the documented payload', () => {
  assert.deepEqual(cmd.setAnc('transparency'), { command: 0xf00f, payload: [0x01, 0x07, 0x00] });
  assert.deepEqual(cmd.setAnc('off'), { command: 0xf00f, payload: [0x01, 0x05, 0x00] });
  assert.deepEqual(cmd.setAnc('adaptive'), { command: 0xf00f, payload: [0x01, 0x04, 0x00] });
  assert.throws(() => cmd.setAnc('loud'));
});
