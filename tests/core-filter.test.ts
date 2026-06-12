import { describe, expect, test } from 'vitest';
import { computeFilter } from '../src/core/filter.js';
import { buildTree, setDirOpen } from '../src/core/tree.js';

const PATHS = [
  'src/server/index.ts',
  'src/server/app.ts',
  'src/ui/index.ts',
  'scripts/deploy.sh',
  'package.json',
];

function tree() {
  // src open, others closed — filter results must not depend on prior expansion for matches.
  return setDirOpen(buildTree(PATHS), 'src', true);
}

describe('computeFilter dim mode', () => {
  test('keeps the whole silhouette, dims non-matches, auto-opens match ancestors', () => {
    const res = computeFilter(tree(), 'srvind', 'dim');
    expect(res.count).toBe(1);
    const byPath = Object.fromEntries(res.rows.map((r) => [r.node.path, r]));
    expect(byPath['src/server/index.ts']!.dim).toBe(false);
    expect(byPath['src/server']!.autoOpen).toBe(true);
    expect(byPath['scripts']!.dim).toBe(true);
    expect(byPath['package.json']!.dim).toBe(true);
  });

  test('descends closed dirs that contain matches', () => {
    const res = computeFilter(buildTree(PATHS), 'deploy', 'dim'); // everything collapsed
    expect(res.rows.some((r) => r.node.path === 'scripts/deploy.sh')).toBe(true);
  });
});

describe('computeFilter hide mode', () => {
  test('drops non-matching leaves and off-path dirs', () => {
    const res = computeFilter(tree(), 'srvind', 'hide');
    const paths = res.rows.map((r) => r.node.path);
    expect(paths).toContain('src');
    expect(paths).toContain('src/server');
    expect(paths).toContain('src/server/index.ts');
    expect(paths).not.toContain('scripts');
    expect(paths).not.toContain('package.json');
    expect(paths).not.toContain('src/server/app.ts');
  });
});

describe('computeFilter flat mode', () => {
  test('returns score-ranked flat file rows', () => {
    const res = computeFilter(tree(), 'index', 'flat');
    expect(res.rows.every((r) => r.flat)).toBe(true);
    expect(res.rows.length).toBe(2);
    expect(res.rows[0]!.node.path).toBe(res.topPath);
  });
});

describe('shared results', () => {
  test('topPath is the best score across modes', () => {
    const dim = computeFilter(tree(), 'index', 'dim');
    const flat = computeFilter(tree(), 'index', 'flat');
    expect(dim.topPath).toBe(flat.topPath);
  });

  test('matchByPath carries highlight positions into full path', () => {
    const res = computeFilter(tree(), 'app', 'dim');
    const pos = res.matchByPath.get('src/server/app.ts')!;
    expect(pos).toBeDefined();
    const target = 'src/server/app.ts';
    expect(pos.map((p) => target[p]).join('')).toBe('app');
  });

  test('no matches → zero count, empty rows in hide mode, null topPath', () => {
    const res = computeFilter(tree(), 'zzzz', 'hide');
    expect(res.count).toBe(0);
    expect(res.rows.length).toBe(0);
    expect(res.topPath).toBeNull();
  });
});
