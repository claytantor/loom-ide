import { describe, expect, test } from 'vitest';
import {
  addPath, allFiles, applyExpanded, applyGitStatus, buildTree, expandTo, expandedPaths,
  findNode, flattenVisible, removePath, setDirOpen, type GitCode,
} from '../src/core/tree.js';

const PATHS = [
  'src/server/index.ts',
  'src/server/app.ts',
  'src/ui/tree.tsx',
  'scripts/deploy.sh',
  'package.json',
  'README.md',
];

describe('buildTree', () => {
  test('creates intermediate dirs and sorts dirs first, alpha', () => {
    const root = buildTree(PATHS);
    const names = (root.children ?? []).map((c) => c.name);
    expect(names).toEqual(['scripts', 'src', 'package.json', 'README.md']);
    const src = findNode(root, 'src')!;
    expect(src.type).toBe('dir');
    expect((src.children ?? []).map((c) => c.name)).toEqual(['server', 'ui']);
  });

  test('dirs start collapsed; root rows only', () => {
    const root = buildTree(PATHS);
    const rows = flattenVisible(root);
    expect(rows.map((r) => r.node.path)).toEqual(['scripts', 'src', 'package.json', 'README.md']);
  });
});

describe('expand/collapse', () => {
  test('setDirOpen reveals children and is immutable', () => {
    const root = buildTree(PATHS);
    const open = setDirOpen(root, 'src', true);
    expect(root).not.toBe(open);
    expect(flattenVisible(root).length).toBe(4);
    const rows = flattenVisible(open).map((r) => r.node.path);
    expect(rows).toContain('src/server');
    expect(rows).not.toContain('src/server/index.ts');
  });

  test('expandTo opens every ancestor', () => {
    const root = buildTree(PATHS);
    const open = expandTo(root, 'src/server/index.ts');
    const rows = flattenVisible(open).map((r) => r.node.path);
    expect(rows).toContain('src/server/index.ts');
  });

  test('expandedPaths/applyExpanded round-trips exactly', () => {
    let root = buildTree(PATHS);
    root = setDirOpen(setDirOpen(root, 'src', true), 'src/ui', true);
    const snapshot = expandedPaths(root);
    let mutated = setDirOpen(root, 'src', false);
    mutated = setDirOpen(mutated, 'scripts', true);
    const restored = applyExpanded(mutated, snapshot);
    expect(expandedPaths(restored)).toEqual(snapshot);
  });
});

describe('addPath/removePath', () => {
  test('addPath inserts sorted with intermediates', () => {
    const root = buildTree(PATHS);
    const next = addPath(root, 'src/lib/fuzzy.ts', 'file');
    expect(findNode(next, 'src/lib/fuzzy.ts')).not.toBeNull();
    const src = findNode(next, 'src')!;
    expect((src.children ?? []).map((c) => c.name)).toEqual(['lib', 'server', 'ui']);
    expect(findNode(root, 'src/lib/fuzzy.ts')).toBeNull();
  });

  test('removePath drops the node', () => {
    const root = buildTree(PATHS);
    const next = removePath(root, 'package.json');
    expect(findNode(next, 'package.json')).toBeNull();
    expect(findNode(root, 'package.json')).not.toBeNull();
  });
});

describe('allFiles', () => {
  test('collects every leaf', () => {
    const root = buildTree(PATHS);
    expect(allFiles(root).map((f) => f.path).sort()).toEqual([...PATHS].sort());
  });
});

describe('applyGitStatus', () => {
  test('decorates files and rolls up strongest code to dirs', () => {
    const root = buildTree(PATHS);
    const status = new Map<string, GitCode>([
      ['src/server/index.ts', 'M'],
      ['src/ui/tree.tsx', '+'],
      ['scripts/deploy.sh', '?'],
    ]);
    const next = applyGitStatus(root, status);
    expect(findNode(next, 'src/server/index.ts')!.git).toBe('M');
    expect(findNode(next, 'src')!.git).toBe('M'); // M outranks +
    expect(findNode(next, 'scripts')!.git).toBe('?');
    expect(findNode(next, 'package.json')!.git).toBeUndefined();
  });

  test('clears stale decorations', () => {
    const root = buildTree(PATHS);
    const withGit = applyGitStatus(root, new Map([['package.json', 'M' as GitCode]]));
    const cleared = applyGitStatus(withGit, new Map());
    expect(findNode(cleared, 'package.json')!.git).toBeUndefined();
  });
});
