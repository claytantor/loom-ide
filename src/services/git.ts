/* git via the system binary — no native deps. Every call degrades to null/empty
   when git is absent or the directory is not a repository. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseStatusPorcelainZ, type GitStatusResult } from '../core/gitParse.js';

const run = promisify(execFile);
const MAX_BUFFER = 16 * 1024 * 1024;

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', root, ...args], {
      maxBuffer: MAX_BUFFER,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout;
  } catch {
    return null;
  }
}

export async function isRepo(root: string): Promise<boolean> {
  const out = await git(root, ['rev-parse', '--is-inside-work-tree']);
  return out?.trim() === 'true';
}

export async function currentBranch(root: string): Promise<string | null> {
  const out = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = out?.trim();
  if (branch && branch !== 'HEAD') return branch;
  if (branch === 'HEAD') {
    const sha = await git(root, ['rev-parse', '--short', 'HEAD']);
    return sha ? `@${sha.trim()}` : null;
  }
  // Unborn branch (fresh init): symbolic-ref still knows the name.
  const sym = await git(root, ['symbolic-ref', '--short', 'HEAD']);
  return sym?.trim() ?? null;
}

export async function repoStatus(root: string): Promise<GitStatusResult | null> {
  const out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (out === null) return null;
  return parseStatusPorcelainZ(out);
}

/** Unified diff of one file against HEAD (falls back to /dev/null diff for untracked). */
export async function diffFile(root: string, relPath: string): Promise<string | null> {
  const tracked = await git(root, ['diff', 'HEAD', '--', relPath]);
  if (tracked && tracked.length > 0) return tracked;
  if (tracked !== null) {
    const untracked = await git(root, ['diff', '--no-index', '--', '/dev/null', relPath]);
    if (untracked && untracked.length > 0) return untracked;
    return tracked; // empty string — no changes
  }
  return null;
}

export async function blameFile(root: string, relPath: string): Promise<string | null> {
  return git(root, ['blame', '--line-porcelain', '--', relPath]);
}

/** Commit subjects on HEAD that are not on `target` (`git log target..HEAD`).
   Returns [] when there are none, git fails, or `target` is unknown. */
export async function logRange(root: string, target: string): Promise<string[]> {
  const out = await git(root, ['log', `${target}..HEAD`, '--pretty=format:%s']);
  if (!out) return [];
  return out
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}

/** Unified diff of HEAD against `target` (`git diff target..HEAD`).
   Returns '' when empty or git fails. */
export async function diffRange(root: string, target: string): Promise<string> {
  const out = await git(root, ['diff', `${target}..HEAD`]);
  return out ?? '';
}

/** Per-file change summary of HEAD against `target` (`git diff --stat`). Compact
   enough to send to the AI even when the full diff is too large. '' on failure. */
export async function diffStatRange(root: string, target: string): Promise<string> {
  const out = await git(root, ['diff', '--stat', `${target}..HEAD`]);
  return out ?? '';
}

/** Revert a file to HEAD (the /discard command). */
export async function discardFile(root: string, relPath: string): Promise<boolean> {
  const restored = await git(root, ['restore', '--worktree', '--staged', '--', relPath]);
  if (restored !== null) return true;
  const fallback = await git(root, ['checkout', 'HEAD', '--', relPath]);
  return fallback !== null;
}
