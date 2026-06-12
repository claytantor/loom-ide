// Public API of the Loom vim engine.

export type { VimMode, Pos, VimState, VimEffects, KeyContext } from './types.js';
export { createVim, getText, withText, markSaved, handleKey, runEx } from './engine.js';
