// Motion resolution: pure functions from (buffer, position, count) to a target.

import type { LastFind, Pos } from './types.js';
import { EOL_DESIRED } from './types.js';
import {
  bigCharClass,
  charClass,
  firstNonBlankCol,
  isBlankLine,
  lastRow,
  lineAt,
  maxNormalCol,
  type CharClass,
} from './text.js';

export interface MotionEnv {
  readonly lines: readonly string[];
  readonly cursor: Pos;
  readonly count: number;
  readonly desiredCol: number | null;
  readonly lastFind: LastFind | null;
  readonly viewportRows: number;
  /** When true the motion is the target of an operator (changes clamping + w rule). */
  readonly forOperator: boolean;
  /** True when an explicit count was typed (1G goes to line 1, plain G to last line). */
  readonly countGiven?: boolean;
}

export interface MotionOutcome {
  readonly pos: Pos;
  readonly wise: 'char' | 'line';
  readonly inclusive: boolean;
  readonly desired: number | 'eol' | 'keep';
  readonly jump: boolean;
  readonly failed: boolean;
  readonly newLastFind?: LastFind;
}

function ok(pos: Pos, opts?: Partial<Omit<MotionOutcome, 'pos' | 'failed'>>): MotionOutcome {
  return {
    pos,
    wise: opts?.wise ?? 'char',
    inclusive: opts?.inclusive ?? false,
    desired: opts?.desired ?? pos.col,
    jump: opts?.jump ?? false,
    failed: false,
    ...(opts?.newLastFind ? { newLastFind: opts.newLastFind } : {}),
  };
}

function fail(cursor: Pos): MotionOutcome {
  return { pos: cursor, wise: 'char', inclusive: false, desired: 'keep', jump: false, failed: true };
}

type Classifier = (ch: string | undefined) => CharClass;

/** Next word start (w/W). Raw col may equal line length at buffer end. */
function nextWordStart(lines: readonly string[], pos: Pos, cls: Classifier): Pos {
  const last = lastRow(lines);
  let { row, col } = pos;
  let line = lineAt(lines, row);
  const startCls = cls(line[col]);
  if (startCls !== 0) {
    while (col < line.length && cls(line[col]) === startCls) col++;
  }
  for (;;) {
    if (col >= line.length) {
      if (row >= last) return { row: last, col: lineAt(lines, last).length };
      row++;
      col = 0;
      line = lineAt(lines, row);
      if (line.length === 0) return { row, col: 0 }; // empty line is a word stop
      continue;
    }
    if (cls(line[col]) === 0) {
      col++;
      continue;
    }
    return { row, col };
  }
}

/** Previous word start (b/B). */
function prevWordStart(lines: readonly string[], pos: Pos, cls: Classifier): Pos | null {
  let { row, col } = pos;
  const stepBack = (): boolean => {
    if (col > 0) {
      col--;
      return true;
    }
    if (row === 0) return false;
    row--;
    col = Math.max(0, lineAt(lines, row).length - 1);
    return true;
  };
  if (!stepBack()) return null;
  // skip whitespace backward; empty lines are stops
  for (;;) {
    const line = lineAt(lines, row);
    if (line.length === 0) return { row, col: 0 };
    if (cls(line[col]) !== 0) break;
    if (!stepBack()) return { row: 0, col: 0 };
  }
  const line = lineAt(lines, row);
  const c0 = cls(line[col]);
  while (col > 0 && cls(line[col - 1]) === c0) col--;
  return { row, col };
}

/** End of word (e/E); skips empty lines. Returns null when it cannot advance. */
function wordEnd(lines: readonly string[], pos: Pos, cls: Classifier): Pos | null {
  const last = lastRow(lines);
  let { row, col } = pos;
  const stepFwd = (): boolean => {
    const line = lineAt(lines, row);
    if (col + 1 < line.length) {
      col++;
      return true;
    }
    let r = row + 1;
    while (r <= last && lineAt(lines, r).length === 0) r++;
    if (r > last) return false;
    row = r;
    col = 0;
    return true;
  };
  if (!stepFwd()) return null;
  for (;;) {
    const line = lineAt(lines, row);
    if (cls(line[col]) !== 0) break;
    if (!stepFwd()) return null;
  }
  const line = lineAt(lines, row);
  const c0 = cls(line[col]);
  while (col + 1 < line.length && cls(line[col + 1]) === c0) col++;
  return { row, col };
}

export function findCharCol(
  line: string,
  col: number,
  cmd: 'f' | 'F' | 't' | 'T',
  ch: string,
  count: number,
  isRepeat: boolean
): number | null {
  if (cmd === 'f' || cmd === 't') {
    let i = cmd === 't' && isRepeat ? col + 1 : col;
    for (let k = 0; k < count; k++) {
      i = line.indexOf(ch, i + 1);
      if (i < 0) return null;
    }
    return cmd === 'f' ? i : i - 1;
  }
  let i = cmd === 'T' && isRepeat ? col - 1 : col;
  for (let k = 0; k < count; k++) {
    if (i <= 0) return null;
    i = line.lastIndexOf(ch, i - 1);
    if (i < 0) return null;
  }
  return cmd === 'F' ? i : i + 1;
}

function paragraphForward(lines: readonly string[], row: number): number {
  const last = lastRow(lines);
  let r = row;
  while (r <= last && isBlankLine(lineAt(lines, r))) r++;
  while (r <= last && !isBlankLine(lineAt(lines, r))) r++;
  return Math.min(r, last);
}

function paragraphBackward(lines: readonly string[], row: number): number {
  let r = row;
  while (r >= 0 && isBlankLine(lineAt(lines, r))) r--;
  while (r >= 0 && !isBlankLine(lineAt(lines, r))) r--;
  return Math.max(r, 0);
}

function verticalDesired(env: MotionEnv): number {
  const d = env.desiredCol;
  return d === null ? env.cursor.col : d;
}

function verticalTo(env: MotionEnv, row: number): MotionOutcome {
  const r = Math.min(Math.max(0, row), lastRow(env.lines));
  const want = verticalDesired(env);
  const col = Math.min(want, maxNormalCol(lineAt(env.lines, r)));
  return ok({ row: r, col }, { wise: 'line', desired: want === EOL_DESIRED ? 'eol' : want });
}

/**
 * Resolve a motion. `motion` is one of:
 * h l j k 0 ^ $ w b e W B E gg G { } f F t T ; , C-d C-u
 * `arg` is the target char for f/F/t/T.
 */
export function runMotion(motion: string, arg: string | null, env: MotionEnv): MotionOutcome {
  const { lines, cursor, count, forOperator } = env;
  const line = lineAt(lines, cursor.row);
  const last = lastRow(lines);

  switch (motion) {
    case 'h': {
      const col = Math.max(0, cursor.col - count);
      if (col === cursor.col) return fail(cursor);
      return ok({ row: cursor.row, col });
    }
    case 'l': {
      const limit = forOperator ? line.length : maxNormalCol(line);
      const col = Math.min(cursor.col + count, limit);
      if (col === cursor.col) return fail(cursor);
      return ok({ row: cursor.row, col });
    }
    case 'j':
      return cursor.row >= last ? fail(cursor) : verticalTo(env, cursor.row + count);
    case 'k':
      return cursor.row <= 0 ? fail(cursor) : verticalTo(env, cursor.row - count);
    case 'C-d': {
      const half = Math.max(1, Math.floor(env.viewportRows / 2));
      return verticalTo(env, cursor.row + half * count);
    }
    case 'C-u': {
      const half = Math.max(1, Math.floor(env.viewportRows / 2));
      return verticalTo(env, cursor.row - half * count);
    }
    case '0':
      return ok({ row: cursor.row, col: 0 });
    case '^':
      return ok({ row: cursor.row, col: firstNonBlankCol(line) });
    case '$': {
      const row = Math.min(cursor.row + count - 1, last);
      const target = lineAt(lines, row);
      return ok(
        { row, col: maxNormalCol(target) },
        { inclusive: true, desired: 'eol' }
      );
    }
    case 'gg':
    case 'G': {
      const row =
        count > 1 || env.countGiven === true
          ? Math.min(count - 1, last)
          : motion === 'gg'
            ? 0
            : last;
      return ok({ row, col: firstNonBlankCol(lineAt(lines, row)) }, { wise: 'line', jump: true });
    }
    case 'w':
    case 'W': {
      const cls = motion === 'W' ? bigCharClass : charClass;
      let p: Pos = cursor;
      for (let i = 0; i < count - 1; i++) p = nextWordStart(lines, p, cls);
      const q = nextWordStart(lines, p, cls);
      if (q.row === cursor.row && q.col === cursor.col) return fail(cursor);
      if (forOperator && q.row > p.row && lineAt(lines, p.row).length > 0) {
        // Operator special case: w never crosses the line break out of the
        // line where the last word ended (dw at EOL stops at end of line).
        return ok({ row: p.row, col: lineAt(lines, p.row).length });
      }
      return ok(q);
    }
    case 'b':
    case 'B': {
      const cls = motion === 'B' ? bigCharClass : charClass;
      let p: Pos | null = cursor;
      for (let i = 0; i < count && p; i++) p = prevWordStart(lines, p, cls);
      if (!p) return fail(cursor);
      return ok(p, { jump: false });
    }
    case 'e':
    case 'E': {
      const cls = motion === 'E' ? bigCharClass : charClass;
      let p: Pos | null = cursor;
      for (let i = 0; i < count && p; i++) p = wordEnd(lines, p, cls);
      if (!p) return fail(cursor);
      return ok(p, { inclusive: true });
    }
    case '{': {
      let r = cursor.row;
      for (let i = 0; i < count; i++) r = paragraphBackward(lines, r);
      return ok({ row: r, col: 0 }, { wise: forOperator ? 'line' : 'char', jump: true, desired: 0 });
    }
    case '}': {
      let r = cursor.row;
      for (let i = 0; i < count; i++) r = paragraphForward(lines, r);
      const col = isBlankLine(lineAt(lines, r)) ? 0 : maxNormalCol(lineAt(lines, r));
      return ok({ row: r, col }, { wise: forOperator ? 'line' : 'char', jump: true, desired: col });
    }
    case 'f':
    case 'F':
    case 't':
    case 'T': {
      if (arg === null) return fail(cursor);
      const col = findCharCol(line, cursor.col, motion, arg, count, false);
      if (col === null || col < 0) return fail(cursor);
      return ok(
        { row: cursor.row, col },
        { inclusive: motion === 'f' || motion === 't', newLastFind: { cmd: motion, char: arg } }
      );
    }
    case ';':
    case ',': {
      const lf = env.lastFind;
      if (!lf) return fail(cursor);
      let cmd = lf.cmd;
      if (motion === ',') {
        cmd = cmd === 'f' ? 'F' : cmd === 'F' ? 'f' : cmd === 't' ? 'T' : 't';
      }
      const col = findCharCol(line, cursor.col, cmd, lf.char, count, true);
      if (col === null || col < 0) return fail(cursor);
      return ok({ row: cursor.row, col }, { inclusive: cmd === 'f' || cmd === 't' });
    }
    default:
      return fail(cursor);
  }
}
