/**
 * LspClient — a JSON-RPC 2.0 / LSP client bound to a pair of streams.
 *
 * It deliberately takes streams rather than a child process so tests can
 * drive it with PassThrough streams and the manager can own process
 * lifecycle separately. Document synchronization is FULL: every didChange
 * sends the whole document text (TextDocumentSyncKind.Full = 1 semantics).
 */

import { FrameDecoder, encodeMessage } from './framing.js';
import type {
  DefinitionResponse,
  HoverContents,
  LspDiagnostic,
  LspHover,
  LspLocation,
  LspLocationLink,
  NormalizedLocation,
} from './types.js';

export interface LspClientOptions {
  /** Stream connected to the server's stdin; the client writes frames here. */
  input: NodeJS.WritableStream;
  /** Stream connected to the server's stdout; the client reads frames here. */
  output: NodeJS.ReadableStream;
  /** file:// URI of the workspace root, sent in the initialize request. */
  rootUri: string;
}

export type DiagnosticsListener = (uri: string, diagnostics: LspDiagnostic[]) => void;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const SHUTDOWN_TIMEOUT_MS = 1500;

export class LspClient {
  private readonly input: NodeJS.WritableStream;
  private readonly output: NodeJS.ReadableStream;
  private readonly rootUri: string;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly versions = new Map<string, number>();
  private readonly diagnosticsListeners = new Set<DiagnosticsListener>();
  private nextId = 0;
  private disposed = false;

  /** Raw capabilities object the server returned from initialize, if any. */
  serverCapabilities: unknown = undefined;

  private readonly onData = (chunk: Buffer | string): void => {
    for (const message of this.decoder.push(chunk)) {
      this.handleMessage(message);
    }
  };

  constructor(options: LspClientOptions) {
    this.input = options.input;
    this.output = options.output;
    this.rootUri = options.rootUri;
    this.output.on('data', this.onData);
  }

  /** Run the LSP handshake: initialize request, then the initialized notification. */
  async initialize(): Promise<void> {
    const result = await this.request<{ capabilities?: unknown } | null>('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: 'workspace' }],
      capabilities: {
        textDocument: {
          // Full-document sync only: didChange always carries the entire text
          // (the server-side sync kind for this is Full = 1).
          synchronization: { dynamicRegistration: false, didSave: true },
          publishDiagnostics: { relatedInformation: true, versionSupport: false },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
    });
    this.serverCapabilities = isRecord(result) ? result['capabilities'] : undefined;
    this.notify('initialized', {});
  }

  /** Send a request and await its response; rejects on timeout, server error, or write failure. */
  request<T = unknown>(method: string, params?: unknown, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error(`LSP client disposed; cannot send '${method}'`));
    }
    return this.rawRequest<T>(method, params, timeoutMs);
  }

  /** Send a notification (no response expected). No-op after dispose. */
  notify(method: string, params?: unknown): void {
    if (this.disposed) return;
    this.send({ jsonrpc: '2.0', method, params });
  }

  // Document lifecycle (full sync) ------------------------------------------

  didOpen(uri: string, languageId: string, text: string): void {
    this.versions.set(uri, 1);
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  /** Full-sync change: sends the whole document and bumps the per-uri version. */
  didChange(uri: string, text: string): void {
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  didSave(uri: string, text: string): void {
    this.notify('textDocument/didSave', { textDocument: { uri }, text });
  }

  didClose(uri: string): void {
    this.versions.delete(uri);
    this.notify('textDocument/didClose', { textDocument: { uri } });
  }

  // Features ------------------------------------------------------------------

  /** Subscribe to textDocument/publishDiagnostics. Returns an unsubscribe function. */
  onDiagnostics(cb: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(cb);
    return () => {
      this.diagnosticsListeners.delete(cb);
    };
  }

  /**
   * Hover at a zero-based position, normalized to a plain string across
   * MarkupContent | MarkedString | MarkedString[] (first meaningful text).
   */
  async hover(uri: string, line: number, character: number): Promise<string | null> {
    const result = await this.request<LspHover | null>('textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    });
    if (!result || result.contents == null) return null;
    return extractHoverText(result.contents);
  }

  /**
   * Definition at a zero-based position, normalized across
   * Location | Location[] | LocationLink[] (first entry wins).
   */
  async definition(uri: string, line: number, character: number): Promise<NormalizedLocation | null> {
    const result = await this.request<DefinitionResponse>('textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    });
    return normalizeDefinitionResponse(result);
  }

  /** Best-effort shutdown request followed by the exit notification. Never throws. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.rawRequest('shutdown', null, SHUTDOWN_TIMEOUT_MS);
    } catch {
      // Best effort: the server may already be gone or unresponsive.
    }
    this.send({ jsonrpc: '2.0', method: 'exit' });
    this.failAllPending(new Error('LSP client disposed'));
    try {
      this.output.off('data', this.onData);
    } catch {
      // Stream may already be destroyed; dispose never throws.
    }
  }

  // Internals -------------------------------------------------------------------

  private rawRequest<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      if (!this.send({ jsonrpc: '2.0', id, method, params })) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`failed to write LSP request '${method}'`));
      }
    });
  }

  private send(message: object): boolean {
    try {
      this.input.write(encodeMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  private handleMessage(raw: unknown): void {
    if (!isRecord(raw)) return;
    const id = raw['id'];
    const method = raw['method'];

    if (typeof method === 'string') {
      if (typeof id === 'number' || typeof id === 'string') {
        this.answerServerRequest(id, method, raw['params']);
      } else {
        this.handleServerNotification(method, raw['params']);
      }
      return;
    }

    if (typeof id === 'number' || typeof id === 'string') {
      this.settleResponse(id, raw);
    }
  }

  private settleResponse(id: number | string, raw: Record<string, unknown>): void {
    const key = typeof id === 'number' ? id : Number(id);
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);

    const error = raw['error'];
    if (isRecord(error)) {
      const message = typeof error['message'] === 'string' ? error['message'] : 'unknown LSP error';
      const code = typeof error['code'] === 'number' ? ` (code ${error['code']})` : '';
      entry.reject(new Error(`LSP '${entry.method}' failed: ${message}${code}`));
    } else {
      entry.resolve(raw['result']);
    }
  }

  /**
   * Answer server-to-client requests with sane empty defaults so servers
   * never hang waiting on us.
   */
  private answerServerRequest(id: number | string, method: string, params: unknown): void {
    let result: unknown;
    switch (method) {
      case 'workspace/configuration': {
        const items = isRecord(params) && Array.isArray(params['items']) ? params['items'] : [];
        result = items.map(() => null);
        break;
      }
      case 'workspace/workspaceFolders':
        result = [{ uri: this.rootUri, name: 'workspace' }];
        break;
      case 'workspace/applyEdit':
        result = { applied: false };
        break;
      case 'window/showDocument':
        result = { success: false };
        break;
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'window/workDoneProgress/create':
      case 'window/showMessageRequest':
      default:
        // Acknowledge with a null result; per JSON-RPC every request must be answered.
        result = null;
        break;
    }
    this.send({ jsonrpc: '2.0', id, result });
  }

  private handleServerNotification(method: string, params: unknown): void {
    if (method === 'textDocument/publishDiagnostics') {
      if (!isRecord(params) || typeof params['uri'] !== 'string') return;
      const uri = params['uri'];
      // Structural trust of the server payload; LspDiagnostic mirrors the wire shape.
      const diagnostics = Array.isArray(params['diagnostics'])
        ? (params['diagnostics'] as LspDiagnostic[])
        : [];
      for (const listener of [...this.diagnosticsListeners]) {
        listener(uri, diagnostics);
      }
      return;
    }
    // Other notifications (window/logMessage, telemetry/event, $/progress, ...)
    // are intentionally ignored.
  }

  private failAllPending(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      entry.reject(error);
    }
  }
}

// Normalization helpers -----------------------------------------------------

function extractHoverText(contents: HoverContents): string | null {
  const parts = Array.isArray(contents) ? contents : [contents];
  for (const part of parts) {
    const text =
      typeof part === 'string'
        ? part
        : isRecord(part) && typeof part['value'] === 'string'
          ? part['value']
          : '';
    if (text.trim().length > 0) return text;
  }
  return null;
}

function normalizeDefinitionResponse(result: DefinitionResponse): NormalizedLocation | null {
  if (result == null) return null;
  const first: LspLocation | LspLocationLink | undefined = Array.isArray(result) ? result[0] : result;
  if (!first) return null;
  if ('targetUri' in first) {
    const range = first.targetSelectionRange ?? first.targetRange;
    return { uri: first.targetUri, line: range.start.line, character: range.start.character };
  }
  return { uri: first.uri, line: first.range.start.line, character: first.range.start.character };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
