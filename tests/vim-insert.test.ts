import { describe, expect, test } from 'vitest';
import { feed, text, vim } from './vim-helpers.test.js';

describe('insert entry points', () => {
  test('i inserts before the cursor', () => {
    const s = vim('abc', 'lliX<Esc>');
    expect(text(s)).toBe('abXc');
    expect(s.mode).toBe('normal');
  });

  test('a appends after the cursor', () => {
    expect(text(vim('hi', 'a!<Esc>'))).toBe('h!i');
  });

  test('a on an empty line works at column zero', () => {
    expect(text(vim('', 'aX<Esc>'))).toBe('X');
  });

  test('A appends at end of line', () => {
    expect(text(vim('hi', 'A!<Esc>'))).toBe('hi!');
  });

  test('I inserts at first non-blank', () => {
    expect(text(vim('  hi', 'IX<Esc>'))).toBe('  Xhi');
  });

  test('o opens below carrying indentation', () => {
    const s = vim('  first\nlast', 'oX<Esc>');
    expect(s.lines).toEqual(['  first', '  X', 'last']);
    expect(s.cursor).toEqual({ row: 1, col: 2 });
  });

  test('O opens above', () => {
    const s = vim('first\nlast', 'jOmid<Esc>');
    expect(s.lines).toEqual(['first', 'mid', 'last']);
    expect(s.cursor.row).toBe(1);
  });

  test('Esc moves the cursor back one column', () => {
    const s = vim('abc', 'i<Esc>');
    expect(s.cursor.col).toBe(0);
    const s2 = vim('abc', 'A<Esc>');
    expect(s2.cursor.col).toBe(2);
  });
});

describe('typing in insert mode', () => {
  test('characters including : and / insert literally', () => {
    expect(text(vim('', 'ia:b/c<Esc>'))).toBe('a:b/c');
  });

  test('<CR> splits the line at the cursor', () => {
    const s = vim('abcd', 'lli<CR><Esc>');
    expect(s.lines).toEqual(['ab', 'cd']);
  });

  test('<CR> carries leading indentation', () => {
    const s = vim('  hello', 'A<CR>world<Esc>');
    expect(s.lines).toEqual(['  hello', '  world']);
  });

  test('<CR> mid-indent only carries what is before the cursor', () => {
    const s = vim('  ab', '0i<CR><Esc>');
    expect(s.lines).toEqual(['', '  ab']);
  });

  test('<BS> deletes the previous char', () => {
    expect(text(vim('abc', 'A<BS><Esc>'))).toBe('ab');
  });

  test('<BS> at column zero joins with the previous line', () => {
    const s = vim('ab\ncd', 'ji<BS><Esc>');
    expect(s.lines).toEqual(['abcd']);
    expect(s.cursor).toEqual({ row: 0, col: 1 });
  });

  test('<BS> at the very start of the buffer is a no-op', () => {
    expect(text(vim('ab', 'i<BS>x<Esc>'))).toBe('xab');
  });

  test('<Del> removes the char under the cursor and joins at EOL', () => {
    expect(text(vim('abc', 'i<Del><Esc>'))).toBe('bc');
    expect(text(vim('ab\ncd', 'A<Del><Esc>'))).toBe('abcd');
  });

  test('<Tab> inserts two spaces', () => {
    expect(text(vim('', 'i<Tab>x<Esc>'))).toBe('  x');
  });

  test('arrows move inside insert mode', () => {
    expect(text(vim('abc', 'i<Right><Right>X<Esc>'))).toBe('abXc');
    const s = vim('ab\ncd', 'i<Down><End>X<Esc>');
    expect(s.lines).toEqual(['ab', 'cdX']);
  });

  test('typing marks the buffer dirty; an aborted insert does not', () => {
    expect(vim('abc', 'ix<Esc>').dirty).toBe(true);
    expect(vim('abc', 'i<Esc>').dirty).toBe(false);
    expect(vim('abc', 'ix<BS><Esc>').dirty).toBe(false);
  });
});

describe('replace mode (R)', () => {
  test('R overwrites characters', () => {
    const s = vim('abcdef', 'RXY<Esc>');
    expect(text(s)).toBe('XYcdef');
    expect(s.mode).toBe('normal');
    expect(s.cursor.col).toBe(1);
  });

  test('R extends the line past the end', () => {
    expect(text(vim('ab', 'RXYZ<Esc>'))).toBe('XYZ');
  });

  test('<BS> in replace mode restores the original chars', () => {
    let s = vim('abcdef', 'RXY');
    expect(text(s)).toBe('XYcdef');
    s = feed(s, '<BS>');
    expect(text(s)).toBe('Xbcdef');
    s = feed(s, '<BS>');
    expect(text(s)).toBe('abcdef');
    s = feed(s, '<BS>'); // nothing recorded: just moves left
    expect(text(s)).toBe('abcdef');
    expect(feed(s, '<Esc>').dirty).toBe(false);
  });

  test('<BS> removes appended chars beyond the original end', () => {
    let s = vim('ab', 'RXYZ');
    expect(text(s)).toBe('XYZ');
    s = feed(s, '<BS>');
    expect(text(s)).toBe('XY');
  });

  test('<CR> in replace mode splits the line', () => {
    const s = vim('abcd', 'RX<CR>Y<Esc>');
    expect(s.lines).toEqual(['X', 'Ycd']);
  });

  test('<BS> across a replace-mode split rejoins the line', () => {
    let s = vim('abcd', 'RX<CR>');
    expect(s.lines).toEqual(['X', 'bcd']);
    s = feed(s, '<BS>');
    expect(s.lines).toEqual(['Xbcd']);
    expect(s.cursor).toEqual({ row: 0, col: 1 });
  });

  test('an R session is one undo unit', () => {
    const s = vim('abcdef', 'RXYZ<Esc>u');
    expect(text(s)).toBe('abcdef');
  });
});

describe('insert session undo grouping', () => {
  test('a whole insert session undoes as one unit', () => {
    const s = vim('start', 'A one two<Esc>u');
    expect(text(s)).toBe('start');
  });

  test('insert with <CR> undoes back to one line', () => {
    const s = vim('ab', 'a1<CR>2<CR>3<Esc>u');
    expect(s.lines).toEqual(['ab']);
  });

  test('c plus typed text is a single undo unit', () => {
    const s = vim('foo bar', 'cwnew<Esc>u');
    expect(text(s)).toBe('foo bar');
  });

  test('o plus text undoes to the original buffer', () => {
    const s = vim('x', 'oabc<Esc>u');
    expect(s.lines).toEqual(['x']);
  });
});
