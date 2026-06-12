import { describe, expect, test } from 'vitest';
import { parseBlameLinePorcelain, parseStatusPorcelainZ, parseUnifiedDiff } from '../src/core/gitParse.js';

describe('parseStatusPorcelainZ', () => {
  test('maps XY codes to tree decorations', () => {
    const out = [' M src/a.ts', '?? new.ts', 'A  staged.ts', ' D gone.ts', 'UU conflict.ts'].join('\0') + '\0';
    const res = parseStatusPorcelainZ(out);
    expect(res.entries.get('src/a.ts')).toBe('M');
    expect(res.entries.get('new.ts')).toBe('?');
    expect(res.entries.get('staged.ts')).toBe('+');
    expect(res.entries.get('gone.ts')).toBe('-');
    expect(res.entries.get('conflict.ts')).toBe('!');
    expect(res.dirtyCount).toBe(5);
  });

  test('rename consumes the origin record', () => {
    const out = 'R  new-name.ts\0old-name.ts\0 M other.ts\0';
    const res = parseStatusPorcelainZ(out);
    expect(res.entries.get('new-name.ts')).toBe('+');
    expect(res.entries.has('old-name.ts')).toBe(false);
    expect(res.entries.get('other.ts')).toBe('M');
  });

  test('empty output → clean', () => {
    const res = parseStatusPorcelainZ('');
    expect(res.dirtyCount).toBe(0);
  });
});

describe('parseUnifiedDiff', () => {
  test('classifies meta, hunk, add, del, ctx', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      'index 111..222 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,2 +1,2 @@',
      ' context',
      '-old line',
      '+new line',
    ].join('\n');
    const lines = parseUnifiedDiff(diff);
    expect(lines.map((l) => l.kind)).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add']);
  });
});

describe('parseBlameLinePorcelain', () => {
  test('extracts hash, author, date, line text', () => {
    const sample = [
      'abcdef0123456789abcdef0123456789abcdef01 1 1 1',
      'author Clay',
      'author-mail <clay@example.com>',
      'author-time 1718000000',
      'author-tz +0000',
      'summary initial',
      'filename x.ts',
      '\tconst a = 1;',
      'abcdef0123456789abcdef0123456789abcdef01 2 2',
      'author Clay',
      'author-time 1718000000',
      '\tconst b = 2;',
    ].join('\n');
    const lines = parseBlameLinePorcelain(sample);
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({ hash: 'abcdef01', author: 'Clay', lineNo: 1, text: 'const a = 1;' });
    expect(lines[0]!.date).toBe('2024-06-10');
    expect(lines[1]!.text).toBe('const b = 2;');
  });
});
