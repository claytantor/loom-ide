/* Pure string/color helpers. No Node, no Ink. */

export function basename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

export function parentPath(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** Truncate in the middle so the basename tail stays visible: `src/…/index.ts`. */
export function midTruncate(p: string, max: number, ellipsis = '…'): string {
  if (max <= 0 || p.length <= max) return p;
  const keep = Math.max(6, max - ellipsis.length);
  const head = Math.ceil(keep * 0.4);
  const tail = keep - head;
  return p.slice(0, head) + ellipsis + p.slice(p.length - tail);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Right-truncate to width, appending ellipsis when cut. */
export function endTruncate(s: string, max: number, ellipsis = '…'): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  if (max <= ellipsis.length) return ellipsis.slice(0, max);
  return s.slice(0, max - ellipsis.length) + ellipsis;
}

interface Rgb { r: number; g: number; b: number }

function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || m[1] === undefined) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const h = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Terminals have no alpha; pre-blend `fg` over `bg` at `alpha` into an opaque hex.
 * Used to realize the spec's rgba selection tint as a paintable cell background.
 */
export function blendHex(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!f || !b) return bg;
  const a = clamp(alpha, 0, 1);
  return rgbToHex({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
  });
}
