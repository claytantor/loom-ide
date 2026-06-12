/* Compose an editor line into styled spans: syntax base + overlay ranges
   (visual selection, search hits, caret cell). Pure; the UI maps spans to
   Ink <Text> props. Overlays later in the list win on conflicting props. */

import type { Theme } from './theme.js';
import { SYNTAX_TOKEN } from './theme.js';
import type { Token } from './syntax.js';

export interface Span {
  text: string;
  color?: string;
  bg?: string;
  bold?: boolean;
  inverse?: boolean;
}

export interface Overlay {
  /** Column range [start, end) — end may exceed line length for line-wide styles. */
  start: number;
  end: number;
  color?: string;
  bg?: string;
  bold?: boolean;
  inverse?: boolean;
}

interface CellStyle {
  color?: string;
  bg?: string;
  bold?: boolean;
  inverse?: boolean;
}

/** Map syntax tokens to base per-column colors using the theme. */
export function baseStylesFromTokens(tokens: Token[], theme: Theme): { text: string; styles: CellStyle[] } {
  let text = '';
  const styles: CellStyle[] = [];
  for (const tok of tokens) {
    const key = SYNTAX_TOKEN[tok.t] ?? 'fg';
    const color = theme[key];
    for (let i = 0; i < tok.v.length; i++) styles.push({ color });
    text += tok.v;
  }
  return { text, styles };
}

export function composeSpans(
  text: string,
  baseStyles: CellStyle[],
  overlays: Overlay[],
): Span[] {
  const len = text.length;
  const cells: CellStyle[] = new Array<CellStyle>(len);
  for (let i = 0; i < len; i++) cells[i] = { ...(baseStyles[i] ?? {}) };
  for (const ov of overlays) {
    const s = Math.max(0, ov.start);
    const e = Math.min(len, ov.end);
    for (let i = s; i < e; i++) {
      const c = cells[i]!;
      if (ov.color !== undefined) c.color = ov.color;
      if (ov.bg !== undefined) c.bg = ov.bg;
      if (ov.bold !== undefined) c.bold = ov.bold;
      if (ov.inverse !== undefined) c.inverse = ov.inverse;
    }
  }
  const spans: Span[] = [];
  let cur: Span | null = null;
  for (let i = 0; i < len; i++) {
    const c = cells[i]!;
    const same =
      cur &&
      cur.color === c.color &&
      cur.bg === c.bg &&
      (cur.bold ?? false) === (c.bold ?? false) &&
      (cur.inverse ?? false) === (c.inverse ?? false);
    if (same && cur) {
      cur.text += text[i];
    } else {
      cur = { text: text[i]! };
      if (c.color !== undefined) cur.color = c.color;
      if (c.bg !== undefined) cur.bg = c.bg;
      if (c.bold) cur.bold = true;
      if (c.inverse) cur.inverse = true;
      spans.push(cur);
    }
  }
  return spans;
}

/** All match ranges of `pattern` (regex source) in `line`, as overlay ranges. */
export function searchRanges(line: string, pattern: string): { start: number; end: number }[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'gi');
  } catch {
    return [];
  }
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
    if (out.length > 200) break;
  }
  return out;
}
