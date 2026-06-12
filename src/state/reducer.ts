/* Pure reducer. Side effects (disk, git, lsp, timers) live in the app layer;
   everything here is synchronous state arithmetic and unit-testable. */

import {
  addPath, applyExpanded, applyGitStatus, expandTo, expandedPaths, findNode, removePath,
  setDirOpen, updateNode, type GitCode, type TreeNode,
} from '../core/tree.js';
import { DEFAULT_CONFIG, type LoomConfig } from '../core/config.js';
import { DEFAULT_KEYMAP, type Keymap } from '../core/keymap.js';
import type { ThemeOverride } from '../core/theme.js';
import type { BlameLine, DiffLine } from '../core/gitParse.js';
import type { FindResult } from '../services/ripgrep.js';
import type { CommandResult } from '../services/passthru.js';
import type { WatchBatch } from '../services/watcher.js';
import type { VimState } from '../core/vim/index.js';
import type { AppState, Diagnostic, InputMode, MainView, PrCompose } from './types.js';
import { deriveOmniMode } from './types.js';

export const FLASH_MS = 900;

export type Action =
  | { type: 'init'; tree: TreeNode; truncated: boolean }
  | { type: 'settings'; config: LoomConfig; keymap: Keymap; userThemes: Map<string, ThemeOverride>; warnings: string[] }
  | { type: 'tree-batch'; batch: WatchBatch; now: number }
  | { type: 'remove-ghosts'; paths: string[] }
  | { type: 'flash-sweep'; now: number }
  | { type: 'git-refresh'; entries: ReadonlyMap<string, GitCode> | null; dirty: number; branch: string | null; isRepo: boolean }
  | { type: 'select'; path: string | null }
  | { type: 'dir-open'; path: string; open: boolean }
  | { type: 'reveal'; path: string }
  | { type: 'focus'; focus: 'tree' | 'editor' }
  | { type: 'omni-set'; value: string }
  | { type: 'omni-clear'; restore: boolean }
  | { type: 'slash-sel'; sel: number }
  | { type: 'input-mode'; mode: InputMode | null }
  | { type: 'open-file'; path: string; vim: VimState; trailingNewline: boolean }
  | { type: 'pr-compose-open'; compose: PrCompose; vim: VimState }
  | { type: 'pr-compose-close' }
  | { type: 'vim-set'; vim: VimState }
  | { type: 'buffer-stale'; stale: boolean }
  | { type: 'close-editor' }
  | { type: 'view'; view: MainView; title?: string; diff?: DiffLine[] | null; blame?: BlameLine[] | null; find?: FindResult | null; command?: CommandResult | null }
  | { type: 'find-sel'; sel: number }
  | { type: 'output-scroll'; scroll: number }
  | { type: 'toast'; text: string; danger?: boolean }
  | { type: 'toast-clear' }
  | { type: 'pulse'; on: boolean }
  | { type: 'spinner'; label: string | null }
  | { type: 'diagnostics'; path: string; items: Diagnostic[] }
  | { type: 'lsp-status'; label: string | null }
  | { type: 'config'; config: LoomConfig }
  | { type: 'quit' };

export function initialState(root: string, rootName: string): AppState {
  return {
    root,
    rootName,
    tree: { name: rootName, type: 'dir', path: '', open: true, children: [] },
    scanTruncated: false,
    selPath: null,
    focus: 'tree',
    mainView: 'empty',
    openFile: null,
    vim: null,
    trailingNewline: true,
    bufferStale: false,
    prCompose: null,
    omni: '',
    inputMode: null,
    slashSel: 0,
    preFilter: null,
    find: null,
    findSel: 0,
    diff: null,
    blame: null,
    command: null,
    outputScroll: 0,
    outputTitle: '',
    isRepo: false,
    branch: null,
    gitDirty: 0,
    toast: null,
    flash: new Map(),
    pulse: false,
    spinner: null,
    diagnostics: new Map(),
    lspStatus: null,
    config: DEFAULT_CONFIG,
    keymap: DEFAULT_KEYMAP,
    userThemes: new Map(),
    startupWarnings: [],
    quitting: false,
  };
}

function firstRowPath(tree: TreeNode): string | null {
  return tree.children?.[0]?.path ?? null;
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'init': {
      const selPath = state.selPath ?? firstRowPath(action.tree);
      return { ...state, tree: action.tree, scanTruncated: action.truncated, selPath };
    }

    case 'settings':
      return {
        ...state,
        config: action.config,
        keymap: action.keymap,
        userThemes: action.userThemes,
        startupWarnings: action.warnings,
      };

    case 'tree-batch': {
      let tree = state.tree;
      const flash = new Map(state.flash);
      for (const dir of action.batch.addedDirs) tree = addPath(tree, dir, 'dir');
      for (const file of action.batch.added) {
        tree = addPath(tree, file, 'file');
        flash.set(file, action.now + FLASH_MS);
      }
      for (const file of action.batch.changed) flash.set(file, action.now + FLASH_MS);
      for (const path of action.batch.removed) {
        // Ghost first; the app layer schedules remove-ghosts.
        if (findNode(tree, path)) tree = updateNode(tree, path, { ghost: true });
      }
      const stale =
        state.openFile !== null &&
        (action.batch.changed.includes(state.openFile) || action.batch.removed.includes(state.openFile));
      return {
        ...state,
        tree,
        flash,
        bufferStale: state.bufferStale || stale,
      };
    }

    case 'remove-ghosts': {
      let tree = state.tree;
      for (const path of action.paths) {
        const node = findNode(tree, path);
        if (node?.ghost) tree = removePath(tree, path);
      }
      // Selection must never vanish out from under the user: fall back to first row.
      const selPath =
        state.selPath && findNode(tree, state.selPath) ? state.selPath : firstRowPath(tree);
      return { ...state, tree, selPath };
    }

    case 'flash-sweep': {
      if (state.flash.size === 0) return state;
      const flash = new Map<string, number>();
      for (const [path, until] of state.flash) {
        if (until > action.now) flash.set(path, until);
      }
      return flash.size === state.flash.size ? state : { ...state, flash };
    }

    case 'git-refresh': {
      const tree = action.entries ? applyGitStatus(state.tree, action.entries) : state.tree;
      return { ...state, tree, gitDirty: action.dirty, branch: action.branch, isRepo: action.isRepo };
    }

    case 'select':
      return { ...state, selPath: action.path };

    case 'dir-open':
      return { ...state, tree: setDirOpen(state.tree, action.path, action.open) };

    case 'reveal': {
      const tree = expandTo(state.tree, action.path);
      return { ...state, tree, selPath: action.path, focus: 'tree' };
    }

    case 'focus':
      return { ...state, focus: action.focus };

    case 'omni-set': {
      const prevMode = deriveOmniMode(state.omni, state.inputMode);
      const nextMode = deriveOmniMode(action.value, state.inputMode);
      let preFilter = state.preFilter;
      // Entering a filter session: snapshot expansion + selection for exact
      // restore, and drop the live selection so the top match becomes
      // pre-selected (in dim mode the old row is still present but must not
      // hold the cursor — the spec pins the cursor to the best match).
      const startingFilter = nextMode === 'filter' && prevMode !== 'filter';
      if (startingFilter && !preFilter) {
        preFilter = { expanded: expandedPaths(state.tree), selPath: state.selPath };
      }
      let slashSel = state.slashSel;
      if (nextMode === 'slash' && prevMode !== 'slash') slashSel = 0;
      if (nextMode === 'slash' && action.value !== state.omni) slashSel = 0;
      // Filter cleared by backspacing to empty: restore exactly.
      if (prevMode === 'filter' && action.value === '') {
        return restoreFilter({ ...state, omni: '' });
      }
      return {
        ...state,
        omni: action.value,
        preFilter,
        slashSel,
        selPath: startingFilter ? null : state.selPath,
      };
    }

    case 'omni-clear': {
      const wasFilter = deriveOmniMode(state.omni, null) === 'filter';
      const next = { ...state, omni: '', slashSel: 0 };
      if (wasFilter && action.restore) return restoreFilter(next);
      next.preFilter = null;
      return next;
    }

    case 'slash-sel':
      return { ...state, slashSel: Math.max(0, action.sel) };

    case 'input-mode':
      return { ...state, inputMode: action.mode, omni: action.mode ? '' : state.omni };

    case 'open-file': {
      const tree = expandTo(state.tree, action.path);
      return {
        ...state,
        tree,
        openFile: action.path,
        vim: action.vim,
        trailingNewline: action.trailingNewline,
        bufferStale: false,
        mainView: 'editor',
        focus: 'editor',
        selPath: action.path,
        omni: '',
        preFilter: null,
        diff: null,
        blame: null,
        outputScroll: 0,
      };
    }

    case 'pr-compose-open':
      // Ephemeral compose buffer: the label is a virtual title ('PR → dev'),
      // NOT a tree path — so, unlike 'open-file', do not expandTo()/set selPath
      // (it would corrupt the tree). The editor pane renders `vim` regardless.
      return {
        ...state,
        prCompose: action.compose,
        vim: action.vim,
        openFile: action.compose.label,
        trailingNewline: true,
        bufferStale: false,
        mainView: 'editor',
        focus: 'editor',
        omni: '',
        preFilter: null,
        diff: null,
        blame: null,
        outputScroll: 0,
      };

    case 'pr-compose-close':
      return {
        ...state,
        prCompose: null,
        vim: null,
        openFile: null,
        bufferStale: false,
        mainView: 'empty',
        focus: 'tree',
      };

    case 'vim-set':
      return { ...state, vim: action.vim };

    case 'buffer-stale':
      return { ...state, bufferStale: action.stale };

    case 'close-editor':
      return {
        ...state,
        openFile: null,
        vim: null,
        bufferStale: false,
        mainView: 'empty',
        focus: 'tree',
      };

    case 'view': {
      const isOutput =
        action.view === 'find' || action.view === 'diff' || action.view === 'blame' ||
        action.view === 'help' || action.view === 'command';
      return {
        ...state,
        mainView: action.view,
        outputTitle: action.title ?? state.outputTitle,
        diff: action.diff !== undefined ? action.diff : state.diff,
        blame: action.blame !== undefined ? action.blame : state.blame,
        find: action.find !== undefined ? action.find : state.find,
        findSel: action.find !== undefined ? 0 : state.findSel,
        command: action.command !== undefined ? action.command : state.command,
        outputScroll: action.view === 'find' ? state.outputScroll : 0,
        focus: isOutput ? 'editor' : state.focus,
      };
    }

    case 'find-sel':
      return { ...state, findSel: Math.max(0, action.sel) };

    case 'output-scroll':
      return { ...state, outputScroll: Math.max(0, action.scroll) };

    case 'toast':
      return { ...state, toast: { text: action.text, ...(action.danger ? { danger: true } : {}) } };

    case 'toast-clear':
      return { ...state, toast: null };

    case 'pulse':
      return { ...state, pulse: action.on };

    case 'spinner':
      return { ...state, spinner: action.label };

    case 'diagnostics': {
      const diagnostics = new Map(state.diagnostics);
      if (action.items.length === 0) diagnostics.delete(action.path);
      else diagnostics.set(action.path, action.items);
      return { ...state, diagnostics };
    }

    case 'lsp-status':
      return { ...state, lspStatus: action.label };

    case 'config':
      return { ...state, config: action.config };

    case 'quit':
      return { ...state, quitting: true };

    default:
      return state;
  }
}

function restoreFilter(state: AppState): AppState {
  if (!state.preFilter) return state;
  const tree = applyExpanded(state.tree, state.preFilter.expanded);
  const selPath =
    state.preFilter.selPath && findNode(tree, state.preFilter.selPath)
      ? state.preFilter.selPath
      : state.selPath && findNode(tree, state.selPath)
        ? state.selPath
        : firstRowPath(tree);
  return { ...state, tree, selPath, preFilter: null };
}
