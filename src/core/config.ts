/* Loom configuration schema + merge. Reading/writing ~/.loom lives in services. */

import type { AccentName, GlyphSet } from './theme.js';
import type { FuzzyMode } from './filter.js';

export interface LoomConfig {
  theme: string;
  accent: AccentName;
  glyphs: GlyphSet;
  fuzzyMode: FuzzyMode;
  gutter: boolean;
  treeWidth: number;
}

export const DEFAULT_CONFIG: LoomConfig = {
  theme: 'neon',
  accent: 'cyan',
  glyphs: 'unicode',
  fuzzyMode: 'dim',
  gutter: true,
  treeWidth: 32,
};

const ACCENT_NAMES: AccentName[] = ['cyan', 'amber', 'green', 'violet'];
const GLYPH_SETS: GlyphSet[] = ['unicode', 'ascii'];
const FUZZY_MODES: FuzzyMode[] = ['dim', 'hide', 'flat'];

export interface ConfigLoadResult {
  config: LoomConfig;
  warnings: string[];
}

export function mergeConfig(raw: unknown): ConfigLoadResult {
  const warnings: string[] = [];
  const config: LoomConfig = { ...DEFAULT_CONFIG };
  if (raw === null || raw === undefined) return { config, warnings };
  if (typeof raw !== 'object') {
    warnings.push('config.yml: top level must be a mapping');
    return { config, warnings };
  }
  const o = raw as Record<string, unknown>;
  if (o.theme !== undefined) {
    if (typeof o.theme === 'string' && o.theme.length > 0) config.theme = o.theme;
    else warnings.push('config.yml: theme must be a string');
  }
  if (o.accent !== undefined) {
    if (typeof o.accent === 'string' && ACCENT_NAMES.includes(o.accent as AccentName)) {
      config.accent = o.accent as AccentName;
    } else warnings.push(`config.yml: accent must be one of ${ACCENT_NAMES.join(', ')}`);
  }
  if (o.glyphs !== undefined) {
    if (typeof o.glyphs === 'string' && GLYPH_SETS.includes(o.glyphs as GlyphSet)) {
      config.glyphs = o.glyphs as GlyphSet;
    } else warnings.push(`config.yml: glyphs must be one of ${GLYPH_SETS.join(', ')}`);
  }
  if (o.fuzzyMode !== undefined) {
    if (typeof o.fuzzyMode === 'string' && FUZZY_MODES.includes(o.fuzzyMode as FuzzyMode)) {
      config.fuzzyMode = o.fuzzyMode as FuzzyMode;
    } else warnings.push(`config.yml: fuzzyMode must be one of ${FUZZY_MODES.join(', ')}`);
  }
  if (o.gutter !== undefined) {
    if (typeof o.gutter === 'boolean') config.gutter = o.gutter;
    else warnings.push('config.yml: gutter must be true or false');
  }
  if (o.treeWidth !== undefined) {
    if (typeof o.treeWidth === 'number' && Number.isFinite(o.treeWidth)) {
      config.treeWidth = Math.max(24, Math.min(46, Math.round(o.treeWidth)));
    } else warnings.push('config.yml: treeWidth must be a number');
  }
  return { config, warnings };
}
