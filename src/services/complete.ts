/* Filesystem side of path-token completion. The string arithmetic (token split,
   fragment resolution, LCP/suffix rules) is pure and lives in core/complete.ts;
   this layer only does the readdir and reassembly. */

import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import {
  baseWantsHidden,
  completeEntries,
  resolvePathTarget,
  splitLastToken,
  type DirEntry,
} from '../core/complete.js';

/**
 * Complete the last whitespace-delimited token of `command` as a filesystem
 * path, relative to `root` (with `~` expanding to the user home). Returns the
 * new command string, or the original unchanged when there's nothing to add
 * (no matches, no LCP progress, or the dir can't be read).
 *
 * Reading the directory is the only side effect; everything else is pure.
 */
export async function completePathToken(root: string, command: string): Promise<string> {
  const { prefix, frag } = splitLastToken(command);
  if (frag === '') return command;

  const { listDir, base } = resolvePathTarget(frag, homedir(), root);

  // Read the directory; ENOENT / not-a-dir / perms all degrade to "no matches".
  let dirents: Dirent[];
  try {
    dirents = await readdir(listDir, { withFileTypes: true });
  } catch {
    return command;
  }

  const wantHidden = baseWantsHidden(base);
  const entries: DirEntry[] = [];
  for (const d of dirents) {
    if (!d.name.startsWith(base)) continue;
    if (!wantHidden && d.name.startsWith('.')) continue; // hide dotfiles unless asked
    entries.push({ name: d.name, isDir: d.isDirectory() });
  }

  const completedBase = completeEntries(base, entries);
  if (completedBase === base) return command; // nothing to extend

  // Splice the completed basename back onto the fragment's own dirname, then
  // onto the preserved command prefix. The dirname is whatever preceded the
  // last '/' in the original fragment (kept verbatim, incl. ~ / leading slash).
  const slash = frag.lastIndexOf('/');
  const fragDir = slash < 0 ? '' : frag.slice(0, slash + 1);
  return `${prefix}${fragDir}${completedBase}`;
}
