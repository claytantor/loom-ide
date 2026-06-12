/* Theme + glyph resolution. Every color in the app resolves through a Theme —
   zero literal colors in components (design guide §3/§4). */

import { blendHex } from './text.js';

export interface Theme {
  bg: string;
  bgEl: string;
  fg: string;
  dim: string;
  accent: string;
  glow: string;
  secondary: string;
  gitM: string;
  gitQ: string;
  gitA: string;
  gitD: string;
  danger: string;
  /** Opaque pre-blend of the rgba selection tint over bg. */
  selBg: string;
}

export type AccentName = 'cyan' | 'amber' | 'green' | 'violet';
export type GlyphSet = 'unicode' | 'ascii';

export interface Glyphs {
  dirOpen: string;
  dirClosed: string;
  cursor: string;
  branch: string;
  clean: string;
  dirty: string;
  prompt: string;
  filt: string;
  dot: string;
  enter: string;
  up: string;
  down: string;
  left: string;
  right: string;
  ell: string;
  vrule: string;
  hrule: string;
  spin: string[];
  reload: string;
}

const NEON_BASE = {
  bg: '#0B0E14',
  bgEl: '#11151F',
  fg: '#C7D0E0',
  dim: '#5A6478',
  secondary: '#F0A36B',
  gitM: '#E5C07B',
  gitQ: '#56B6C2',
  gitA: '#7FD88F',
  gitD: '#E06C75',
  danger: '#FF5C66',
};

export const ACCENTS: Record<AccentName, { accent: string; glow: string }> = {
  cyan: { accent: '#22D3EE', glow: '#67E8F9' },
  amber: { accent: '#F0A36B', glow: '#FFC79A' },
  green: { accent: '#7FD88F', glow: '#A7E8B3' },
  violet: { accent: '#B392F0', glow: '#D0BCFF' },
};

const MONO: Theme = {
  bg: '#050705',
  bgEl: '#0b0f0a',
  fg: '#b8c0a8',
  dim: '#5b6356',
  accent: '#8ae234',
  glow: '#b6f56a',
  secondary: '#c4a000',
  gitM: '#c4a000',
  gitQ: '#73a39a',
  gitA: '#8ae234',
  gitD: '#cc6666',
  danger: '#cc6666',
  selBg: blendHex('#8ae234', '#050705', 0.13),
};

export type ThemeName = 'neon' | 'mono';

export interface ThemeChoice {
  theme: string;
  accent: AccentName;
}

/** A user theme file may override any Theme token. */
export type ThemeOverride = Partial<Record<keyof Theme, string>> & { name?: string };

export function resolveTheme(
  choice: ThemeChoice,
  userThemes: ReadonlyMap<string, ThemeOverride> = new Map(),
): Theme {
  let base: Theme;
  if (choice.theme === 'mono') {
    base = { ...MONO };
  } else {
    const acc = ACCENTS[choice.accent] ?? ACCENTS.cyan;
    base = {
      ...NEON_BASE,
      ...acc,
      selBg: blendHex(acc.accent, NEON_BASE.bg, 0.12),
    };
  }
  const user = userThemes.get(choice.theme);
  if (user) {
    const { name: _name, ...tokens } = user;
    base = { ...base, ...tokens };
    if (!user.selBg) base.selBg = blendHex(base.accent, base.bg, 0.12);
  }
  return base;
}

export const GLYPHS: Record<GlyphSet, Glyphs> = {
  unicode: {
    dirOpen: '▾',
    dirClosed: '▸',
    cursor: '❱',
    branch: '⎇',
    clean: '✓',
    dirty: '±',
    prompt: '›',
    filt: '▸',
    dot: '●',
    enter: '⏎',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    ell: '…',
    vrule: '│',
    hrule: '─',
    spin: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    reload: '↻',
  },
  ascii: {
    dirOpen: 'v',
    dirClosed: '>',
    cursor: '>',
    branch: 'git:',
    clean: 'ok',
    dirty: '*',
    prompt: '>',
    filt: '>',
    dot: '*',
    enter: 'Enter',
    up: '^',
    down: 'v',
    left: '<',
    right: '>',
    ell: '...',
    vrule: '|',
    hrule: '-',
    spin: ['|', '/', '-', '\\'],
    reload: 'r',
  },
};

/** Syntax scope → theme token (design handoff table; no new colors invented). */
export const SYNTAX_TOKEN: Record<string, keyof Theme> = {
  kw: 'secondary',
  string: 'gitA',
  comment: 'dim',
  num: 'gitQ',
  fn: 'glow',
  type: 'gitM',
  ident: 'fg',
  punct: 'fg',
  ws: 'fg',
};

export const GIT_TOKEN: Record<string, keyof Theme> = {
  M: 'gitM',
  '?': 'gitQ',
  '+': 'gitA',
  '-': 'gitD',
  '!': 'danger',
};
