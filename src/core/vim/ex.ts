// Ex command execution (runEx receives the command without the leading ':').

import type { VimEffects, VimState } from './types.js';
import { UNDO_CAP } from './types.js';
import { clampNormal, firstNonBlankCol, lastRow, lineAt } from './text.js';
import { setMessage, snapshotOf } from './state.js';
import { compilePattern, matchCols } from './search.js';

export interface ExResult {
  state: VimState;
  effects: VimEffects;
}

function msg(state: VimState, message: string, extra?: Partial<VimEffects>): ExResult {
  return { state: setMessage(state, message), effects: { ...extra, message } };
}

function gotoLine(state: VimState, row: number): VimState {
  const r = Math.min(Math.max(0, row), lastRow(state.lines));
  return {
    ...state,
    cursor: { row: r, col: firstNonBlankCol(lineAt(state.lines, r)) },
    desiredCol: null,
    lastJump: state.cursor,
  };
}

function lineSearch(state: VimState, pattern: string, dir: 1 | -1): ExResult {
  if (pattern === '') return msg(state, 'pattern not found: ');
  const re = compilePattern(pattern);
  if (!re) return msg(state, `invalid pattern: ${pattern}`);
  const last = lastRow(state.lines);
  const total = last + 1;
  for (let i = 1; i <= total; i++) {
    const r = (((state.cursor.row + dir * i) % total) + total) % total;
    re.lastIndex = 0;
    if (re.test(lineAt(state.lines, r))) {
      const next = gotoLine(
        { ...state, searchPattern: pattern, searchHighlight: true, searchDirection: dir },
        r
      );
      return { state: next, effects: {} };
    }
  }
  return msg(state, `pattern not found: ${pattern}`);
}

/** Resolve an ex address token to a 0-based row, or null when invalid. */
function resolveAddr(state: VimState, tok: string): number | null {
  const t = tok.trim();
  if (t === '.') return state.cursor.row;
  if (t === '$') return lastRow(state.lines);
  if (/^\d+$/.test(t)) return Math.min(Math.max(0, parseInt(t, 10) - 1), lastRow(state.lines));
  const rel = /^([.$]|\d+)\s*([+-])\s*(\d+)$/.exec(t);
  if (rel) {
    const base = resolveAddr(state, rel[1] as string);
    if (base === null) return null;
    const delta = parseInt(rel[3] as string, 10) * (rel[2] === '+' ? 1 : -1);
    return Math.min(Math.max(0, base + delta), lastRow(state.lines));
  }
  return null;
}

function resolveRange(state: VimState, rangeStr: string): { start: number; end: number } | null {
  const t = rangeStr.trim();
  if (t === '') return { start: state.cursor.row, end: state.cursor.row };
  if (t === '%') return { start: 0, end: lastRow(state.lines) };
  const comma = t.indexOf(',');
  if (comma < 0) {
    const r = resolveAddr(state, t);
    return r === null ? null : { start: r, end: r };
  }
  const a = resolveAddr(state, t.slice(0, comma));
  const b = resolveAddr(state, t.slice(comma + 1));
  if (a === null || b === null) return null;
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/** Split s/pat/rep/flags body on unescaped '/' delimiters. */
function splitSubstitute(body: string): { pattern: string; replacement: string; flags: string } | null {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === '\\' && i + 1 < body.length) {
      const next = body[i + 1] as string;
      if (next === '/') {
        cur += '/';
        i++;
        continue;
      }
      cur += ch + next;
      i++;
      continue;
    }
    if (ch === '/' && parts.length < 2) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  if (parts.length === 1) return null;
  return {
    pattern: parts[0] ?? '',
    replacement: parts[1] ?? '',
    flags: parts[2] ?? '',
  };
}

/** Convert a vim-style replacement (\1..\9 groups, \\ literal) to JS replace syntax. */
function toJsReplacement(repl: string): string {
  let out = '';
  for (let i = 0; i < repl.length; i++) {
    const ch = repl[i] as string;
    if (ch === '$') {
      out += '$$';
      continue;
    }
    if (ch === '\\' && i + 1 < repl.length) {
      const next = repl[i + 1] as string;
      if (/[0-9]/.test(next)) {
        out += '$' + next;
        i++;
        continue;
      }
      if (next === '\\') {
        out += '\\';
        i++;
        continue;
      }
      out += next;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function substitute(state: VimState, rangeStr: string, body: string, raw: string): ExResult {
  const parsed = splitSubstitute(body);
  if (!parsed) return msg(state, `not an editor command: ${raw}`);
  const range = resolveRange(state, rangeStr);
  if (!range) return msg(state, `not an editor command: ${raw}`);
  if (!/^[gi]*$/.test(parsed.flags)) return msg(state, `not an editor command: ${raw}`);
  let pattern = parsed.pattern;
  if (pattern === '') {
    if (!state.searchPattern) return msg(state, 'no previous search');
    pattern = state.searchPattern;
  }
  const global = parsed.flags.includes('g');
  const ignoreCase = parsed.flags.includes('i');
  const re = compilePattern(pattern, ignoreCase);
  if (!re) return msg(state, `invalid pattern: ${pattern}`);
  const jsRepl = toJsReplacement(parsed.replacement);
  const out = state.lines.slice() as string[];
  let total = 0;
  let changedLines = 0;
  let lastChanged = state.cursor.row;
  for (let r = range.start; r <= Math.min(range.end, lastRow(state.lines)); r++) {
    const line = out[r] as string;
    const hits = matchCols(line, re).length;
    if (hits === 0) continue;
    const n = global ? hits : 1;
    re.lastIndex = 0;
    const replaced = global
      ? line.replace(re, jsRepl)
      : line.replace(new RegExp(pattern, ignoreCase ? 'i' : ''), jsRepl);
    out[r] = replaced;
    changedLines++;
    lastChanged = r;
    total += n;
  }
  if (total === 0) {
    return msg(state, `pattern not found: ${pattern}`);
  }
  const snap = snapshotOf(state);
  const cursor = { row: lastChanged, col: firstNonBlankCol(out[lastChanged] ?? '') };
  const message = `${total} substitution${total === 1 ? '' : 's'} on ${changedLines} line${changedLines === 1 ? '' : 's'}`;
  const next: VimState = {
    ...state,
    lines: out,
    cursor: clampNormal(out, cursor),
    dirty: true,
    undoStack: [...state.undoStack, snap].slice(-UNDO_CAP),
    redoStack: [],
    searchPattern: pattern,
    searchHighlight: true,
    message,
  };
  return { state: next, effects: { message } };
}

export function execEx(state: VimState, cmdRaw: string): ExResult {
  const cmd = cmdRaw.trim();
  if (cmd === '') return { state, effects: {} };

  if (cmd === 'w') return { state, effects: { save: true } };
  if (cmd === 'q') {
    if (state.dirty) {
      return msg(state, 'no write since last change (add ! to override)');
    }
    return { state, effects: { quit: true } };
  }
  if (cmd === 'q!') return { state, effects: { quit: true, forced: true } };
  if (cmd === 'wq' || cmd === 'x') return { state, effects: { save: true, quit: true } };
  if (cmd === 'wq!' || cmd === 'x!') return { state, effects: { save: true, quit: true, forced: true } };
  if (/^noh(l(search)?)?$/.test(cmd)) {
    return { state: { ...state, searchHighlight: false }, effects: {} };
  }
  if (/^\d+$/.test(cmd)) {
    return { state: gotoLine(state, parseInt(cmd, 10) - 1), effects: {} };
  }
  if (cmd === '$') {
    return { state: gotoLine(state, lastRow(state.lines)), effects: {} };
  }
  if (cmd.startsWith('/')) return lineSearch(state, cmd.slice(1), 1);
  if (cmd.startsWith('?')) return lineSearch(state, cmd.slice(1), -1);

  const sub = /^([%.,$\d+\-\s]*)s\/(.*)$/.exec(cmd);
  if (sub) {
    return substitute(state, sub[1] ?? '', sub[2] ?? '', cmd);
  }
  return msg(state, `not an editor command: ${cmd}`);
}
