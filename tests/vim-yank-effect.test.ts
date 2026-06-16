// The yank → clipboard bridge: the engine must SURFACE yanked text as an effect
// (App.tsx then writes it to the system clipboard via OSC 52). These tests assert
// the effect is raised on every yank path and stays absent otherwise.

import { describe, expect, test } from 'vitest';
import { createVim } from '../src/core/vim/index.js';
import { feedFx } from './vim-helpers.test.js';

describe('yank surfaces a clipboard effect', () => {
  test('yy yields the whole line (linewise)', () => {
    const { effects } = feedFx(createVim('hello world'), 'yy');
    expect(effects.yank).toEqual({ text: 'hello world', linewise: true });
  });

  test('yw yields the word (charwise)', () => {
    const { effects } = feedFx(createVim('hello world'), 'yw');
    expect(effects.yank?.text).toBe('hello ');
    expect(effects.yank?.linewise).toBe(false);
  });

  test('Y yields the line linewise', () => {
    const { effects } = feedFx(createVim('abc'), 'Y');
    expect(effects.yank).toEqual({ text: 'abc', linewise: true });
  });

  test('visual y yields the selection charwise', () => {
    // select "hel" then yank
    const { effects } = feedFx(createVim('hello'), 'vlly');
    expect(effects.yank?.text).toBe('hel');
    expect(effects.yank?.linewise).toBe(false);
  });

  test('visual-line V y yields the line linewise', () => {
    const { effects } = feedFx(createVim('one\ntwo'), 'Vy');
    expect(effects.yank).toEqual({ text: 'one', linewise: true });
  });

  test('2yy yields two lines', () => {
    const { effects } = feedFx(createVim('a\nb\nc'), '2yy');
    expect(effects.yank).toEqual({ text: 'a\nb', linewise: true });
  });

  test('yank to a named register still surfaces the effect', () => {
    const { effects } = feedFx(createVim('xyz'), '"ayy');
    expect(effects.yank).toEqual({ text: 'xyz', linewise: true });
  });
});

describe('non-yank keys raise no clipboard effect', () => {
  test('a plain motion does not yank', () => {
    const { effects } = feedFx(createVim('hello'), 'l');
    expect(effects.yank).toBeUndefined();
  });

  test('delete does not yank to the clipboard', () => {
    const { effects } = feedFx(createVim('hello'), 'dd');
    expect(effects.yank).toBeUndefined();
  });

  test('paste (p) does not re-yank', () => {
    const { effects } = feedFx(createVim('ab'), 'ylp');
    // the final key is p — no yank effect on it
    expect(effects.yank).toBeUndefined();
  });
});
