import { describe, expect, test } from 'vitest';
import { feed, text, vim } from './vim-helpers.test.js';

describe('dot repeat of operators', () => {
  test('. repeats dw', () => {
    let s = vim('one two three', 'dw');
    expect(text(s)).toBe('two three');
    s = feed(s, '.');
    expect(text(s)).toBe('three');
  });

  test('. repeats dd on the next line', () => {
    const s = vim('a\nb\nc', 'dd.');
    expect(s.lines).toEqual(['c']);
  });

  test('. repeats x', () => {
    expect(text(vim('abcdef', 'x.'))).toBe('cdef');
  });

  test('a count before . overrides the recorded count', () => {
    let s = vim('abcdefg', 'x');
    expect(text(s)).toBe('bcdefg');
    s = feed(s, '3.');
    expect(text(s)).toBe('efg');
  });

  test('the overriding count sticks for later repeats', () => {
    let s = vim('a b c d e f g h i j k l', 'dw');
    s = feed(s, '2.');
    expect(text(s)).toBe('d e f g h i j k l');
    s = feed(s, '.');
    expect(text(s)).toBe('f g h i j k l');
  });

  test('2d3w then . deletes six words again', () => {
    const s = vim('a b c d e f g h i j k l m', '2d3w.');
    expect(text(s)).toBe('m');
  });

  test('. repeats J with its count', () => {
    let s = vim('a\nb\nc\nd\ne', '3J');
    expect(text(s)).toBe('a b c\nd\ne');
    s = feed(s, 'j.');
    expect(text(s)).toBe('a b c\nd e');
  });

  test('. repeats r{char}', () => {
    const s = vim('aaaa', 'rxl.');
    expect(text(s)).toBe('xxaa');
  });

  test('. repeats ~', () => {
    const s = vim('abcd', '~.');
    expect(text(s)).toBe('ABcd');
  });

  test('. repeats >> on another line', () => {
    const s = vim('a\nb', '>>j.');
    expect(s.lines).toEqual(['  a', '  b']);
  });

  test('. repeats p', () => {
    const s = vim('ab', 'ylp..');
    expect(text(s)).toBe('aaaab');
  });

  test('. repeats a delete into a named register', () => {
    const s = vim('one two three', '"adww.gg"aP');
    expect(text(s)).toBe('threetwo ');
  });
});

describe('dot repeat of insert sessions', () => {
  test('. repeats a plain insert with its text', () => {
    let s = vim('ab', 'ihi<Esc>');
    expect(text(s)).toBe('hiab');
    s = feed(s, '.');
    expect(text(s)).toBe('hhiiab');
  });

  test('. repeats cw with the typed replacement', () => {
    let s = vim('aaa bbb ccc', 'cwX<Esc>');
    expect(text(s)).toBe('X bbb ccc');
    s = feed(s, 'w.');
    expect(text(s)).toBe('X X ccc');
  });

  test('. repeats o with its text', () => {
    const s = vim('x', 'ohey<Esc>.');
    expect(s.lines).toEqual(['x', 'hey', 'hey']);
  });

  test('. repeats A appends', () => {
    const s = vim('one\ntwo', 'A!<Esc>j.');
    expect(s.lines).toEqual(['one!', 'two!']);
  });

  test('. repeats an R session', () => {
    const s = vim('abc\nabc', 'RXY<Esc>j0.');
    expect(s.lines).toEqual(['XYc', 'XYc']);
  });

  test('insert repeats include <BS> edits', () => {
    let s = vim('', 'iab<BS>c<Esc>');
    expect(text(s)).toBe('ac');
    s = feed(s, '.');
    expect(text(s)).toBe('aacc');
  });

  test('. repeats S line replacement', () => {
    const s = vim('one\ntwo', 'Snew<Esc>j.');
    expect(s.lines).toEqual(['new', 'new']);
  });
});

describe('dot repeat edge cases', () => {
  test('. with no recorded change is a no-op', () => {
    const s = vim('abc', '.');
    expect(text(s)).toBe('abc');
    expect(s.dirty).toBe(false);
  });

  test('motions are not recorded as changes', () => {
    const s = vim('one two', 'xw.');
    expect(text(s)).toBe('ne wo');
  });

  test('yank is not recorded', () => {
    const s = vim('ab cd', 'xyw.');
    expect(text(s)).toBe(' cd');
  });

  test('undo is not recorded; . replays the change again', () => {
    let s = vim('abcd', 'xu');
    expect(text(s)).toBe('abcd');
    s = feed(s, '.');
    expect(text(s)).toBe('bcd');
  });

  test('repeat is itself undoable one step at a time', () => {
    let s = vim('aaaa', 'x..');
    expect(text(s)).toBe('a');
    s = feed(s, 'u');
    expect(text(s)).toBe('aa');
  });

  test('a failed replay leaves the buffer untouched', () => {
    let s = vim('ab\ncd', 'dfb');
    expect(s.lines).toEqual(['', 'cd']);
    s = feed(s, 'j.');
    expect(s.lines).toEqual(['', 'cd']); // no 'b' on this line: no-op
  });
});
