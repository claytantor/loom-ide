/* Single-buffer disk IO with trailing-newline preservation. */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
