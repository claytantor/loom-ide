import { describe, expect, test } from 'vitest';
import { filterSlash, filterThemeEntries, slashMatchPositions, themeEntries } from '../src/state/commands.js';

describe('filterSlash', () => {
  test('bare slash lists everything', () => {
    expect(filterSlash('/').length).toBe(16);
  });
  test('/add is selection-aware, takes a filename arg, captured as one', () => {
    const items = filterSlash('/add components/Button.tsx');
    expect(items.length).toBe(1);
    expect(items[0]!.name).toBe('/add');
    expect(items[0]!.arg).toBe('components/Button.tsx');
    expect(items[0]!.takesArg).toBe(true);
    expect(items[0]!.selScoped).toBe(true);
  });
  test('/a prefix offers /add', () => {
    expect(filterSlash('/a').map((c) => c.name)).toContain('/add');
  });
  test('/pr is a distinct command that captures its args (target + flags)', () => {
    const items = filterSlash('/pr dev --draft --no-ai');
    expect(items.length).toBe(1);
    expect(items[0]!.name).toBe('/pr');
    expect(items[0]!.arg).toBe('dev --draft --no-ai');
    expect(items[0]!.takesArg).toBe(true);
  });
  test('/p prefix offers /pr', () => {
    expect(filterSlash('/p').map((c) => c.name)).toContain('/pr');
  });
  test('/gh and /git are distinct commands that capture their args', () => {
    const gh = filterSlash('/gh pr list --limit 5');
    expect(gh.length).toBe(1);
    expect(gh[0]!.name).toBe('/gh');
    expect(gh[0]!.arg).toBe('pr list --limit 5');

    const git = filterSlash('/git status -sb');
    expect(git.length).toBe(1);
    expect(git[0]!.name).toBe('/git');
    expect(git[0]!.arg).toBe('status -sb');
  });
  test('/g prefix offers both git and gh', () => {
    const names = filterSlash('/g').map((c) => c.name);
    expect(names).toContain('/git');
    expect(names).toContain('/gh');
  });
  test('/bash is a distinct command that captures its raw shell command as one arg', () => {
    const items = filterSlash('/bash echo hi | tr a-z A-Z');
    expect(items.length).toBe(1);
    expect(items[0]!.name).toBe('/bash');
    expect(items[0]!.arg).toBe('echo hi | tr a-z A-Z');
    expect(items[0]!.takesArg).toBe(true);
    expect(items[0]!.selScoped).toBe(false);
  });
  test('/b prefix offers /bash', () => {
    expect(filterSlash('/b').map((c) => c.name)).toContain('/bash');
  });
  test('/help resolves by prefix', () => {
    const items = filterSlash('/help');
    expect(items[0]!.name).toBe('/help');
    expect(filterSlash('/he').map((c) => c.name)).toContain('/help');
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
