/**
 * Structural types for the subset of the Language Server Protocol Loom
 * speaks, plus file-URI helpers shared by the client and manager.
 *
 * Position convention: lines and characters/columns are ZERO-BASED
 * everywhere in this module — exactly as on the LSP wire — including
 * NormalizedDiagnostic. Convert to 1-based at the presentation layer.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';

// JSON-RPC 2.0 envelope ----------------------------------------------------

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

// LSP structures -----------------------------------------------------------

export interface LspPosition {
  /** Zero-based line. */
  line: number;
  /** Zero-based UTF-16 column. */
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspLocationLink {
  originSelectionRange?: LspRange;
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
}

export interface LspDiagnostic {
  range: LspRange;
  /** 1 = error, 2 = warning, 3 = information, 4 = hint. Absent means unspecified. */
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: unknown[];
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: LspDiagnostic[];
}

export interface MarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

/** Deprecated in the LSP spec but still emitted by many servers. */
export type MarkedString = string | { language: string; value: string };

export type HoverContents = MarkupContent | MarkedString | MarkedString[];

export interface LspHover {
  contents: HoverContents;
  range?: LspRange;
}

export type DefinitionResponse = LspLocation | LspLocation[] | LspLocationLink[] | null;

// Normalized shapes Loom consumes -------------------------------------------

export interface NormalizedLocation {
  uri: string;
  /** Zero-based. */
  line: number;
  /** Zero-based. */
  character: number;
}

export type DiagnosticSeverityName = 'error' | 'warning' | 'info' | 'hint';

/**
 * Editor-friendly diagnostic. LSP's zero-based positions are PRESERVED:
 * line/col/endLine/endCol are all 0-based.
 */
export interface NormalizedDiagnostic {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  severity: DiagnosticSeverityName;
  message: string;
  source?: string;
}

export type LspServerStatus = 'starting' | 'ready' | 'failed' | 'stopped';

// File-URI helpers -----------------------------------------------------------

/**
 * Convert a filesystem path to a file:// URI. Reserved characters are
 * percent-encoded, so paths with spaces become %20. Relative paths are
 * resolved against the current working directory.
 */
export function pathToUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

/**
 * Convert a file:// URI back to a filesystem path, percent-decoding the
 * result (handles %20 and multibyte escapes). Falls back to a manual decode
 * for URIs Node's parser rejects (e.g. file URIs carrying a host component).
 */
export function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    const withoutScheme = uri.replace(/^file:\/\//i, '');
    const firstSlash = withoutScheme.indexOf('/');
    const encoded = firstSlash <= 0 ? withoutScheme : withoutScheme.slice(firstSlash);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
}
