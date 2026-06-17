import { describe, expect, test } from 'vitest';
import {
  baseWantsHidden,
  completeEntries,
  completeSlash,
  resolvePathTarget,
  splitLastToken,
  type CompletableCommand,
  type DirEntry,
} from '../src/core/complete.js';

const CMDS: CompletableCommand[] = [
  { name: '/edit' },
  { name: '/diff' },
  { name: '/discard' },
  { name: '/git', takesArg: true },
  { name: '/gh', takesArg: true },
  { name: '/pr', takesArg: true },
  { name: '/quit' },
];

describe('completeSlash — command-name completion', () => {
  test('LCP extends a partial head with multiple matches', () => {
    // /diff + /discard share /di → extend to /di (no further, they diverge).
    expect(completeSlash('/d', CMDS)).toBe('/di');
  });

  test('no LCP progress and no selection → unchanged', () => {
    // /git + /gh share only /g, which is already typed → no progress.
    expect(completeSlash('/g', CMDS)).toBe('/g');
  });

  test('single match completes to full name, with space when it takes an arg', () => {
    expect(completeSlash('/pr', CMDS)).toBe('/pr ');
  });

  test('single match without an arg gets no trailing space', () => {
    expect(completeSlash('/quit', CMDS)).toBe('/quit');
  });

  test('no-progress LCP falls back to the highlighted item (+ space if arg)', () => {
    // /g is ambiguous; arrowed to /git → committing it adds the arg space.
    expect(completeSlash('/g', CMDS, '/git')).toBe('/git ');
    expect(completeSlash('/g', CMDS, '/gh')).toBe('/gh ');
  });

  test('zero matches → unchanged', () => {
    expect(completeSlash('/zzz', CMDS)).toBe('/zzz');
  });

  test('case-insensitive head matching', () => {
    expect(completeSlash('/PR', CMDS)).toBe('/pr ');
  });

  test('head already settled (space typed) → unchanged', () => {
    expect(completeSlash('/diff foo', CMDS)).toBe('/diff foo');
  });

  test('not a slash string → unchanged', () => {
    expect(completeSlash('hello', CMDS)).toBe('hello');
  });
});

describe('splitLastToken', () => {
  test('keeps the prefix verbatim and isolates the trailing token', () => {
    expect(splitLastToken('ls -la ./scr')).toEqual({ prefix: 'ls -la ', frag: './scr' });
  });
  test('whole string is the token when there is no space', () => {
    expect(splitLastToken('scr')).toEqual({ prefix: '', frag: 'scr' });
  });
  test('trailing space → empty fragment', () => {
    expect(splitLastToken('cat ')).toEqual({ prefix: 'cat ', frag: '' });
  });
});

describe('resolvePathTarget', () => {
  const home = '/home/u';
  const root = '/repo';

  test('bare fragment lists the repo root, matches whole frag', () => {
    expect(resolvePathTarget('scr', home, root)).toEqual({ listDir: '/repo', base: 'scr' });
  });
  test('relative fragment with a slash lists dirname under root', () => {
    expect(resolvePathTarget('src/ap', home, root)).toEqual({ listDir: '/repo/src', base: 'ap' });
  });
  test('relative with leading ./ keeps the dir under root', () => {
    expect(resolvePathTarget('./scripts/ech', home, root)).toEqual({ listDir: '/repo/./scripts', base: 'ech' });
  });
  test('absolute fragment lists its own dirname', () => {
    expect(resolvePathTarget('/etc/pas', home, root)).toEqual({ listDir: '/etc', base: 'pas' });
  });
  test('absolute fragment at root level lists /', () => {
    expect(resolvePathTarget('/et', home, root)).toEqual({ listDir: '/', base: 'et' });
  });
  test('~ expands to home, listing home itself', () => {
    expect(resolvePathTarget('~', home, root)).toEqual({ listDir: '/home/u', base: '' });
  });
  test('~/frag expands to home/dirname', () => {
    expect(resolvePathTarget('~/.config/lo', home, root)).toEqual({ listDir: '/home/u/.config', base: 'lo' });
  });
});

describe('completeEntries', () => {
  const mk = (name: string, isDir: boolean): DirEntry => ({ name, isDir });

  test('extends to the LCP of multiple matches', () => {
    expect(completeEntries('s', [mk('services', true), mk('seeds', false)])).toBe('se');
  });
  test('single directory match gets a trailing slash', () => {
    expect(completeEntries('serv', [mk('services', true)])).toBe('services/');
  });
  test('single file match gets a trailing space terminator', () => {
    expect(completeEntries('READ', [mk('README.md', false)])).toBe('README.md ');
  });
  test('no matches → base unchanged', () => {
    expect(completeEntries('zzz', [])).toBe('zzz');
  });
});

describe('baseWantsHidden', () => {
  test('only surfaces dotfiles when the base starts with a dot', () => {
    expect(baseWantsHidden('.')).toBe(true);
    expect(baseWantsHidden('.gi')).toBe(true);
    expect(baseWantsHidden('src')).toBe(false);
    expect(baseWantsHidden('')).toBe(false);
  });
});
