import { describe, expect, test } from 'vitest';
import { baseStylesFromTokens, composeSpans, searchRanges } from '../src/core/decorate.js';
import { resolveTheme } from '../src/core/theme.js';
import { tokenizeLine } from '../src/core/syntax.js';

const theme = resolveTheme({ theme: 'neon', accent: 'cyan' });

describe('baseStylesFromTokens', () => {
  test('colors every column from its token scope', () => {
    const { text, styles } = baseStylesFromTokens(tokenizeLine('const x', 'ts'), theme);
    expect(text).toBe('const x');
    expect(styles[0]!.color).toBe(theme.secondary); // kw
    expect(styles[6]!.color).toBe(theme.fg); // ident
  });
});

describe('composeSpans', () => {
  test('merges adjacent same-style cells into one span', () => {
    const { text, styles } = baseStylesFromTokens(tokenizeLine('abc def', 'plain'), theme);
    const spans = composeSpans(text, styles, []);
    expect(spans.length).toBe(1);
    expect(spans[0]!.text).toBe('abc def');
  });

  test('overlay splits spans and wins on conflict', () => {
    const { text, styles } = baseStylesFromTokens(tokenizeLine('abcdef', 'plain'), theme);
    const spans = composeSpans(text, styles, [{ start: 2, end: 4, color: theme.glow, bold: true }]);
    expect(spans.map((s) => s.text)).toEqual(['ab', 'cd', 'ef']);
    expect(spans[1]!.color).toBe(theme.glow);
    expect(spans[1]!.bold).toBe(true);
  });

  test('later overlays win (caret over selection)', () => {
    const { text, styles } = baseStylesFromTokens(tokenizeLine('abcd', 'plain'), theme);
    const spans = composeSpans(text, styles, [
      { start: 0, end: 4, bg: theme.selBg },
      { start: 1, end: 2, inverse: true },
    ]);
    const caret = spans.find((s) => s.text === 'b')!;
    expect(caret.inverse).toBe(true);
    expect(caret.bg).toBe(theme.selBg);
  });

  test('overlay ranges clamp to line length', () => {
    const { text, styles } = baseStylesFromTokens(tokenizeLine('ab', 'plain'), theme);
    const spans = composeSpans(text, styles, [{ start: 0, end: 99, bg: theme.selBg }]);
    expect(spans.map((s) => s.text).join('')).toBe('ab');
  });
});

describe('searchRanges', () => {
  test('finds all matches case-insensitively', () => {
    expect(searchRanges('Listen listen LISTEN', 'listen')).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 13 },
      { start: 14, end: 20 },
    ]);
  });
  test('invalid regex yields no ranges', () => {
    expect(searchRanges('abc', '[')).toEqual([]);
  });
  test('zero-width matches do not loop forever', () => {
    expect(searchRanges('abc', 'x*').length).toBeLessThan(10);
  });
});
