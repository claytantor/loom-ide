import { describe, expect, test } from 'vitest';
import { createVim, runEx } from '../src/core/vim/index.js';
import { feed, text, vim } from './vim-helpers.test.js';

describe('undo and redo basics', () => {
  test('u undoes and <C-r> redoes a delete', () => {
    let s = vim('hello', 'x');
    expect(text(s)).toBe('ello');
    s = feed(s, 'u');
    expect(text(s)).toBe('hello');
    s = feed(s, '<C-r>');
    expect(text(s)).toBe('ello');
  });

  test('undo restores the pre-change cursor', () => {
    const s = vim('abc def', 'wxu');
    expect(text(s)).toBe('abc def');
    expect(s.cursor).toEqual({ row: 0, col: 4 });
  });

  test('multiple undos walk back through history', () => {
    let s = vim('a\nb\nc', 'dddd');
    expect(s.lines).toEqual(['c']);
    s = feed(s, 'u');
    expect(s.lines).toEqual(['b', 'c']);
    s = feed(s, 'u');
    expect(s.lines).toEqual(['a', 'b', 'c']);
  });

  test('counts apply to u and <C-r>', () => {
    let s = vim('abcdef', 'xxx');
    s = feed(s, '3u');
    expect(text(s)).toBe('abcdef');
    s = feed(s, '2<C-r>');
    expect(text(s)).toBe('cdef');
  });

  test('undo past the oldest change reports a message', () => {
    const s = vim('abc', 'u');
    expect(s.message).toBe('already at oldest change');
  });

  test('redo past the newest change reports a message', () => {
    const s = vim('abc', 'x<C-r>');
    expect(s.message).toBe('already at newest change');
  });

  test('a new change clears the redo stack', () => {
    let s = vim('abcd', 'xux');
    s = feed(s, '<C-r>');
    expect(s.message).toBe('already at newest change');
    expect(text(s)).toBe('bcd');
  });
});

describe('undo units', () => {
  test('one insert session is one unit', () => {
    let s = vim('', 'ihello world<Esc>');
    expect(text(s)).toBe('hello world');
    s = feed(s, 'u');
    expect(text(s)).toBe('');
  });

  test('paste is one unit', () => {
    const s = vim('ab\ncd', 'yyjpu');
    expect(s.lines).toEqual(['ab', 'cd']);
  });

  test('undo across a join restores both lines and the cursor', () => {
    let s = vim('foo\nbar', 'J');
    expect(text(s)).toBe('foo bar');
    s = feed(s, 'u');
    expect(s.lines).toEqual(['foo', 'bar']);
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  test('r and ~ are single units', () => {
    expect(text(vim('abc', 'rxu'))).toBe('abc');
    expect(text(vim('abc', '3~u'))).toBe('abc');
  });

  test('an ex substitute over many lines is one unit', () => {
    let s = runEx(createVim('a\na\na'), '%s/a/b/').state;
    expect(s.lines).toEqual(['b', 'b', 'b']);
    s = feed(s, 'u');
    expect(s.lines).toEqual(['a', 'a', 'a']);
  });

  test('cw plus typing undoes in one step', () => {
    const s = vim('one two', 'cwxyz<Esc>u');
    expect(text(s)).toBe('one two');
  });

  test('indent and dedent are units', () => {
    let s = vim('a', '>>');
    expect(s.lines).toEqual(['  a']);
    s = feed(s, 'u');
    expect(s.lines).toEqual(['a']);
  });

  test('visual delete is one unit', () => {
    const s = vim('hello', 'vlldu');
    expect(text(s)).toBe('hello');
  });
});

describe('undo bookkeeping', () => {
  test('undo restores the dirty flag of the snapshot', () => {
    let s = vim('abc', 'x');
    expect(s.dirty).toBe(true);
    s = feed(s, 'u');
    expect(s.dirty).toBe(false);
    s = feed(s, '<C-r>');
    expect(s.dirty).toBe(true);
  });

  test('aborted inserts add no undo entry', () => {
    let s = vim('abc', 'i<Esc>');
    s = feed(s, 'u');
    expect(s.message).toBe('already at oldest change');
  });

  test('redo then undo round-trips repeatedly', () => {
    let s = vim('abcdef', 'xx');
    for (let i = 0; i < 3; i++) {
      s = feed(s, 'u');
      s = feed(s, '<C-r>');
    }
    expect(text(s)).toBe('cdef');
  });

  test('history is capped at 200 units', () => {
    let s = createVim('x'.repeat(300));
    for (let i = 0; i < 205; i++) s = feed(s, 'x');
    expect(s.undoStack.length).toBe(200);
    expect(text(s)).toBe('x'.repeat(95));
  });

  test('yank does not create an undo unit', () => {
    const s = vim('abc', 'yyu');
    expect(s.message).toBe('already at oldest change');
  });

  test('failed operators do not create undo units', () => {
    const s = vim('abc', 'dfzu');
    expect(s.message).toBe('already at oldest change');
  });
});
