import { describe, expect, test } from 'vitest';
import { basename, blendHex, clamp, endTruncate, midTruncate, parentPath } from '../src/core/text.js';

describe('basename/parentPath', () => {
  test('basename returns last segment', () => {
    expect(basename('src/server/index.ts')).toBe('index.ts');
    expect(basename('index.ts')).toBe('index.ts');
  });
  test('parentPath strips last segment', () => {
    expect(parentPath('src/server/index.ts')).toBe('src/server');
    expect(parentPath('index.ts')).toBe('');
  });
});

describe('midTruncate', () => {
  test('returns unchanged when within max', () => {
    expect(midTruncate('short.ts', 20)).toBe('short.ts');
  });
  test('truncates in the middle keeping the tail', () => {
    const out = midTruncate('src/server/handlers/index.ts', 16);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out).toContain('…');
    expect(out.endsWith('index.ts') || out.endsWith('ndex.ts') || out.endsWith('ex.ts')).toBe(true);
  });
});

describe('endTruncate', () => {
  test('cuts with ellipsis', () => {
    expect(endTruncate('abcdefgh', 5)).toBe('abcd…');
    expect(endTruncate('abc', 5)).toBe('abc');
  });
});

describe('clamp', () => {
  test('bounds values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('blendHex', () => {
  test('alpha 0 yields bg, alpha 1 yields fg', () => {
    expect(blendHex('#ffffff', '#000000', 0)).toBe('#000000');
    expect(blendHex('#ffffff', '#000000', 1)).toBe('#ffffff');
  });
  test('blends the spec selection tint', () => {
    const out = blendHex('#22D3EE', '#0B0E14', 0.12);
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(out).not.toBe('#0b0e14');
  });
});
