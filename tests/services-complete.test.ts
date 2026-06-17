import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completePathToken } from '../src/services/complete.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loom-complete-'));
  await mkdir(join(dir, 'scripts'), { recursive: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'README.md'), 'x');
  await writeFile(join(dir, 'scratch.txt'), 'x');
  await writeFile(join(dir, '.hidden'), 'x');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('completePathToken', () => {
  test('extends a bare fragment to the LCP of matching root entries', async () => {
    // scripts/ + scratch.txt share "scr" (src diverges at the 2nd char).
    expect(await completePathToken(dir, 'ls scr')).toBe('ls scr'); // already at LCP
    expect(await completePathToken(dir, 'ls scra')).toBe('ls scratch.txt '); // single file
  });

  test('single directory match gets a trailing slash and preserves the prefix', async () => {
    expect(await completePathToken(dir, 'cd scri')).toBe('cd scripts/');
  });

  test('single file match gets a trailing space', async () => {
    expect(await completePathToken(dir, 'cat READ')).toBe('cat README.md ');
  });

  test('only the last token is completed; earlier args are preserved verbatim', async () => {
    expect(await completePathToken(dir, 'ls -la READ')).toBe('ls -la README.md ');
  });

  test('hidden files are excluded unless the base starts with a dot', async () => {
    // bare "h" does not surface ".hidden".
    expect(await completePathToken(dir, 'cat h')).toBe('cat h');
    // explicit dot reveals it (single match → file → trailing space).
    expect(await completePathToken(dir, 'cat .hid')).toBe('cat .hidden ');
  });

  test('nonexistent directory degrades to no-op', async () => {
    expect(await completePathToken(dir, 'cat nope/xyz')).toBe('cat nope/xyz');
  });

  test('empty trailing token is a no-op', async () => {
    expect(await completePathToken(dir, 'ls ')).toBe('ls ');
  });
});
