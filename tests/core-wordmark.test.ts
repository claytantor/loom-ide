import { describe, expect, test } from 'vitest';
import {
  LOOM_ART, LOOM_ART_HEIGHT, LOOM_ART_WIDTH, pickWordmark,
} from '../src/core/wordmark.js';

describe('LOOM_ART', () => {
  test('is a rectangular block, every row exactly LOOM_ART_WIDTH cells', () => {
    expect(LOOM_ART).toHaveLength(LOOM_ART_HEIGHT);
    for (const line of LOOM_ART) expect([...line]).toHaveLength(LOOM_ART_WIDTH);
  });

  test('no row has leading or trailing whitespace (so nothing is trimmed when centered)', () => {
    // This is the alignment guarantee: Ink trims leading/trailing whitespace
    // during measurement, which is what made the old figlet art drift. The
    // block art must start and end every row with a real glyph.
    for (const line of LOOM_ART) {
      expect(line).toBe(line.trim());
      expect(line.startsWith(' ')).toBe(false);
      expect(line.endsWith(' ')).toBe(false);
    }
  });
});

describe('pickWordmark', () => {
  test('picks the big block when it fits both ways', () => {
    const c = pickWordmark(120, 40);
    expect(c.tier).toBe('big');
    expect(c.lines).toBe(LOOM_ART);
    expect(c.width).toBe(LOOM_ART_WIDTH);
  });

  test('falls back to letter-spaced small when too narrow for the block', () => {
    const c = pickWordmark(20, 40);
    expect(c.tier).toBe('small');
    expect(c.width).toBeLessThanOrEqual(20);
  });

  test('falls back to small when too short for the block', () => {
    const c = pickWordmark(120, 6);
    expect(c.tier).toBe('small');
  });

  test('plain backstop never overflows a degenerate viewport', () => {
    const c = pickWordmark(3, 1);
    expect(c.tier).toBe('plain');
    expect(c.width).toBeLessThanOrEqual(3);
  });

  test('width is always <= columns so centering can never overflow', () => {
    for (const cols of [1, 2, 5, 8, 9, 28, 29, 80]) {
      expect(pickWordmark(cols, 40).width).toBeLessThanOrEqual(cols);
    }
  });

  test('every returned tier yields equal-length lines (alignment guarantee)', () => {
    for (const [cols, rows] of [[120, 40], [20, 40], [120, 6], [3, 1]] as const) {
      const c = pickWordmark(cols, rows);
      const widths = new Set(c.lines.map((l) => [...l].length));
      expect(widths.size).toBe(1);
    }
  });

  test('tolerates zero / negative sizes without throwing', () => {
    expect(() => pickWordmark(0, 0)).not.toThrow();
    expect(() => pickWordmark(-5, -5)).not.toThrow();
    expect(pickWordmark(0, 0).tier).toBe('plain');
  });
});
