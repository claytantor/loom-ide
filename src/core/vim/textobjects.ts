// Text objects: iw aw iW aW, quote pairs, bracket pairs, paragraphs.

import type { ObjectRange, Pos } from './types.js';
import {
  bigCharClass,
  charClass,
  isBlankLine,
  lastRow,
  lineAt,
  type CharClass,
} from './text.js';

const BRACKETS: Readonly<Record<string, readonly [string, string]>> = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  b: ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
  B: ['{', '}'],
};

const QUOTES = new Set(['"', "'", '`']);

function isObjSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

function wordObject(
  lines: readonly string[],
  cursor: Pos,
  around: boolean,
  cls: (ch: string | undefined) => CharClass
): ObjectRange | null {
  const line = lineAt(lines, cursor.row);
  if (line.length === 0) {
    return { wise: 'char', start: { ...cursor, col: 0 }, endEx: { ...cursor, col: 0 }, empty: true };
  }
  const col = Math.min(cursor.col, line.length - 1);
  const c0 = cls(line[col]);
  let s = col;
  let e = col;
  while (s > 0 && cls(line[s - 1]) === c0) s--;
  while (e + 1 < line.length && cls(line[e + 1]) === c0) e++;
  if (around) {
    if (c0 === 0) {
      // aw on whitespace: whitespace + following word run
      if (e + 1 < line.length) {
        const wc = cls(line[e + 1]);
        e++;
        while (e + 1 < line.length && cls(line[e + 1]) === wc) e++;
      }
    } else {
      let extended = false;
      while (e + 1 < line.length && cls(line[e + 1]) === 0) {
        e++;
        extended = true;
      }
      if (!extended) {
        while (s > 0 && cls(line[s - 1]) === 0) s--;
      }
    }
  }
  return { wise: 'char', start: { row: cursor.row, col: s }, endEx: { row: cursor.row, col: e + 1 } };
}

/** Unescaped quote positions on a line. */
function quoteCols(line: string, q: string): number[] {
  const cols: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === q && (i === 0 || line[i - 1] !== '\\')) cols.push(i);
  }
  return cols;
}

function quoteObject(
  lines: readonly string[],
  cursor: Pos,
  around: boolean,
  q: string
): ObjectRange | null {
  const line = lineAt(lines, cursor.row);
  const cols = quoteCols(line, q);
  let open = -1;
  let close = -1;
  for (let i = 0; i + 1 < cols.length; i += 2) {
    const o = cols[i] as number;
    const c = cols[i + 1] as number;
    if (cursor.col <= c || cursor.col < o) {
      open = o;
      close = c;
      break;
    }
  }
  if (open < 0) return null;
  if (!around) {
    return {
      wise: 'char',
      start: { row: cursor.row, col: open + 1 },
      endEx: { row: cursor.row, col: close },
      empty: close === open + 1,
    };
  }
  let s = open;
  let e = close + 1;
  let extended = false;
  while (e < line.length && isObjSpace(line[e])) {
    e++;
    extended = true;
  }
  if (!extended) {
    while (s > 0 && isObjSpace(line[s - 1])) s--;
  }
  return { wise: 'char', start: { row: cursor.row, col: s }, endEx: { row: cursor.row, col: e } };
}

/** Find the unmatched `open` at or before `from`, scanning backward with nesting. */
function scanBack(lines: readonly string[], from: Pos, open: string, close: string): Pos | null {
  let depth = 0;
  for (let row = from.row; row >= 0; row--) {
    const line = lineAt(lines, row);
    const startCol = row === from.row ? Math.min(from.col, Math.max(0, line.length - 1)) : line.length - 1;
    for (let col = startCol; col >= 0; col--) {
      const ch = line[col];
      if (ch === close && !(row === from.row && col === from.col)) depth++;
      else if (ch === open) {
        if (depth === 0) return { row, col };
        depth--;
      }
    }
  }
  return null;
}

/** Find the unmatched `close` at or after `from`, scanning forward with nesting. */
function scanFwd(lines: readonly string[], from: Pos, open: string, close: string): Pos | null {
  let depth = 0;
  const last = lastRow(lines);
  for (let row = from.row; row <= last; row++) {
    const line = lineAt(lines, row);
    const startCol = row === from.row ? from.col : 0;
    for (let col = startCol; col < line.length; col++) {
      const ch = line[col];
      if (ch === open) depth++;
      else if (ch === close) {
        if (depth === 0) return { row, col };
        depth--;
      }
    }
  }
  return null;
}

function bracketObject(
  lines: readonly string[],
  cursor: Pos,
  around: boolean,
  pair: readonly [string, string]
): ObjectRange | null {
  const [open, close] = pair;
  const line = lineAt(lines, cursor.row);
  const at = line[cursor.col];
  let openPos: Pos | null;
  if (at === open) {
    openPos = cursor;
  } else if (at === close) {
    openPos = scanBack(lines, cursor, open, close);
  } else {
    openPos = scanBack(lines, cursor, open, close);
  }
  if (!openPos) return null;
  const afterOpen: Pos =
    openPos.col + 1 <= lineAt(lines, openPos.row).length
      ? { row: openPos.row, col: openPos.col + 1 }
      : { row: openPos.row + 1, col: 0 };
  const closePos = scanFwd(lines, afterOpen, open, close);
  if (!closePos) return null;
  if (around) {
    return {
      wise: 'char',
      start: openPos,
      endEx: { row: closePos.row, col: closePos.col + 1 },
    };
  }
  const openAtEol = openPos.col === lineAt(lines, openPos.row).length - 1;
  const closeAtBol = closePos.col === 0;
  if (openAtEol && closeAtBol && closePos.row > openPos.row) {
    if (closePos.row === openPos.row + 1) {
      const p = { row: openPos.row, col: openPos.col + 1 };
      return { wise: 'char', start: p, endEx: p, empty: true };
    }
    // Pretty-printed block: inner content is whole lines between the brackets.
    return { wise: 'line', startRow: openPos.row + 1, endRow: closePos.row - 1 };
  }
  const start = { row: openPos.row, col: openPos.col + 1 };
  const endEx = { row: closePos.row, col: closePos.col };
  const empty = start.row === endEx.row && start.col >= endEx.col;
  return { wise: 'char', start, endEx, empty };
}

function paragraphObject(lines: readonly string[], cursor: Pos, around: boolean): ObjectRange {
  const last = lastRow(lines);
  const onBlank = isBlankLine(lineAt(lines, cursor.row));
  let s = cursor.row;
  let e = cursor.row;
  const sameKind = (r: number): boolean => isBlankLine(lineAt(lines, r)) === onBlank;
  while (s > 0 && sameKind(s - 1)) s--;
  while (e < last && sameKind(e + 1)) e++;
  if (around) {
    if (onBlank) {
      // blanks + following paragraph
      while (e < last && !isBlankLine(lineAt(lines, e + 1))) e++;
    } else {
      let extended = false;
      while (e < last && isBlankLine(lineAt(lines, e + 1))) {
        e++;
        extended = true;
      }
      if (!extended) {
        while (s > 0 && isBlankLine(lineAt(lines, s - 1))) s--;
      }
    }
  }
  return { wise: 'line', startRow: s, endRow: e };
}

/**
 * Resolve a text object. `kind` is 'i' or 'a'; `obj` is the object char
 * (w W " ' ` ( ) b [ ] { } B p). Returns null when no object is found.
 */
export function resolveTextObject(
  lines: readonly string[],
  cursor: Pos,
  kind: 'i' | 'a',
  obj: string
): ObjectRange | null {
  const around = kind === 'a';
  if (obj === 'w') return wordObject(lines, cursor, around, charClass);
  if (obj === 'W') return wordObject(lines, cursor, around, bigCharClass);
  if (QUOTES.has(obj)) return quoteObject(lines, cursor, around, obj);
  if (obj === 'p') return paragraphObject(lines, cursor, around);
  const pair = BRACKETS[obj];
  if (pair) return bracketObject(lines, cursor, around, pair);
  return null;
}

export function isTextObjectChar(obj: string): boolean {
  return obj === 'w' || obj === 'W' || obj === 'p' || QUOTES.has(obj) || BRACKETS[obj] !== undefined;
}

const OPEN_SET = '([{';
const CLOSE_SET = ')]}';

/** `%`: jump from the first bracket at/after the cursor to its match. */
export function matchBracket(lines: readonly string[], pos: Pos): Pos | null {
  const line = lineAt(lines, pos.row);
  for (let c = pos.col; c < line.length; c++) {
    const ch = line[c] as string;
    const oi = OPEN_SET.indexOf(ch);
    if (oi >= 0) {
      return scanFwd(lines, { row: pos.row, col: c + 1 }, OPEN_SET[oi] as string, CLOSE_SET[oi] as string);
    }
    const ci = CLOSE_SET.indexOf(ch);
    if (ci >= 0) {
      return scanBack(lines, { row: pos.row, col: c }, OPEN_SET[ci] as string, CLOSE_SET[ci] as string);
    }
  }
  return null;
}
