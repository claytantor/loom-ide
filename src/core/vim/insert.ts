// Insert and Replace (R) mode handling. A whole session is one undo unit.

import type { InsertSession, ReplaceStep, VimState } from './types.js';
import { SHIFT_WIDTH, UNDO_CAP } from './types.js';
import {
  clampInsert,
  clampNormal,
  lastRow,
  leadingIndent,
  lineAt,
  linesEqual,
  spliceLines,
} from './text.js';

export interface InsertResult {
  state: VimState;
}

function withSession(state: VimState, session: InsertSession): VimState {
  return { ...state, insertSession: session };
}

function record(session: InsertSession | null, token: string): InsertSession | null {
  if (!session) return null;
  return { ...session, typed: [...session.typed, token] };
}

function pushStep(session: InsertSession | null, step: ReplaceStep): InsertSession | null {
  if (!session) return null;
  return { ...session, replaceSteps: [...session.replaceSteps, step] };
}

function setLine(state: VimState, row: number, text: string): readonly string[] {
  const out = state.lines.slice() as string[];
  out[row] = text;
  return out;
}

function finishSession(state: VimState): VimState {
  const snap = state.pendingUndo;
  const sess = state.insertSession;
  const changed = snap ? !linesEqual(state.lines, snap.lines) : false;
  let undoStack = state.undoStack;
  let redoStack = state.redoStack;
  let dirty = state.dirty;
  if (snap) {
    if (changed) {
      undoStack = [...undoStack, snap].slice(-UNDO_CAP);
      redoStack = [];
    } else {
      dirty = snap.dirty;
    }
  }
  const lastChange = sess?.prefix
    ? { tokens: [...sess.prefix, ...sess.typed, '<Esc>'], count: sess.count }
    : state.lastChange;
  const col = Math.max(0, state.cursor.col - 1);
  return {
    ...state,
    mode: 'normal',
    cursor: clampNormal(state.lines, { row: state.cursor.row, col }),
    dirty,
    undoStack,
    redoStack,
    pendingUndo: null,
    insertSession: null,
    desiredCol: null,
    pendingKeys: '',
    lastChange,
  };
}

function insertText(state: VimState, token: string, text: string): VimState {
  const { row, col } = state.cursor;
  const line = lineAt(state.lines, row);
  const lines = setLine(state, row, line.slice(0, col) + text + line.slice(col));
  return {
    ...state,
    lines,
    cursor: { row, col: col + text.length },
    dirty: true,
    insertSession: record(state.insertSession, token),
  };
}

function replaceText(state: VimState, token: string, text: string): VimState {
  let session = record(state.insertSession, token);
  let line = lineAt(state.lines, state.cursor.row);
  const { row } = state.cursor;
  let col = state.cursor.col;
  for (const ch of text) {
    if (col < line.length) {
      session = pushStep(session, { kind: 'replaced', ch: line[col] as string });
      line = line.slice(0, col) + ch + line.slice(col + 1);
    } else {
      session = pushStep(session, { kind: 'appended' });
      line = line + ch;
    }
    col++;
  }
  return {
    ...state,
    lines: setLine(state, row, line),
    cursor: { row, col },
    dirty: true,
    insertSession: session,
  };
}

function splitLine(state: VimState, token: string, carryIndent: boolean, step: boolean): VimState {
  const { row, col } = state.cursor;
  const line = lineAt(state.lines, row);
  const head = line.slice(0, col);
  const indent = carryIndent ? leadingIndent(head) : '';
  const tail = indent + line.slice(col);
  const lines = spliceLines(state.lines, row, row, [head, tail]);
  let session = record(state.insertSession, token);
  if (step) session = pushStep(session, { kind: 'split', indent: indent.length });
  return {
    ...state,
    lines,
    cursor: { row: row + 1, col: indent.length },
    dirty: true,
    insertSession: session,
  };
}

function backspaceInsert(state: VimState): VimState {
  const { row, col } = state.cursor;
  const session = record(state.insertSession, '<BS>');
  if (col > 0) {
    const line = lineAt(state.lines, row);
    const lines = setLine(state, row, line.slice(0, col - 1) + line.slice(col));
    return { ...state, lines, cursor: { row, col: col - 1 }, dirty: true, insertSession: session };
  }
  if (row === 0) return session ? withSession(state, session) : state;
  const prev = lineAt(state.lines, row - 1);
  const cur = lineAt(state.lines, row);
  const lines = spliceLines(state.lines, row - 1, row, [prev + cur]);
  return {
    ...state,
    lines,
    cursor: { row: row - 1, col: prev.length },
    dirty: true,
    insertSession: session,
  };
}

function backspaceReplace(state: VimState): VimState {
  const sess = state.insertSession;
  const steps = sess?.replaceSteps ?? [];
  const last = steps[steps.length - 1];
  let session = record(sess, '<BS>');
  const { row, col } = state.cursor;
  if (!last) {
    // nothing recorded at this position: just move left
    const ncol = Math.max(0, col - 1);
    return { ...state, cursor: { row, col: ncol }, insertSession: session };
  }
  session = session ? { ...session, replaceSteps: steps.slice(0, -1) } : null;
  if (last.kind === 'split') {
    const prev = lineAt(state.lines, row - 1);
    const cur = lineAt(state.lines, row);
    const restored = cur.slice(last.indent);
    const lines = spliceLines(state.lines, row - 1, row, [prev + restored]);
    return { ...state, lines, cursor: { row: row - 1, col: prev.length }, dirty: true, insertSession: session };
  }
  const line = lineAt(state.lines, row);
  if (last.kind === 'replaced') {
    const lines = setLine(state, row, line.slice(0, col - 1) + last.ch + line.slice(col));
    return { ...state, lines, cursor: { row, col: Math.max(0, col - 1) }, dirty: true, insertSession: session };
  }
  // appended
  const lines = setLine(state, row, line.slice(0, col - 1) + line.slice(col));
  return { ...state, lines, cursor: { row, col: Math.max(0, col - 1) }, dirty: true, insertSession: session };
}

function deleteAtCursor(state: VimState): VimState {
  const { row, col } = state.cursor;
  const line = lineAt(state.lines, row);
  const session = record(state.insertSession, '<Del>');
  if (col < line.length) {
    const lines = setLine(state, row, line.slice(0, col) + line.slice(col + 1));
    return { ...state, lines, dirty: true, insertSession: session };
  }
  if (row < lastRow(state.lines)) {
    const next = lineAt(state.lines, row + 1);
    const lines = spliceLines(state.lines, row, row + 1, [line + next]);
    return { ...state, lines, dirty: true, insertSession: session };
  }
  return session ? withSession(state, session) : state;
}

function moveCursor(state: VimState, token: string): VimState {
  const { row, col } = state.cursor;
  const last = lastRow(state.lines);
  let pos = { row, col };
  switch (token) {
    case '<Left>':
      pos = { row, col: Math.max(0, col - 1) };
      break;
    case '<Right>':
      pos = { row, col: Math.min(col + 1, lineAt(state.lines, row).length) };
      break;
    case '<Up>':
      pos = { row: Math.max(0, row - 1), col };
      break;
    case '<Down>':
      pos = { row: Math.min(last, row + 1), col };
      break;
    case '<Home>':
      pos = { row, col: 0 };
      break;
    case '<End>':
      pos = { row, col: lineAt(state.lines, row).length };
      break;
  }
  return {
    ...state,
    cursor: clampInsert(state.lines, pos),
    insertSession: record(state.insertSession, token),
  };
}

export function handleInsertKey(state: VimState, key: string): InsertResult {
  const replace = state.mode === 'replace';
  switch (key) {
    case '<Esc>':
      return { state: finishSession(state) };
    case '<CR>':
      return { state: splitLine(state, key, !replace, replace) };
    case '<BS>':
      return { state: replace ? backspaceReplace(state) : backspaceInsert(state) };
    case '<Del>':
      return { state: deleteAtCursor(state) };
    case '<Tab>': {
      const text = ' '.repeat(SHIFT_WIDTH);
      return { state: replace ? replaceText(state, key, text) : insertText(state, key, text) };
    }
    case '<Left>':
    case '<Right>':
    case '<Up>':
    case '<Down>':
    case '<Home>':
    case '<End>':
      return { state: moveCursor(state, key) };
    default:
      if (key.length === 1) {
        return { state: replace ? replaceText(state, key, key) : insertText(state, key, key) };
      }
      return { state }; // unknown special: ignore
  }
}
