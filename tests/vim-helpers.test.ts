// Shared helpers for the vim engine suites, plus tests for the tokenizer itself.

import { describe, expect, test } from 'vitest';
import {
  createVim,
  getText,
  handleKey,
  type KeyContext,
  type VimEffects,
  type VimState,
} from '../src/core/vim/index.js';

const SPECIALS = new Set([
  '<Esc>', '<CR>', '<BS>', '<Tab>', '<Up>', '<Down>', '<Left>', '<Right>',
  '<Home>', '<End>', '<Del>', '<C-r>', '<C-d>', '<C-u>',
]);

/** Split 'dd2w<Esc>ihello<Esc>' into engine key tokens. */
export function tokenize(keys: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < keys.length) {
    if (keys[i] === '<') {
      const end = keys.indexOf('>', i);
      if (end > i) {
        const candidate = keys.slice(i, end + 1);
        if (SPECIALS.has(candidate)) {
          out.push(candidate);
          i = end + 1;
          continue;
        }
      }
    }
    out.push(keys[i] as string);
    i++;
  }
  return out;
}

/** Fold a key string through handleKey. */
export function feed(state: VimState, keys: string, ctx?: KeyContext): VimState {
  let cur = state;
  for (const tok of tokenize(keys)) {
    cur = handleKey(cur, tok, ctx).state;
  }
  return cur;
}

/** createVim + feed in one step. */
export function vim(text: string, keys = '', ctx?: KeyContext): VimState {
  return feed(createVim(text), keys, ctx);
}

/** Feed all keys, returning the effects of the final key. */
export function feedFx(
  state: VimState,
  keys: string,
  ctx?: KeyContext
): { state: VimState; effects: VimEffects } {
  const tokens = tokenize(keys);
  let cur = state;
  let effects: VimEffects = {};
  for (const tok of tokens) {
    const r = handleKey(cur, tok, ctx);
    cur = r.state;
    effects = r.effects;
  }
  return { state: cur, effects };
}

export function text(state: VimState): string {
  return getText(state);
}

describe('vim-helpers tokenizer', () => {
  test('splits plain characters', () => {
    expect(tokenize('dd2w')).toEqual(['d', 'd', '2', 'w']);
  });

  test('extracts special tokens', () => {
    expect(tokenize('ihello<Esc>')).toEqual(['i', 'h', 'e', 'l', 'l', 'o', '<Esc>']);
    expect(tokenize('<C-r><CR>')).toEqual(['<C-r>', '<CR>']);
  });

  test('leaves unknown angle text as literal characters', () => {
    expect(tokenize('i<a>')).toEqual(['i', '<', 'a', '>']);
  });

  test('handles << and <Esc> mixed', () => {
    expect(tokenize('<<<Esc>')).toEqual(['<', '<', '<Esc>']);
  });

  test('feed folds keys through the engine', () => {
    const s = vim('abc', 'llx');
    expect(text(s)).toBe('ab');
  });
});
