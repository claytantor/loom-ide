import { describe, expect, test } from 'vitest';
import { filterSlash, filterThemeEntries, slashMatchPositions, themeEntries } from '../src/state/commands.js';

describe('filterSlash', () => {
  test('bare slash lists everything', () => {
    expect(filterSlash('/').length).toBe(9);
  });
  test('/di → prefix matches first, then substring (handoff: /edit /diff /discard)', () => {
    const names = filterSlash('/di').map((c) => c.name);
    expect(names).toEqual(['/diff', '/discard', '/edit']);
  });
  test('substring matches rank after prefix matches', () => {
    const names = filterSlash('/e').map((c) => c.name);
    expect(names[0]).toBe('/edit');
    expect(names).toContain('/reveal'); // substring 'e'
    expect(names.indexOf('/reveal')).toBeGreaterThan(names.indexOf('/edit'));
  });
  test('exact command plus arg narrows to one with arg captured', () => {
    const items = filterSlash('/find listen here');
    expect(items.length).toBe(1);
    expect(items[0]!.name).toBe('/find');
    expect(items[0]!.arg).toBe('listen here');
  });
  test('arg ignored for commands that take none', () => {
    const items = filterSlash('/quit now');
    expect(items.length).toBe(1);
    expect(items[0]!.arg).toBe('');
  });
  test('non-slash input yields nothing', () => {
    expect(filterSlash('diff')).toEqual([]);
  });
});

describe('slashMatchPositions', () => {
  test('highlights the typed prefix', () => {
    expect(slashMatchPositions('/diff', '/di')).toEqual([0, 1, 2]);
  });
  test('bare slash highlights nothing', () => {
    expect(slashMatchPositions('/diff', '/')).toEqual([]);
  });
  test('arg does not affect highlighting', () => {
    expect(slashMatchPositions('/find', '/find listen')).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('theme entries', () => {
  test('bundled set plus user themes', () => {
    const entries = themeEntries(new Map([['hacker', {}]]));
    expect(entries.map((e) => e.id)).toEqual(['neon/cyan', 'neon/amber', 'neon/green', 'neon/violet', 'mono', 'hacker']);
  });
  test('filtering narrows by id or label', () => {
    const entries = themeEntries(new Map());
    expect(filterThemeEntries(entries, 'vio').map((e) => e.id)).toEqual(['neon/violet']);
    expect(filterThemeEntries(entries, 'green').map((e) => e.id)).toEqual(['neon/green', 'mono']);
  });
});
