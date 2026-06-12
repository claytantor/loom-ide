import { describe, expect, test } from 'vitest';
import { FrameDecoder, encodeMessage } from '../src/services/lsp/index.js';

describe('encodeMessage', () => {
  test('produces a Content-Length header with the utf8 BYTE length', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'x', params: { s: 'héllo' } };
    const encoded = encodeMessage(msg);
    const body = JSON.stringify(msg);
    const match = /^Content-Length: (\d+)\r\n\r\n/.exec(encoded.toString('utf8'));
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(Buffer.byteLength(body, 'utf8'));
  });

  test('round-trips through FrameDecoder', () => {
    const msg = { jsonrpc: '2.0', id: 42, method: 'textDocument/hover', params: { a: [1, 2, 3], nested: { ok: true } } };
    const decoder = new FrameDecoder();
    expect(decoder.push(encodeMessage(msg))).toEqual([msg]);
    expect(decoder.errors).toBe(0);
  });
});

describe('FrameDecoder', () => {
  test('handles a message split mid-header', () => {
    const encoded = encodeMessage({ id: 1, method: 'a' });
    const decoder = new FrameDecoder();
    expect(decoder.push(encoded.subarray(0, 7))).toEqual([]); // inside 'Content-Length'
    expect(decoder.push(encoded.subarray(7))).toEqual([{ id: 1, method: 'a' }]);
  });

  test('handles a message split mid-body', () => {
    const encoded = encodeMessage({ id: 2, payload: 'abcdefgh' });
    const headerEnd = encoded.indexOf('\r\n\r\n') + 4;
    const splitAt = headerEnd + 5; // a few bytes into the body
    const decoder = new FrameDecoder();
    expect(decoder.push(encoded.subarray(0, splitAt))).toEqual([]);
    expect(decoder.push(encoded.subarray(splitAt))).toEqual([{ id: 2, payload: 'abcdefgh' }]);
  });

  test('returns three messages from a single chunk', () => {
    const msgs = [{ id: 1 }, { id: 2, method: 'b' }, { id: 3, result: null }];
    const chunk = Buffer.concat(msgs.map((m) => encodeMessage(m)));
    const decoder = new FrameDecoder();
    expect(decoder.push(chunk)).toEqual(msgs);
  });

  test('multibyte UTF-8 body: Content-Length counts bytes, not chars', () => {
    const msg = { text: '日本語テキスト' };
    const body = JSON.stringify(msg);
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(body.length); // bytes != chars
    const decoder = new FrameDecoder();
    expect(decoder.push(encodeMessage(msg))).toEqual([msg]);
  });

  test('multibyte body split in the middle of a character still decodes', () => {
    const msg = { text: '日本語' };
    const encoded = encodeMessage(msg);
    const headerLen = encoded.length - Buffer.byteLength(JSON.stringify(msg), 'utf8');
    // body is {"text":"日本語"} — byte 9 is the start of 日 (3 bytes); split inside it.
    const splitAt = headerLen + 10;
    const decoder = new FrameDecoder();
    expect(decoder.push(encoded.subarray(0, splitAt))).toEqual([]);
    expect(decoder.push(encoded.subarray(splitAt))).toEqual([msg]);
  });

  test('tolerates extra headers such as Content-Type', () => {
    const body = JSON.stringify({ ok: true });
    const raw = Buffer.from(
      `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n` +
        `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`,
      'utf8',
    );
    const decoder = new FrameDecoder();
    expect(decoder.push(raw)).toEqual([{ ok: true }]);
    expect(decoder.errors).toBe(0);
  });

  test('skips a malformed JSON frame without throwing and keeps decoding', () => {
    const bad = '{"broken": ';
    const raw = Buffer.concat([
      Buffer.from(`Content-Length: ${Buffer.byteLength(bad, 'utf8')}\r\n\r\n${bad}`, 'utf8'),
      encodeMessage({ fine: 1 }),
    ]);
    const errors: Error[] = [];
    const decoder = new FrameDecoder({ onError: (err) => errors.push(err) });
    let out: unknown[] = [];
    expect(() => {
      out = decoder.push(raw);
    }).not.toThrow();
    expect(out).toEqual([{ fine: 1 }]);
    expect(decoder.errors).toBe(1);
    expect(errors).toHaveLength(1);
  });

  test('recovers after a header block without Content-Length', () => {
    const raw = Buffer.concat([
      Buffer.from('X-Bogus: nope\r\n\r\n', 'utf8'),
      encodeMessage({ recovered: true }),
    ]);
    const decoder = new FrameDecoder();
    expect(decoder.push(raw)).toEqual([{ recovered: true }]);
    expect(decoder.errors).toBe(1);
  });

  test('accepts string chunks and interleaved partial frames across many pushes', () => {
    const msgs = [{ n: 1 }, { n: 2, s: 'ü' }];
    const all = Buffer.concat(msgs.map((m) => encodeMessage(m)));
    const decoder = new FrameDecoder();
    const out: unknown[] = [];
    for (let i = 0; i < all.length; i += 3) {
      out.push(...decoder.push(all.subarray(i, Math.min(i + 3, all.length))));
    }
    expect(out).toEqual(msgs);
    expect(decoder.errors).toBe(0);
  });
});
