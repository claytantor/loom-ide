// Visual and visual-line mode handling.

import type { Pos, VimState } from './types.js';
import {
  clampNormal,
  firstNonBlankCol,
  lastRow,
  lineAt,
  maxNormalCol,
  posMax,
  posMin,
} from './text.js';
import {
  deleteRange,
  fillRange,
  indentLines,
  pasteCharwise,
  rangeText,
  toggleCaseRange,
  type OpRange,
} from './operators.js';
import { readRegister, writeRegister } from './registers.js';
import { commitChange, setMessage, snapshotOf } from './state.js';
import { isTextObjectChar, resolveTextObject } from './textobjects.js';
import { enterInsert, type NormalResult } from './normal.js';
import { runMotion, type MotionEnv } from './motions.js';
import { EOL_DESIRED } from './types.js';
import { spliceLines } from './text.js';

const KEY_ALIASES: Readonly<Record<string, string>> = {
  '<Left>': 'h',
  '<Right>': 'l',
  '<Up>': 'k',
  '<Down>': 'j',
  '<Home>': '0',
  '<End>': '$',
  '<Del>': 'x',
};

const MOTION_CHARS = new Set([
  'h', 'j', 'k', 'l', '0', '^', '$', 'w', 'b', 'e', 'W', 'B', 'E', '{', '}', 'G', ';', ',',
]);
const FIND_CHARS = new Set(['f', 'F', 't', 'T']);
const OP_KEYS = new Set(['d', 'x', 'c', 's', 'y', '>', '<', '~', 'p', 'P', 'o', 'v', 'V']);

type VisualCmd =
  | { kind: 'motion'; motion: string; arg: string | null; count: number | null }
  | { kind: 'object'; ia: 'i' | 'a'; obj: string }
  | { kind: 'op'; key: string; arg: string | null; register: string | null };

type VParse =
  | { status: 'pending' }
  | { status: 'invalid' }
  | { status: 'done'; cmd: VisualCmd };

function parseVisual(seq: string): VParse {
  let i = 0;
  let register: string | null = null;
  if (seq[i] === '"') {
    const r = seq[i + 1];
    if (r === undefined) return { status: 'pending' };
    if (!/[a-zA-Z0-9"]/.test(r)) return { status: 'invalid' };
    register = r;
    i += 2;
  }
  let count: number | null = null;
  if (/[1-9]/.test(seq[i] ?? '')) {
    count = 0;
    while (i < seq.length && /[0-9]/.test(seq[i] as string)) {
      count = count * 10 + Number(seq[i]);
      i++;
    }
  }
  const c = seq[i];
  if (c === undefined) return { status: 'pending' };
  if (c === 'g') {
    const g2 = seq[i + 1];
    if (g2 === undefined) return { status: 'pending' };
    if (g2 !== 'g') return { status: 'invalid' };
    return { status: 'done', cmd: { kind: 'motion', motion: 'gg', arg: null, count } };
  }
  if (FIND_CHARS.has(c)) {
    const arg = seq[i + 1];
    if (arg === undefined) return { status: 'pending' };
    return { status: 'done', cmd: { kind: 'motion', motion: c, arg, count } };
  }
  if (MOTION_CHARS.has(c)) {
    return { status: 'done', cmd: { kind: 'motion', motion: c, arg: null, count } };
  }
  if (c === 'i' || c === 'a') {
    const obj = seq[i + 1];
    if (obj === undefined) return { status: 'pending' };
    if (!isTextObjectChar(obj)) return { status: 'invalid' };
    return { status: 'done', cmd: { kind: 'object', ia: c, obj } };
  }
  if (c === 'r') {
    const arg = seq[i + 1];
    if (arg === undefined) return { status: 'pending' };
    return { status: 'done', cmd: { kind: 'op', key: 'r', arg, register } };
  }
  if (OP_KEYS.has(c)) {
    return { status: 'done', cmd: { kind: 'op', key: c, arg: null, register } };
  }
  return { status: 'invalid' };
}

function visualRange(state: VimState): OpRange {
  const a = state.visualStart ?? state.cursor;
  const b = state.cursor;
  if (state.mode === 'visual-line') {
    return { wise: 'line', startRow: Math.min(a.row, b.row), endRow: Math.max(a.row, b.row) };
  }
  const lo = posMin(a, b);
  const hi = posMax(a, b);
  return { wise: 'char', start: lo, endEx: { row: hi.row, col: hi.col + 1 } };
}

function exitVisual(state: VimState): VimState {
  return { ...state, mode: 'normal', visualStart: null, pendingKeys: '' };
}

function rangeStart(range: OpRange): Pos {
  return range.wise === 'line' ? { row: range.startRow, col: 0 } : range.start;
}

/** Position of the last character covered by a charwise exclusive end. */
function posBeforeEx(lines: readonly string[], endEx: Pos): Pos {
  if (endEx.col > 0) return { row: endEx.row, col: endEx.col - 1 };
  const row = Math.max(0, endEx.row - 1);
  return { row, col: maxNormalCol(lineAt(lines, row)) };
}

function execVisualOp(state: VimState, key: string, arg: string | null, register: string | null): VimState {
  const range = visualRange(state);
  const snap = snapshotOf(state);
  const start = rangeStart(range);

  switch (key) {
    case 'd':
    case 'x': {
      const del = deleteRange(state.lines, range);
      const registers = writeRegister(state.registers, register, del.text, del.linewise, false);
      return exitVisual(commitChange({ ...state, registers }, snap, del.lines, del.cursor));
    }
    case 'c':
    case 's': {
      const { text, linewise } = rangeText(state.lines, range);
      const registers = writeRegister(state.registers, register, text, linewise, false);
      if (range.wise === 'line') {
        const next = spliceLines(state.lines, range.startRow, range.endRow, ['']);
        return enterInsert({ ...exitVisual(state), registers }, snap, null, null, next, { row: range.startRow, col: 0 });
      }
      const del = deleteRange(state.lines, range);
      return enterInsert({ ...exitVisual(state), registers }, snap, null, null, del.lines, range.start);
    }
    case 'y': {
      const { text, linewise } = rangeText(state.lines, range);
      const registers = writeRegister(state.registers, register, text, linewise, true);
      return exitVisual({
        ...state,
        registers,
        cursor: clampNormal(state.lines, start),
        desiredCol: null,
      });
    }
    case '>':
    case '<': {
      const startRow = range.wise === 'line' ? range.startRow : range.start.row;
      const endRow = range.wise === 'line' ? range.endRow : range.endEx.row;
      const lines = indentLines(state.lines, startRow, endRow, key === '>' ? 1 : -1);
      const cursor = { row: startRow, col: firstNonBlankCol(lineAt(lines, startRow)) };
      return exitVisual(commitChange(state, snap, lines, cursor));
    }
    case '~': {
      const lines = toggleCaseRange(state.lines, range);
      return exitVisual(commitChange(state, snap, lines, start));
    }
    case 'r': {
      const lines = fillRange(state.lines, range, arg as string);
      return exitVisual(commitChange(state, snap, lines, start));
    }
    case 'p':
    case 'P': {
      const reg = readRegister(state.registers, register);
      if (!reg || reg.text === '') {
        return exitVisual(setMessage(state, `nothing in register ${register ?? '"'}`));
      }
      const del = deleteRange(state.lines, range);
      const registers = writeRegister(state.registers, null, del.text, del.linewise, false);
      let lines: string[];
      let cursor: Pos;
      if (range.wise === 'line') {
        const block = reg.text.split('\n');
        lines = del.lines.slice();
        const at = Math.min(range.startRow, lines.length);
        lines.splice(at, 0, ...block);
        // deleting all lines leaves a stub empty line; drop it when pasting linewise
        if (lines[at + block.length] === '' && del.lines.length === 1 && del.lines[0] === '') {
          lines.splice(at + block.length, 1);
        }
        cursor = { row: at, col: firstNonBlankCol(block[0] ?? '') };
      } else if (reg.linewise) {
        const block = reg.text.split('\n');
        const at = del.cursor;
        const cur = lineAt(del.lines, at.row);
        const insertCol = Math.min(range.start.col, cur.length);
        const head = cur.slice(0, insertCol);
        const tail = cur.slice(insertCol);
        lines = spliceLines(del.lines, at.row, at.row, [head, ...block, tail]);
        cursor = { row: at.row + 1, col: firstNonBlankCol(block[0] ?? '') };
      } else {
        const at = { row: del.cursor.row, col: Math.min(range.start.col, lineAt(del.lines, del.cursor.row).length) };
        const pasted = pasteCharwise(del.lines, at, reg.text, 1);
        lines = pasted.lines;
        cursor = pasted.cursor;
      }
      return exitVisual(commitChange({ ...state, registers }, snap, lines, cursor));
    }
    case 'o': {
      const a = state.visualStart ?? state.cursor;
      return { ...state, visualStart: state.cursor, cursor: a, desiredCol: null, pendingKeys: '' };
    }
    case 'v':
      return state.mode === 'visual' ? exitVisual(state) : { ...state, mode: 'visual', pendingKeys: '' };
    case 'V':
      return state.mode === 'visual-line' ? exitVisual(state) : { ...state, mode: 'visual-line', pendingKeys: '' };
    default:
      return exitVisual(state);
  }
}

function execVisualMotion(state: VimState, motion: string, arg: string | null, count: number | null, viewportRows: number): VimState {
  const env: MotionEnv = {
    lines: state.lines,
    cursor: state.cursor,
    count: count ?? 1,
    desiredCol: state.desiredCol,
    lastFind: state.lastFind,
    viewportRows,
    forOperator: false,
    countGiven: count !== null,
  };
  const out = runMotion(motion, arg, env);
  if (out.failed) {
    return out.newLastFind ? { ...state, lastFind: out.newLastFind, pendingKeys: '' } : { ...state, pendingKeys: '' };
  }
  return {
    ...state,
    pendingKeys: '',
    cursor: clampNormal(state.lines, out.pos),
    desiredCol: out.desired === 'eol' ? EOL_DESIRED : out.desired === 'keep' ? state.desiredCol : out.desired,
    lastFind: out.newLastFind ?? state.lastFind,
    lastJump: out.jump ? state.cursor : state.lastJump,
  };
}

function execVisualObject(state: VimState, ia: 'i' | 'a', obj: string): VimState {
  const found = resolveTextObject(state.lines, state.cursor, ia, obj);
  if (!found) return { ...state, pendingKeys: '' };
  if (found.wise === 'line') {
    return {
      ...state,
      pendingKeys: '',
      mode: 'visual-line',
      visualStart: { row: found.startRow, col: 0 },
      cursor: clampNormal(state.lines, { row: found.endRow, col: state.cursor.col }),
      desiredCol: null,
    };
  }
  if (found.empty) {
    return {
      ...state,
      pendingKeys: '',
      visualStart: clampNormal(state.lines, found.start),
      cursor: clampNormal(state.lines, found.start),
    };
  }
  return {
    ...state,
    pendingKeys: '',
    visualStart: clampNormal(state.lines, found.start),
    cursor: clampNormal(state.lines, posBeforeEx(state.lines, found.endEx)),
    desiredCol: null,
  };
}

export function handleVisualKey(state: VimState, key: string, viewportRows: number): NormalResult {
  const mapped = KEY_ALIASES[key] ?? key;
  if (mapped === '<Esc>') {
    return { state: exitVisual(state) };
  }
  if (mapped.length > 1) {
    if ((mapped === '<C-d>' || mapped === '<C-u>') && /^[0-9]*$/.test(state.pendingKeys)) {
      const count = state.pendingKeys === '' ? null : parseInt(state.pendingKeys, 10);
      const base = { ...state, pendingKeys: '' };
      return { state: execVisualMotion(base, mapped === '<C-d>' ? 'C-d' : 'C-u', null, count, viewportRows) };
    }
    return { state: state.pendingKeys === '' ? state : { ...state, pendingKeys: '' } };
  }
  const seq = state.pendingKeys + mapped;
  const parsed = parseVisual(seq);
  if (parsed.status === 'pending') {
    return { state: { ...state, pendingKeys: seq } };
  }
  if (parsed.status === 'invalid') {
    return { state: { ...state, pendingKeys: '' } };
  }
  const base = { ...state, pendingKeys: '' };
  const cmd = parsed.cmd;
  if (cmd.kind === 'motion') {
    return { state: execVisualMotion(base, cmd.motion, cmd.arg, cmd.count, viewportRows) };
  }
  if (cmd.kind === 'object') {
    return { state: execVisualObject(base, cmd.ia, cmd.obj) };
  }
  return { state: execVisualOp(base, cmd.key, cmd.arg, cmd.register) };
}
