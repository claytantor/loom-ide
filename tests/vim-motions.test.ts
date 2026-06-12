import { describe, expect, test } from 'vitest';
import { createVim, handleKey } from '../src/core/vim/index.js';
import { feed, text, vim } from './vim-helpers.test.js';

describe('basic cursor motions', () => {
  test('h l move and clamp within the line', () => {
    let s = vim('abc', 'll');
    expect(s.cursor).toEqual({ row: 0, col: 2 });
    s = feed(s, 'l');
    expect(s.cursor.col).toBe(2); // clamped at last char
    s = feed(s, 'hhh');
    expect(s.cursor.col).toBe(0);
  });

  test('j k move vertically', () => {
    let s = vim('abc\ndef\nghi', 'jj');
    expect(s.cursor.row).toBe(2);
    s = feed(s, 'k');
    expect(s.cursor.row).toBe(1);
    s = feed(s, 'kk');
    expect(s.cursor.row).toBe(0); // clamped at top
  });

  test('arrow keys behave like h j k l', () => {
    let s = vim('abc\ndef', '<Down><Right>');
    expect(s.cursor).toEqual({ row: 1, col: 1 });
    s = feed(s, '<Up><Left>');
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('counts multiply motions', () => {
    const s = vim('a\nb\nc\nd\ne', '3j');
    expect(s.cursor.row).toBe(3);
    expect(vim('abcdef', '10l').cursor.col).toBe(5);
  });

  test('j k remember the desired column across short lines', () => {
    let s = vim('abcdef\nab\nabcdef', '4lj');
    expect(s.cursor).toEqual({ row: 1, col: 1 });
    s = feed(s, 'j');
    expect(s.cursor).toEqual({ row: 2, col: 4 });
  });

  test('$ sticks to end of line when moving vertically', () => {
    let s = vim('abc\nlonger line\nxy', '$j');
    expect(s.cursor).toEqual({ row: 1, col: 10 });
    s = feed(s, 'j');
    expect(s.cursor).toEqual({ row: 2, col: 1 });
  });

  test('0 ^ $ and <Home>/<End>', () => {
    let s = vim('  hello world', '$');
    expect(s.cursor.col).toBe(12);
    s = feed(s, '0');
    expect(s.cursor.col).toBe(0);
    s = feed(s, '^');
    expect(s.cursor.col).toBe(2);
    s = feed(s, '<End>');
    expect(s.cursor.col).toBe(12);
    s = feed(s, '<Home>');
    expect(s.cursor.col).toBe(0);
  });
});

describe('word motions', () => {
  test('w stops at words and punctuation runs', () => {
    let s = vim('foo.bar baz');
    s = feed(s, 'w');
    expect(s.cursor.col).toBe(3); // '.'
    s = feed(s, 'w');
    expect(s.cursor.col).toBe(4); // 'bar'
    s = feed(s, 'w');
    expect(s.cursor.col).toBe(8); // 'baz'
  });

  test('W treats punctuation as part of the WORD', () => {
    const s = vim('foo.bar baz', 'W');
    expect(s.cursor.col).toBe(8);
  });

  test('w crosses lines and stops on empty lines', () => {
    let s = vim('foo\n\nbar', 'w');
    expect(s.cursor).toEqual({ row: 1, col: 0 });
    s = feed(s, 'w');
    expect(s.cursor).toEqual({ row: 2, col: 0 });
  });

  test('b moves back to word starts across lines', () => {
    let s = vim('hello world\nnext', 'j');
    s = feed(s, 'b');
    expect(s.cursor).toEqual({ row: 0, col: 6 });
    s = feed(s, 'b');
    expect(s.cursor).toEqual({ row: 0, col: 0 });
    expect(feed(s, 'b').cursor).toEqual({ row: 0, col: 0 }); // clamped
  });

  test('e moves to word ends, skipping blank lines', () => {
    let s = vim('one two\n\nthree');
    s = feed(s, 'e');
    expect(s.cursor.col).toBe(2);
    s = feed(s, 'e');
    expect(s.cursor.col).toBe(6);
    s = feed(s, 'e');
    expect(s.cursor).toEqual({ row: 2, col: 4 });
  });

  test('E uses WORD ends', () => {
    const s = vim('foo.bar baz', 'E');
    expect(s.cursor.col).toBe(6);
  });

  test('B moves back by WORDs', () => {
    const s = vim('foo.bar baz', '$B');
    expect(s.cursor.col).toBe(8);
    expect(feed(s, 'B').cursor.col).toBe(0);
  });

  test('counts apply to word motions', () => {
    expect(vim('a b c d e', '3w').cursor.col).toBe(6);
    expect(vim('a b c d e', '$2b').cursor.col).toBe(4);
    expect(vim('one two three', '2e').cursor.col).toBe(6);
  });
});

describe('line jumps and paragraphs', () => {
  test('gg and G jump to first/last line at first non-blank', () => {
    let s = vim('a\nb\n  c', 'G');
    expect(s.cursor).toEqual({ row: 2, col: 2 });
    s = feed(s, 'gg');
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('counts give absolute lines for gg and G', () => {
    expect(vim('a\nb\nc\nd', '3G').cursor.row).toBe(2);
    expect(vim('a\nb\nc\nd', 'G2gg').cursor.row).toBe(1);
    expect(vim('a\nb', '9G').cursor.row).toBe(1); // clamped
  });

  test('} and { move between paragraph boundaries', () => {
    let s = vim('p1\np1b\n\np2\n\n\np3');
    s = feed(s, '}');
    expect(s.cursor.row).toBe(2);
    s = feed(s, '}');
    expect(s.cursor.row).toBe(4);
    s = feed(s, '{');
    expect(s.cursor.row).toBe(2);
    s = feed(s, '{');
    expect(s.cursor.row).toBe(0);
  });

  test('} at the last paragraph goes to the end of the buffer', () => {
    const s = vim('a\nb', '}');
    expect(s.cursor.row).toBe(1);
  });

  test('<C-d>/<C-u> scroll by half the viewport', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n');
    let s = vim(lines, '<C-d>', { viewportRows: 10 });
    expect(s.cursor.row).toBe(5);
    s = feed(s, '<C-d>'); // default viewport 20 -> 10 rows
    expect(s.cursor.row).toBe(15);
    s = feed(s, '<C-u>', { viewportRows: 10 });
    expect(s.cursor.row).toBe(10);
    s = feed(s, '2<C-u>', { viewportRows: 10 });
    expect(s.cursor.row).toBe(0);
  });
});

describe('find-char motions', () => {
  test('f and F find characters on the line', () => {
    let s = vim('hello world', 'fw');
    expect(s.cursor.col).toBe(6);
    s = feed(s, 'Fe');
    expect(s.cursor.col).toBe(1);
  });

  test('t and T stop beside the target', () => {
    let s = vim('hello world', 'tw');
    expect(s.cursor.col).toBe(5);
    s = feed(s, '$Tw');
    expect(s.cursor.col).toBe(7);
  });

  test('counts find the nth occurrence', () => {
    expect(vim('xaxaxa', '2fa').cursor.col).toBe(3);
  });

  test('failed find does not move the cursor', () => {
    const s = vim('hello', 'llfz');
    expect(s.cursor.col).toBe(2);
  });

  test('; repeats the last find and , reverses it', () => {
    let s = vim('xaybza', 'fa');
    expect(s.cursor.col).toBe(1);
    s = feed(s, ';');
    expect(s.cursor.col).toBe(5);
    s = feed(s, ',');
    expect(s.cursor.col).toBe(1);
  });

  test('; after t skips the adjacent target', () => {
    let s = vim('axbxc', 'tx');
    expect(s.cursor.col).toBe(0);
    s = feed(s, ';');
    expect(s.cursor.col).toBe(2);
  });
});

describe('pending keys and misc', () => {
  test('pendingKeys surfaces in-flight sequences', () => {
    let s = vim('abc', '2');
    expect(s.pendingKeys).toBe('2');
    s = feed(s, 'd');
    expect(s.pendingKeys).toBe('2d');
    s = feed(s, 'd');
    expect(s.pendingKeys).toBe('');
  });

  test('Esc aborts a pending sequence', () => {
    const s = vim('abc', 'd<Esc>');
    expect(s.pendingKeys).toBe('');
    expect(s.lines).toEqual(['abc']);
  });

  test('invalid sequences clear pending state', () => {
    const s = vim('abc', 'dz');
    expect(s.pendingKeys).toBe('');
    expect(s.lines).toEqual(['abc']);
  });

  test('<Del> deletes like x in normal mode', () => {
    expect(text(vim('abc', '<Del>'))).toBe('bc');
  });

  test('% jumps between matching brackets', () => {
    let s = vim('(hello)', '%');
    expect(s.cursor.col).toBe(6);
    s = feed(s, '%');
    expect(s.cursor.col).toBe(0);
  });

  test('motions on an empty buffer are safe', () => {
    const s = createVim('');
    for (const k of ['w', 'b', 'e', '$', '0', '^', 'G', 'j', 'k', 'h', 'l', '}', '{']) {
      const r = handleKey(s, k);
      expect(r.state.cursor).toEqual({ row: 0, col: 0 });
    }
    expect(feed(createVim(''), 'gg').cursor).toEqual({ row: 0, col: 0 });
  });
});
