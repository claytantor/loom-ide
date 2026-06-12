import { describe, expect, test } from 'vitest';
import { createVim, handleKey, runEx } from '../src/core/vim/index.js';
import { feed, feedFx, vim } from './vim-helpers.test.js';

describe('* and # word search', () => {
  test('* jumps to the next occurrence of the word under the cursor', () => {
    const s = vim('foo bar\nbaz\nfoo qux', '*');
    expect(s.cursor).toEqual({ row: 2, col: 0 });
    expect(s.searchPattern).toBe('\\bfoo\\b');
    expect(s.searchHighlight).toBe(true);
  });

  test('* matches whole words only', () => {
    const s = vim('foo foobar foo', '*');
    expect(s.cursor.col).toBe(11);
  });

  test('* escapes regex metacharacters in the word', () => {
    const s = vim('a_1 x\na_1', '*');
    expect(s.cursor.row).toBe(1);
  });

  test('* works from the middle of a word', () => {
    const s = vim('abc xx abc', 'l*');
    expect(s.cursor.col).toBe(7);
  });

  test('# searches backward', () => {
    const s = vim('foo bar\nfoo', 'G#');
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('* with no word under the cursor reports a message', () => {
    const s = vim('   ', '*');
    expect(s.message).toBe('no word under cursor');
  });

  test('* wraps and reports the wrap', () => {
    const { state, effects } = feedFx(createVim('only\nhere'), '*');
    expect(state.cursor).toEqual({ row: 0, col: 0 }); // single occurrence wraps to itself
    expect(effects.message).toBe('search hit BOTTOM, continuing at TOP');
  });
});

describe('n and N repeats', () => {
  test('n repeats in the search direction', () => {
    let s = vim('a\nx a\nx\na', '*');
    expect(s.cursor.row).toBe(1);
    s = feed(s, 'n');
    expect(s.cursor.row).toBe(3);
  });

  test('N goes the opposite way', () => {
    let s = vim('a\na\na', '*n');
    expect(s.cursor.row).toBe(2);
    s = feed(s, 'N');
    expect(s.cursor.row).toBe(1);
  });

  test('after # the n key keeps searching backward', () => {
    let s = vim('w\nw\nw', 'G#');
    expect(s.cursor.row).toBe(1);
    s = feed(s, 'n');
    expect(s.cursor.row).toBe(0);
  });

  test('n wraps with a message', () => {
    let s = vim('hit\nmiss\nhit', '*');
    expect(s.cursor.row).toBe(2);
    const r = feedFx(s, 'n');
    expect(r.state.cursor.row).toBe(0);
    expect(r.effects.message).toBe('search hit BOTTOM, continuing at TOP');
  });

  test('backward wrap reports TOP', () => {
    const s = vim('w x w', '#');
    expect(s.message).toBe('search hit TOP, continuing at BOTTOM');
    expect(s.cursor.col).toBe(4);
  });

  test('n with no previous search reports a message', () => {
    const s = vim('abc', 'n');
    expect(s.message).toBe('no previous search');
  });

  test('counts repeat n', () => {
    const s = vim('a\na\na\na', '*2n');
    expect(s.cursor.row).toBe(3);
  });
});

describe('search state housekeeping', () => {
  test('messages clear on the next successful key', () => {
    let s = vim('abc', 'n');
    expect(s.message).toBe('no previous search');
    s = feed(s, 'l');
    expect(s.message).toBeNull();
  });

  test(':noh clears the highlight but keeps the pattern', () => {
    let s = vim('foo\nfoo', '*');
    expect(s.searchHighlight).toBe(true);
    s = runEx(s, 'noh').state;
    expect(s.searchHighlight).toBe(false);
    expect(s.searchPattern).toBe('\\bfoo\\b');
    s = feed(s, 'n');
    expect(s.searchHighlight).toBe(true);
  });

  test('handleKey returns effects.message for search notices', () => {
    const r = handleKey(createVim('abc'), 'n');
    expect(r.effects.message).toBe('no previous search');
    expect(r.state.message).toBe('no previous search');
  });

  test('searchPattern persists across edits', () => {
    let s = vim('foo bar foo', '*');
    s = feed(s, 'x');
    expect(s.searchPattern).toBe('\\bfoo\\b');
  });
});
