// Hard allowlist for outgoing frames. Anything not listed throws before it reaches a transport,
// which keeps firmware, reset and pairing opcodes out by construction: they are in neither table.
import { CONFIRMED_OUTGOING } from './commands.js';
import { DRAFT_OUTGOING } from './drafts.js';

const hex = (n) => '0x' + n.toString(16).padStart(4, '0');

// allowDraft: the demo device, or real hardware with Experimental controls on. Otherwise CONFIRMED opcodes only.
export function assertAllowed(command, { allowDraft = false } = {}) {
  if (CONFIRMED_OUTGOING[command]) return CONFIRMED_OUTGOING[command];
  if (DRAFT_OUTGOING[command]) {
    if (allowDraft) return DRAFT_OUTGOING[command];
    throw new Error(`blocked: ${DRAFT_OUTGOING[command]} (${hex(command)}) is not confirmed yet`);
  }
  throw new Error(`blocked: opcode ${hex(command)} is not on the allowlist`);
}

export const isAllowed = (command, opts) => {
  try { assertAllowed(command, opts); return true; } catch { return false; }
};
