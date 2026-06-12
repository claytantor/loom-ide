import { describe, expect, test } from 'vitest';
import { feed, vim } from './vim-helpers.test.js';

describe('marks', () => {
  test('m sets a mark and backtick jumps to the exact position', () => {
    const s = vim('abc\ndef\nghi', 'jlmagg`a');
    expect(s.cursor).toEqual({ row: 1, col: 1 });
  });

  test("' jumps to the first non-blank of the mark line", () => {
    const s = vim('abc\n  def\nghi', 'jllmbgg\'b');
    expect(s.cursor).toEqual({ row: 1, col: 2 });
  });

  test('multiple marks are independent', () => {
    let s = vim('a\nb\nc', 'majmbjmc');
    s = feed(s, '`a');
    expect(s.cursor.row).toBe(0);
    s = feed(s, '`c');
    expect(s.cursor.row).toBe(2);
    s = feed(s, '`b');
    expect(s.cursor.row).toBe(1);
  });

  test('jumping to an unset mark reports a message', () => {
    const s = vim('abc', '`z');
    expect(s.message).toBe('mark not set: z');
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('mark position is clamped after the buffer shrinks', () => {
    const s = vim('aaaa\nbbbb', 'j$maggdd`a');
    expect(s.cursor).toEqual({ row: 0, col: 3 });
  });
});

describe('jump point (double backtick)', () => {
  test('G sets the jump point and `` returns to it', () => {
    let s = vim('a\nb\nc\nd', 'jl');
    s = feed(s, 'G');
    expect(s.cursor.row).toBe(3);
    s = feed(s, '``');
    expect(s.cursor).toEqual({ row: 1, col: 0 }); // 'b' has only one column
  });

  test('`` toggles between the two ends of a jump', () => {
    let s = vim('aa\nbb\ncc', 'G``');
    expect(s.cursor.row).toBe(0);
    s = feed(s, '``');
    expect(s.cursor.row).toBe(2);
  });

  test('gg sets the jump point', () => {
    const s = vim('a\nb\nc', 'Gkgg``');
    expect(s.cursor.row).toBe(1);
  });

  test('paragraph motions set the jump point', () => {
    const s = vim('a\n\nb', '}``');
    expect(s.cursor.row).toBe(0);
  });

  test('search sets the jump point', () => {
    const s = vim('foo\nbar\nfoo', '*``');
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('mark jumps set the jump point', () => {
    const s = vim('a\nb\nc', 'majj`a``');
    expect(s.cursor.row).toBe(2);
  });

  test('`` with no jump recorded reports a message', () => {
    const s = vim('abc', '``');
    expect(s.message).toBe('mark not set: `');
  });
});
