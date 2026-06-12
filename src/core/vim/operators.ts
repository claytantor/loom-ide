// Buffer-mutating primitives. All functions are pure: they take lines and
// return new arrays, never touching the input.

import type { Pos } from './types.js';
import { SHIFT_WIDTH } from './types.js';
import {
  clampNormal,
  deleteCharRange,
  extractCharRange,
  firstNonBlankCol,
  insertCharText,
  lastRow,
  lineAt,
  maxNormalCol,
  spliceLines,
} from './text.js';

export type OpRange =
  | { readonly wise: 'char'; readonly start: Pos; readonly endEx: Pos }
  | { readonly wise: 'line'; readonly startRow: number; readonly endRow: number };

/** Clamp a charwise range's columns to real line bounds (endEx col may be len). */
function clampCharRange(lines: readonly string[], start: Pos, endEx: Pos): { start: Pos; endEx: Pos } {
  const sLine = lineAt(lines, start.row);
  const eLine = lineAt(lines, endEx.row);
  return {
    start: { row: start.row, col: Math.min(Math.max(0, start.col), sLine.length) },
    endEx: { row: endEx.row, col: Math.min(Math.max(0, endEx.col), eLine.length) },
  };
}

export function rangeText(lines: readonly string[], range: OpRange): { text: string; linewise: boolean } {
  if (range.wise === 'line') {
    const rows = lines.slice(range.startRow, range.endRow + 1);
    return { text: rows.join('\n'), linewise: true };
  }
  const { start, endEx } = clampCharRange(lines, range.start, range.endEx);
  return { text: extractCharRange(lines, start, endEx), linewise: false };
}

export interface DeleteOutcome {
  readonly lines: string[];
  readonly cursor: Pos;
  readonly text: string;
  readonly linewise: boolean;
}

export function deleteRange(lines: readonly string[], range: OpRange): DeleteOutcome {
  if (range.wise === 'line') {
    const text = lines.slice(range.startRow, range.endRow + 1).join('\n');
    const next = spliceLines(lines, range.startRow, range.endRow, []);
    const row = Math.min(range.startRow, lastRow(next));
    return {
      lines: next,
      cursor: { row, col: firstNonBlankCol(lineAt(next, row)) },
      text,
      linewise: true,
    };
  }
  const { start, endEx } = clampCharRange(lines, range.start, range.endEx);
  const text = extractCharRange(lines, start, endEx);
  const next = deleteCharRange(lines, start, endEx);
  return { lines: next, cursor: clampNormal(next, start), text, linewise: false };
}

/** Replace the rows of a linewise change (cc / S / visual-line c) with one empty line. */
export function changeLinewise(lines: readonly string[], startRow: number, endRow: number): { lines: string[]; cursor: Pos } {
  const next = spliceLines(lines, startRow, endRow, ['']);
  return { lines: next, cursor: { row: startRow, col: 0 } };
}

export function indentLines(
  lines: readonly string[],
  startRow: number,
  endRow: number,
  dir: 1 | -1,
  times = 1
): string[] {
  const pad = ' '.repeat(SHIFT_WIDTH);
  const out = lines.slice() as string[];
  for (let r = startRow; r <= Math.min(endRow, lastRow(lines)); r++) {
    let line = out[r] ?? '';
    for (let t = 0; t < times; t++) {
      if (dir === 1) {
        if (line.length > 0) line = pad + line;
      } else if (line.startsWith('\t')) {
        line = line.slice(1);
      } else {
        let strip = 0;
        while (strip < SHIFT_WIDTH && line[strip] === ' ') strip++;
        line = line.slice(strip);
      }
    }
    out[r] = line;
  }
  return out;
}

export function toggleCaseChar(ch: string): string {
  const lower = ch.toLowerCase();
  return ch === lower ? ch.toUpperCase() : lower;
}

function toggleCaseStr(s: string): string {
  let out = '';
  for (const ch of s) out += toggleCaseChar(ch);
  return out;
}

export function toggleCaseRange(lines: readonly string[], range: OpRange): string[] {
  if (range.wise === 'line') {
    const out = lines.slice() as string[];
    for (let r = range.startRow; r <= Math.min(range.endRow, lastRow(lines)); r++) {
      out[r] = toggleCaseStr(out[r] ?? '');
    }
    return out;
  }
  const { start, endEx } = clampCharRange(lines, range.start, range.endEx);
  const out = lines.slice() as string[];
  for (let r = start.row; r <= endEx.row; r++) {
    const line = out[r] ?? '';
    const from = r === start.row ? start.col : 0;
    const to = r === endEx.row ? endEx.col : line.length;
    out[r] = line.slice(0, from) + toggleCaseStr(line.slice(from, to)) + line.slice(to);
  }
  return out;
}

/** Overwrite every character in the range with `ch` (visual r). */
export function fillRange(lines: readonly string[], range: OpRange, ch: string): string[] {
  if (range.wise === 'line') {
    const out = lines.slice() as string[];
    for (let r = range.startRow; r <= Math.min(range.endRow, lastRow(lines)); r++) {
      out[r] = ch.repeat((out[r] ?? '').length);
    }
    return out;
  }
  const { start, endEx } = clampCharRange(lines, range.start, range.endEx);
  const out = lines.slice() as string[];
  for (let r = start.row; r <= endEx.row; r++) {
    const line = out[r] ?? '';
    const from = r === start.row ? start.col : 0;
    const to = r === endEx.row ? endEx.col : line.length;
    out[r] = line.slice(0, from) + ch.repeat(Math.max(0, to - from)) + line.slice(to);
  }
  return out;
}

/** Join `count` lines (vim J): at least one join; returns null when impossible. */
export function joinLines(
  lines: readonly string[],
  row: number,
  count: number
): { lines: string[]; cursor: Pos } | null {
  const joins = Math.max(1, count - 1);
  if (row >= lastRow(lines)) return null;
  let out = lines.slice() as string[];
  let col = 0;
  for (let i = 0; i < joins && row < out.length - 1; i++) {
    const base = out[row] ?? '';
    const next = out[row + 1] ?? '';
    const nextTrim = next.replace(/^[ \t]+/, '');
    let joined: string;
    if (base === '') {
      joined = nextTrim;
      col = 0;
    } else {
      col = base.replace(/\s+$/, '').length;
      if (/\s$/.test(base) || nextTrim === '') joined = base + nextTrim;
      else joined = base + ' ' + nextTrim;
      col = Math.min(col, maxNormalCol(joined));
    }
    out = spliceLines(out, row, row + 1, [joined]);
  }
  return { lines: out, cursor: { row, col } };
}

export function pasteCharwise(
  lines: readonly string[],
  pos: Pos,
  text: string,
  count: number
): { lines: string[]; cursor: Pos } {
  const repeated = count > 1 ? new Array<string>(count).fill(text).join('') : text;
  const { lines: next, end } = insertCharText(lines, pos, repeated);
  const cursor = repeated.length === 0 ? pos : clampNormal(next, { row: end.row, col: end.col - 1 });
  return { lines: next, cursor };
}

export function pasteLinewise(
  lines: readonly string[],
  row: number,
  text: string,
  count: number,
  above: boolean
): { lines: string[]; cursor: Pos } {
  const regLines = text.split('\n');
  const block: string[] = [];
  for (let i = 0; i < Math.max(1, count); i++) block.push(...regLines);
  const idx = above ? row : row + 1;
  const out = lines.slice() as string[];
  out.splice(idx, 0, ...block);
  return { lines: out, cursor: { row: idx, col: firstNonBlankCol(block[0] ?? '') } };
}
