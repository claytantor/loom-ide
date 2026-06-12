import { describe, expect, test } from 'vitest';
import { createVim, getText, markSaved, runEx, withText } from '../src/core/vim/index.js';
import { feed, text, vim } from './vim-helpers.test.js';

describe('write/quit commands', () => {
  test(':w requests a save', () => {
    const { effects } = runEx(createVim('x'), 'w');
    expect(effects.save).toBe(true);
    expect(effects.quit).toBeUndefined();
  });

  test(':q quits a clean buffer', () => {
    const { effects } = runEx(createVim('x'), 'q');
    expect(effects.quit).toBe(true);
    expect(effects.forced).toBeUndefined();
  });

  test(':q on a dirty buffer refuses with a message', () => {
    const dirty = vim('abc', 'x');
    const { state, effects } = runEx(dirty, 'q');
    expect(effects.quit).toBeUndefined();
    expect(effects.message).toBe('no write since last change (add ! to override)');
    expect(state.message).toBe('no write since last change (add ! to override)');
  });

  test(':q! force-quits a dirty buffer', () => {
    const { effects } = runEx(vim('abc', 'x'), 'q!');
    expect(effects.quit).toBe(true);
    expect(effects.forced).toBe(true);
  });

  test(':wq and :x save and quit', () => {
    for (const cmd of ['wq', 'x']) {
      const { effects } = runEx(vim('abc', 'x'), cmd);
      expect(effects.save).toBe(true);
      expect(effects.quit).toBe(true);
    }
  });

  test(':wq! is forced', () => {
    const { effects } = runEx(createVim(''), 'wq!');
    expect(effects).toMatchObject({ save: true, quit: true, forced: true });
  });

  test('markSaved clears dirty so :q succeeds', () => {
    const saved = markSaved(vim('abc', 'x'));
    expect(saved.dirty).toBe(false);
    expect(runEx(saved, 'q').effects.quit).toBe(true);
  });

  test('unknown commands report not-an-editor-command', () => {
    const { effects } = runEx(createVim(''), 'frobnicate');
    expect(effects.message).toBe('not an editor command: frobnicate');
  });
});

describe('line addressing', () => {
  test(':{n} jumps to a 1-based line at first non-blank', () => {
    const s = runEx(createVim('a\n  b\nc'), '2').state;
    expect(s.cursor).toEqual({ row: 1, col: 2 });
  });

  test(':{n} clamps to the last line', () => {
    expect(runEx(createVim('a\nb'), '99').state.cursor.row).toBe(1);
  });

  test(':$ jumps to the last line', () => {
    expect(runEx(createVim('a\nb\nc'), '$').state.cursor.row).toBe(2);
  });

  test(':/pat jumps to the next matching line with wrap', () => {
    let s = runEx(createVim('foo\nbar\nbaz'), '/ba').state;
    expect(s.cursor.row).toBe(1);
    s = runEx(s, '/foo').state;
    expect(s.cursor.row).toBe(0); // wrapped
    expect(s.searchPattern).toBe('foo');
  });

  test(':?pat searches backward', () => {
    const base = feed(createVim('foo\nmid\nfoo'), 'j');
    const s = runEx(base, '?foo').state;
    expect(s.cursor.row).toBe(0);
  });

  test(':/missing reports pattern not found', () => {
    const { effects } = runEx(createVim('abc'), '/zzz');
    expect(effects.message).toBe('pattern not found: zzz');
  });

  test('line jumps set the jump point', () => {
    let s = runEx(createVim('a\nb\nc'), '3').state;
    s = feed(s, '``');
    expect(s.cursor.row).toBe(0);
  });
});

describe('substitute', () => {
  test('s/pat/rep/ replaces the first match on the current line', () => {
    const s = runEx(createVim('aa bb aa'), 's/aa/XX/').state;
    expect(text(s)).toBe('XX bb aa');
  });

  test('the g flag replaces every match on the line', () => {
    const { state, effects } = runEx(createVim('aa bb aa'), 's/aa/XX/g');
    expect(text(state)).toBe('XX bb XX');
    expect(effects.message).toBe('2 substitutions on 1 line');
  });

  test('%s works across the whole buffer and reports counts', () => {
    const { state, effects } = runEx(createVim('a a\nb\na'), '%s/a/x/g');
    expect(state.lines).toEqual(['x x', 'b', 'x']);
    expect(effects.message).toBe('3 substitutions on 2 lines');
  });

  test('singular message forms', () => {
    const { effects } = runEx(createVim('a'), 's/a/b/');
    expect(effects.message).toBe('1 substitution on 1 line');
  });

  test('numeric ranges limit the scope', () => {
    const s = runEx(createVim('x\nx\nx\nx'), '2,3s/x/y/').state;
    expect(s.lines).toEqual(['x', 'y', 'y', 'x']);
  });

  test('.,$ ranges use the cursor line', () => {
    const base = feed(createVim('a1\na2\na3'), 'j');
    const s = runEx(base, '.,$s/a/b/').state;
    expect(s.lines).toEqual(['a1', 'b2', 'b3']);
  });

  test('the i flag ignores case', () => {
    const s = runEx(createVim('FOO foo'), 's/foo/x/gi').state;
    expect(text(s)).toBe('x x');
  });

  test('capture groups use vim-style backslash references', () => {
    const s = runEx(createVim('john smith'), 's/(\\w+) (\\w+)/\\2, \\1/').state;
    expect(text(s)).toBe('smith, john');
  });

  test('dollar signs in the replacement are literal', () => {
    const s = runEx(createVim('price'), 's/price/$9/').state;
    expect(text(s)).toBe('$9');
  });

  test('escaped slashes can appear in the pattern', () => {
    const s = runEx(createVim('a/b'), 's/a\\/b/ok/').state;
    expect(text(s)).toBe('ok');
  });

  test('no match reports pattern not found and changes nothing', () => {
    const { state, effects } = runEx(createVim('abc'), 's/zzz/x/');
    expect(text(state)).toBe('abc');
    expect(effects.message).toBe('pattern not found: zzz');
    expect(state.dirty).toBe(false);
  });

  test('substitute is one undo unit and sets dirty', () => {
    let s = runEx(createVim('a\na'), '%s/a/b/').state;
    expect(s.dirty).toBe(true);
    s = feed(s, 'u');
    expect(s.lines).toEqual(['a', 'a']);
  });

  test('cursor lands on the last substituted line', () => {
    const s = runEx(createVim('a\nzz\na'), '%s/a/b/').state;
    expect(s.cursor.row).toBe(2);
  });

  test('empty pattern reuses the last search', () => {
    const base = vim('foo\nfoo', '*');
    const s = runEx(base, '%s//X/g').state;
    expect(s.lines).toEqual(['X', 'X']);
  });
});

describe('buffer API', () => {
  test('withText replaces content, clears undo, resets dirty', () => {
    let s = vim('abc', 'x'); // dirty with undo history
    s = withText(s, 'new\ncontent');
    expect(getText(s)).toBe('new\ncontent');
    expect(s.dirty).toBe(false);
    s = feed(s, 'u');
    expect(getText(s)).toBe('new\ncontent');
    expect(s.message).toBe('already at oldest change');
  });

  test('withText clamps the cursor', () => {
    const long = feed(createVim('abcdef\nabcdef'), 'j$');
    const s = withText(long, 'xy');
    expect(s.cursor).toEqual({ row: 0, col: 1 });
  });

  test('runEx clears a stale message on success', () => {
    let s = vim('abc', 'n'); // sets 'no previous search'
    s = runEx(s, '1').state;
    expect(s.message).toBeNull();
  });
});
