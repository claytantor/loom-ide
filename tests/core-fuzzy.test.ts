import { describe, expect, test } from 'vitest';
import { fuzzyScore } from '../src/core/fuzzy.js';

describe('fuzzyScore', () => {
  test('srvind matches src/server/index.ts', () => {
    const m = fuzzyScore('srvind', 'src/server/index.ts');
    expect(m).not.toBeNull();
    expect(m!.positions.length).toBe(6);
  });

  test('non-subsequence returns null', () => {
    expect(fuzzyScore('zzz', 'src/server/index.ts')).toBeNull();
  });

  test('empty query returns null', () => {
    expect(fuzzyScore('', 'anything')).toBeNull();
  });

  test('case-insensitive', () => {
    expect(fuzzyScore('README', 'readme.md')).not.toBeNull();
    expect(fuzzyScore('readme', 'README.md')).not.toBeNull();
  });

  test('boundary matches outrank interior matches', () => {
    const boundary = fuzzyScore('si', 'src/index.ts')!;
    const interior = fuzzyScore('si', 'absinthe.ts')!;
    expect(boundary.score).toBeGreaterThan(interior.score);
  });

  test('contiguous run beats scattered match', () => {
    const contiguous = fuzzyScore('abc', 'xx/abc.ts')!;
    const scattered = fuzzyScore('abc', 'xa-b-c-long.ts')!;
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  test('shorter tail ranks higher for equal matches', () => {
    const short = fuzzyScore('idx', 'idx.ts')!;
    const long = fuzzyScore('idx', 'idx-something-long.ts')!;
    expect(short.score).toBeGreaterThan(long.score);
  });

  test('positions index into the target', () => {
    const m = fuzzyScore('st', 'src/tree.ts')!;
    expect(m.positions[0]).toBe(0);
    expect('src/tree.ts'[m.positions[1]!]).toBe('t');
  });
});
