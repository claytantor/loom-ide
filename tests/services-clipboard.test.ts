import { describe, expect, test } from 'vitest';
import { copyToClipboard, type ClipboardSink } from '../src/services/clipboard.js';
import { encodeOsc52 } from '../src/core/osc52.js';

function fakeSink(): { sink: ClipboardSink; written: string[] } {
  const written: string[] = [];
  return { sink: { write: (chunk: string) => written.push(chunk) }, written };
}

describe('copyToClipboard', () => {
  test('writes exactly the OSC 52 sequence for the text', () => {
    const { sink, written } = fakeSink();
    const ok = copyToClipboard('hello', sink);
    expect(ok).toBe(true);
    expect(written).toEqual([encodeOsc52('hello')]);
  });

  test('empty text is a no-op (writes nothing, returns false)', () => {
    const { sink, written } = fakeSink();
    const ok = copyToClipboard('', sink);
    expect(ok).toBe(false);
    expect(written).toEqual([]);
  });

  test('multi-line yank is copied in one write', () => {
    const { sink, written } = fakeSink();
    copyToClipboard('one\ntwo\nthree', sink);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(encodeOsc52('one\ntwo\nthree'));
  });

  test('a large payload never throws (terminals may cap it, that is OK)', () => {
    const { sink } = fakeSink();
    const big = 'x'.repeat(200_000);
    expect(() => copyToClipboard(big, sink)).not.toThrow();
  });
});
