/* Single-buffer disk IO with trailing-newline preservation. */

import { readFile, writeFile, rename, mkdir, stat, chmod, unlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { resolveAddPath } from '../core/addPath.js';

export interface LoadedBuffer {
  lines: string[];
  trailingNewline: boolean;
}

export class BinaryFileError extends Error {
  constructor(path: string) {
    super(`can't open ${path} — binary file`);
  }
}

const MAX_EDIT_BYTES = 8 * 1024 * 1024;

export class TooLargeError extends Error {
  constructor(path: string) {
    super(`can't open ${path} — larger than ${MAX_EDIT_BYTES / 1024 / 1024}MB`);
  }
}

export async function loadBuffer(root: string, relPath: string): Promise<LoadedBuffer> {
  const buf = await readFile(join(root, relPath));
  if (buf.length > MAX_EDIT_BYTES) throw new TooLargeError(relPath);
  if (buf.subarray(0, 8192).includes(0)) throw new BinaryFileError(relPath);
  const text = buf.toString('utf8');
  const trailingNewline = text.endsWith('\n');
  const body = trailingNewline ? text.slice(0, -1) : text;
  return { lines: body === '' && trailingNewline ? [''] : body.split('\n'), trailingNewline };
}

export async function saveBuffer(
  root: string,
  relPath: string,
  lines: readonly string[],
  trailingNewline: boolean,
): Promise<void> {
  const text = lines.join('\n') + (trailingNewline ? '\n' : '');
  await writeFile(join(root, relPath), text, 'utf8');
}

export async function renamePath(root: string, fromRel: string, toRel: string): Promise<void> {
  const to = join(root, toRel);
  await mkdir(dirname(to), { recursive: true });
  await rename(join(root, fromRel), to);
}

export type CreateFileResult =
  | { ok: true; relPath: string }
  /** The path resolves to an existing file — caller should open it, not clobber. */
  | { ok: false; reason: 'exists'; relPath: string }
  | { ok: false; reason: 'empty' | 'traversal' | 'absolute' }
  | { ok: false; reason: 'error'; message: string };

/**
 * Create a new empty file for `/add`: resolve `rawArg` under `currentDir` (the
 * current tree level), refuse anything that escapes the repo, `mkdir -p` the
 * parent, and write an empty file — never overwriting an existing one.
 *
 * Path resolution is delegated to the pure {@link resolveAddPath}; this wrapper
 * only touches disk. Returns the created repo-relative path, or a typed result
 * the app layer renders as a toast.
 */
export async function createFile(
  root: string,
  currentDir: string,
  rawArg: string,
): Promise<CreateFileResult> {
  const res = resolveAddPath(currentDir, rawArg);
  if (!res.ok) return { ok: false, reason: res.reason };

  const abs = join(root, res.relPath);
  // Defense in depth: even after the pure traversal check, confirm the realized
  // absolute path stays inside root (guards symlinked currentDir edge cases).
  const rel = relative(root, abs);
  if (rel.startsWith('..') || rel === '') return { ok: false, reason: 'traversal' };

  try {
    if (res.parentDir) await mkdir(join(root, res.parentDir), { recursive: true });
  } catch (err) {
    // mkdir failing (e.g. a path component is a file) is a plain error, NOT a
    // refuse-if-exists — only the write below distinguishes "file exists".
    return { ok: false, reason: 'error', message: (err as Error).message };
  }
  try {
    // 'wx' fails with EEXIST if the file already exists — atomic refuse-if-exists.
    await writeFile(abs, '', { encoding: 'utf8', flag: 'wx' });
    return { ok: true, relPath: res.relPath };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EEXIST') return { ok: false, reason: 'exists', relPath: res.relPath };
    return { ok: false, reason: 'error', message: e.message };
  }
}

/** Resolve `relPath` under `root`, refusing anything that escapes the repo.
   Returns the absolute path, or null when it would land outside the working
   tree (path traversal / absolute escape). Mirrors createFile's guard. */
function resolveInRoot(root: string, relPath: string): string | null {
  const abs = join(root, relPath);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..')) return null;
  return abs;
}

export type DeleteFileResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'is-directory' | 'outside-root' | 'error'; message?: string };

/**
 * Delete `relPath` (resolved under `root`) — the equivalent of `rm <file>`.
 *
 * Files only: an existing directory is refused with `is-directory` rather than
 * deleted (recursive directory removal is intentionally out of scope for /rm).
 * Path traversal / absolute escapes are refused with `outside-root`, and a
 * missing target reads as `not-found`. Mirrors createFile's typed result.
 */
export async function deleteFile(root: string, relPath: string): Promise<DeleteFileResult> {
  const abs = resolveInRoot(root, relPath);
  if (!abs) return { ok: false, reason: 'outside-root' };

  let st;
  try {
    st = await stat(abs);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { ok: false, reason: 'not-found' };
    return { ok: false, reason: 'error', message: e.message };
  }
  if (st.isDirectory()) return { ok: false, reason: 'is-directory' };

  try {
    await unlink(abs);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error).message };
  }
}

export type MakeExecutableResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'not-a-file' | 'outside-root' | 'error'; message?: string };

/**
 * Add the execute bit to `relPath` (resolved under `root`) — the equivalent of
 * `chmod +x`: it ORs `0o111` onto the file's current mode, preserving existing
 * permission bits rather than hardcoding `0o755`.
 *
 * Only operates on an existing regular file inside the repo; path traversal /
 * absolute escapes and non-files are refused with a typed reason.
 */
export async function makeExecutable(root: string, relPath: string): Promise<MakeExecutableResult> {
  const abs = resolveInRoot(root, relPath);
  if (!abs) return { ok: false, reason: 'outside-root' };

  let st;
  try {
    st = await stat(abs);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { ok: false, reason: 'not-found' };
    return { ok: false, reason: 'error', message: e.message };
  }
  if (!st.isFile()) return { ok: false, reason: 'not-a-file' };

  try {
    await chmod(abs, st.mode | 0o111);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error).message };
  }
}

/**
 * Lightweight pre-check for the chmod-and-rerun flow: is `relPath` a real,
 * in-root, regular file that currently LACKS the execute bit? Used by the app
 * layer to decide whether prompting is justified after a 126 exit. Any failure
 * (outside root, missing, not a file, error) reads as "don't prompt".
 */
export async function isNonExecFile(root: string, relPath: string): Promise<boolean> {
  const abs = resolveInRoot(root, relPath);
  if (!abs) return false;
  try {
    const st = await stat(abs);
    return st.isFile() && (st.mode & 0o111) === 0;
  } catch {
    return false;
  }
}
