/* Pure completion logic for the omnibar — no Ink, no fs, no Node side effects.
   Two flavours, both string arithmetic so they unit-test in isolation:

     1. Slash command-name completion (shell-like, over the prefix-matched
        registry names): extend to the longest common prefix, complete a lone
        match (with a trailing space iff it takes an arg), and — when the LCP
        makes no progress — commit the currently highlighted palette item.

     2. Path-token completion helpers: split off the last whitespace-delimited
        token, resolve {listDir, base} from it (against a passed-in home/root),
        and turn directory entries into the completed fragment. The actual
        readdir is a side effect and lives in src/services/complete.ts. */

/** Minimal shape of a slash command this module needs. */
export interface CompletableCommand {
  name: string;
  takesArg?: boolean;
}

/** Longest common prefix of a list of strings ('' for an empty list). */
function longestCommonPrefix(items: readonly string[]): string {
  if (items.length === 0) return '';
  let lcp = items[0] ?? '';
  for (let i = 1; i < items.length; i++) {
    const s = items[i] ?? '';
    let k = 0;
    while (k < lcp.length && k < s.length && lcp[k] === s[k]) k++;
    lcp = lcp.slice(0, k);
    if (lcp === '') break;
  }
  return lcp;
}

/** Full completion of a single command name: its name plus a trailing space
   iff it takes an arg (so the cursor lands ready for arg entry). */
function completeFull(cmd: CompletableCommand): string {
  return cmd.takesArg ? `${cmd.name} ` : cmd.name;
}

/**
 * Complete a slash command HEAD, shell-style, over the registry.
 *
 * - Only operates on the head (text before the first space). If a space is
 *   already present the head is settled — returns `omni` unchanged (the caller
 *   handles the `/bash <token>` path-completion case separately).
 * - Matches the prefix-matched names (those whose name starts with the typed
 *   head, case-insensitive) and extends `omni` to their longest common prefix.
 * - Exactly one prefix match → complete to its full name (+ space if takesArg).
 * - LCP makes no progress with multiple candidates → fall back to completing the
 *   currently highlighted palette item (`selectedName`) to its full name, so a
 *   second Tab (or Tab after arrowing) commits the selection.
 * - Zero matches → `omni` unchanged.
 */
export function completeSlash(
  omni: string,
  commands: readonly CompletableCommand[],
  selectedName?: string,
): string {
  if (!omni.startsWith('/')) return omni;
  if (omni.includes(' ')) return omni; // head already settled — not our job

  const head = omni.toLowerCase();
  const matches = commands.filter((c) => c.name.toLowerCase().startsWith(head));
  if (matches.length === 0) return omni;

  if (matches.length === 1) {
    const only = matches[0];
    if (!only) return omni;
    return completeFull(only);
  }

  // Multiple candidates: try to extend to the longest common prefix.
  const lcp = longestCommonPrefix(matches.map((c) => c.name));
  if (lcp.length > omni.length) return lcp;

  // No LCP progress → commit the highlighted item, if it's a real candidate.
  if (selectedName) {
    const sel = matches.find((c) => c.name === selectedName);
    if (sel) return completeFull(sel);
  }
  return omni;
}

/* ── path-token completion (pure halves) ─────────────────────────────────── */

/** A directory entry, as the service layer surfaces it from a dirent. */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

/** The last whitespace-delimited token of a command and the verbatim prefix
   that precedes it (everything up to and including the gap). Reassembled as
   `prefix + completedFrag`. */
export interface TokenSplit {
  prefix: string;
  frag: string;
}

/** Split a command string into its preserved `prefix` and trailing `frag`. */
export function splitLastToken(command: string): TokenSplit {
  // Match the final run of non-whitespace at the end of the string.
  const m = /(\S*)$/.exec(command);
  const frag = m ? m[1] : '';
  const prefix = command.slice(0, command.length - frag.length);
  return { prefix, frag };
}

/** Where a fragment points: the directory to list and the basename to match. */
export interface PathTarget {
  /** Directory to readdir, resolved against home/root as needed. */
  listDir: string;
  /** Basename prefix to filter entries by. */
  base: string;
}

/** POSIX dirname/basename split on the final '/'. */
function dirBasename(p: string): { dir: string; base: string } {
  const slash = p.lastIndexOf('/');
  if (slash < 0) return { dir: '', base: p };
  return { dir: p.slice(0, slash), base: p.slice(slash + 1) };
}

/** Join two POSIX-ish path segments, tolerating empty/trailing slashes. */
function joinPath(a: string, b: string): string {
  if (a === '') return b;
  const left = a.endsWith('/') ? a.slice(0, -1) : a;
  return b === '' ? left : `${left}/${b}`;
}

/**
 * Resolve a fragment into the directory to list and the basename to match,
 * shell-style:
 *   - `~` / `~/…`     → relative to `home`
 *   - absolute (`/…`) → its own dirname / basename
 *   - relative w/ '/' → dirname relative to `root`
 *   - bare (no '/')   → list `root`, match the whole frag
 *
 * `listDir` is always an absolute filesystem path for the service to read.
 */
export function resolvePathTarget(frag: string, home: string, root: string): PathTarget {
  // Tilde expansion.
  if (frag === '~' || frag.startsWith('~/')) {
    const rest = frag === '~' ? '' : frag.slice(2);
    const { dir, base } = dirBasename(rest);
    return { listDir: joinPath(home, dir), base };
  }

  // Absolute path.
  if (frag.startsWith('/')) {
    const { dir, base } = dirBasename(frag);
    return { listDir: dir === '' ? '/' : dir, base };
  }

  // Relative with a slash → dirname under root.
  if (frag.includes('/')) {
    const { dir, base } = dirBasename(frag);
    return { listDir: joinPath(root, dir), base };
  }

  // Bare fragment → list root, match the whole thing.
  return { listDir: root, base: frag };
}

/**
 * Given directory entries that already match `base`, return the completed
 * fragment text (the replacement for the typed last token):
 *   - extend to the longest common prefix of the match names;
 *   - exactly one match that is a directory → append '/';
 *   - exactly one match that is a file      → append a trailing space;
 *   - no matches                            → unchanged `base`.
 *
 * The returned value is only the basename part (callers splice it onto the
 * fragment's own dirname, then onto the command prefix).
 */
export function completeEntries(base: string, entries: readonly DirEntry[]): string {
  if (entries.length === 0) return base;

  if (entries.length === 1) {
    const only = entries[0];
    if (!only) return base;
    return only.isDir ? `${only.name}/` : `${only.name} `;
  }

  return longestCommonPrefix(entries.map((e) => e.name));
}

/** Whether a base should surface dotfiles (standard shell rule: only when the
   user has already typed a leading dot). */
export function baseWantsHidden(base: string): boolean {
  return base.startsWith('.');
}
