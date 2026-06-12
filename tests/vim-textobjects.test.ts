import { describe, expect, test } from 'vitest';
import { feed, text, vim } from './vim-helpers.test.js';

describe('word objects', () => {
  test('diw deletes the inner word from anywhere inside it', () => {
    expect(text(vim('foo bar baz', '5ldiw'))).toBe('foo  baz');
    expect(text(vim('foo bar baz', '4ldiw'))).toBe('foo  baz');
  });

  test('diw on whitespace deletes the whitespace run', () => {
    expect(text(vim('a   b', 'ldiw'))).toBe('ab');
  });

  test('daw takes trailing whitespace, or leading when none trails', () => {
    expect(text(vim('foo bar baz', 'wdaw'))).toBe('foo baz');
    expect(text(vim('foo bar', 'wdaw'))).toBe('foo');
  });

  test('iw treats punctuation runs as words; iW does not', () => {
    expect(text(vim('a.b,c d', 'ldiw'))).toBe('ab,c d');
    expect(text(vim('a.b,c d', 'diW'))).toBe(' d');
  });

  test('ciw changes the word under the cursor', () => {
    expect(text(vim('one two', 'wciwTWO<Esc>'))).toBe('one TWO');
  });

  test('yiw yanks without moving text', () => {
    const s = vim('hello world', 'wyiw');
    expect(text(s)).toBe('hello world');
    expect(text(feed(s, 'P'))).toBe('hello worldworld');
  });
});

describe('quote objects', () => {
  test('di" deletes inside double quotes', () => {
    expect(text(vim('say "hello" now', 'f"di"'))).toBe('say "" now');
    expect(text(vim('say "hello" now', '6ldi"'))).toBe('say "" now');
  });

  test("di' and di` work the same for their quotes", () => {
    expect(text(vim("x 'ab' y", "di'"))).toBe("x '' y");
    expect(text(vim('x `ab` y', 'di`'))).toBe('x `` y');
  });

  test('quote objects look ahead when the cursor is before the pair', () => {
    expect(text(vim('pre "in" post', 'di"'))).toBe('pre "" post');
  });

  test('da" eats trailing space after the closing quote', () => {
    expect(text(vim('a "b" c', 'da"'))).toBe('a c');
  });

  test('da" falls back to leading space when nothing trails', () => {
    expect(text(vim('a "b"', 'da"'))).toBe('a');
  });

  test('escaped quotes are not delimiters', () => {
    expect(text(vim('x "a\\"b" y', 'di"'))).toBe('x "" y');
  });

  test('ci" on an empty pair inserts between the quotes', () => {
    const s = vim('x "" y', 'ci"hi<Esc>');
    expect(text(s)).toBe('x "hi" y');
  });

  test('quote objects fail when no pair exists', () => {
    expect(text(vim('plain text', 'di"'))).toBe('plain text');
  });
});

describe('bracket objects', () => {
  test('di( from inside, on the opener, and on the closer', () => {
    expect(text(vim('f(a, b)', '3ldi('))).toBe('f()');
    expect(text(vim('f(a, b)', 'ldi('))).toBe('f()');
    expect(text(vim('f(a, b)', '$di('))).toBe('f()');
  });

  test('da( removes the brackets too; ab and b aliases work', () => {
    expect(text(vim('f(a, b)', '3lda('))).toBe('f');
    expect(text(vim('f(a, b)', '3ldab'))).toBe('f');
    expect(text(vim('f(a, b)', '3ldib'))).toBe('f()');
  });

  test('nested brackets choose the innermost pair', () => {
    expect(text(vim('(a(b)c)', '3ldi('))).toBe('(a()c)');
    expect(text(vim('(a(b)c)', 'di('))).toBe('()');
  });

  test('i[ and i{ with their aliases', () => {
    expect(text(vim('a[xy]b', 'lldi['))).toBe('a[]b');
    expect(text(vim('a{xy}b', 'lldi{'))).toBe('a{}b');
    expect(text(vim('a{xy}b', 'lldiB'))).toBe('a{}b');
    expect(text(vim('a{xy}b', 'lldaB'))).toBe('ab');
  });

  test('di{ on a pretty-printed block keeps the brace lines', () => {
    const s = vim('fn() {\n  one\n  two\n}', 'jdi{');
    expect(s.lines).toEqual(['fn() {', '}']);
  });

  test('ci{ across lines starts insert on the block', () => {
    const s = vim('if (x) {\n  body\n}', 'jci{X<Esc>');
    expect(s.lines).toEqual(['if (x) {', 'X', '}']);
  });

  test('multi-line da( spans the brackets charwise', () => {
    const s = vim('a (one\ntwo) b', 'f(da(');
    expect(text(s)).toBe('a  b');
  });

  test('ci( on empty parens inserts inside', () => {
    expect(text(vim('f()', 'lci(x<Esc>'))).toBe('f(x)');
  });

  test('di( with no enclosing pair is a no-op', () => {
    expect(text(vim('abc', 'di('))).toBe('abc');
  });
});

describe('paragraph objects', () => {
  test('dip deletes the current paragraph block', () => {
    const s = vim('a\nb\n\nc', 'dip');
    expect(s.lines).toEqual(['', 'c']);
  });

  test('dap also removes the trailing blank lines', () => {
    const s = vim('a\nb\n\n\nc', 'dap');
    expect(s.lines).toEqual(['c']);
  });

  test('dip on a blank line removes the blank run', () => {
    const s = vim('a\n\n\nb', 'jdip');
    expect(s.lines).toEqual(['a', 'b']);
  });

  test('dap takes leading blanks when no trailing exist', () => {
    const s = vim('a\n\nb\nc', 'Gdap');
    expect(s.lines).toEqual(['a']);
  });

  test('cip opens insert on an empty line', () => {
    const s = vim('p1\np1\n\np2', 'cipX<Esc>');
    expect(s.lines).toEqual(['X', '', 'p2']);
  });
});
