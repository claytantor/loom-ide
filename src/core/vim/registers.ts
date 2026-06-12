// Register storage. Plain immutable record keyed by register name.
// '"' is the unnamed register; '0' is the yank register; a-z named; A-Z append.

import type { Register } from './types.js';

export type Registers = Readonly<Record<string, Register>>;

export const UNNAMED = '"';
export const YANK0 = '0';

export function readRegister(regs: Registers, name: string | null): Register | null {
  const key = name === null ? UNNAMED : /[A-Z]/.test(name) ? name.toLowerCase() : name;
  return regs[key] ?? null;
}

/**
 * Write yanked/deleted text into registers.
 * - Named a-z: set; A-Z: append to the lowercase register.
 * - Unnamed always mirrors the final content.
 * - Yanks with no explicit register also fill register 0.
 */
export function writeRegister(
  regs: Registers,
  name: string | null,
  text: string,
  linewise: boolean,
  isYank: boolean
): Registers {
  let content: Register = { text, linewise };
  const out: Record<string, Register> = { ...regs };
  if (name !== null) {
    if (/[A-Z]/.test(name)) {
      const key = name.toLowerCase();
      const prev = out[key];
      if (prev) {
        const joined = prev.linewise || linewise ? prev.text + '\n' + text : prev.text + text;
        content = { text: joined, linewise: prev.linewise || linewise };
      }
      out[key] = content;
    } else {
      out[name] = content;
    }
  } else if (isYank) {
    out[YANK0] = content;
  }
  out[UNNAMED] = content;
  return out;
}
