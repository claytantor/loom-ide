import { describe, expect, test } from 'vitest';
import { initialState, reduce, type Action } from '../src/state/reducer.js';
import { buildTree, findNode, setDirOpen } from '../src/core/tree.js';
import type { AppState } from '../src/state/types.js';
import type { VimState } from '../src/core/vim/index.js';

const PATHS = ['src/server/index.ts', 'src/server/app.ts', 'src/ui/tree.tsx', 'scripts/deploy.sh', 'package.json'];

function boot(): AppState {
  let s = initialState('/repo', 'repo');
  s = reduce(s, { type: 'init', tree: setDirOpen(buildTree(PATHS, 'repo'), 'src', true), truncated: false });
  return s;
}

function apply(s: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reduce, s);
}

describe('init', () => {
  test('selects the first row', () => {
    const s = boot();
    expect(s.selPath).toBe('scripts');
  });
});

describe('filter session snapshot/restore', () => {
  test('typing captures snapshot; Esc restores expansion + selection exactly', () => {
    let s = boot();
    s = apply(s, { type: 'select', path: 'package.json' });
    const expandedBefore = findNode(s.tree, 'src')!.open;
    s = apply(s, { type: 'omni-set', value: 'd' });
    expect(s.preFilter).not.toBeNull();
    // Simulate the app expanding dirs during filtering (auto-expand renders only,
    // but a select of a deep row may expand) — mutate then restore.
    s = apply(s, { type: 'dir-open', path: 'scripts', open: true });
    s = apply(s, { type: 'select', path: 'scripts/deploy.sh' });
    s = apply(s, { type: 'omni-clear', restore: true });
    expect(s.omni).toBe('');
    expect(s.preFilter).toBeNull();
    expect(findNode(s.tree, 'scripts')!.open).toBe(false);
    expect(findNode(s.tree, 'src')!.open).toBe(expandedBefore);
    expect(s.selPath).toBe('package.json');
  });

  test('backspacing the filter to empty also restores', () => {
    let s = boot();
    s = apply(s, { type: 'select', path: 'package.json' }, { type: 'omni-set', value: 'x' });
    s = apply(s, { type: 'dir-open', path: 'scripts', open: true });
    s = apply(s, { type: 'omni-set', value: '' });
    expect(findNode(s.tree, 'scripts')!.open).toBe(false);
    expect(s.selPath).toBe('package.json');
  });

  test('slash typing does not start a filter session', () => {
    let s = boot();
    s = apply(s, { type: 'omni-set', value: '/' });
    expect(s.preFilter).toBeNull();
  });

  test('starting a filter drops the selection so the top match can pin (dim-mode bug)', () => {
    let s = boot();
    s = apply(s, { type: 'select', path: 'package.json' });
    // First filter char: selection cleared, but snapshot remembers it.
    s = apply(s, { type: 'omni-set', value: 's' });
    expect(s.selPath).toBeNull();
    expect(s.preFilter?.selPath).toBe('package.json');
    // Subsequent chars do NOT keep clearing a user nav that happens mid-filter.
    s = apply(s, { type: 'select', path: 'src/server/index.ts' });
    s = apply(s, { type: 'omni-set', value: 'sr' });
    expect(s.selPath).toBe('src/server/index.ts');
    // Clearing restores the original pre-filter selection.
    s = apply(s, { type: 'omni-clear', restore: true });
    expect(s.selPath).toBe('package.json');
  });
});

describe('watcher batches', () => {
  test('added files flash; removed files ghost then drop with selection fallback', () => {
    let s = boot();
    s = apply(s, { type: 'select', path: 'package.json' });
    s = apply(s, {
      type: 'tree-batch',
      batch: { added: ['NEW.md'], addedDirs: [], changed: [], removed: ['package.json'] },
      now: 1000,
    });
    expect(findNode(s.tree, 'NEW.md')).not.toBeNull();
    expect(s.flash.has('NEW.md')).toBe(true);
    expect(findNode(s.tree, 'package.json')!.ghost).toBe(true);
    s = apply(s, { type: 'remove-ghosts', paths: ['package.json'] });
    expect(findNode(s.tree, 'package.json')).toBeNull();
    expect(s.selPath).toBe('scripts'); // fell back to first row, not nowhere
  });

  test('change to the open file marks the buffer stale', () => {
    let s = boot();
    const vim = { lines: ['x'], cursor: { row: 0, col: 0 }, mode: 'normal', visualStart: null, dirty: false, message: null, searchPattern: null, searchHighlight: false, pendingKeys: '' } as unknown as VimState;
    s = apply(s, { type: 'open-file', path: 'src/server/index.ts', vim, trailingNewline: true });
    s = apply(s, {
      type: 'tree-batch',
      batch: { added: [], addedDirs: [], changed: ['src/server/index.ts'], removed: [] },
      now: 0,
    });
    expect(s.bufferStale).toBe(true);
  });

  test('flash-sweep clears expired entries only', () => {
    let s = boot();
    s = apply(s, {
      type: 'tree-batch',
      batch: { added: ['a.ts', 'b.ts'], addedDirs: [], changed: [], removed: [] },
      now: 0,
    });
    const later = apply(s, { type: 'flash-sweep', now: 100 });
    expect(later.flash.size).toBe(2);
    const swept = apply(s, { type: 'flash-sweep', now: 10_000 });
    expect(swept.flash.size).toBe(0);
  });
});

describe('pr-compose', () => {
  const vim = { lines: ['PR title', '', 'body'], cursor: { row: 0, col: 0 } } as unknown as VimState;
  const compose = { target: 'dev', head: 'feature/x', draft: false, label: 'PR → dev' } as const;

  test('open hosts the draft in the editor without touching the tree path', () => {
    let s = boot();
    s = apply(s, { type: 'select', path: 'package.json' });
    s = apply(s, { type: 'pr-compose-open', compose, vim });
    expect(s.prCompose).toEqual(compose);
    expect(s.vim).toBe(vim);
    expect(s.openFile).toBe('PR → dev'); // virtual label, NOT a real path
    expect(s.mainView).toBe('editor');
    expect(s.focus).toBe('editor');
    // The label must NOT be treated as a tree path: selection is untouched and
    // no phantom node is created/expanded for it.
    expect(s.selPath).toBe('package.json');
    expect(findNode(s.tree, 'PR → dev')).toBeNull();
  });

  test('close clears the compose state and returns focus to the tree', () => {
    let s = boot();
    s = apply(s, { type: 'pr-compose-open', compose, vim });
    s = apply(s, { type: 'pr-compose-close' });
    expect(s.prCompose).toBeNull();
    expect(s.vim).toBeNull();
    expect(s.openFile).toBeNull();
    expect(s.mainView).toBe('empty');
    expect(s.focus).toBe('tree');
  });
});

describe('tree visibility (full-width editor)', () => {
  test('toggle-tree hides the tree from the editor and shows it again', () => {
    let s = boot();
    s = apply(s, { type: 'focus', focus: 'editor' });
    expect(s.treeHidden).toBe(false);
    s = apply(s, { type: 'toggle-tree' });
    expect(s.treeHidden).toBe(true);
    expect(s.focus).toBe('editor');
    s = apply(s, { type: 'toggle-tree' });
    expect(s.treeHidden).toBe(false);
  });

  test('focusing the tree reveals it — no stranding on a hidden tree (invariant)', () => {
    let s = boot();
    s = apply(s, { type: 'focus', focus: 'editor' }, { type: 'toggle-tree' });
    expect(s.treeHidden).toBe(true);
    // Tab / Esc / :q / reveal all set focus:'tree' → the tree comes back.
    s = apply(s, { type: 'focus', focus: 'tree' });
    expect(s.focus).toBe('tree');
    expect(s.treeHidden).toBe(false);
  });

  test('cannot hide a tree that is currently focused', () => {
    let s = boot(); // focus starts on the tree
    s = apply(s, { type: 'toggle-tree' });
    expect(s.treeHidden).toBe(false); // invariant reverts it
  });
});

describe('open-file', () => {
  test('expands ancestors, selects, focuses editor, clears omni', () => {
    let s = boot();
    s = apply(s, { type: 'omni-set', value: 'srvind' });
    const vim = { lines: [''], cursor: { row: 0, col: 0 } } as unknown as VimState;
    s = apply(s, { type: 'open-file', path: 'src/server/index.ts', vim, trailingNewline: true });
    expect(s.mainView).toBe('editor');
    expect(s.focus).toBe('editor');
    expect(s.omni).toBe('');
    expect(s.selPath).toBe('src/server/index.ts');
    expect(findNode(s.tree, 'src/server')!.open).toBe(true);
  });
});

describe('views', () => {
  test('find view resets selection and grabs focus', () => {
    let s = boot();
    s = apply(s, { type: 'find-sel', sel: 3 });
    s = apply(s, {
      type: 'view',
      view: 'find',
      title: '/find x',
      find: { query: 'x', groups: [], matches: 0, fileCount: 0, truncated: false, engine: 'ripgrep' },
    });
    expect(s.findSel).toBe(0);
    expect(s.focus).toBe('editor');
    expect(s.mainView).toBe('find');
  });
});

describe('diagnostics', () => {
  test('set and clear per path', () => {
    let s = boot();
    const diag = { line: 0, col: 0, endLine: 0, endCol: 1, severity: 'error' as const, message: 'boom' };
    s = apply(s, { type: 'diagnostics', path: 'a.ts', items: [diag] });
    expect(s.diagnostics.get('a.ts')!.length).toBe(1);
    s = apply(s, { type: 'diagnostics', path: 'a.ts', items: [] });
    expect(s.diagnostics.has('a.ts')).toBe(false);
  });
});
