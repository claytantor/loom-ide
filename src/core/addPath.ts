/* Pure path resolution for the `/add` command. No Node, no fs — just string
   arithmetic over repo-relative, POSIX-style paths so it unit-tests in isolation.

   "Current level" is the directory a new file is created in, derived from the
   current tree selection:
     • selected node is a dir  → create inside it
     • selected node is a file → create alongside it (its parent dir)
     • nothing selected        → repo root ('')

   The resolver then joins the (possibly nested) filename arg under that level and
   rejects anything that escapes the repo via `..` — creation stays confined to
   the working tree. */

import { parentPath } from './text.js';

export type SelKind = 'dir' | 'file' | 'none';

/** Resolve the current-level directory (repo-relative, '' = root) from the
   selection's path and kind. */
export function currentLevelDir(selPath: string | null, kind: SelKind): string {
  if (!selPath || kind === 'none') return '';
  if (kind === 'dir') return selPath;
  return parentPath(selPath); // file → its parent dir
}

export type AddResolution =
  | { ok: true; relPath: string; parentDir: string }
  | { ok: false; reason: 'empty' | 'traversal' | 'absolute' };

/**
 * Resolve a `/add` filename arg against a current-level directory into a clean,
 * repo-relative target path.
 *
 * - Trims the arg; an empty/whitespace arg is a soft `empty` failure (no-op).
 * - Supports nested paths (`components/Button.tsx`) — intermediate dirs implied.
 * - Normalizes `.`/`..`/duplicate slashes and rejects any result that escapes
 *   the repo root, or an absolute path arg.
 *
 * Returns the normalized `relPath` and its `parentDir` (for `mkdir -p`).
 */
export function resolveAddPath(currentDir: string, rawArg: string): AddResolution {
  const arg = rawArg.trim();
  if (arg === '') return { ok: false, reason: 'empty' };
  // Reject absolute paths outright — /add is always relative to the current level.
  if (arg.startsWith('/') || /^[A-Za-z]:[\\/]/.test(arg)) return { ok: false, reason: 'absolute' };

  // Normalize both segments to forward slashes and fold them together.
  const combined = `${currentDir}/${arg.split('\\').join('/')}`;
  const parts = combined.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return { ok: false, reason: 'traversal' }; // escaped root
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (stack.length === 0) return { ok: false, reason: 'empty' }; // e.g. arg of '.' at root

  const relPath = stack.join('/');
  // The arg collapsed to the current level itself (e.g. `/add .`) — there's no
  // new file leaf to create, so treat it as a no-op rather than naming a file
  // after the directory.
  if (relPath === currentDir) return { ok: false, reason: 'empty' };
  return { ok: true, relPath, parentDir: parentPath(relPath) };
}
