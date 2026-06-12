// Engine entry points: createVim, handleKey, runEx and buffer accessors.

import type { KeyContext, VimEffects, VimState } from './types.js';
import { clampNormal, joinText, splitText } from './text.js';
import { initialState } from './state.js';
import { handleNormalKey, type NormalResult } from './normal.js';
import { handleVisualKey } from './visual.js';
import { handleInsertKey } from './insert.js';
import { execEx } from './ex.js';

const DEFAULT_VIEWPORT_ROWS = 20;

export function createVim(text: string): VimState {
  return initialState(text);
}

export function getText(state: VimState): string {
  return joinText(state.lines);
}

/** External reload: replace the buffer, clear history, clamp cursor, mark clean. */
export function withText(state: VimState, text: string): VimState {
  const lines = splitText(text);
  return {
    ...state,
    lines,
    cursor: clampNormal(lines, state.cursor),
    mode: 'normal',
    visualStart: null,
    dirty: false,
    message: null,
    pendingKeys: '',
    desiredCol: null,
    undoStack: [],
    redoStack: [],
    pendingUndo: null,
    insertSession: null,
  };
}

export function markSaved(state: VimState): VimState {
  return state.dirty ? { ...state, dirty: false } : state;
}

function clearMessage(state: VimState): VimState {
  return state.message !== null ? { ...state, message: null } : state;
}

function dispatch(state: VimState, key: string, viewportRows: number): NormalResult {
  switch (state.mode) {
    case 'insert':
    case 'replace':
      return handleInsertKey(state, key);
    case 'visual':
    case 'visual-line':
      return handleVisualKey(state, key, viewportRows);
    default:
      return handleNormalKey(state, key, viewportRows);
  }
}

export function handleKey(
  state: VimState,
  key: string,
  ctx?: KeyContext
): { state: VimState; effects: VimEffects } {
  const viewportRows = ctx?.viewportRows ?? DEFAULT_VIEWPORT_ROWS;
  let result = dispatch(clearMessage(state), key, viewportRows);
  if (result.replay) {
    // Dot repeat: re-feed the recorded tokens through the engine.
    let cur = result.state;
    for (const tok of result.replay) {
      const step = dispatch(clearMessage(cur), tok, viewportRows);
      cur = step.state; // nested replays are impossible ('.' is never recorded)
    }
    result = { state: cur };
  }
  const effects: VimEffects = {};
  if (result.state.message !== null) effects.message = result.state.message;
  return { state: result.state, effects };
}

export function runEx(state: VimState, cmd: string): { state: VimState; effects: VimEffects } {
  return execEx(clearMessage(state), cmd);
}
