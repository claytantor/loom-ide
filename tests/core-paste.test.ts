import { describe, expect, test } from 'vitest';
import { extractPaste, hasPasteMarker, stripPasteMarkers } from '../src/core/paste.js';

const ESC = '\x1b';
const START = `${ESC}[200~`;
const END = `${ESC}[201~`;
// Ink strips a single leading ESC, so the start marker often arrives ESC-less.
const START_NO_ESC = '[200~';

describe('hasPasteMarker', () => {
  test('detects the ESC-prefixed start marker', () => {
    expect(hasPasteMarker(`${START}hi${END}`)).toBe(true);
  });

  test('detects the ESC-stripped start marker (Ink form)', () => {
    expect(hasPasteMarker(`${START_NO_ESC}hi${END}`)).toBe(true);
  });

  test('detects a lone end marker (paste split across events)', () => {
    expect(hasPasteMarker(`more text${END}`)).toBe(true);
  });

  test('is false for ordinary typed input', () => {
    expect(hasPasteMarker('hello')).toBe(false);
    expect(hasPasteMarker(':w')).toBe(false);
  });
});

describe('stripPasteMarkers', () => {
  test('removes both markers, keeps the payload', () => {
    expect(stripPasteMarkers(`${START}hello world${END}`)).toBe('hello world');
  });

  test('removes the ESC-stripped start form (Ink delivery)', () => {
    expect(stripPasteMarkers(`${START_NO_ESC}abc${END}`)).toBe('abc');
  });

  test('preserves newlines and inner content exactly', () => {
    expect(stripPasteMarkers(`${START}line1\nline2${END}`)).toBe('line1\nline2');
  });

  test('strips stray markers anywhere — they must never reach the buffer', () => {
    expect(stripPasteMarkers(`a${START}b${END}c`)).toBe('abc');
    expect(stripPasteMarkers(START)).toBe('');
    expect(stripPasteMarkers(END)).toBe('');
  });

  test('no-op when there is nothing to strip', () => {
    expect(stripPasteMarkers('plain')).toBe('plain');
  });
});

describe('extractPaste', () => {
  test('returns the literal payload with markers removed', () => {
    expect(extractPaste(`${START_NO_ESC}const x = 1;${END}`)).toBe('const x = 1;');
  });

  test('handles a payload that itself contains bracket-like text', () => {
    expect(extractPaste(`${START}arr[200] = 1${END}`)).toBe('arr[200] = 1');
  });
});
