/* ~/.loom IO: seeding, config/keybindings/theme loading, config persistence.
   All loaders are error-tolerant — a broken file yields defaults + warnings. */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { mergeConfig, type LoomConfig } from '../core/config.js';
import { applyKeymapOverrides, DEFAULT_KEYMAP, type Keymap } from '../core/keymap.js';
import type { ThemeOverride } from '../core/theme.js';
import { SEED_CONFIG_YML, SEED_KEYBINDINGS_YML, SEED_THEME_EXAMPLE_JSON } from './seeds.js';

export function loomDir(): string {
  return process.env.LOOM_HOME ?? join(homedir(), '.loom');
}

export async function ensureSeeded(): Promise<void> {
  const dir = loomDir();
  await mkdir(join(dir, 'themes'), { recursive: true });
  const seedIfAbsent = async (path: string, content: string): Promise<void> => {
    if (!existsSync(path)) await writeFile(path, content, 'utf8');
  };
  await seedIfAbsent(join(dir, 'config.yml'), SEED_CONFIG_YML);
  await seedIfAbsent(join(dir, 'keybindings.yml'), SEED_KEYBINDINGS_YML);
  await seedIfAbsent(join(dir, 'themes', 'custom-example.json'), SEED_THEME_EXAMPLE_JSON);
}

export interface LoadedSettings {
  config: LoomConfig;
  keymap: Keymap;
  userThemes: Map<string, ThemeOverride>;
  warnings: string[];
}

export async function loadSettings(): Promise<LoadedSettings> {
  const dir = loomDir();
  const warnings: string[] = [];

  let rawConfig: unknown = null;
  try {
    rawConfig = parse(await readFile(join(dir, 'config.yml'), 'utf8'));
  } catch (err) {
    if (existsSync(join(dir, 'config.yml'))) warnings.push(`config.yml: ${(err as Error).message}`);
  }
  const { config, warnings: cw } = mergeConfig(rawConfig);
  warnings.push(...cw);

  let rawKeys: unknown = null;
  try {
    rawKeys = parse(await readFile(join(dir, 'keybindings.yml'), 'utf8'));
  } catch (err) {
    if (existsSync(join(dir, 'keybindings.yml'))) warnings.push(`keybindings.yml: ${(err as Error).message}`);
  }
  const { keymap, warnings: kw } = applyKeymapOverrides(DEFAULT_KEYMAP, rawKeys);
  warnings.push(...kw);

  const userThemes = new Map<string, ThemeOverride>();
  try {
    const themeDir = join(dir, 'themes');
    for (const file of await readdir(themeDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await readFile(join(themeDir, file), 'utf8')) as ThemeOverride;
        const name = parsed.name ?? file.replace(/\.json$/, '');
        userThemes.set(name, parsed);
      } catch {
        warnings.push(`themes/${file}: invalid JSON — skipped`);
      }
    }
  } catch {
    // themes dir absent — fine
  }

  return { config, keymap, userThemes, warnings };
}

/** Persist the current config (used by /theme and friends). */
export async function saveConfig(config: LoomConfig): Promise<void> {
  const dir = loomDir();
  await mkdir(dir, { recursive: true });
  const body = stringify(config);
  await writeFile(join(dir, 'config.yml'), `# loom — general settings (managed; comments are not preserved)\n${body}`, 'utf8');
}
