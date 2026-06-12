/**
 * Public surface of Loom's LSP stack: framing, stream-bound client,
 * per-language server manager, and shared protocol types.
 */

export { encodeMessage, FrameDecoder } from './framing.js';
export type { FrameDecoderOptions } from './framing.js';

export { LspClient } from './client.js';
export type { LspClientOptions, DiagnosticsListener } from './client.js';

export {
  LspManager,
  DEFAULT_SERVERS,
  resolveLanguage,
  findOnPath,
  normalizeDiagnostic,
} from './manager.js';
export type {
  LanguageRoute,
  LanguageServerCommand,
  LanguageServerSpec,
  LspManagerOptions,
  ManagerDiagnosticsListener,
  StatusListener,
} from './manager.js';

export { pathToUri, uriToPath } from './types.js';
export type {
  DefinitionResponse,
  DiagnosticSeverityName,
  HoverContents,
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  LspDiagnostic,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspPosition,
  LspRange,
  LspServerStatus,
  MarkedString,
  MarkupContent,
  NormalizedDiagnostic,
  NormalizedLocation,
  PublishDiagnosticsParams,
} from './types.js';
