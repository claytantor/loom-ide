import { describe, expect, test } from 'vitest';
import { getText } from '../src/core/vim/index.js';
import { feed, text, vim } from './vim-helpers.test.js';

describe('delete operator', () => {
  test('dw deletes a word with trailing space', () => {
    const s = vim('hello world', 'dw');
    expect(text(s)).toBe('world');
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('dw at the last word of a line stops at end of line', () => {
    const s = vim('foo bar\nbaz', 'wdw');
    expect(s.lines).toEqual(['foo ', 'baz']);
  });

  test('dw on an empty line removes the line break', () => {
    const s = vim('a\n\nb', 'jdw');
    expect(s.lines).toEqual(['a', 'b']);
  });

  test('2d3w deletes six words', () => {
    const s = vim('a b c d e f g', '2d3w');
    expect(text(s)).toBe('g');
  });

  test('db deletes backward without the cursor char', () => {
    const s = vim('foo bar', '$db');
    expect(text(s)).toBe('foo r');
  });

  test('de is inclusive of the word end', () => {
    const s = vim('foo bar', 'de');
    expect(text(s)).toBe(' bar');
  });

  test('d$ and D delete to end of line', () => {
    expect(text(vim('hello', 'lld$'))).toBe('he');
    const s = vim('hello world', '5lD');
    expect(text(s)).toBe('hello');
    expect(s.cursor.col).toBe(4);
  });

  test('d0 and d^ delete to line start', () => {
    expect(text(vim('hello', '$d0'))).toBe('o');
    expect(text(vim('  abc', '$d^'))).toBe('  c');
  });

  test('df and dt include/exclude the target', () => {
    expect(text(vim('foo=bar', 'df='))).toBe('bar');
    expect(text(vim('foo(bar)', 'dt('))).toBe('(bar)');
  });

  test('failed find motion aborts the operator', () => {
    const s = vim('hello', 'dfz');
    expect(text(s)).toBe('hello');
  });

  test('dd deletes the line and lands on first non-blank', () => {
    const s = vim('first\n  second\nthird', 'dd');
    expect(s.lines).toEqual(['  second', 'third']);
    expect(s.cursor).toEqual({ row: 0, col: 2 });
  });

  test('3dd deletes three lines', () => {
    expect(vim('a\nb\nc\nd', '3dd').lines).toEqual(['d']);
  });

  test('dd on the only line leaves an empty buffer', () => {
    const s = vim('solo', 'dd');
    expect(s.lines).toEqual(['']);
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('dd on the last line moves the cursor up', () => {
    const s = vim('a\nb', 'jdd');
    expect(s.lines).toEqual(['a']);
    expect(s.cursor.row).toBe(0);
  });

  test('dj and dk are linewise', () => {
    expect(vim('a\nb\nc', 'dj').lines).toEqual(['c']);
    expect(vim('a\nb\nc', 'Gdk').lines).toEqual(['a']);
  });

  test('dG and dgg are linewise to the buffer edges', () => {
    expect(vim('a\nb\nc', 'jdG').lines).toEqual(['a']);
    expect(vim('a\nb\nc', 'jdgg').lines).toEqual(['c']);
  });

  test('d} is linewise per Loom spec', () => {
    const s = vim('a\nb\n\nc', 'd}');
    expect(s.lines).toEqual(['c']);
  });

  test('x deletes under cursor and X before it', () => {
    let s = vim('abc', 'lx');
    expect(text(s)).toBe('ac');
    s = vim('abc', 'lX');
    expect(text(s)).toBe('bc');
  });

  test('x at end of line pulls the cursor back', () => {
    const s = vim('abc', '$x');
    expect(text(s)).toBe('ab');
    expect(s.cursor.col).toBe(1);
  });

  test('3x deletes three chars but stops at end of line', () => {
    expect(text(vim('abcdef', 'l3x'))).toBe('aef');
    expect(text(vim('ab', '9x'))).toBe('');
  });

  test('x and dd on an empty buffer are no-ops', () => {
    const s = vim('', 'xdd');
    expect(s.lines).toEqual(['']);
    expect(s.dirty).toBe(false);
  });

  test('dh at column zero is a no-op', () => {
    expect(text(vim('abc', 'dh'))).toBe('abc');
  });
});

describe('change operator', () => {
  test('cw acts like ce on a word', () => {
    const s = vim('hello world', 'cw');
    expect(s.mode).toBe('insert');
    expect(text(s)).toBe(' world');
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('cw on whitespace behaves like dw', () => {
    const s = vim('a   b', 'lcw');
    expect(text(s)).toBe('ab');
    expect(s.mode).toBe('insert');
  });

  test('c2w changes two words like c2e', () => {
    const s = vim('one two three', 'c2wX<Esc>');
    expect(text(s)).toBe('X three');
  });

  test('cc clears the line and enters insert', () => {
    const s = vim('hello', 'cc');
    expect(s.mode).toBe('insert');
    expect(s.lines).toEqual(['']);
  });

  test('cc then typing replaces the line as one change', () => {
    const s = vim('old line\nkeep', 'ccnew<Esc>');
    expect(s.lines).toEqual(['new', 'keep']);
  });

  test('2cc changes two lines into one', () => {
    const s = vim('a\nb\nc', '2ccX<Esc>');
    expect(s.lines).toEqual(['X', 'c']);
  });

  test('C changes to end of line', () => {
    const s = vim('hello world', '5lCend<Esc>');
    expect(text(s)).toBe('helloend');
  });

  test('s substitutes characters and S the line', () => {
    expect(text(vim('abc', 'sX<Esc>'))).toBe('Xbc');
    expect(text(vim('abc', '2sXY<Esc>'))).toBe('XYc');
    expect(text(vim('  abc', 'SX<Esc>'))).toBe('X');
  });

  test('s on an empty line still enters insert', () => {
    const s = vim('', 's');
    expect(s.mode).toBe('insert');
  });

  test('c with a linewise motion replaces whole lines', () => {
    const s = vim('a\nb\nc', 'cjX<Esc>');
    expect(s.lines).toEqual(['X', 'c']);
  });
});

describe('yank and paste', () => {
  test('yy then p pastes the line below', () => {
    const s = vim('abc\ndef', 'yyp');
    expect(s.lines).toEqual(['abc', 'abc', 'def']);
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });

  test('yy then P pastes above', () => {
    const s = vim('abc\ndef', 'jyyP');
    expect(s.lines).toEqual(['abc', 'def', 'def']);
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });

  test('Y is linewise like yy', () => {
    const s = vim('abc', 'Yp');
    expect(s.lines).toEqual(['abc', 'abc']);
  });

  test('yw then p pastes charwise after the cursor', () => {
    const s = vim('one two', 'ywwp');
    expect(text(s)).toBe('one tone wo');
  });

  test('charwise paste places cursor on the last pasted char', () => {
    const s = vim('ab', 'ylp');
    expect(text(s)).toBe('aab');
    expect(s.cursor.col).toBe(1);
  });

  test('3p repeats the paste', () => {
    const s = vim('ab', 'yl3p');
    expect(text(s)).toBe('aaaab');
  });

  test('linewise paste with count repeats lines', () => {
    const s = vim('x\ny', 'yy2p');
    expect(s.lines).toEqual(['x', 'x', 'x', 'y']);
  });

  test('multi-line charwise yank pastes a split', () => {
    const s = vim('ab\ncd', 'vjyGp');
    // selection 'ab\nc' pasted after 'c' on the last line
    expect(s.lines).toEqual(['ab', 'cab', 'cd']);
  });

  test('p on an empty line pastes at column zero', () => {
    const s = vim('abc\n', 'yljp');
    expect(s.lines).toEqual(['abc', 'a']);
  });

  test('yank moves the cursor to the start of the range', () => {
    const s = vim('one two', 'wyb');
    expect(s.cursor.col).toBe(0);
  });

  test('y with linewise motion keeps the column', () => {
    const s = vim('abc\ndef', 'lyj');
    expect(s.cursor).toEqual({ row: 0, col: 1 });
  });
});

describe('indent operators', () => {
  test('>> indents and << dedents by two spaces', () => {
    let s = vim('hello', '>>');
    expect(s.lines).toEqual(['  hello']);
    expect(s.cursor.col).toBe(2);
    s = feed(s, '<<');
    expect(s.lines).toEqual(['hello']);
  });

  test('3>> indents three lines', () => {
    const s = vim('a\nb\nc', '3>>');
    expect(s.lines).toEqual(['  a', '  b', '  c']);
  });

  test('>j indents the motion rows', () => {
    const s = vim('a\nb\nc', '>j');
    expect(s.lines).toEqual(['  a', '  b', 'c']);
  });

  test('>> skips empty lines', () => {
    const s = vim('a\n\nb', '>G');
    expect(s.lines).toEqual(['  a', '', '  b']);
  });

  test('<< removes a leading tab as one unit', () => {
    const s = vim('\thello', '<<');
    expect(s.lines).toEqual(['hello']);
  });

  test('<< on partially indented line removes what is there', () => {
    const s = vim(' a', '<<');
    expect(s.lines).toEqual(['a']);
  });
});

describe('other edits', () => {
  test('r replaces a single character', () => {
    const s = vim('abc', 'rx');
    expect(text(s)).toBe('xbc');
    expect(s.cursor.col).toBe(0);
  });

  test('3r replaces three characters and fails when short', () => {
    expect(text(vim('abcdef', '3rx'))).toBe('xxxdef');
    expect(text(vim('ab', '3rx'))).toBe('ab'); // not enough chars
  });

  test('r<CR> replaces the char with a line break', () => {
    const s = vim('abcd', 'llr<CR>');
    expect(s.lines).toEqual(['ab', 'd']);
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });

  test('J joins with a single space', () => {
    const s = vim('foo\n   bar', 'J');
    expect(text(s)).toBe('foo bar');
    expect(s.cursor.col).toBe(3);
  });

  test('3J joins three lines', () => {
    expect(text(vim('a\nb\nc\nd', '3J'))).toBe('a b c\nd');
  });

  test('J with an empty next line adds no space', () => {
    expect(vim('abc\n\ndef', 'J').lines).toEqual(['abc', 'def']);
  });

  test('J on the last line is a no-op', () => {
    const s = vim('abc', 'J');
    expect(text(s)).toBe('abc');
    expect(s.dirty).toBe(false);
  });

  test('~ toggles case and advances', () => {
    let s = vim('aB', '~');
    expect(text(s)).toBe('AB');
    expect(s.cursor.col).toBe(1);
    s = feed(s, '~');
    expect(text(s)).toBe('Ab');
  });

  test('3~ toggles a run and clamps at end of line', () => {
    const s = vim('abc', '9~');
    expect(text(s)).toBe('ABC');
    expect(s.cursor.col).toBe(2);
  });

  test('operators leave the buffer dirty', () => {
    expect(vim('abc', 'x').dirty).toBe(true);
    expect(vim('abc', 'yy').dirty).toBe(false); // yank is not a change
  });

  test('getText round-trips the buffer', () => {
    const s = vim('a\nb\nc');
    expect(getText(s)).toBe('a\nb\nc');
  });
});
