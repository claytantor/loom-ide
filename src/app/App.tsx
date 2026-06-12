/* Loom's application shell: state store, services wiring, key routing, layout.
   All disk/git/lsp side effects live here; everything below `render` is pure. */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { join, relative } from 'node:path';

import { computeFilter, type FilterRow } from '../core/filter.js';
import { allFiles, buildTree, findNode, flattenVisible } from '../core/tree.js';
import { basename, clamp, endTruncate, parentPath } from '../core/text.js';
import { GLYPHS, resolveTheme } from '../core/theme.js';
import { keyDescFromInk, lookupAction, type KeyAction } from '../core/keymap.js';
import { parseBlameLinePorcelain, parseUnifiedDiff } from '../core/gitParse.js';
import {
  createVim, getText, handleKey, markSaved, runEx,
  type VimEffects, type VimState,
} from '../core/vim/index.js';

import { scanRepo, SCAN_CAP } from '../services/fsScan.js';
import { watchRepo, type RepoWatcher, type WatchBatch } from '../services/watcher.js';
import { blameFile, currentBranch, diffFile, discardFile, isRepo as gitIsRepo, repoStatus } from '../services/git.js';
import { findInProject } from '../services/ripgrep.js';
import { parseArgv, runByLabel, runGit, type CommandResult, type PassthruLabel } from '../services/passthru.js';
import {
  commitLogDraft, createPr, gatherPrContext, generatePrDescription, parseDraft, preflightAuth,
} from '../services/pr.js';
import { loadBuffer, renamePath, saveBuffer } from '../services/bufferIo.js';
import { ensureSeeded, loadSettings, saveConfig } from '../services/configIo.js';
import { LspManager, pathToUri, resolveLanguage, uriToPath, type LspClient } from '../services/lsp/index.js';

import { initialState, reduce, FLASH_MS } from '../state/reducer.js';
import { deriveOmniMode, type ConfirmAction, type PrCompose } from '../state/types.js';
import { filterSlash, filterThemeEntries, themeEntries, type SlashItem, type ThemeEntry } from '../state/commands.js';

import { ChromeContext } from '../ui/context.js';
import { TreePane } from '../ui/TreePane.js';
import { Editor } from '../ui/Editor.js';
import { BlameView, CommandView, DiffView, EmptyMain, FindView, HelpView, HELP_ROWS, flattenFind } from '../ui/OutputViews.js';
import { OmniBar } from '../ui/OmniBar.js';
import { SlashPalette } from '../ui/SlashPalette.js';

export interface AppProps {
  root: string;
}

const GIT_DEBOUNCE_MS = 250;
const LSP_SYNC_MS = 300;
const TOAST_MS = 2800;
const GHOST_MS = 800;
const PULSE_MS = 900;
const MAX_PALETTE_ROWS = 9;

export function App({ root }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(root, basename(root) || root));
  const stateRef = useRef(state);
  stateRef.current = state;

  /* ── omni-bar value as a synchronous ref ───────────────────────────────
   * Ink delivers each keystroke as its own `useInput` call, but React commits
   * dispatches asynchronously — so a fast burst (or paste) like `:w` would let
   * the second key read a stale omni value and mis-route. omniRef is updated
   * synchronously on every omni mutation and reconciled to committed state via
   * an effect (which only runs post-commit, never mid-burst). */
  const omniRef = useRef(state.omni);
  useEffect(() => {
    omniRef.current = state.omni;
  }, [state.omni]);
  const pushOmni = useCallback((value: string): void => {
    omniRef.current = value;
    dispatch({ type: 'omni-set', value });
  }, []);
  const clearOmni = useCallback((restore: boolean): void => {
    omniRef.current = '';
    dispatch({ type: 'omni-clear', restore });
  }, []);

  /* ── terminal geometry ─────────────────────────────────────────────── */
  // A sizeless PTY (some CI/`script` contexts) reports columns/rows of 0, which
  // `?? default` would NOT catch — fall back on any non-positive value too.
  const { stdout } = useStdout();
  const measure = useCallback(
    () => ({
      cols: stdout && stdout.columns > 0 ? stdout.columns : 120,
      rows: stdout && stdout.rows > 0 ? stdout.rows : 40,
    }),
    [stdout],
  );
  const [dims, setDims] = useState(measure);
  useEffect(() => {
    if (!stdout || typeof stdout.on !== 'function') return;
    const onResize = (): void => setDims(measure());
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout, measure]);

  /* ── service refs ──────────────────────────────────────────────────── */
  const lspRef = useRef<LspManager | null>(null);
  const watcherRef = useRef<RepoWatcher | null>(null);
  const selfSaveRef = useRef(new Map<string, number>());
  const gitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lspSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lspSyncedTextRef = useRef<string | null>(null);
  // Set synchronously while a /pr submit is in flight, so the trailing :wq quit
  // (save+quit in one burst) is a guarded no-op instead of cancelling the PR.
  const prSubmittingRef = useRef(false);

  const toast = useCallback((text: string, danger = false): void => {
    dispatch({ type: 'toast', text, danger });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => dispatch({ type: 'toast-clear' }), TOAST_MS);
  }, []);

  const refreshGit = useCallback((): void => {
    if (gitTimerRef.current) clearTimeout(gitTimerRef.current);
    gitTimerRef.current = setTimeout(() => {
      void (async () => {
        const repo = await gitIsRepo(root);
        if (!repo) {
          dispatch({ type: 'git-refresh', entries: null, dirty: 0, branch: null, isRepo: false });
          return;
        }
        const [status, branch] = await Promise.all([repoStatus(root), currentBranch(root)]);
        dispatch({
          type: 'git-refresh',
          entries: status?.entries ?? null,
          dirty: status?.dirtyCount ?? 0,
          branch,
          isRepo: true,
        });
      })();
    }, GIT_DEBOUNCE_MS);
  }, [root]);

  const onWatchBatch = useCallback((batch: WatchBatch): void => {
    const now = Date.now();
    const changed = batch.changed.filter((p) => {
      const at = selfSaveRef.current.get(p);
      return !(at !== undefined && now - at < 1000);
    });
    const any = batch.added.length + batch.addedDirs.length + changed.length + batch.removed.length > 0;
    if (any) {
      dispatch({ type: 'tree-batch', batch: { ...batch, changed }, now });
      if (batch.removed.length > 0) {
        setTimeout(() => dispatch({ type: 'remove-ghosts', paths: batch.removed }), GHOST_MS);
      }
      setTimeout(() => dispatch({ type: 'flash-sweep', now: Date.now() }), FLASH_MS + 60);
      dispatch({ type: 'pulse', on: true });
      setTimeout(() => dispatch({ type: 'pulse', on: false }), PULSE_MS);
    }
    refreshGit();
  }, [refreshGit]);

  /* ── bootstrap ─────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    void (async () => {
      await ensureSeeded();
      const settings = await loadSettings();
      if (!alive) return;
      dispatch({ type: 'settings', ...settings });
      const scan = await scanRepo(root);
      if (!alive) return;
      dispatch({ type: 'init', tree: buildTree(scan.files, basename(root)), truncated: scan.truncated });
      refreshGit();
      watcherRef.current = await watchRepo(root, onWatchBatch);
      if (scan.truncated) toast(`large repo — tree capped at ${SCAN_CAP} files`);
      else if (settings.warnings.length > 0) toast(settings.warnings[0]!, true);
    })();
    const lsp = new LspManager(root);
    lsp.onDiagnostics((absPath, diags) => {
      const rel = relative(root, absPath);
      if (rel.startsWith('..')) return;
      dispatch({
        type: 'diagnostics',
        path: rel.split('\\').join('/'),
        items: diags.map((d) => ({
          line: d.line, col: d.col, endLine: d.endLine, endCol: d.endCol,
          severity: d.severity, message: d.message, ...(d.source ? { source: d.source } : {}),
        })),
      });
    });
    lsp.onStatus((lang, status) => {
      if (status === 'starting') dispatch({ type: 'lsp-status', label: `${lang} lsp` });
      else dispatch({ type: 'lsp-status', label: null });
    });
    lspRef.current = lsp;
    return () => {
      alive = false;
      void watcherRef.current?.close();
      void lsp.disposeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  /* ── buffer plumbing ───────────────────────────────────────────────── */
  const lspClientForOpen = useCallback(async (): Promise<LspClient | null> => {
    const open = stateRef.current.openFile;
    if (!open || !lspRef.current) return null;
    return lspRef.current.clientFor(join(root, open));
  }, [root]);

  const openFileAt = useCallback(async (rel: string, line?: number): Promise<void> => {
    try {
      const prev = stateRef.current.openFile;
      if (prev && prev !== rel) {
        const client = await lspClientForOpen();
        client?.didClose(pathToUri(join(root, prev)));
      }
      const buf = await loadBuffer(root, rel);
      let vim = createVim(buf.lines.join('\n'));
      if (line !== undefined && line > 0) vim = runEx(vim, String(line)).state;
      dispatch({ type: 'open-file', path: rel, vim, trailingNewline: buf.trailingNewline });
      lspSyncedTextRef.current = getText(vim);
      const lspMgr = lspRef.current;
      if (lspMgr && resolveLanguage(join(root, rel))) {
        const client = await lspMgr.clientFor(join(root, rel));
        client?.didOpen(pathToUri(join(root, rel)), resolveLanguage(join(root, rel))!.languageId, getText(vim));
      }
    } catch (err) {
      toast((err as Error).message, true);
    }
  }, [root, toast, lspClientForOpen]);

  const requestOpen = useCallback((rel: string, line?: number): void => {
    const s = stateRef.current;
    const node = findNode(s.tree, rel);
    if (node && node.type !== 'file') return;
    if (s.vim?.dirty && s.openFile && s.openFile !== rel) {
      dispatch({
        type: 'input-mode',
        mode: {
          kind: 'confirm',
          question: `discard unsaved changes to ${basename(s.openFile)}?`,
          action: { kind: 'open-other', path: rel },
        },
      });
      return;
    }
    void openFileAt(rel, line);
  }, [openFileAt]);

  const saveNow = useCallback(async (vim: VimState): Promise<void> => {
    const s = stateRef.current;
    // Compose-buffer save (the /pr crux): :w, :wq, and Ctrl-S all funnel here.
    // Intercept before any disk write — there is no real file behind this buffer.
    if (s.prCompose) {
      void submitPr(s.prCompose, vim);
      return;
    }
    if (!s.openFile) return;
    try {
      await saveBuffer(root, s.openFile, vim.lines, s.trailingNewline);
      selfSaveRef.current.set(s.openFile, Date.now());
      dispatch({ type: 'vim-set', vim: markSaved(vim) });
      dispatch({ type: 'buffer-stale', stale: false });
      toast(`wrote ${s.openFile}`);
      const client = await lspClientForOpen();
      client?.didSave(pathToUri(join(root, s.openFile)), getText(vim));
      refreshGit();
    } catch (err) {
      toast((err as Error).message, true);
    }
  }, [root, toast, refreshGit, lspClientForOpen]);

  const closeEditor = useCallback((): void => {
    const open = stateRef.current.openFile;
    if (open) {
      void lspClientForOpen().then((client) => client?.didClose(pathToUri(join(root, open))));
    }
    dispatch({ type: 'close-editor' });
  }, [root, lspClientForOpen]);

  const handleVimEffects = useCallback((effects: VimEffects, vim: VimState): void => {
    if (effects.message) toast(effects.message);
    if (effects.save) void saveNow(vim);
    if (effects.quit) {
      // In a /pr compose buffer, quit means "abandon the PR", not "close a file".
      // For :wq the save above already started submitPr (which set the ref), so
      // the trailing quit here must NOT cancel — guard on the in-flight ref.
      if (prSubmittingRef.current) return;
      if (stateRef.current.prCompose) cancelPr();
      else closeEditor();
    }
  }, [toast, saveNow, closeEditor]);

  /* LSP didChange sync, debounced on buffer text change. */
  useEffect(() => {
    if (!state.vim || !state.openFile) return;
    const text = getText(state.vim);
    if (text === lspSyncedTextRef.current) return;
    if (lspSyncTimerRef.current) clearTimeout(lspSyncTimerRef.current);
    const open = state.openFile;
    lspSyncTimerRef.current = setTimeout(() => {
      lspSyncedTextRef.current = text;
      void lspClientForOpen().then((client) => client?.didChange(pathToUri(join(root, open)), text));
    }, LSP_SYNC_MS);
  }, [state.vim, state.openFile, root, lspClientForOpen]);

  /* ── command implementations ───────────────────────────────────────── */
  const runFind = useCallback(async (query: string): Promise<void> => {
    dispatch({ type: 'spinner', label: '/find' });
    const res = await findInProject(root, query, async () => allFiles(stateRef.current.tree).map((f) => f.path));
    dispatch({ type: 'spinner', label: null });
    dispatch({ type: 'view', view: 'find', title: `/find ${query}`, find: res });
  }, [root]);

  const runPassthru = useCallback(async (label: PassthruLabel, argString: string): Promise<void> => {
    dispatch({ type: 'spinner', label: `/${label}` });
    const result = await runByLabel(label, root, argString, { cols: refs.current.mainChars });
    dispatch({ type: 'spinner', label: null });
    dispatch({ type: 'view', view: 'command', title: `${label} ${argString}`, command: result });
    if (result.error) toast(result.error, true);
  }, [root, toast]);

  const runDiff = useCallback(async (rel: string): Promise<void> => {
    dispatch({ type: 'spinner', label: '/diff' });
    const raw = await diffFile(root, rel);
    dispatch({ type: 'spinner', label: null });
    if (raw === null) {
      toast('git diff failed — not a repository?', true);
      return;
    }
    dispatch({ type: 'view', view: 'diff', title: `/diff ${rel}`, diff: parseUnifiedDiff(raw) });
  }, [root, toast]);

  const runBlame = useCallback(async (rel: string): Promise<void> => {
    dispatch({ type: 'spinner', label: '/blame' });
    const raw = await blameFile(root, rel);
    dispatch({ type: 'spinner', label: null });
    if (raw === null) {
      toast(`git blame failed for ${rel}`, true);
      return;
    }
    dispatch({ type: 'view', view: 'blame', title: `/blame ${rel}`, blame: parseBlameLinePorcelain(raw) });
  }, [root, toast]);

  const applyTheme = useCallback(async (entry: ThemeEntry): Promise<void> => {
    const config = { ...stateRef.current.config, theme: entry.theme, accent: entry.accent };
    dispatch({ type: 'config', config });
    try {
      await saveConfig(config);
      toast(`theme: ${entry.id}`);
    } catch (err) {
      toast((err as Error).message, true);
    }
  }, [toast]);

  const doQuit = useCallback((): void => {
    dispatch({ type: 'quit' });
    void watcherRef.current?.close();
    void lspRef.current?.disposeAll();
    exit();
    // exit() unmounts Ink, but the chokidar watcher, LSP child processes, and
    // pending timers keep Node's event loop alive — guarantee the shell returns.
    // cli.tsx's `process.on('exit')` handler restores the screen first.
    setTimeout(() => process.exit(0), 50);
  }, [exit]);

  const confirmYes = useCallback(async (action: ConfirmAction): Promise<void> => {
    dispatch({ type: 'input-mode', mode: null });
    switch (action.kind) {
      case 'discard': {
        const ok = await discardFile(root, action.path);
        toast(ok ? `discarded changes to ${action.path}` : `discard failed for ${action.path}`, !ok);
        if (ok && stateRef.current.openFile === action.path) await openFileAt(action.path);
        refreshGit();
        return;
      }
      case 'quit':
        doQuit();
        return;
      case 'open-other':
        await openFileAt(action.path);
        return;
    }
  }, [root, toast, refreshGit, openFileAt, doQuit]);

  const submitRename = useCallback(async (target: string, newName: string): Promise<void> => {
    dispatch({ type: 'input-mode', mode: null });
    clearOmni(false);
    if (!newName || newName.includes('/') || newName === basename(target)) {
      if (newName.includes('/')) toast('rename takes a new name, not a path', true);
      return;
    }
    const parent = parentPath(target);
    const to = parent ? `${parent}/${newName}` : newName;
    try {
      await renamePath(root, target, to);
      const s = stateRef.current;
      dispatch({
        type: 'tree-batch',
        batch: { added: [to], addedDirs: [], changed: [], removed: [target] },
        now: Date.now(),
      });
      dispatch({ type: 'remove-ghosts', paths: [target] });
      dispatch({ type: 'select', path: to });
      if (s.openFile === target && s.vim) {
        dispatch({ type: 'open-file', path: to, vim: s.vim, trailingNewline: s.trailingNewline });
      }
      toast(`renamed to ${to}`);
      refreshGit();
    } catch (err) {
      toast((err as Error).message, true);
    }
  }, [root, toast, refreshGit]);

  const lspHover = useCallback(async (): Promise<void> => {
    const s = stateRef.current;
    if (!s.openFile || !s.vim) return;
    const client = await lspClientForOpen();
    if (!client) {
      toast('no language server for this file');
      return;
    }
    const text = await client.hover(pathToUri(join(root, s.openFile)), s.vim.cursor.row, s.vim.cursor.col);
    const first = text?.split('\n').find((l) => l.trim().length > 0);
    toast(first ? endTruncate(first.trim(), 100) : 'no hover info');
  }, [root, toast, lspClientForOpen]);

  const lspDefinition = useCallback(async (): Promise<void> => {
    const s = stateRef.current;
    if (!s.openFile || !s.vim) return;
    const client = await lspClientForOpen();
    if (!client) {
      toast('no language server for this file');
      return;
    }
    const def = await client.definition(pathToUri(join(root, s.openFile)), s.vim.cursor.row, s.vim.cursor.col);
    if (!def) {
      toast('definition not found');
      return;
    }
    const abs = uriToPath(def.uri);
    const rel = relative(root, abs).split('\\').join('/');
    if (rel.startsWith('..')) {
      toast(`definition outside repo: ${abs}`);
      return;
    }
    requestOpen(rel, def.line + 1);
  }, [root, toast, requestOpen, lspClientForOpen]);

  const runSlashItem = useCallback((item: SlashItem): void => {
    const s = stateRef.current;
    const sel = s.selPath && findNode(s.tree, s.selPath)?.type === 'file' ? s.selPath : null;
    const clear = (): void => clearOmni(false);
    switch (item.name) {
      case '/edit':
        clear();
        if (sel) requestOpen(sel);
        else toast('select a file first');
        return;
      case '/diff':
        clear();
        if (sel) void runDiff(sel);
        else toast('select a file first');
        return;
      case '/blame':
        clear();
        if (sel) void runBlame(sel);
        else toast('select a file first');
        return;
      case '/discard':
        clear();
        if (sel) {
          dispatch({
            type: 'input-mode',
            mode: { kind: 'confirm', question: `discard changes to ${sel}?`, action: { kind: 'discard', path: sel } },
          });
        } else toast('select a file first');
        return;
      case '/rename':
        clear();
        if (sel) {
          dispatch({ type: 'input-mode', mode: { kind: 'rename', target: sel } });
          pushOmni(basename(sel));
        } else toast('select a file first');
        return;
      case '/reveal': {
        clear();
        const target = s.openFile ?? sel;
        if (target) dispatch({ type: 'reveal', path: target });
        return;
      }
      case '/find':
        clear();
        if (item.arg) void runFind(item.arg);
        else dispatch({ type: 'input-mode', mode: { kind: 'find' } });
        return;
      case '/git':
        clear();
        if (item.arg) void runPassthru('git', item.arg);
        else dispatch({ type: 'input-mode', mode: { kind: 'passthru', label: 'git' } });
        return;
      case '/gh':
        clear();
        if (item.arg) void runPassthru('gh', item.arg);
        else dispatch({ type: 'input-mode', mode: { kind: 'passthru', label: 'gh' } });
        return;
      case '/theme':
        // Open the theme picker: keep slash mode with a trailing space.
        pushOmni('/theme ');
        dispatch({ type: 'slash-sel', sel: 0 });
        return;
      case '/help':
        clear();
        dispatch({ type: 'view', view: 'help', title: '/help' });
        return;
      case '/quit':
        clear();
        if (s.vim?.dirty) {
          dispatch({
            type: 'input-mode',
            mode: { kind: 'confirm', question: 'unsaved changes — quit anyway?', action: { kind: 'quit' } },
          });
        } else doQuit();
        return;
      default:
        clear();
    }
  }, [requestOpen, runDiff, runBlame, runFind, runPassthru, toast, doQuit]);

  const submitEx = useCallback((cmd: string): void => {
    const s = stateRef.current;
    clearOmni(false);
    const trimmed = cmd.trim();
    if (!s.vim || !s.openFile) {
      toast('no file open');
      return;
    }
    if (trimmed === 'e' || trimmed === 'e!') {
      if (s.vim.dirty && trimmed !== 'e!') toast('no write since last change (:e! overrides)');
      else void openFileAt(s.openFile);
      return;
    }
    const { state: vim, effects } = runEx(s.vim, trimmed);
    dispatch({ type: 'vim-set', vim });
    handleVimEffects(effects, vim);
  }, [toast, openFileAt, handleVimEffects]);

  /* ── derived render data (mirrored into refs for the key router) ───── */
  const omniMode = deriveOmniMode(state.omni, state.inputMode);
  const filtering = omniMode === 'filter' && state.focus === 'tree';

  const filterRes = useMemo(
    () => (filtering ? computeFilter(state.tree, state.omni, state.config.fuzzyMode) : null),
    [filtering, state.tree, state.omni, state.config.fuzzyMode],
  );
  const rows: FilterRow[] = useMemo(
    () => (filterRes ? filterRes.rows : flattenVisible(state.tree)),
    [filterRes, state.tree],
  );
  const effSel = useMemo(() => {
    if (state.selPath && rows.some((r) => r.node.path === state.selPath)) return state.selPath;
    if (filterRes) return filterRes.topPath;
    return rows[0]?.node.path ?? null;
  }, [rows, state.selPath, filterRes]);

  const slashItems = useMemo(() => (omniMode === 'slash' ? filterSlash(state.omni) : []), [omniMode, state.omni]);
  const themeItems = useMemo(() => {
    if (omniMode !== 'slash' || !state.omni.startsWith('/theme ')) return null;
    return filterThemeEntries(themeEntries(state.userThemes), state.omni.slice('/theme '.length).trim());
  }, [omniMode, state.omni, state.userThemes]);

  const findHits = useMemo(() => (state.find ? flattenFind(state.find) : []), [state.find]);

  /* layout */
  const layout: 'wide' | 'mid' | 'stacked' = dims.cols >= 120 ? 'wide' : dims.cols >= 80 ? 'mid' : 'stacked';
  const showTreeFooter = dims.rows >= 22;
  const paletteOpen = omniMode === 'slash' && (themeItems ? themeItems.length > 0 : slashItems.length > 0);
  const paletteRows = paletteOpen
    ? Math.min(MAX_PALETTE_ROWS, 1 + (themeItems ? themeItems.length : slashItems.length))
    : 0;
  const toastRows = state.toast ? 1 : 0;
  const bottomRows = 2; // hrule + omni bar
  const contentRows = Math.max(4, dims.rows - bottomRows - paletteRows - toastRows);
  const treeChars = layout === 'stacked'
    ? dims.cols
    : clamp(Math.min(state.config.treeWidth, layout === 'mid' ? 30 : 40), 24, Math.max(24, dims.cols - 30));
  const mainChars = layout === 'stacked' ? dims.cols : dims.cols - treeChars - 1;

  const refs = useRef({ rows, effSel, findHits, slashItems, themeItems, editorBody: contentRows - 3, mainChars, omniMode });
  refs.current = { rows, effSel, findHits, slashItems, themeItems, editorBody: contentRows - 3, mainChars, omniMode };

  /* ── vim key feed ──────────────────────────────────────────────────── */
  const feedVim = useCallback((tokens: string[]): void => {
    const s = stateRef.current;
    if (!s.vim) return;
    let vim = s.vim;
    let agg: VimEffects = {};
    for (const tok of tokens) {
      const r = handleKey(vim, tok, { viewportRows: refs.current.editorBody });
      vim = r.state;
      agg = { ...agg, ...r.effects };
    }
    dispatch({ type: 'vim-set', vim });
    handleVimEffects(agg, vim);
  }, [handleVimEffects]);

  const inkToTokens = useCallback((input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]): string[] => {
    if (key.escape) return ['<Esc>'];
    if (key.return) return ['<CR>'];
    if (key.backspace) return ['<BS>'];
    if (key.delete) return ['<Del>'];
    if (key.tab) return ['<Tab>'];
    if (key.upArrow) return ['<Up>'];
    if (key.downArrow) return ['<Down>'];
    if (key.leftArrow) return ['<Left>'];
    if (key.rightArrow) return ['<Right>'];
    if (key.ctrl && input.length === 1) return [`<C-${input.toLowerCase()}>`];
    return [...input];
  }, []);

  /* ── key routing ───────────────────────────────────────────────────── */
  useInput((input, key) => {
    const s = stateRef.current;
    const omni = omniRef.current;
    if (s.quitting) return;
    const desc = keyDescFromInk(input, key);
    const mode = deriveOmniMode(omni, s.inputMode);
    const printable = input.length > 0 && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab
      && !key.backspace && !key.delete && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow;

    /* 1 — modal input prompts (find / rename / confirm) */
    if (s.inputMode) {
      const im = s.inputMode;
      if (im.kind === 'confirm') {
        if (input === 'y' || input === 'Y') void confirmYes(im.action);
        else if (input === 'n' || input === 'N' || key.escape) dispatch({ type: 'input-mode', mode: null });
        return;
      }
      if (key.escape) {
        dispatch({ type: 'input-mode', mode: null });
        clearOmni(false);
        return;
      }
      if (key.return) {
        const value = omni.trim();
        if (im.kind === 'find') {
          dispatch({ type: 'input-mode', mode: null });
          clearOmni(false);
          if (value) void runFind(value);
        } else if (im.kind === 'passthru') {
          dispatch({ type: 'input-mode', mode: null });
          clearOmni(false);
          if (value) void runPassthru(im.label, value);
        } else {
          void submitRename(im.target, value);
        }
        return;
      }
      if (key.backspace || key.delete) {
        pushOmni(omni.slice(0, -1));
        return;
      }
      if (printable) pushOmni(omni + input);
      return;
    }

    /* 2 — slash palette */
    if (mode === 'slash') {
      const list = refs.current.themeItems ?? refs.current.slashItems;
      const max = Math.max(0, list.length - 1);
      const sel = Math.min(s.slashSel, max);
      if (key.escape) {
        clearOmni(false);
        return;
      }
      if (key.downArrow) {
        dispatch({ type: 'slash-sel', sel: Math.min(max, sel + 1) });
        return;
      }
      if (key.upArrow) {
        dispatch({ type: 'slash-sel', sel: Math.max(0, sel - 1) });
        return;
      }
      if (key.return) {
        if (refs.current.themeItems) {
          const t = refs.current.themeItems[sel];
          if (t) {
            void applyTheme(t);
            clearOmni(false);
          }
        } else {
          const it = refs.current.slashItems[sel];
          if (it) runSlashItem(it);
        }
        return;
      }
      if (key.backspace || key.delete) {
        pushOmni(omni.slice(0, -1));
        return;
      }
      if (printable) pushOmni(omni + input);
      return;
    }

    /* 3 — ex line */
    if (mode === 'ex') {
      if (key.escape) {
        clearOmni(false);
        return;
      }
      if (key.return) {
        submitEx(omni.slice(1));
        return;
      }
      if (key.backspace || key.delete) {
        pushOmni(omni.slice(0, -1));
        return;
      }
      if (printable) pushOmni(omni + input);
      return;
    }

    /* 4 — tree focus (idle or filter) */
    if (s.focus === 'tree') {
      const isFiltering = mode === 'filter';
      const rowList = refs.current.rows;
      const cur = refs.current.effSel;
      const idx = rowList.findIndex((r) => r.node.path === cur);

      if (input.length > 0 && input[0] === '/' && !key.ctrl && !key.meta) {
        pushOmni(input);
        return;
      }
      if (input.length > 0 && input[0] === ':' && !key.ctrl && !key.meta) {
        pushOmni(input);
        return;
      }
      if (key.escape) {
        if (isFiltering) clearOmni(true);
        return;
      }

      let action: KeyAction | null = lookupAction(s.keymap, 'tree', desc);
      if (!action && !isFiltering && !key.ctrl && !key.meta) {
        if (input === 'k') action = 'nav.up';
        else if (input === 'j') action = 'nav.down';
        else if (input === 'h') action = 'nav.left';
        else if (input === 'l') action = 'nav.right';
      }

      if (action === 'focus.toggle') {
        if (s.openFile || s.mainView !== 'empty') dispatch({ type: 'focus', focus: 'editor' });
        return;
      }
      if (action === 'nav.down') {
        if (idx >= 0 && idx < rowList.length - 1) dispatch({ type: 'select', path: rowList[idx + 1]!.node.path });
        else if (idx < 0 && rowList.length > 0) dispatch({ type: 'select', path: rowList[0]!.node.path });
        return;
      }
      if (action === 'nav.up') {
        if (idx > 0) dispatch({ type: 'select', path: rowList[idx - 1]!.node.path });
        return;
      }
      if (action === 'nav.right') {
        const node = idx >= 0 ? rowList[idx]!.node : null;
        if (!node) return;
        if (node.type === 'dir') {
          if (!node.open && !isFiltering) dispatch({ type: 'dir-open', path: node.path, open: true });
          else if (idx < rowList.length - 1) dispatch({ type: 'select', path: rowList[idx + 1]!.node.path });
        } else {
          if (isFiltering) clearOmni(true);
          requestOpen(node.path);
        }
        return;
      }
      if (action === 'nav.left') {
        const node = idx >= 0 ? rowList[idx]!.node : null;
        if (!node) return;
        if (node.type === 'dir' && node.open && !isFiltering) {
          dispatch({ type: 'dir-open', path: node.path, open: false });
        } else {
          const parent = parentPath(node.path);
          if (parent && rowList.some((r) => r.node.path === parent)) dispatch({ type: 'select', path: parent });
        }
        return;
      }
      if (action === 'select') {
        const node = idx >= 0 ? rowList[idx]!.node : null;
        if (!node) return;
        if (node.type === 'dir') {
          if (!isFiltering) dispatch({ type: 'dir-open', path: node.path, open: !node.open });
        } else {
          if (isFiltering) clearOmni(true);
          requestOpen(node.path);
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (isFiltering) pushOmni(omni.slice(0, -1));
        return;
      }
      if (printable && /[\w. \-]/.test(input)) {
        pushOmni(omni + input);
      }
      return;
    }

    /* 5 — editor-side focus */
    if (s.mainView === 'find') {
      const hits = refs.current.findHits;
      const action = lookupAction(s.keymap, 'find', desc);
      if (input.length > 0 && input[0] === '/' && !key.ctrl && !key.meta) {
        pushOmni(input);
        return;
      }
      if (action === 'nav.down') {
        dispatch({ type: 'find-sel', sel: Math.min(hits.length - 1, s.findSel + 1) });
        return;
      }
      if (action === 'nav.up') {
        dispatch({ type: 'find-sel', sel: Math.max(0, s.findSel - 1) });
        return;
      }
      if (action === 'select') {
        const hit = hits[Math.min(s.findSel, hits.length - 1)];
        if (hit) requestOpen(hit.path, hit.line);
        return;
      }
      if (action === 'back') {
        dispatch({ type: 'view', view: s.openFile ? 'editor' : 'empty' });
        dispatch({ type: 'focus', focus: 'tree' });
        return;
      }
      if (action === 'focus.toggle') {
        dispatch({ type: 'focus', focus: 'tree' });
        return;
      }
      return;
    }

    if (s.mainView === 'diff' || s.mainView === 'blame' || s.mainView === 'help' || s.mainView === 'command') {
      const action = lookupAction(s.keymap, 'output', desc);
      const total = s.mainView === 'diff' ? (s.diff?.length ?? 0)
        : s.mainView === 'blame' ? (s.blame?.length ?? 0)
        : s.mainView === 'command' ? (s.command?.lines.length ?? 0)
        : HELP_ROWS.length;
      const page = Math.max(1, refs.current.editorBody);
      const maxScroll = Math.max(0, total - page);
      if (input.length > 0 && input[0] === '/' && !key.ctrl && !key.meta) {
        pushOmni(input);
        return;
      }
      if (action === 'nav.down') {
        dispatch({ type: 'output-scroll', scroll: Math.min(maxScroll, s.outputScroll + 1) });
        return;
      }
      if (action === 'nav.up') {
        dispatch({ type: 'output-scroll', scroll: Math.max(0, s.outputScroll - 1) });
        return;
      }
      if (desc === 'pagedown') {
        dispatch({ type: 'output-scroll', scroll: Math.min(maxScroll, s.outputScroll + page) });
        return;
      }
      if (desc === 'pageup') {
        dispatch({ type: 'output-scroll', scroll: Math.max(0, s.outputScroll - page) });
        return;
      }
      if (action === 'back' || action === 'focus.toggle') {
        dispatch({ type: 'view', view: s.openFile ? 'editor' : 'empty' });
        dispatch({ type: 'focus', focus: 'tree' });
        return;
      }
      return;
    }

    /* editor buffer with vim */
    if (!s.vim) {
      if (key.escape || key.tab) dispatch({ type: 'focus', focus: 'tree' });
      return;
    }
    const inInsert = s.vim.mode === 'insert' || s.vim.mode === 'replace';
    if (!inInsert) {
      if (desc === 'tab') {
        dispatch({ type: 'focus', focus: 'tree' });
        return;
      }
      if (desc === 'ctrl+s') {
        void saveNow(s.vim);
        return;
      }
      if (desc === 'ctrl+g') {
        dispatch({ type: 'config', config: { ...s.config, gutter: !s.config.gutter } });
        return;
      }
      // Match on the FIRST char, not the whole string: a fast burst or paste
      // makes Ink coalesce e.g. ':w' or '/find x' into one input event, which
      // an `=== ':'` check would miss (routing it to vim as motions instead).
      if (input.length > 0 && input[0] === '/' && !key.ctrl && !key.meta && !s.vim.pendingKeys) {
        pushOmni(input);
        return;
      }
      if (input.length > 0 && input[0] === ':' && !key.ctrl && !key.meta && !s.vim.pendingKeys) {
        pushOmni(input);
        return;
      }
      if (input === 'K' && !s.vim.pendingKeys && s.vim.mode === 'normal') {
        void lspHover();
        return;
      }
      if (input === 'd' && s.vim.pendingKeys === 'g') {
        feedVim(['<Esc>']);
        void lspDefinition();
        return;
      }
      if (key.escape && s.vim.mode === 'normal' && !s.vim.pendingKeys) {
        feedVim(['<Esc>']); // let the engine clear highlight/message state…
        dispatch({ type: 'focus', focus: 'tree' }); // …then step back to the tree
        return;
      }
    } else if (desc === 'ctrl+s') {
      void saveNow(s.vim);
      return;
    }
    feedVim(inkToTokens(input, key));
  });

  /* ── render ────────────────────────────────────────────────────────── */
  const chrome = useMemo(
    () => ({
      theme: resolveTheme({ theme: state.config.theme, accent: state.config.accent }, state.userThemes),
      g: GLYPHS[state.config.glyphs],
    }),
    [state.config.theme, state.config.accent, state.config.glyphs, state.userThemes],
  );
  const { theme, g } = chrome;

  const footerTarget = effSel ?? state.openFile ?? '';
  const footerHint = footerTarget ? `/edit /diff /blame on ${basename(footerTarget)}` : 'no files';

  const treePane = (
    <TreePane
      rows={rows}
      selPath={effSel}
      matchByPath={filterRes?.matchByPath ?? new Map()}
      flash={state.flash}
      focused={state.focus === 'tree'}
      query={filtering ? state.omni : ''}
      count={filterRes?.count ?? 0}
      width={treeChars}
      height={contentRows}
      showFooter={showTreeFooter}
      footerHint={footerHint}
    />
  );

  let mainPane: React.JSX.Element;
  if (state.mainView === 'find' && state.find) {
    mainPane = <FindView result={state.find} sel={state.findSel} width={mainChars} height={contentRows} />;
  } else if (state.mainView === 'diff' && state.diff) {
    mainPane = <DiffView title={state.outputTitle} lines={state.diff} scroll={state.outputScroll} width={mainChars} height={contentRows} />;
  } else if (state.mainView === 'blame' && state.blame) {
    mainPane = <BlameView title={state.outputTitle} lines={state.blame} scroll={state.outputScroll} width={mainChars} height={contentRows} />;
  } else if (state.mainView === 'help') {
    mainPane = <HelpView scroll={state.outputScroll} width={mainChars} height={contentRows} />;
  } else if (state.mainView === 'command' && state.command) {
    mainPane = <CommandView result={state.command} scroll={state.outputScroll} width={mainChars} height={contentRows} />;
  } else if (state.mainView === 'editor' && state.vim && state.openFile) {
    mainPane = (
      <Editor
        vim={state.vim}
        path={state.openFile}
        focused={state.focus === 'editor'}
        gutter={state.config.gutter}
        branch={state.branch}
        stale={state.bufferStale}
        diagnostics={state.diagnostics.get(state.openFile) ?? []}
        width={mainChars}
        height={contentRows}
      />
    );
  } else {
    mainPane = <EmptyMain width={mainChars} height={contentRows} watching={state.isRepo} />;
  }

  const divider = (
    <Box width={1} flexDirection="column">
      <Text color={theme.dim}>{Array.from({ length: contentRows }, () => g.vrule).join('\n')}</Text>
    </Box>
  );

  return (
    <ChromeContext.Provider value={chrome}>
      <Box flexDirection="column" width={dims.cols} height={dims.rows}>
        <Box height={contentRows}>
          {layout === 'stacked'
            ? (state.focus === 'tree' ? treePane : mainPane)
            : (
              <>
                {treePane}
                {divider}
                {mainPane}
              </>
            )}
        </Box>
        {paletteOpen ? (
          <SlashPalette
            items={slashItems.slice(0, MAX_PALETTE_ROWS - 1)}
            themeItems={themeItems ? themeItems.slice(0, MAX_PALETTE_ROWS - 1) : null}
            sel={Math.min(state.slashSel, (themeItems ? themeItems.length : slashItems.length) - 1)}
            query={state.omni}
            selName={basename(footerTarget)}
            width={dims.cols}
          />
        ) : null}
        {state.toast ? (
          <Box width={dims.cols} justifyContent="flex-end" paddingRight={1}>
            <Text color={state.toast.danger ? theme.danger : theme.glow} wrap="truncate">{state.toast.text}</Text>
          </Box>
        ) : null}
        <Text color={theme.dim}>{g.hrule.repeat(dims.cols)}</Text>
        <OmniBar
          value={state.omni}
          mode={omniMode}
          inputMode={state.inputMode}
          branch={state.branch}
          isRepo={state.isRepo}
          vimDirty={state.vim?.dirty ?? false}
          onDisk={state.gitDirty}
          pulse={state.pulse}
          layout={layout}
          spinner={state.spinner ?? state.lspStatus}
          width={dims.cols}
        />
      </Box>
    </ChromeContext.Provider>
  );
}
