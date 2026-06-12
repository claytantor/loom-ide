import { describe, expect, test } from 'vitest';
import { DEFAULT_KEYMAP, applyKeymapOverrides, keyDescFromInk, lookupAction } from '../src/core/keymap.js';
import { DEFAULT_CONFIG, mergeConfig } from '../src/core/config.js';
import { resolveTheme } from '../src/core/theme.js';

describe('keymap defaults', () => {
  test('tree navigation lookups', () => {
    expect(lookupAction(DEFAULT_KEYMAP, 'tree', 'up')).toBe('nav.up');
    expect(lookupAction(DEFAULT_KEYMAP, 'tree', 'return')).toBe('select');
    expect(lookupAction(DEFAULT_KEYMAP, 'tree', 'tab')).toBe('focus.toggle');
    expect(lookupAction(DEFAULT_KEYMAP, 'editor', 'ctrl+s')).toBe('save');
    expect(lookupAction(DEFAULT_KEYMAP, 'tree', 'x')).toBeNull();
  });
});

describe('keymap overrides', () => {
  test('valid override replaces binding', () => {
    const { keymap, warnings } = applyKeymapOverrides(DEFAULT_KEYMAP, {
      tree: { 'nav.up': ['up', 'ctrl+p'] },
    });
    expect(warnings).toEqual([]);
    expect(lookupAction(keymap, 'tree', 'ctrl+p')).toBe('nav.up');
    expect(lookupAction(DEFAULT_KEYMAP, 'tree', 'ctrl+p')).toBeNull();
  });
  test('string shorthand accepted', () => {
    const { keymap } = applyKeymapOverrides(DEFAULT_KEYMAP, { editor: { save: 'ctrl+w' } });
    expect(lookupAction(keymap, 'editor', 'ctrl+w')).toBe('save');
  });
  test('unknown context/action warn and are ignored', () => {
    const { warnings } = applyKeymapOverrides(DEFAULT_KEYMAP, {
      bogus: { x: 'y' },
      tree: { teleport: 'z' },
    });
    expect(warnings.length).toBe(2);
  });
});

describe('keyDescFromInk', () => {
  test('special keys and modifiers normalize', () => {
    expect(keyDescFromInk('', { upArrow: true })).toBe('up');
    expect(keyDescFromInk('s', { ctrl: true })).toBe('ctrl+s');
    expect(keyDescFromInk('', { return: true })).toBe('return');
    expect(keyDescFromInk('K', {})).toBe('k');
  });
  test('named keys ignore Ink\'s unreliable meta flag (Escape reports meta=true)', () => {
    // A lone Escape comes through as escape+meta; it must still resolve to 'escape'
    // so keymap-driven 'back' bindings (find/diff/blame/help) fire.
    expect(keyDescFromInk('', { escape: true, meta: true })).toBe('escape');
    expect(keyDescFromInk('', { downArrow: true, meta: true })).toBe('down');
    expect(lookupAction(DEFAULT_KEYMAP, 'output', keyDescFromInk('', { escape: true, meta: true }))).toBe('back');
  });
});

describe('mergeConfig', () => {
  test('null yields defaults', () => {
    expect(mergeConfig(null).config).toEqual(DEFAULT_CONFIG);
  });
  test('valid values apply, treeWidth clamps', () => {
    const { config, warnings } = mergeConfig({
      theme: 'mono', accent: 'violet', glyphs: 'ascii', fuzzyMode: 'hide', gutter: false, treeWidth: 99,
    });
    expect(warnings).toEqual([]);
    expect(config).toMatchObject({ theme: 'mono', accent: 'violet', glyphs: 'ascii', fuzzyMode: 'hide', gutter: false, treeWidth: 46 });
  });
  test('invalid values warn and keep defaults', () => {
    const { config, warnings } = mergeConfig({ accent: 'pink', fuzzyMode: 'maybe', gutter: 'yes' });
    expect(warnings.length).toBe(3);
    expect(config.accent).toBe(DEFAULT_CONFIG.accent);
    expect(config.fuzzyMode).toBe('dim');
  });
  test('prDiffLimit / prDefaultTarget default and apply', () => {
    expect(DEFAULT_CONFIG.prDiffLimit).toBe(1000);
    expect(DEFAULT_CONFIG.prDefaultTarget).toBe('');
    const { config, warnings } = mergeConfig({ prDiffLimit: 250, prDefaultTarget: '  dev  ' });
    expect(warnings).toEqual([]);
    expect(config.prDiffLimit).toBe(250);
    expect(config.prDefaultTarget).toBe('dev'); // trimmed
  });
  test('prDiffLimit floors at 0 and rounds; non-number warns', () => {
    expect(mergeConfig({ prDiffLimit: -5 }).config.prDiffLimit).toBe(0);
    expect(mergeConfig({ prDiffLimit: 12.7 }).config.prDiffLimit).toBe(13);
    const { config, warnings } = mergeConfig({ prDiffLimit: 'lots' });
    expect(warnings.some((w) => w.includes('prDiffLimit'))).toBe(true);
    expect(config.prDiffLimit).toBe(DEFAULT_CONFIG.prDiffLimit);
  });
  test('non-string prDefaultTarget warns and keeps default', () => {
    const { config, warnings } = mergeConfig({ prDefaultTarget: 123 });
    expect(warnings.some((w) => w.includes('prDefaultTarget'))).toBe(true);
    expect(config.prDefaultTarget).toBe('');
  });
  test('wrap defaults off, applies a boolean, warns on non-boolean', () => {
    expect(DEFAULT_CONFIG.wrap).toBe(false);
    expect(mergeConfig({ wrap: true }).config.wrap).toBe(true);
    const { config, warnings } = mergeConfig({ wrap: 'yes' });
    expect(warnings.some((w) => w.includes('wrap'))).toBe(true);
    expect(config.wrap).toBe(false);
  });
});

describe('resolveTheme', () => {
  test('neon accents swap accent/glow/selBg', () => {
    const cyan = resolveTheme({ theme: 'neon', accent: 'cyan' });
    const violet = resolveTheme({ theme: 'neon', accent: 'violet' });
    expect(cyan.accent).toBe('#22D3EE');
    expect(violet.accent).toBe('#B392F0');
    expect(cyan.selBg).not.toBe(violet.selBg);
    expect(cyan.bg).toBe(violet.bg);
  });
  test('mono is the low-color theme', () => {
    expect(resolveTheme({ theme: 'mono', accent: 'cyan' }).accent).toBe('#8ae234');
  });
  test('user theme overrides tokens and recomputes selBg', () => {
    const user = new Map([['custom', { fg: '#ffffff', accent: '#ff00ff' }]]);
    const t = resolveTheme({ theme: 'custom', accent: 'cyan' }, user);
    expect(t.fg).toBe('#ffffff');
    expect(t.accent).toBe('#ff00ff');
    expect(t.selBg).toMatch(/^#[0-9a-f]{6}$/);
  });
});
