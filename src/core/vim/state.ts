// State construction and undo/commit helpers.

import type { Pos, UndoEntry, VimState } from './types.js';
import { UNDO_CAP } from './types.js';
import { clampNormal, linesEqual, splitText } from './text.js';

export function initialState(text: string): VimState {
  return {
    lines: splitText(text),
    cursor: { row: 0, col: 0 },
    mode: 'normal',
    visualStart: null,
    dirty: false,
    message: null,
    searchPattern: null,
    searchHighlight: false,
    pendingKeys: '',
    desiredCol: null,
    registers: {},
    marks: {},
    lastJump: null,
    undoStack: [],
    redoStack: [],
    pendingUndo: null,
    insertSession: null,
    lastFind: null,
    searchDirection: 1,
    lastChange: null,
  };
}

export function snapshotOf(state: VimState): UndoEntry {
  return { lines: state.lines, cursor: state.cursor, dirty: state.dirty };
}

export function setMessage(state: VimState, message: string | null): VimState {
  return { ...state, message };
}

/**
 * Commit a buffer change as one undo unit. If nothing actually changed,
 * returns the state with only the cursor moved.
 */
export function commitChange(
  state: VimState,
  snap: UndoEntry,
  lines: readonly string[],
  cursor: Pos
): VimState {
  if (linesEqual(lines, state.lines)) {
    return { ...state, cursor: clampNormal(state.lines, cursor) };
  }
  return {
    ...state,
    lines,
    cursor: clampNormal(lines, cursor),
    dirty: true,
    undoStack: [...state.undoStack, snap].slice(-UNDO_CAP),
    redoStack: [],
  };
}

export function undo(state: VimState, count: number): VimState {
  let cur = state;
  for (let i = 0; i < count; i++) {
    const entry = cur.undoStack[cur.undoStack.length - 1];
    if (!entry) {
      return setMessage(cur, 'already at oldest change');
    }
    cur = {
      ...cur,
      lines: entry.lines,
      cursor: clampNormal(entry.lines, entry.cursor),
      dirty: entry.dirty,
      undoStack: cur.undoStack.slice(0, -1),
      redoStack: [...cur.redoStack, snapshotOf(cur)],
    };
  }
  return cur;
}

export function redo(state: VimState, count: number): VimState {
  let cur = state;
  for (let i = 0; i < count; i++) {
    const entry = cur.redoStack[cur.redoStack.length - 1];
    if (!entry) {
      return setMessage(cur, 'already at newest change');
    }
    cur = {
      ...cur,
      lines: entry.lines,
      cursor: clampNormal(entry.lines, entry.cursor),
      dirty: entry.dirty,
      undoStack: [...cur.undoStack, snapshotOf(cur)].slice(-UNDO_CAP),
      redoStack: cur.redoStack.slice(0, -1),
    };
  }
  return cur;
}
