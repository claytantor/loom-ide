/* The "loom" word art + responsive tier selection. Pure — no Ink, no Node, no
   timers. Rendered statically on the landing/empty main pane (src/ui/OutputViews
   EmptyMain). A side-effect-free function of (columns, rows) so it unit-tests
   without a terminal. */

/**
 * The "loom" wordmark drawn on a fixed 5-row grid with full-block glyphs
 * (`█ ▄ ▀`). 5 rows tall, 18 columns wide.
 *
 * Why block glyphs instead of a figlet `_ | / \` block: those rely on a leading
 * space on the top row and trailing spaces on most rows to hold the rectangle.
 * Ink/Yoga trims leading and trailing whitespace when it measures a <Text>, so
 * those padding spaces vanish and the rows center to different left offsets —
 * the art visibly "does not line up." (Confirmed: the old top row ` _` measured
 * 2 cells while `|_|\___...` measured 25, so they were centered independently.)
 *
 * This grid is bulletproof against that:
 *  - Every row is exactly {@link LOOM_ART_WIDTH} cells.
 *  - No row has any LEADING or TRAILING whitespace — the first and last cell of
 *    every row is a real glyph (`█` / `▄` / `▀`), so nothing can be trimmed and
 *    all rows keep identical width through measurement and centering.
 *  - All glyphs are reliably single-cell-width in a monospace terminal.
 *  - Centering is done once for the whole block (see EmptyMain), never per line.
 */
export const LOOM_ART: readonly string[] = [
  '█  ▄██▄ ▄██▄ █▄ ▄█',
  '█  █  █ █  █ █ █ █',
  '█  █  █ █  █ █ █ █',
  '█  █  █ █  █ █   █',
  '█▄ ▀██▀ ▀██▀ █   █',
];

/** Width of the word art in columns (every line is exactly this many cells). */
export const LOOM_ART_WIDTH = 18;
/** Height of the word art in rows. */
export const LOOM_ART_HEIGHT: number = LOOM_ART.length;

/** Letter-spaced medium wordmark, used when the big art won't fit. */
export const SMALL_WORDMARK = 'l o o m';
/** Plain fallback wordmark — the always-safe backstop. */
export const PLAIN_WORDMARK = 'loom';

/** Horizontal breathing room kept on each side of the big art. */
const HMARGIN = 2;
/** Rows the landing pane needs around the art (hint + status lines + slack). */
const VBUDGET = 4;

export type WordmarkTier = 'big' | 'small' | 'plain';

export interface WordmarkChoice {
  tier: WordmarkTier;
  /** Lines to render (1 line for small/plain, LOOM_ART for big). Every line in
   * the returned array is the same number of cells with no leading/trailing
   * whitespace, so the rows always line up once the block is centered. */
  lines: readonly string[];
  /** Widest rendered line, in columns — guaranteed <= columns. */
  width: number;
}

/**
 * Pick the largest wordmark tier that fits the available pane.
 *  - `big`   — the 18x5 block. Needs both width (`cols >= 18 + 4 = 22`) and
 *              height (`rows >= 5 + 4 = 9`).
 *  - `small` — letter-spaced `l o o m` (7 cols), when `cols >= 9`.
 *  - `plain` — bare `loom`, truncated to width as an absolute backstop.
 * The returned `width` is always <= `columns` so callers can center safely.
 */
export function pickWordmark(columns: number, rows: number): WordmarkChoice {
  const cols = Math.max(1, Math.floor(columns));
  const rws = Math.max(1, Math.floor(rows));

  if (cols >= LOOM_ART_WIDTH + HMARGIN * 2 && rws >= LOOM_ART_HEIGHT + VBUDGET) {
    return { tier: 'big', lines: LOOM_ART, width: LOOM_ART_WIDTH };
  }
  if (cols >= SMALL_WORDMARK.length + 2) {
    return { tier: 'small', lines: [SMALL_WORDMARK], width: SMALL_WORDMARK.length };
  }
  const plain = PLAIN_WORDMARK.slice(0, cols);
  return { tier: 'plain', lines: [plain], width: plain.length };
}
