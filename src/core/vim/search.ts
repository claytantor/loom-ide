// Buffer search: pattern compilation, occurrence scanning, wrap handling.

import type { Pos } from './types.js';
import { escapeRegex, lastRow, lineAt } from './text.js';

export function compilePattern(pattern: string, ignoreCase = false): RegExp | null {
  try {
    return new RegExp(pattern, ignoreCase ? 'gi' : 'g');
  } catch {
    return null;
  }
}

/** Start columns of every match of `re` in `line`. */
export function matchCols(line: string, re: RegExp): number[] {
  const cols: number[] = [];
  re.lastIndex = 0;
  for (;;) {
    const m = re.exec(line);
    if (!m) break;
    cols.push(m.index);
    if (m[0].length === 0) re.lastIndex++;
    if (re.lastIndex > line.length) break;
  }
  return cols;
}

export interface SearchHit {
  readonly pos: Pos;
  readonly wrapped: boolean;
}

/**
 * Find the next/previous match relative to `from` (exclusive), wrapping
 * around the buffer. Returns null when the pattern matches nowhere.
 */
export function findMatch(
  lines: readonly string[],
  from: Pos,
  re: RegExp,
  dir: 1 | -1
): SearchHit | null {
  const last = lastRow(lines);
  if (dir === 1) {
    for (let r = from.row; r <= last; r++) {
      const cols = matchCols(lineAt(lines, r), re);
      for (const c of cols) {
        if (r > from.row || c > from.col) return { pos: { row: r, col: c }, wrapped: false };
      }
    }
    for (let r = 0; r <= from.row; r++) {
      const cols = matchCols(lineAt(lines, r), re);
      for (const c of cols) {
        if (r < from.row || c <= from.col) return { pos: { row: r, col: c }, wrapped: true };
      }
    }
    return null;
  }
  for (let r = from.row; r >= 0; r--) {
    const cols = matchCols(lineAt(lines, r), re);
    for (let i = cols.length - 1; i >= 0; i--) {
      const c = cols[i] as number;
      if (r < from.row || c < from.col) return { pos: { row: r, col: c }, wrapped: false };
    }
  }
  for (let r = last; r >= from.row; r--) {
    const cols = matchCols(lineAt(lines, r), re);
    for (let i = cols.length - 1; i >= 0; i--) {
      const c = cols[i] as number;
      if (r > from.row || c >= from.col) return { pos: { row: r, col: c }, wrapped: true };
    }
  }
  return null;
}

export function wrapMessage(dir: 1 | -1): string {
  return dir === 1
    ? 'search hit BOTTOM, continuing at TOP'
    : 'search hit TOP, continuing at BOTTOM';
}

/** Word under (or after) the cursor on its line, vim-* style. */
export function wordUnderCursor(line: string, col: number): { word: string; start: number } | null {
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_]/.test(ch);
  let c = Math.min(col, Math.max(0, line.length - 1));
  if (!isWord(line[c])) {
    while (c < line.length && !isWord(line[c])) c++;
    if (c >= line.length) return null;
  }
  let s = c;
  while (s > 0 && isWord(line[s - 1])) s--;
  let e = c;
  while (e + 1 < line.length && isWord(line[e + 1])) e++;
  return { word: line.slice(s, e + 1), start: s };
}

export function wholeWordPattern(word: string): string {
  return '\\b' + escapeRegex(word) + '\\b';
}
