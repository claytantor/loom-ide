import { describe, expect, test } from 'vitest';
import { base64Utf8, encodeOsc52 } from '../src/core/osc52.js';

const ESC = '\x1b';
const BEL = '\x07';

describe('base64Utf8', () => {
  test('encodes ASCII', () => {
    expect(base64Utf8('hello')).toBe('aGVsbG8=');
  });

  test('encodes empty string to empty', () => {
    expect(base64Utf8('')).toBe('');
  });

  test('encodes multi-byte UTF-8 (not Latin-1)', () => {
    // "é" is 0xC3 0xA9 in UTF-8 → "w6k="
    expect(base64Utf8('é')).toBe('w6k=');
    // round-trips through Buffer
    expect(Buffer.from(base64Utf8('café'), 'base64').toString('utf8')).toBe('café');
  });

  test('encodes newlines and tabs verbatim', () => {
    expect(Buffer.from(base64Utf8('a\nb\tc'), 'base64').toString('utf8')).toBe('a\nb\tc');
  });
});

describe('encodeOsc52', () => {
  test('wraps base64 payload in ESC ] 52 ; c ; … BEL', () => {
    expect(encodeOsc52('hello')).toBe(`${ESC}]52;c;aGVsbG8=${BEL}`);
  });

  test('targets the clipboard selection (c), never primary', () => {
    expect(encodeOsc52('x')).toContain(';c;');
    expect(encodeOsc52('x').startsWith(`${ESC}]52;c;`)).toBe(true);
    expect(encodeOsc52('x').endsWith(BEL)).toBe(true);
  });

  test('empty text yields a well-formed empty-payload sequence (no crash)', () => {
    expect(encodeOsc52('')).toBe(`${ESC}]52;c;${BEL}`);
  });

  test('multi-line yank round-trips through the payload', () => {
    const seq = encodeOsc52('one\ntwo');
    const payload = seq.slice(`${ESC}]52;c;`.length, -1);
    expect(Buffer.from(payload, 'base64').toString('utf8')).toBe('one\ntwo');
  });
});
