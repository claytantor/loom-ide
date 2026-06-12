/* App state — one source of truth, per the handoff state table.
   The vim engine state is held opaquely (constructed by the app layer) so the
   reducer stays free of engine imports and unit-tests in isolation. */

import type { TreeNode } from '../core/tree.js';
import type { LoomConfig } from '../core/config.js';
import type { Keymap } from '../core/keymap.js';
import type { ThemeOverride } from '../core/theme.js';
import type { DiffLine, BlameLine } from '../core/gitParse.js';
import type { FindResult } from '../services/ripgrep.js';
import type { VimState } from '../core/vim/index.js';

export type Focus = 'tree' | 'editor';
export type MainView = 'empty' | 'editor' | 'find' | 'diff' | 'blame';

export type InputMode =
  | { kind: 'find' }
  | { kind: 'rename'; target: string }
  | { kind: 'confirm'; question: string; action: ConfirmAction };

export type ConfirmAction =
  | { kind: 'discard'; path: string }
  | { kind: 'quit' }
  | { kind: 'open-other'; path: string };

export interface Diagnostic {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

export interface AppState {
  root: string;
  rootName: string;
  tree: TreeNode;
  scanTruncated: boolean;
  selPath: string | null;
  focus: Focus;
  mainView: MainView;

  openFile: string | null;
  vim: VimState | null;
  trailingNewline: boolean;
  bufferStale: boolean;

  omni: string;
  inputMode: InputMode | null;
  slashSel: number;
  /** Expansion/selection snapshot captured when a filter session starts. */
  preFilter: { expanded: Set<string>; selPath: string | null } | null;

  find: FindResult | null;
  findSel: number;
  diff: DiffLine[] | null;
  blame: BlameLine[] | null;
  outputScroll: number;
  outputTitle: string;

  isRepo: boolean;
  branch: string | null;
  gitDirty: number;

  toast: { text: string; danger?: boolean } | null;
  /** path → expiry epoch-ms for the accent.glow flash on new/changed rows. */
  flash: ReadonlyMap<string, number>;
  pulse: boolean;
  spinner: string | null;

  diagnostics: ReadonlyMap<string, Diagnostic[]>;
  lspStatus: string | null;

  config: LoomConfig;
  keymap: Keymap;
  userThemes: Map<string, ThemeOverride>;
  startupWarnings: string[];

  quitting: boolean;
}

export type OmniMode = 'idle' | 'filter' | 'slash' | 'ex' | 'input';

export function deriveOmniMode(omni: string, inputMode: InputMode | null): OmniMode {
  if (inputMode) return 'input';
  if (omni.startsWith('/')) return 'slash';
  if (omni.startsWith(':')) return 'ex';
  return omni.length > 0 ? 'filter' : 'idle';
}
