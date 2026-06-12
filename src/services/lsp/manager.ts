/**
 * LspManager — routes files to language servers, spawning one server per
 * language on first use and reusing it afterwards.
 *
 * Crash policy: when a server process dies it is marked dead and ONE respawn
 * is allowed on the next request for that language (two spawn attempts
 * total). Diagnostics are aggregated across servers and re-emitted with
 * absolute paths and LSP's zero-based positions preserved.
 */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, sep } from 'node:path';
import { LspClient } from './client.js';
import { pathToUri, uriToPath } from './types.js';
import type {
  DiagnosticSeverityName,
  LspDiagnostic,
  LspServerStatus,
  NormalizedDiagnostic,
} from './types.js';

// Language routing table -----------------------------------------------------

export interface LanguageServerCommand {
  command: string;
  args: string[];
}

export interface LanguageServerSpec {
  /** Stable key reported by onStatus, e.g. 'typescript'. */
  id: string;
  /** Lowercase file extensions without the dot. */
  extensions: string[];
  /** Extension -> LSP languageId (e.g. tsx -> typescriptreact). */
  languageIds: Record<string, string>;
  /** Server command candidates in priority order; first found on PATH wins. */
  commands: LanguageServerCommand[];
}

/** Default routing table. Extend by passing `servers` to the LspManager constructor. */
export const DEFAULT_SERVERS: LanguageServerSpec[] = [
  {
    id: 'typescript',
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'],
    languageIds: {
      ts: 'typescript',
      mts: 'typescript',
      cts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      jsx: 'javascriptreact',
    },
    commands: [{ command: 'typescript-language-server', args: ['--stdio'] }],
  },
  {
    id: 'python',
    extensions: ['py', 'pyi'],
    languageIds: { py: 'python', pyi: 'python' },
    commands: [
      { command: 'pyright-langserver', args: ['--stdio'] },
      { command: 'pylsp', args: [] },
    ],
  },
];

export interface LanguageRoute {
  spec: LanguageServerSpec;
  languageId: string;
}

/** Resolve a file path to its language-server spec and LSP languageId. */
export function resolveLanguage(
  filePath: string,
  table: LanguageServerSpec[] = DEFAULT_SERVERS,
): LanguageRoute | null {
  const ext = extname(filePath).slice(1).toLowerCase();
  if (!ext) return null;
  for (const spec of table) {
    if (spec.extensions.includes(ext)) {
      return { spec, languageId: spec.languageIds[ext] ?? spec.id };
    }
  }
  return null;
}

// PATH lookup -----------------------------------------------------------------

/**
 * Pure PATH scan (no shelling out): splits env.PATH, checks each directory
 * for the command (plus PATHEXT suffixes on Windows) via fs.existsSync.
 * Returns the first matching absolute path, or null.
 */
export function findOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const suffixes =
    process.platform === 'win32'
      ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
      : [''];

  const isFile = (candidate: string): boolean => {
    try {
      return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  };

  if (command.includes('/') || command.includes(sep) || isAbsolute(command)) {
    for (const suffix of suffixes) {
      if (isFile(command + suffix)) return command + suffix;
    }
    return null;
  }

  const pathValue = env.PATH ?? env.Path ?? '';
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, command + suffix);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

// Diagnostics normalization ----------------------------------------------------

const SEVERITY_NAMES: Record<number, DiagnosticSeverityName> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

/** Normalize a wire diagnostic. Positions stay ZERO-BASED, as on the LSP wire. */
export function normalizeDiagnostic(diag: LspDiagnostic): NormalizedDiagnostic {
  const normalized: NormalizedDiagnostic = {
    line: diag.range.start.line,
    col: diag.range.start.character,
    endLine: diag.range.end.line,
    endCol: diag.range.end.character,
    severity: SEVERITY_NAMES[diag.severity ?? 1] ?? 'error',
    message: diag.message,
  };
  if (diag.source !== undefined) normalized.source = diag.source;
  return normalized;
}

// Manager ----------------------------------------------------------------------

export type StatusListener = (lang: string, status: LspServerStatus) => void;
export type ManagerDiagnosticsListener = (absPath: string, diags: NormalizedDiagnostic[]) => void;

export interface LspManagerOptions {
  /** Override or extend the routing table. Defaults to DEFAULT_SERVERS. */
  servers?: LanguageServerSpec[];
  /** Environment used for PATH lookups only (tests). Spawned servers inherit process.env. */
  env?: NodeJS.ProcessEnv;
}

interface ManagedServer {
  spec: LanguageServerSpec;
  child: ChildProcessWithoutNullStreams;
  client: LspClient;
  status: LspServerStatus;
  ready: Promise<LspClient | null>;
}

const MAX_SPAWNS_PER_LANGUAGE = 2; // initial spawn + one respawn after a crash

export class LspManager {
  private readonly rootDir: string;
  private readonly servers: LanguageServerSpec[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly running = new Map<string, ManagedServer>();
  private readonly spawnCounts = new Map<string, number>();
  private readonly unavailable = new Set<string>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly diagnosticsListeners = new Set<ManagerDiagnosticsListener>();
  private disposing = false;

  constructor(rootDir: string, options: LspManagerOptions = {}) {
    this.rootDir = rootDir;
    this.servers = options.servers ?? DEFAULT_SERVERS;
    this.env = options.env ?? process.env;
  }

  /** Routing lookup without spawning anything. */
  routeFor(filePath: string): LanguageRoute | null {
    return resolveLanguage(filePath, this.servers);
  }

  /** Subscribe to server status transitions. Returns an unsubscribe function. */
  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /**
   * Subscribe to aggregated diagnostics across all servers. Paths are
   * absolute; positions are zero-based. Returns an unsubscribe function.
   */
  onDiagnostics(cb: ManagerDiagnosticsListener): () => void {
    this.diagnosticsListeners.add(cb);
    return () => {
      this.diagnosticsListeners.delete(cb);
    };
  }

  /**
   * Get (spawning on first use) the initialized client for a file's
   * language. Returns null when the file has no route, no server binary is
   * on PATH, or the server failed and its respawn budget is spent.
   */
  async clientFor(filePath: string): Promise<LspClient | null> {
    const route = this.routeFor(filePath);
    if (!route) return null;
    const { spec } = route;

    if (this.unavailable.has(spec.id)) return null;

    const existing = this.running.get(spec.id);
    if (existing) return existing.ready;

    const used = this.spawnCounts.get(spec.id) ?? 0;
    if (used >= MAX_SPAWNS_PER_LANGUAGE) return null;

    const binary = this.findCommand(spec);
    if (!binary) {
      this.unavailable.add(spec.id);
      this.emitStatus(spec.id, 'failed');
      return null;
    }

    this.spawnCounts.set(spec.id, used + 1);
    return this.start(spec, binary.file, binary.args);
  }

  /** Shut down every running server. Never throws. */
  async disposeAll(): Promise<void> {
    this.disposing = true;
    const entries = [...this.running.values()];
    this.running.clear();
    await Promise.allSettled(
      entries.map(async (managed) => {
        await managed.client.dispose();
        try {
          managed.child.kill();
        } catch {
          // Already dead.
        }
        managed.status = 'stopped';
        this.emitStatus(managed.spec.id, 'stopped');
      }),
    );
    this.spawnCounts.clear();
    this.unavailable.clear();
    this.disposing = false;
  }

  // Internals -----------------------------------------------------------------

  private findCommand(spec: LanguageServerSpec): { file: string; args: string[] } | null {
    for (const candidate of spec.commands) {
      const file = findOnPath(candidate.command, this.env);
      if (file) return { file, args: candidate.args };
    }
    return null;
  }

  private start(spec: LanguageServerSpec, file: string, args: string[]): Promise<LspClient | null> {
    this.emitStatus(spec.id, 'starting');

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(file, args, { cwd: this.rootDir, stdio: 'pipe' });
    } catch {
      this.emitStatus(spec.id, 'failed');
      return Promise.resolve(null);
    }

    // Swallow pipe errors (EPIPE on a dying server) so they never become
    // uncaught 'error' events; the exit handler owns state transitions.
    const noop = (): void => {};
    child.stdin.on('error', noop);
    child.stdout.on('error', noop);
    child.stderr.on('error', noop);
    child.stderr.resume(); // drain stderr so the server never blocks on it

    const client = new LspClient({
      input: child.stdin,
      output: child.stdout,
      rootUri: pathToUri(this.rootDir),
    });

    const managed: ManagedServer = {
      spec,
      child,
      client,
      status: 'starting',
      ready: Promise.resolve(null),
    };
    this.running.set(spec.id, managed);

    child.once('error', () => this.markDead(managed, 'failed'));
    child.once('exit', () => {
      this.markDead(managed, managed.status === 'ready' ? 'stopped' : 'failed');
    });

    client.onDiagnostics((uri, diags) => this.dispatchDiagnostics(uri, diags));

    managed.ready = client.initialize().then(
      () => {
        if (this.running.get(spec.id) !== managed) return null; // died mid-init
        managed.status = 'ready';
        this.emitStatus(spec.id, 'ready');
        return client;
      },
      () => {
        this.markDead(managed, 'failed');
        return null;
      },
    );
    return managed.ready;
  }

  private markDead(managed: ManagedServer, status: 'failed' | 'stopped'): void {
    if (this.running.get(managed.spec.id) === managed) {
      this.running.delete(managed.spec.id);
    }
    if (managed.status === 'failed' || managed.status === 'stopped') return; // already reported
    managed.status = status;
    void managed.client.dispose(); // rejects pending requests, detaches listeners; never throws
    if (!managed.child.killed) {
      try {
        managed.child.kill();
      } catch {
        // Already gone.
      }
    }
    if (!this.disposing) this.emitStatus(managed.spec.id, status);
  }

  private dispatchDiagnostics(uri: string, diags: LspDiagnostic[]): void {
    if (this.diagnosticsListeners.size === 0) return;
    const absPath = uriToPath(uri);
    const normalized = diags.map(normalizeDiagnostic);
    for (const cb of [...this.diagnosticsListeners]) {
      try {
        cb(absPath, normalized);
      } catch {
        // Listener errors must not break the dispatch loop.
      }
    }
  }

  private emitStatus(lang: string, status: LspServerStatus): void {
    for (const cb of [...this.statusListeners]) {
      try {
        cb(lang, status);
      } catch {
        // Listener errors must not break the manager.
      }
    }
  }
}
