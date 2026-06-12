/* App state — one source of truth, per the handoff state table.
   The vim engine state is held opaquely (constructed by the app layer) so the
   reducer stays free of engine imports and unit-tests in isolation. */

import type { TreeNode } from '../core/tree.js';
import type { LoomConfig } from '../core/config.js';
import type { Keymap } from '../core/keymap.js';
import type { ThemeOverride } from '../core/theme.js';
import type { DiffLine, BlameLine } from '../core/gitParse.js';
import type { FindResult } from '../services/ripgrep.js';
import type { CommandResult, PassthruLabel } from '../services/passthru.js';
import type { VimState } from '../core/vim/index.js';

export type Focus = 'tree' | 'editor';
export type MainView = 'empty' | 'editor' | 'find' | 'diff' | 'blame' | 'help' | 'command';

export type InputMode =
  | { kind: 'find' }
  | { kind: 'passthru'; label: PassthruLabel }
  | { kind: 'pr' }
  | { kind: 'rename'; target: string }
  | { kind: 'confirm'; question: string; action: ConfirmAction };

/** Live /pr compose session: the AI draft is hosted in the vim editor as an
   ephemeral buffer (no disk file). Saving it creates the PR; quitting cancels. */
export interface PrCompose {
  /** Base branch the PR merges into. */
  target: string;
  /** Head branch (current branch) the PR is opened from. */
  head: string;
  /** Open the PR as a draft (R4). */
  draft: boolean;
  /** Virtual label shown in the editor status line, e.g. 'PR → dev'. */
  label: string;
}

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
  /** Hide the file tree so the main pane is full-width (clean editor selection). */
  treeHidden: boolean;

  openFile: string | null;
  vim: VimState | null;
  trailingNewline: boolean;
  bufferStale: boolean;
  /** Non-null while an AI PR draft is being composed in the editor buffer. */
  prCompose: PrCompose | null;

  omni: string;
  inputMode: InputMode | null;
  slashSel: number;
  /** Expansion/selection snapshot captured when a filter session starts. */
  preFilter: { expanded: Set<string>; selPath: string | null } | null;

  find: FindResult | null;
  findSel: number;
  diff: DiffLine[] | null;
  blame: BlameLine[] | null;
  command: CommandResult | null;
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
