// Normal-mode key parsing and execution.

import type { Pos, UndoEntry, VimState } from './types.js';
import { EOL_DESIRED } from './types.js';
import {
  charClass,
  clampInsert,
  clampNormal,
  firstNonBlankCol,
  lastRow,
  leadingIndent,
  lineAt,
  linesEqual,
  maxNormalCol,
  posMax,
  posMin,
} from './text.js';
import { runMotion, type MotionEnv } from './motions.js';
import { isTextObjectChar, matchBracket, resolveTextObject } from './textobjects.js';
import {
  changeLinewise,
  deleteRange,
  indentLines,
  joinLines,
  pasteCharwise,
  pasteLinewise,
  rangeText,
  toggleCaseRange,
  type OpRange,
} from './operators.js';
import { readRegister, writeRegister } from './registers.js';
import { commitChange, redo, setMessage, snapshotOf, undo } from './state.js';
import { compilePattern, findMatch, wholeWordPattern, wordUnderCursor, wrapMessage } from './search.js';

export interface NormalResult {
  state: VimState;
  /** Tokens to re-feed through the engine (dot repeat). */
  replay?: string[];
}

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
  'h', 'j', 'k', 'l', '0', '^', '$', 'w', 'b', 'e', 'W', 'B', 'E', '{', '}', 'G', ';', ',', '%',
]);
const FIND_CHARS = new Set(['f', 'F', 't', 'T']);
const OPERATORS = new Set(['d', 'c', 'y', '>', '<']);
const SIMPLE_KEYS = new Set([
  'x', 'X', 'D', 'C', 'Y', 's', 'S', 'p', 'P', 'J', '~', 'u', '.',
  'v', 'V', 'R', 'i', 'a', 'o', 'O', 'A', 'I', 'n', 'N', '*', '#',
]);

type OpChar = 'd' | 'c' | 'y' | '>' | '<';

type OpTarget =
  | { t: 'motion'; motion: string; arg: string | null }
  | { t: 'object'; ia: 'i' | 'a'; obj: string }
  | { t: 'double' };

type Action =
  | { t: 'motion'; motion: string; arg: string | null }
  | { t: 'op'; op: OpChar; target: OpTarget }
  | { t: 'simple'; key: string; arg: string | null };

interface NormalCmd {
  register: string | null;
  count: number | null;
  dotTokens: string[];
  action: Action;
}

type ParseOut =
  | { status: 'pending'; expectsChar: boolean }
  | { status: 'invalid' }
  | { status: 'done'; cmd: NormalCmd };

const PENDING: ParseOut = { status: 'pending', expectsChar: false };
const PENDING_CHAR: ParseOut = { status: 'pending', expectsChar: true };
const INVALID: ParseOut = { status: 'invalid' };

function readCount(seq: string, i: number): { count: number | null; next: number } {
  if (!/[1-9]/.test(seq[i] ?? '')) return { count: null, next: i };
  let n = 0;
  while (i < seq.length && /[0-9]/.test(seq[i] as string)) {
    n = n * 10 + Number(seq[i]);
    i++;
  }
  return { count: n, next: i };
}

export function parseNormal(seq: string): ParseOut {
  let i = 0;
  const dot: string[] = [];
  let register: string | null = null;
  if (seq[i] === '"') {
    const r = seq[i + 1];
    if (r === undefined) return PENDING_CHAR;
    if (!/[a-zA-Z0-9"]/.test(r)) return INVALID;
    register = r;
    dot.push('"', r);
    i += 2;
  }
  const c1 = readCount(seq, i);
  i = c1.next;
  let count = c1.count;
  const c = seq[i];
  if (c === undefined) return PENDING;
  const done = (action: Action): ParseOut => ({
    status: 'done',
    cmd: { register, count, dotTokens: dot, action },
  });

  if (OPERATORS.has(c)) {
    i++;
    dot.push(c);
    const c2 = readCount(seq, i);
    i = c2.next;
    if (c2.count !== null) count = (count ?? 1) * c2.count;
    const m = seq[i];
    if (m === undefined) return PENDING;
    if (m === c) {
      dot.push(m);
      return done({ t: 'op', op: c as OpChar, target: { t: 'double' } });
    }
    if (m === 'i' || m === 'a') {
      const obj = seq[i + 1];
      if (obj === undefined) return PENDING_CHAR;
      if (!isTextObjectChar(obj)) return INVALID;
      dot.push(m, obj);
      return done({ t: 'op', op: c as OpChar, target: { t: 'object', ia: m, obj } });
    }
    if (m === 'g') {
      const g2 = seq[i + 1];
      if (g2 === undefined) return PENDING;
      if (g2 !== 'g') return INVALID;
      dot.push('g', 'g');
      return done({ t: 'op', op: c as OpChar, target: { t: 'motion', motion: 'gg', arg: null } });
    }
    if (FIND_CHARS.has(m)) {
      const arg = seq[i + 1];
      if (arg === undefined) return PENDING_CHAR;
      dot.push(m, arg);
      return done({ t: 'op', op: c as OpChar, target: { t: 'motion', motion: m, arg } });
    }
    if (MOTION_CHARS.has(m)) {
      dot.push(m);
      return done({ t: 'op', op: c as OpChar, target: { t: 'motion', motion: m, arg: null } });
    }
    return INVALID;
  }

  if (c === 'g') {
    const g2 = seq[i + 1];
    if (g2 === undefined) return PENDING;
    if (g2 !== 'g') return INVALID;
    dot.push('g', 'g');
    return done({ t: 'motion', motion: 'gg', arg: null });
  }
  if (FIND_CHARS.has(c)) {
    const arg = seq[i + 1];
    if (arg === undefined) return PENDING_CHAR;
    dot.push(c, arg);
    return done({ t: 'motion', motion: c, arg });
  }
  if (MOTION_CHARS.has(c)) {
    dot.push(c);
    return done({ t: 'motion', motion: c, arg: null });
  }
  if (c === 'r') {
    const arg = seq[i + 1];
    if (arg === undefined) return PENDING_CHAR;
    dot.push('r', arg);
    return done({ t: 'simple', key: 'r', arg });
  }
  if (c === 'm') {
    const arg = seq[i + 1];
    if (arg === undefined) return PENDING_CHAR;
    if (!/[a-z]/.test(arg)) return INVALID;
    return done({ t: 'simple', key: 'm', arg });
  }
  if (c === '`' || c === "'") {
    const arg = seq[i + 1];
    if (arg === undefined) return PENDING_CHAR;
    if (!/[a-z]/.test(arg) && arg !== c) return INVALID;
    return done({ t: 'simple', key: c, arg });
  }
  if (SIMPLE_KEYS.has(c)) {
    dot.push(c);
    return done({ t: 'simple', key: c, arg: null });
  }
  return INVALID;
}

// ── execution ────────────────────────────────────────────────────────────────

function applyMotionOutcome(state: VimState, motion: string, arg: string | null, count: number, countGiven: boolean, viewportRows: number): VimState {
  if (motion === '%') {
    const target = matchBracket(state.lines, state.cursor);
    if (!target) return state;
    return {
      ...state,
      cursor: clampNormal(state.lines, target),
      desiredCol: null,
      lastJump: state.cursor,
    };
  }
  const env: MotionEnv = {
    lines: state.lines,
    cursor: state.cursor,
    count,
    desiredCol: state.desiredCol,
    lastFind: state.lastFind,
    viewportRows,
    forOperator: false,
    countGiven,
  };
  const out = runMotion(motion, arg, env);
  if (out.failed) {
    return out.newLastFind ? { ...state, lastFind: out.newLastFind } : state;
  }
  return {
    ...state,
    cursor: clampNormal(state.lines, out.pos),
    desiredCol: out.desired === 'eol' ? EOL_DESIRED : out.desired === 'keep' ? state.desiredCol : out.desired,
    lastFind: out.newLastFind ?? state.lastFind,
    lastJump: out.jump ? state.cursor : state.lastJump,
  };
}

interface ResolvedTarget {
  range: OpRange | null;
  /** Insert position for `c` when the range is empty (text objects). */
  emptyAt: Pos | null;
}

function resolveOpTarget(
  state: VimState,
  op: OpChar,
  target: OpTarget,
  count: number,
  countGiven: boolean,
  viewportRows: number
): ResolvedTarget {
  const { lines, cursor } = state;
  if (target.t === 'double') {
    const endRow = Math.min(cursor.row + count - 1, lastRow(lines));
    return { range: { wise: 'line', startRow: cursor.row, endRow }, emptyAt: null };
  }
  if (target.t === 'object') {
    const obj = resolveTextObject(lines, cursor, target.ia, target.obj);
    if (!obj) return { range: null, emptyAt: null };
    if (obj.wise === 'line') {
      return { range: { wise: 'line', startRow: obj.startRow, endRow: obj.endRow }, emptyAt: null };
    }
    if (obj.empty) {
      return { range: null, emptyAt: op === 'c' ? obj.start : null };
    }
    return { range: { wise: 'char', start: obj.start, endEx: obj.endEx }, emptyAt: null };
  }
  let motion = target.motion;
  if (op === 'c' && (motion === 'w' || motion === 'W') && charClass(lineAt(lines, cursor.row)[cursor.col]) !== 0) {
    motion = motion === 'w' ? 'e' : 'E'; // the cw-acts-like-ce quirk
  }
  if (motion === '%') {
    const t = matchBracket(lines, cursor);
    if (!t) return { range: null, emptyAt: null };
    const lo = posMin(cursor, t);
    const hi = posMax(cursor, t);
    return { range: { wise: 'char', start: lo, endEx: { row: hi.row, col: hi.col + 1 } }, emptyAt: null };
  }
  const env: MotionEnv = {
    lines,
    cursor,
    count,
    desiredCol: state.desiredCol,
    lastFind: state.lastFind,
    viewportRows,
    forOperator: true,
    countGiven,
  };
  const out = runMotion(motion, arg0(target), env);
  if (out.failed) return { range: null, emptyAt: null };
  if (out.wise === 'line') {
    return {
      range: {
        wise: 'line',
        startRow: Math.min(cursor.row, out.pos.row),
        endRow: Math.max(cursor.row, out.pos.row),
      },
      emptyAt: null,
    };
  }
  const lo = posMin(cursor, out.pos);
  const hi = posMax(cursor, out.pos);
  const endEx = { row: hi.row, col: hi.col + (out.inclusive ? 1 : 0) };
  if (lo.row === endEx.row && lo.col >= endEx.col) return { range: null, emptyAt: null };
  return { range: { wise: 'char', start: lo, endEx }, emptyAt: null };
}

function arg0(target: OpTarget): string | null {
  return target.t === 'motion' ? target.arg : null;
}

/** Switch into insert mode, beginning (or continuing) an undoable session. */
export function enterInsert(
  state: VimState,
  snap: UndoEntry,
  prefix: readonly string[] | null,
  count: number | null,
  lines: readonly string[],
  cursor: Pos,
  mode: 'insert' | 'replace' = 'insert'
): VimState {
  return {
    ...state,
    lines,
    cursor: clampInsert(lines, cursor),
    mode,
    visualStart: null,
    dirty: state.dirty || !linesEqual(lines, state.lines),
    pendingKeys: '',
    desiredCol: null,
    pendingUndo: snap,
    insertSession: { prefix, count, typed: [], replaceSteps: [] },
  };
}

function recordDot(state: VimState, tokens: readonly string[], count: number | null): VimState {
  return { ...state, lastChange: { tokens, count } };
}

function execOperator(state: VimState, cmd: NormalCmd, viewportRows: number): VimState {
  const action = cmd.action as Extract<Action, { t: 'op' }>;
  const count = cmd.count ?? 1;
  const snap = snapshotOf(state);
  const { range, emptyAt } = resolveOpTarget(state, action.op, action.target, count, cmd.count !== null, viewportRows);

  if (action.op === 'c') {
    if (emptyAt) {
      return enterInsert(state, snap, cmd.dotTokens, cmd.count, state.lines, emptyAt);
    }
    if (!range) return state;
    const { text, linewise } = rangeText(state.lines, range);
    const registers = writeRegister(state.registers, cmd.register, text, linewise, false);
    if (range.wise === 'line') {
      const chg = changeLinewise(state.lines, range.startRow, range.endRow);
      return enterInsert({ ...state, registers }, snap, cmd.dotTokens, cmd.count, chg.lines, chg.cursor);
    }
    const del = deleteRange(state.lines, range);
    return enterInsert({ ...state, registers }, snap, cmd.dotTokens, cmd.count, del.lines, range.start);
  }

  if (!range) return state;

  if (action.op === 'y') {
    const { text, linewise } = rangeText(state.lines, range);
    const registers = writeRegister(state.registers, cmd.register, text, linewise, true);
    const cursor =
      range.wise === 'line'
        ? { row: range.startRow, col: Math.min(state.cursor.col, maxNormalCol(lineAt(state.lines, range.startRow))) }
        : range.start;
    return { ...state, registers, cursor: clampNormal(state.lines, cursor), desiredCol: null };
  }

  if (action.op === '>' || action.op === '<') {
    const startRow = range.wise === 'line' ? range.startRow : range.start.row;
    const endRow = range.wise === 'line' ? range.endRow : range.endEx.row;
    const lines = indentLines(state.lines, startRow, endRow, action.op === '>' ? 1 : -1);
    const cursor = { row: startRow, col: firstNonBlankCol(lineAt(lines, startRow)) };
    return recordDot(commitChange(state, snap, lines, cursor), cmd.dotTokens, cmd.count);
  }

  // delete
  const del = deleteRange(state.lines, range);
  const registers = writeRegister(state.registers, cmd.register, del.text, del.linewise, false);
  const next = commitChange({ ...state, registers }, snap, del.lines, del.cursor);
  return recordDot({ ...next, desiredCol: null }, cmd.dotTokens, cmd.count);
}

function doSearchJump(state: VimState, pattern: string, dir: 1 | -1, from: Pos): VimState {
  const re = compilePattern(pattern);
  if (!re) return setMessage(state, `invalid pattern: ${pattern}`);
  const hit = findMatch(state.lines, from, re, dir);
  if (!hit) return setMessage(state, `pattern not found: ${pattern}`);
  return {
    ...state,
    cursor: clampNormal(state.lines, hit.pos),
    desiredCol: null,
    lastJump: state.cursor,
    message: hit.wrapped ? wrapMessage(dir) : state.message,
  };
}

function execStarSearch(state: VimState, dir: 1 | -1): VimState {
  const line = lineAt(state.lines, state.cursor.row);
  const w = wordUnderCursor(line, state.cursor.col);
  if (!w) return setMessage(state, 'no word under cursor');
  const pattern = wholeWordPattern(w.word);
  const based: VimState = {
    ...state,
    searchPattern: pattern,
    searchHighlight: true,
    searchDirection: dir,
  };
  return doSearchJump(based, pattern, dir, { row: state.cursor.row, col: w.start });
}

function execSimple(state: VimState, cmd: NormalCmd, viewportRows: number): NormalResult {
  const action = cmd.action as Extract<Action, { t: 'simple' }>;
  const count = cmd.count ?? 1;
  const key = action.key;
  const snap = snapshotOf(state);
  const { lines, cursor } = state;
  const line = lineAt(lines, cursor.row);

  switch (key) {
    case 'x':
    case 'X': {
      if (line.length === 0) return { state };
      const start = key === 'x' ? cursor.col : Math.max(0, cursor.col - count);
      const endEx = key === 'x' ? Math.min(cursor.col + count, line.length) : cursor.col;
      if (start >= endEx) return { state };
      const range: OpRange = { wise: 'char', start: { row: cursor.row, col: start }, endEx: { row: cursor.row, col: endEx } };
      const del = deleteRange(lines, range);
      const registers = writeRegister(state.registers, cmd.register, del.text, false, false);
      const next = commitChange({ ...state, registers }, snap, del.lines, del.cursor);
      return { state: recordDot({ ...next, desiredCol: null }, cmd.dotTokens, cmd.count) };
    }
    case 'D':
    case 'C': {
      const endRow = Math.min(cursor.row + count - 1, lastRow(lines));
      const endEx = { row: endRow, col: lineAt(lines, endRow).length };
      const empty = endRow === cursor.row && cursor.col >= endEx.col;
      if (key === 'C') {
        if (empty) return { state: enterInsert(state, snap, cmd.dotTokens, cmd.count, lines, cursor) };
        const range: OpRange = { wise: 'char', start: cursor, endEx };
        const { text } = rangeText(lines, range);
        const registers = writeRegister(state.registers, cmd.register, text, false, false);
        const del = deleteRange(lines, range);
        return { state: enterInsert({ ...state, registers }, snap, cmd.dotTokens, cmd.count, del.lines, cursor) };
      }
      if (empty) return { state };
      const range: OpRange = { wise: 'char', start: cursor, endEx };
      const del = deleteRange(lines, range);
      const registers = writeRegister(state.registers, cmd.register, del.text, false, false);
      const next = commitChange({ ...state, registers }, snap, del.lines, del.cursor);
      return { state: recordDot({ ...next, desiredCol: null }, cmd.dotTokens, cmd.count) };
    }
    case 'Y': {
      const endRow = Math.min(cursor.row + count - 1, lastRow(lines));
      const { text } = rangeText(lines, { wise: 'line', startRow: cursor.row, endRow });
      const registers = writeRegister(state.registers, cmd.register, text, true, true);
      return { state: { ...state, registers } };
    }
    case 's': {
      const endEx = Math.min(cursor.col + count, line.length);
      if (cursor.col < endEx) {
        const range: OpRange = { wise: 'char', start: cursor, endEx: { row: cursor.row, col: endEx } };
        const del = deleteRange(lines, range);
        const registers = writeRegister(state.registers, cmd.register, del.text, false, false);
        return { state: enterInsert({ ...state, registers }, snap, cmd.dotTokens, cmd.count, del.lines, cursor) };
      }
      return { state: enterInsert(state, snap, cmd.dotTokens, cmd.count, lines, cursor) };
    }
    case 'S': {
      const endRow = Math.min(cursor.row + count - 1, lastRow(lines));
      const { text } = rangeText(lines, { wise: 'line', startRow: cursor.row, endRow });
      const registers = writeRegister(state.registers, cmd.register, text, true, false);
      const chg = changeLinewise(lines, cursor.row, endRow);
      return { state: enterInsert({ ...state, registers }, snap, cmd.dotTokens, cmd.count, chg.lines, chg.cursor) };
    }
    case 'p':
    case 'P': {
      const reg = readRegister(state.registers, cmd.register);
      if (!reg || reg.text === '') {
        return { state: setMessage(state, `nothing in register ${cmd.register ?? '"'}`) };
      }
      let result: { lines: string[]; cursor: Pos };
      if (reg.linewise) {
        result = pasteLinewise(lines, cursor.row, reg.text, count, key === 'P');
      } else {
        const col = key === 'p' ? Math.min(cursor.col + 1, line.length) : cursor.col;
        result = pasteCharwise(lines, { row: cursor.row, col }, reg.text, count);
      }
      const next = commitChange(state, snap, result.lines, result.cursor);
      return { state: recordDot({ ...next, desiredCol: null }, cmd.dotTokens, cmd.count) };
    }
    case 'J': {
      const joined = joinLines(lines, cursor.row, count);
      if (!joined) return { state };
      const next = commitChange(state, snap, joined.lines, joined.cursor);
      return { state: recordDot({ ...next, desiredCol: null }, cmd.dotTokens, cmd.count) };
    }
    case '~': {
      if (line.length === 0) return { state };
      const endEx = Math.min(cursor.col + count, line.length);
      const toggled = toggleCaseRange(lines, {
        wise: 'char',
        start: cursor,
        endEx: { row: cursor.row, col: endEx },
      });
      const next = commitChange(state, snap, toggled, { row: cursor.row, col: Math.min(endEx, maxNormalCol(line)) });
      return { state: recordDot({ ...next, desiredCol: null }, cmd.dotTokens, cmd.count) };
    }
    case 'r': {
      const ch = action.arg as string;
      if (cursor.col + count > line.length) return { state };
      let next: VimState;
      if (ch === '\n') {
        const head = line.slice(0, cursor.col);
        const tail = line.slice(cursor.col + count);
        const out = lines.slice() as string[];
        out.splice(cursor.row, 1, head, tail);
        next = commitChange(state, snap, out, { row: cursor.row + 1, col: 0 });
      } else {
        const out = lines.slice() as string[];
        out[cursor.row] = line.slice(0, cursor.col) + ch.repeat(count) + line.slice(cursor.col + count);
        next = commitChange(state, snap, out, { row: cursor.row, col: cursor.col + count - 1 });
      }
      return { state: recordDot({ ...next, desiredCol: null }, cmd.dotTokens, cmd.count) };
    }
    case 'i':
    case 'a':
    case 'I':
    case 'A': {
      const col =
        key === 'i' ? cursor.col
        : key === 'a' ? Math.min(cursor.col + 1, line.length)
        : key === 'I' ? firstNonBlankCol(line)
        : line.length;
      return { state: enterInsert(state, snap, [key], cmd.count, lines, { row: cursor.row, col }) };
    }
    case 'o':
    case 'O': {
      const indent = leadingIndent(line);
      const row = key === 'o' ? cursor.row + 1 : cursor.row;
      const out = lines.slice() as string[];
      out.splice(row, 0, indent);
      return { state: enterInsert(state, snap, [key], cmd.count, out, { row, col: indent.length }) };
    }
    case 'R':
      return { state: enterInsert(state, snap, ['R'], cmd.count, lines, cursor, 'replace') };
    case 'v':
      return { state: { ...state, mode: 'visual', visualStart: cursor } };
    case 'V':
      return { state: { ...state, mode: 'visual-line', visualStart: cursor } };
    case 'u':
      return { state: undo(state, count) };
    case 'C-r':
      return { state: redo(state, count) };
    case 'm': {
      const marks = { ...state.marks, [action.arg as string]: cursor };
      return { state: { ...state, marks } };
    }
    case '`':
    case "'": {
      const arg = action.arg as string;
      const target = arg === '`' || arg === "'" ? state.lastJump : state.marks[arg] ?? null;
      if (!target) return { state: setMessage(state, `mark not set: ${arg}`) };
      const pos =
        key === '`'
          ? clampNormal(lines, target)
          : { row: Math.min(target.row, lastRow(lines)), col: firstNonBlankCol(lineAt(lines, Math.min(target.row, lastRow(lines)))) };
      return { state: { ...state, cursor: pos, desiredCol: null, lastJump: cursor } };
    }
    case '*':
      return { state: execStarSearch(state, 1) };
    case '#':
      return { state: execStarSearch(state, -1) };
    case 'n':
    case 'N': {
      if (!state.searchPattern) return { state: setMessage(state, 'no previous search') };
      const dir: 1 | -1 = key === 'n' ? state.searchDirection : state.searchDirection === 1 ? -1 : 1;
      let cur: VimState = { ...state, searchHighlight: true };
      for (let k = 0; k < count; k++) {
        cur = doSearchJump(cur, state.searchPattern, dir, cur.cursor);
      }
      return { state: cur };
    }
    case '.': {
      const lc = state.lastChange;
      if (!lc) return { state };
      const effCount = cmd.count ?? lc.count;
      const tokens = [...lc.tokens];
      if (effCount !== null) {
        const at = tokens[0] === '"' ? 2 : 0;
        tokens.splice(at, 0, ...String(effCount).split(''));
      }
      return { state, replay: tokens };
    }
    default:
      return { state };
  }
}

function execCmd(state: VimState, cmd: NormalCmd, viewportRows: number): NormalResult {
  switch (cmd.action.t) {
    case 'motion':
      return {
        state: applyMotionOutcome(state, cmd.action.motion, cmd.action.arg, cmd.count ?? 1, cmd.count !== null, viewportRows),
      };
    case 'op':
      return { state: execOperator(state, cmd, viewportRows) };
    case 'simple':
      return execSimple(state, cmd, viewportRows);
  }
}

export function handleNormalKey(state: VimState, key: string, viewportRows: number): NormalResult {
  const mapped = KEY_ALIASES[key] ?? key;
  if (mapped === '<Esc>') {
    return { state: { ...state, pendingKeys: '' } };
  }
  if (mapped.length > 1) {
    if (mapped === '<C-d>' || mapped === '<C-u>' || mapped === '<C-r>') {
      if (!/^[0-9]*$/.test(state.pendingKeys)) {
        return { state: { ...state, pendingKeys: '' } };
      }
      const count = state.pendingKeys === '' ? null : parseInt(state.pendingKeys, 10);
      const base = { ...state, pendingKeys: '' };
      const cmd: NormalCmd = {
        register: null,
        count,
        dotTokens: [],
        action:
          mapped === '<C-r>'
            ? { t: 'simple', key: 'C-r', arg: null }
            : { t: 'motion', motion: mapped === '<C-d>' ? 'C-d' : 'C-u', arg: null },
      };
      return execCmd(base, cmd, viewportRows);
    }
    if (mapped === '<CR>') {
      const probe = parseNormal(state.pendingKeys + ' ');
      // '<CR>' is only meaningful as the char argument of r (replace with newline).
      if (state.pendingKeys !== '' && probe.status === 'done') {
        return handleNormalKey(state, '\n', viewportRows);
      }
      return { state: { ...state, pendingKeys: '' } };
    }
    // Unknown special token: drop any pending sequence.
    return { state: state.pendingKeys === '' ? state : { ...state, pendingKeys: '' } };
  }

  const seq = state.pendingKeys + mapped;
  const parsed = parseNormal(seq);
  if (parsed.status === 'pending') {
    return { state: { ...state, pendingKeys: seq } };
  }
  if (parsed.status === 'invalid') {
    return { state: { ...state, pendingKeys: '' } };
  }
  const base = { ...state, pendingKeys: '' };
  return execCmd(base, parsed.cmd, viewportRows);
}
