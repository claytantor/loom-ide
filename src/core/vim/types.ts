// Core types for the Loom vim engine. Pure data — no Node, no Ink.

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'replace';

export interface Pos {
  row: number;
  col: number;
}

/** Register contents. `linewise` registers paste as whole lines. */
export interface Register {
  readonly text: string;
  readonly linewise: boolean;
}

/** Snapshot for one undo unit. `dirty` is the flag value at snapshot time. */
export interface UndoEntry {
  readonly lines: readonly string[];
  readonly cursor: Pos;
  readonly dirty: boolean;
}

/** Last f/F/t/T for ; and , repeats. */
export interface LastFind {
  readonly cmd: 'f' | 'F' | 't' | 'T';
  readonly char: string;
}

/** Replayable description of the last change for `.` */
export interface LastChange {
  /** Tokens of the change with any count digits stripped (register prefix kept). */
  readonly tokens: readonly string[];
  /** Combined count in effect when recorded (null = none given). */
  readonly count: number | null;
}

/** One undoable step inside an active Replace-mode (R) session. */
export type ReplaceStep =
  | { readonly kind: 'replaced'; readonly ch: string }
  | { readonly kind: 'appended' }
  | { readonly kind: 'split'; readonly indent: number };

/** Bookkeeping for an in-progress insert/replace session. */
export interface InsertSession {
  /** Tokens that started the session ('i', 'o', ['c','w'], …) or null when not dot-recordable (visual c). */
  readonly prefix: readonly string[] | null;
  /** Count given before the entry command (kept for dot replay fidelity; not multiplied). */
  readonly count: number | null;
  /** Every token typed during the session, in order. */
  readonly typed: readonly string[];
  /** Replace-mode restore stack. */
  readonly replaceSteps: readonly ReplaceStep[];
}

export interface VimState {
  readonly lines: readonly string[];
  readonly cursor: Pos;
  readonly mode: VimMode;
  readonly visualStart: Pos | null;
  readonly dirty: boolean;
  readonly message: string | null;
  readonly searchPattern: string | null;
  readonly searchHighlight: boolean;
  readonly pendingKeys: string;
  // ── internal fields (allowed by the public contract) ──
  readonly desiredCol: number | null;
  readonly registers: Readonly<Record<string, Register>>;
  readonly marks: Readonly<Record<string, Pos>>;
  readonly lastJump: Pos | null;
  readonly undoStack: readonly UndoEntry[];
  readonly redoStack: readonly UndoEntry[];
  /** Pre-change snapshot for the in-progress insert/replace session. */
  readonly pendingUndo: UndoEntry | null;
  readonly insertSession: InsertSession | null;
  readonly lastFind: LastFind | null;
  readonly searchDirection: 1 | -1;
  readonly lastChange: LastChange | null;
}

export interface VimEffects {
  save?: boolean;
  quit?: boolean;
  forced?: boolean;
  message?: string | null;
}

export interface KeyContext {
  viewportRows?: number;
}

/** Wise-ness of a motion when used with an operator. */
export type Wise = 'char' | 'line';

/** Result of resolving a motion. */
export interface MotionResult {
  readonly pos: Pos;
  readonly wise: Wise;
  /** Charwise only: include the character under `pos` in operator ranges. */
  readonly inclusive: boolean;
  /** Desired-column handling: explicit value, end-of-line stickiness, or keep current. */
  readonly desired: number | 'eol' | 'keep';
  /** True for motions that should record the jump point (gg G { } searches marks). */
  readonly jump: boolean;
}

/** Resolved text-object range. Charwise ranges use an exclusive end position. */
export type ObjectRange =
  | { readonly wise: 'char'; readonly start: Pos; readonly endEx: Pos; readonly empty?: boolean }
  | { readonly wise: 'line'; readonly startRow: number; readonly endRow: number };

export const SHIFT_WIDTH = 2;
export const UNDO_CAP = 200;
export const EOL_DESIRED = Number.MAX_SAFE_INTEGER;
