import { describe, expect, test } from 'vitest';
import { feed, text, vim } from './vim-helpers.test.js';

describe('unnamed register', () => {
  test('x then p swaps characters', () => {
    expect(text(vim('ab', 'xp'))).toBe('ba');
  });

  test('dd then p moves a line', () => {
    const s = vim('one\ntwo', 'ddp');
    expect(s.lines).toEqual(['two', 'one']);
  });

  test('delete overwrites the unnamed register', () => {
    const s = vim('aaa bbb', 'yiwwdiwp');
    expect(text(s)).toBe('aaa bbb');
  });
});

describe('named registers', () => {
  test('"a yank and "a paste round-trip charwise', () => {
    const s = vim('hello world', '"ayww"ap');
    expect(text(s)).toBe('hello whello orld');
  });

  test('"a yank and paste round-trip linewise', () => {
    const s = vim('abc\ndef', '"ayyj"ap');
    expect(s.lines).toEqual(['abc', 'def', 'abc']);
  });

  test('named delete fills the register', () => {
    const s = vim('foo bar', '"bdwG"bp');
    expect(text(s)).toBe('bfoo ar');
  });

  test('A-Z appends to the lowercase register', () => {
    const s = vim('one\ntwo\nthree', '"ayyj"AyyG"ap');
    expect(s.lines).toEqual(['one', 'two', 'three', 'one', 'two']);
  });

  test('append to an empty register just sets it', () => {
    const s = vim('abc', '"Ayyp');
    expect(s.lines).toEqual(['abc', 'abc']);
  });

  test('"Ap reads the lowercase register', () => {
    const s = vim('xy', '"ayl"Ap');
    expect(text(s)).toBe('xxy');
  });

  test('charwise append concatenates without newline', () => {
    const s = vim('ab', '"ayl"Aylo<Esc>"ap');
    expect(s.lines).toEqual(['ab', 'aa']);
  });
});

describe('yank register 0', () => {
  test('yank fills register 0; delete does not', () => {
    const s = vim('keep\ntrash', 'yyjdd');
    // unnamed now holds the deleted line, register 0 the yanked one
    expect(feed(s, 'p').lines).toEqual(['keep', 'trash']);
    expect(feed(s, '"0p').lines).toEqual(['keep', 'keep']);
  });

  test('named yank does not clobber register 0', () => {
    const s = vim('a\nb', 'yyj"byy"0p');
    expect(s.lines).toEqual(['a', 'b', 'a']);
  });
});

describe('register wise-ness', () => {
  test('linewise flag survives the round trip', () => {
    const s = vim('line one\nline two', '"ayyw"ap');
    expect(s.lines).toEqual(['line one', 'line one', 'line two']);
  });

  test('charwise register pastes inline', () => {
    const s = vim('ab\ncd', '"cdej"cP');
    expect(s.lines).toEqual(['', 'abcd']);
  });

  test('multi-line charwise register pastes as a split', () => {
    const s = vim('one\ntwo\nxx', 'vjly2jp');
    expect(s.lines).toEqual(['one', 'two', 'xone', 'twx']);
  });

  test('pasting from an empty named register reports a message', () => {
    const s = vim('ab', '"zp');
    expect(s.message).toBe('nothing in register z');
    expect(text(s)).toBe('ab');
  });

  test('visual delete writes the register with selection wise-ness', () => {
    const s = vim('a\nb\nc', 'Vj"mdG"mp');
    expect(s.lines).toEqual(['c', 'a', 'b']);
  });
});
