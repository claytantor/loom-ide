import { describe, expect, test } from 'vitest';
import { feed, text, vim } from './vim-helpers.test.js';

describe('visual mode basics', () => {
  test('v enters visual and Esc leaves it', () => {
    let s = vim('hello', 'v');
    expect(s.mode).toBe('visual');
    expect(s.visualStart).toEqual({ row: 0, col: 0 });
    s = feed(s, '<Esc>');
    expect(s.mode).toBe('normal');
    expect(s.visualStart).toBeNull();
  });

  test('V enters visual-line', () => {
    expect(vim('a\nb', 'V').mode).toBe('visual-line');
  });

  test('v toggles off and V switches the mode', () => {
    expect(vim('ab', 'vv').mode).toBe('normal');
    expect(vim('ab', 'vV').mode).toBe('visual-line');
    expect(vim('ab', 'VV').mode).toBe('normal');
    expect(vim('ab', 'Vv').mode).toBe('visual');
  });

  test('o swaps cursor and anchor', () => {
    let s = vim('abcde', 'lvll');
    expect(s.visualStart).toEqual({ row: 0, col: 1 });
    expect(s.cursor).toEqual({ row: 0, col: 3 });
    s = feed(s, 'o');
    expect(s.visualStart).toEqual({ row: 0, col: 3 });
    expect(s.cursor).toEqual({ row: 0, col: 1 });
  });

  test('counts work on visual motions', () => {
    const s = vim('abcdef', 'v3l');
    expect(s.cursor.col).toBe(3);
  });

  test('arrow keys extend the selection like h j k l', () => {
    const s = vim('abc\ndef', 'v<Right><Down>d');
    expect(s.lines).toEqual(['f']);
  });
});

describe('visual operators', () => {
  test('visual d deletes the inclusive selection', () => {
    const s = vim('hello', 'vlld');
    expect(text(s)).toBe('lo');
    expect(s.mode).toBe('normal');
  });

  test('visual x is the same as d', () => {
    expect(text(vim('hello', 'vllx'))).toBe('lo');
  });

  test('backward selection deletes the same range', () => {
    const s = vim('hello', 'llvhhd');
    expect(text(s)).toBe('lo');
  });

  test('visual selection across lines', () => {
    // selection runs b..e inclusive (j keeps the column)
    const s = vim('abc\ndef', 'lvjd');
    expect(s.lines).toEqual(['af']);
  });

  test('visual c changes the selection and enters insert', () => {
    const s = vim('hello world', 'vecbye<Esc>');
    expect(text(s)).toBe('bye world');
  });

  test('visual y yanks and moves the cursor to selection start', () => {
    const s = vim('hello', 'llvlly');
    expect(s.cursor.col).toBe(2);
    expect(text(feed(s, 'P'))).toBe('hellollo');
  });

  test('V d deletes whole lines', () => {
    const s = vim('a\nb\nc', 'Vjd');
    expect(s.lines).toEqual(['c']);
  });

  test('V c opens a fresh line in insert', () => {
    const s = vim('a\nb\nc', 'VjcX<Esc>');
    expect(s.lines).toEqual(['X', 'c']);
  });

  test('V y then p pastes lines', () => {
    const s = vim('a\nb', 'Vyjp');
    expect(s.lines).toEqual(['a', 'b', 'a']);
  });

  test('visual ~ toggles case of the selection', () => {
    const s = vim('abc', 'vl~');
    expect(text(s)).toBe('ABc');
    expect(s.cursor.col).toBe(0);
  });

  test('visual r fills the selection with a char', () => {
    expect(text(vim('abc', 'vllrX'))).toBe('XXX');
    expect(vim('ab\ncd', 'VjrX').lines).toEqual(['XX', 'XX']);
  });

  test('visual > and < indent the selected rows', () => {
    let s = vim('a\nb\nc', 'vj>');
    expect(s.lines).toEqual(['  a', '  b', 'c']);
    s = feed(s, 'Vj<');
    expect(s.lines).toEqual(['a', 'b', 'c']);
  });

  test('visual J-like ops not bound: unknown key clears pending', () => {
    const s = vim('abc', 'vq');
    expect(s.mode).toBe('visual'); // invalid key, selection kept
  });
});

describe('visual paste', () => {
  test('p replaces the selection with charwise register text', () => {
    const s = vim('foo bar', 'yiwwviwp');
    expect(text(s)).toBe('foo foo');
  });

  test('the replaced text lands in the unnamed register', () => {
    const s = vim('foo bar', 'yiwwviwpo<Esc>p');
    expect(s.lines).toEqual(['foo foo', 'bar']);
  });

  test('V p replaces lines with a linewise register', () => {
    const s = vim('one\ntwo\nthree', 'yyjVp');
    expect(s.lines).toEqual(['one', 'one', 'three']);
  });

  test('charwise selection pasted with a linewise register splits lines', () => {
    const s = vim('aaa\nxyz', 'yyjviwp');
    expect(s.lines).toEqual(['aaa', '', 'aaa', '']);
  });
});

describe('text objects in visual mode', () => {
  test('viw selects the inner word', () => {
    const s = vim('foo bar baz', 'wviwd');
    expect(text(s)).toBe('foo  baz');
  });

  test('vaw includes trailing whitespace', () => {
    const s = vim('foo bar baz', 'wvawd');
    expect(text(s)).toBe('foo baz');
  });

  test('vi( selects inside brackets', () => {
    const s = vim('f(a, b)', 'llvi(d');
    expect(text(s)).toBe('f()');
  });

  test('vip switches to linewise selection', () => {
    let s = vim('a\nb\n\nc', 'vip');
    expect(s.mode).toBe('visual-line');
    s = feed(s, 'd');
    expect(s.lines).toEqual(['', 'c']);
  });

  test('vi" selects inside quotes', () => {
    const s = vim('say "hi there"', 'fhvi"y0P');
    expect(text(s)).toBe('hi theresay "hi there"');
  });
});
