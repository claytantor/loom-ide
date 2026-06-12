// Pure text/position helpers shared across the engine.

import type { Pos } from './types.js';

export function splitText(text: string): string[] {
  return text.split('\n');
}

export function joinText(lines: readonly string[]): string {
  return lines.join('\n');
}

export function lineAt(lines: readonly string[], row: number): string {
  return lines[row] ?? '';
}

export function lastRow(lines: readonly string[]): number {
  return Math.max(0, lines.length - 1);
}

/** Max cursor col for a line in normal mode (cursor sits ON a char). */
export function maxNormalCol(line: string): number {
  return Math.max(0, line.length - 1);
}

export function clampRow(lines: readonly string[], row: number): number {
  return Math.min(Math.max(0, row), lastRow(lines));
}

/** Clamp a position for normal-mode display (col on a char, or 0 on empty line). */
export function clampNormal(lines: readonly string[], pos: Pos): Pos {
  const row = clampRow(lines, pos.row);
  const col = Math.min(Math.max(0, pos.col), maxNormalCol(lineAt(lines, row)));
  return { row, col };
}

/** Clamp a position for insert mode (col may be at end of line). */
export function clampInsert(lines: readonly string[], pos: Pos): Pos {
  const row = clampRow(lines, pos.row);
  const col = Math.min(Math.max(0, pos.col), lineAt(lines, row).length);
  return { row, col };
}

export function posEq(a: Pos, b: Pos): boolean {
  return a.row === b.row && a.col === b.col;
}

export function posLt(a: Pos, b: Pos): boolean {
  return a.row < b.row || (a.row === b.row && a.col < b.col);
}

export function posMin(a: Pos, b: Pos): Pos {
  return posLt(a, b) ? a : b;
}

export function posMax(a: Pos, b: Pos): Pos {
  return posLt(a, b) ? b : a;
}

export function firstNonBlankCol(line: string): number {
  const m = /\S/.exec(line);
  return m ? m.index : 0;
}

export function leadingIndent(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

export function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

/** 0 = whitespace, 1 = word ([A-Za-z0-9_]), 2 = other punctuation. */
export type CharClass = 0 | 1 | 2;

export function charClass(ch: string | undefined): CharClass {
  if (ch === undefined || ch === '' || /\s/.test(ch)) return 0;
  if (/[A-Za-z0-9_]/.test(ch)) return 1;
  return 2;
}

/** WORD class: 0 = blank, 1 = non-blank. */
export function bigCharClass(ch: string | undefined): CharClass {
  return charClass(ch) === 0 ? 0 : 1;
}

export function linesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace rows [from..to] (inclusive) with `repl`, returning a new array. */
export function spliceLines(
  lines: readonly string[],
  from: number,
  to: number,
  repl: readonly string[]
): string[] {
  const out = lines.slice(0, from) as string[];
  out.push(...repl);
  out.push(...lines.slice(to + 1));
  return out.length > 0 ? out : [''];
}

/** Extract charwise text between start (inclusive) and endEx (exclusive col). */
export function extractCharRange(lines: readonly string[], start: Pos, endEx: Pos): string {
  if (start.row === endEx.row) {
    return lineAt(lines, start.row).slice(start.col, endEx.col);
  }
  const parts: string[] = [lineAt(lines, start.row).slice(start.col)];
  for (let r = start.row + 1; r < endEx.row; r++) parts.push(lineAt(lines, r));
  parts.push(lineAt(lines, endEx.row).slice(0, endEx.col));
  return parts.join('\n');
}

/** Delete charwise range [start, endEx); returns new lines. */
export function deleteCharRange(lines: readonly string[], start: Pos, endEx: Pos): string[] {
  const head = lineAt(lines, start.row).slice(0, start.col);
  const tail = lineAt(lines, endEx.row).slice(endEx.col);
  return spliceLines(lines, start.row, endEx.row, [head + tail]);
}

/** Insert charwise text (may contain \n) at pos; returns new lines and end position (after last char). */
export function insertCharText(
  lines: readonly string[],
  pos: Pos,
  text: string
): { lines: string[]; end: Pos } {
  const line = lineAt(lines, pos.row);
  const head = line.slice(0, pos.col);
  const tail = line.slice(pos.col);
  const parts = text.split('\n');
  if (parts.length === 1) {
    const next = spliceLines(lines, pos.row, pos.row, [head + text + tail]);
    return { lines: next, end: { row: pos.row, col: pos.col + text.length } };
  }
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  const mid = parts.slice(1, -1);
  const repl = [head + first, ...mid, last + tail];
  const next = spliceLines(lines, pos.row, pos.row, repl);
  return { lines: next, end: { row: pos.row + parts.length - 1, col: last.length } };
}
