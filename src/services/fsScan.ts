/* Recursive repo scan respecting .gitignore (nested files included).
   `.git` is always skipped. Capped — truncation is reported, never silent. */

import { opendir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';

export const SCAN_CAP = 50_000;

export interface ScanResult {
  /** Repo-relative file paths, '/' separated. */
  files: string[];
  /** True when SCAN_CAP stopped the walk early. */
  truncated: boolean;
}

interface IgnoreScope {
  ig: Ignore;
  /** Repo-relative dir ('' = root) the .gitignore lives in. */
  base: string;
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

function isIgnored(scopes: IgnoreScope[], relPath: string, isDir: boolean): boolean {
  for (const { ig, base } of scopes) {
    const sub = base === '' ? relPath : relPath.startsWith(base + '/') ? relPath.slice(base.length + 1) : null;
    if (sub === null || sub === '') continue;
    if (ig.ignores(isDir ? sub + '/' : sub)) return true;
  }
  return false;
}

async function scopeFor(dirAbs: string, dirRel: string): Promise<IgnoreScope | null> {
  try {
    const text = await readFile(join(dirAbs, '.gitignore'), 'utf8');
    const ig = ignore().add(text);
    return { ig, base: dirRel };
  } catch {
    return null;
  }
}

export async function scanRepo(root: string): Promise<ScanResult> {
  const files: string[] = [];
  let truncated = false;

  async function walk(dirAbs: string, dirRel: string, scopes: IgnoreScope[]): Promise<void> {
    if (truncated) return;
    const localScope = await scopeFor(dirAbs, dirRel);
    const active = localScope ? [...scopes, localScope] : scopes;
    let dir;
    try {
      dir = await opendir(dirAbs);
    } catch {
      return;
    }
    const subdirs: { abs: string; rel: string }[] = [];
    for await (const entry of dir) {
      if (truncated) break;
      const name = entry.name;
      if (name === '.git') continue;
      const abs = join(dirAbs, name);
      const rel = toPosix(relative(root, abs));
      if (entry.isDirectory()) {
        if (!isIgnored(active, rel, true)) subdirs.push({ abs, rel });
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (isIgnored(active, rel, false)) continue;
        files.push(rel);
        if (files.length >= SCAN_CAP) {
          truncated = true;
          break;
        }
      }
    }
    for (const sub of subdirs) {
      await walk(sub.abs, sub.rel, active);
      if (truncated) return;
    }
  }

  await walk(root, '', []);
  files.sort();
  return { files, truncated };
}

/** Shared predicate so the watcher ignores exactly what the scan ignores. */
export async function buildIgnorePredicate(root: string): Promise<(absPath: string, isDir: boolean) => boolean> {
  // Root-level .gitignore only for the fast predicate; nested ones are rare
  // enough that a stray watch event is harmless (the scan stays authoritative).
  const rootScope = await scopeFor(root, '');
  return (absPath: string, isDir: boolean): boolean => {
    const rel = toPosix(relative(root, absPath));
    if (rel === '' || rel === '.') return false;
    if (rel === '.git' || rel.startsWith('.git/')) return true;
    if (!rootScope) return false;
    return isIgnored([rootScope], rel, isDir);
  };
}
