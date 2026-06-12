/**
 * LSP base-protocol framing: `Content-Length: N\r\n\r\n{json}`.
 *
 * Pure byte-level encode/decode with no I/O, so it can be unit-tested with
 * plain Buffers and reused over any transport.
 */

const HEADER_TERMINATOR = '\r\n\r\n';

/** Encode a JSON-RPC message into a framed Buffer. Content-Length is BYTES (utf8), not chars. */
export function encodeMessage(msg: object): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}${HEADER_TERMINATOR}`, 'utf8');
  return Buffer.concat([header, body]);
}

export interface FrameDecoderOptions {
  /** Invoked when a frame is skipped (bad header or malformed JSON body). Never throws upstream. */
  onError?: (error: Error, rawBody?: string) => void;
}

/**
 * Incremental decoder for the LSP base protocol.
 *
 * Feed it arbitrary chunk boundaries via push(); it returns every complete
 * message it can parse and buffers the rest. Handles:
 * - headers split across chunks
 * - bodies split across chunks (including mid-multibyte-character splits)
 * - multiple messages in one chunk
 * - extra headers (e.g. Content-Type) before the body
 * - malformed JSON bodies and header blocks missing Content-Length: the
 *   frame is skipped, `errors` is incremented, decoding continues.
 */
export class FrameDecoder {
  /** Count of frames skipped due to malformed headers or JSON bodies. */
  errors = 0;

  private buffer: Buffer = Buffer.alloc(0);
  private readonly onError: ((error: Error, rawBody?: string) => void) | undefined;

  constructor(options: FrameDecoderOptions = {}) {
    this.onError = options.onError;
  }

  /** Append a chunk and return zero or more complete parsed JSON messages. */
  push(chunk: Buffer | string): unknown[] {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    this.buffer = this.buffer.length === 0 ? incoming : Buffer.concat([this.buffer, incoming]);

    const messages: unknown[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_TERMINATOR, 0, 'utf8');
      if (headerEnd === -1) break; // headers incomplete; wait for more bytes

      const headerBlock = this.buffer.subarray(0, headerEnd).toString('utf8');
      const bodyStart = headerEnd + HEADER_TERMINATOR.length;
      const contentLength = parseContentLength(headerBlock);

      if (contentLength === null) {
        // Unusable header block: drop it and resync at whatever follows.
        this.recordError(new Error(`LSP frame missing valid Content-Length header: ${headerBlock}`));
        this.buffer = this.buffer.subarray(bodyStart);
        continue;
      }

      if (this.buffer.length < bodyStart + contentLength) break; // body incomplete

      const bodyBytes = this.buffer.subarray(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.subarray(bodyStart + contentLength);
      const bodyText = bodyBytes.toString('utf8');
      try {
        messages.push(JSON.parse(bodyText));
      } catch (err) {
        this.recordError(err instanceof Error ? err : new Error(String(err)), bodyText);
      }
    }
    return messages;
  }

  private recordError(error: Error, rawBody?: string): void {
    this.errors += 1;
    this.onError?.(error, rawBody);
  }
}

/**
 * Extract Content-Length from a header block. Header names are
 * case-insensitive; unknown headers (Content-Type, ...) are tolerated.
 */
function parseContentLength(headerBlock: string): number | null {
  for (const line of headerBlock.split('\r\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const name = line.slice(0, sep).trim().toLowerCase();
    if (name !== 'content-length') continue;
    const value = Number.parseInt(line.slice(sep + 1).trim(), 10);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  return null;
}
