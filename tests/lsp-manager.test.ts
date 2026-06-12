import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
  DEFAULT_SERVERS,
  LspManager,
  findOnPath,
  normalizeDiagnostic,
  pathToUri,
  resolveLanguage,
  uriToPath,
} from '../src/services/lsp/index.js';
import type { LspServerStatus } from '../src/services/lsp/index.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'loom-lsp-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('language routing table', () => {
  test('routes every TS/JS family extension to typescript-language-server', () => {
    const expected: Record<string, string> = {
      ts: 'typescript',
      mts: 'typescript',
      cts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      jsx: 'javascriptreact',
    };
    for (const [ext, languageId] of Object.entries(expected)) {
      const route = resolveLanguage(`/proj/src/file.${ext}`);
      expect(route, ext).not.toBeNull();
      expect(route!.spec.id).toBe('typescript');
      expect(route!.languageId).toBe(languageId);
      expect(route!.spec.commands[0]).toEqual({ command: 'typescript-language-server', args: ['--stdio'] });
    }
  });

  test('routes py/pyi to python with pyright preferred over pylsp', () => {
    for (const ext of ['py', 'pyi']) {
      const route = resolveLanguage(`/proj/app.${ext}`);
      expect(route!.spec.id).toBe('python');
      expect(route!.languageId).toBe('python');
      expect(route!.spec.commands.map((c) => c.command)).toEqual(['pyright-langserver', 'pylsp']);
    }
  });

  test('is case-insensitive on extensions and null for unknown/missing ones', () => {
    expect(resolveLanguage('/proj/A.TS')!.spec.id).toBe('typescript');
    expect(resolveLanguage('/proj/main.rs')).toBeNull();
    expect(resolveLanguage('/proj/Makefile')).toBeNull();
  });

  test('table is extensible via a custom entry', () => {
    const custom = [
      ...DEFAULT_SERVERS,
      {
        id: 'go',
        extensions: ['go'],
        languageIds: { go: 'go' },
        commands: [{ command: 'gopls', args: [] }],
      },
    ];
    const route = resolveLanguage('/proj/main.go', custom);
    expect(route!.spec.id).toBe('go');
    expect(route!.languageId).toBe('go');
  });
});

describe('uri helpers', () => {
  test('pathToUri/uriToPath round-trip a path containing spaces', () => {
    const p = '/tmp/loom test dir/some file.ts';
    const uri = pathToUri(p);
    expect(uri).toBe('file:///tmp/loom%20test%20dir/some%20file.ts');
    expect(uriToPath(uri)).toBe(p);
  });

  test('uriToPath percent-decodes plain and multibyte escapes', () => {
    expect(uriToPath('file:///tmp/plain.ts')).toBe('/tmp/plain.ts');
    expect(uriToPath('file:///tmp/%E6%97%A5%E6%9C%AC.ts')).toBe('/tmp/日本.ts');
  });
});

describe('findOnPath', () => {
  test('finds an executable in a PATH directory and misses absent ones', () => {
    const dir = makeTempDir();
    const exe = path.join(dir, 'fake-server');
    writeFileSync(exe, '#!/bin/sh\nexit 0\n');
    chmodSync(exe, 0o755);

    expect(findOnPath('fake-server', { PATH: dir })).toBe(exe);
    expect(findOnPath('not-installed-anywhere', { PATH: dir })).toBeNull();
  });

  test('scans multiple PATH entries in order', () => {
    const empty = makeTempDir();
    const populated = makeTempDir();
    const exe = path.join(populated, 'fake-server');
    writeFileSync(exe, '#!/bin/sh\nexit 0\n');
    chmodSync(exe, 0o755);

    const PATH = `${empty}${path.delimiter}${populated}`;
    expect(findOnPath('fake-server', { PATH })).toBe(exe);
  });

  test('does not match directories or empty PATH', () => {
    const dir = makeTempDir();
    expect(findOnPath(path.basename(dir), { PATH: path.dirname(dir) })).toBeNull(); // dirs excluded
    expect(findOnPath('anything', { PATH: '' })).toBeNull();
    expect(findOnPath('anything', {})).toBeNull();
  });
});

describe('normalizeDiagnostic', () => {
  test('maps ranges and severities, preserving zero-based positions', () => {
    const normalized = normalizeDiagnostic({
      range: { start: { line: 3, character: 1 }, end: { line: 3, character: 9 } },
      severity: 2,
      source: 'ts',
      message: 'unused variable',
    });
    expect(normalized).toEqual({
      line: 3,
      col: 1,
      endLine: 3,
      endCol: 9,
      severity: 'warning',
      message: 'unused variable',
      source: 'ts',
    });
  });

  test('covers all severity codes and defaults missing/unknown to error', () => {
    const base = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'm' };
    expect(normalizeDiagnostic({ ...base, severity: 1 }).severity).toBe('error');
    expect(normalizeDiagnostic({ ...base, severity: 2 }).severity).toBe('warning');
    expect(normalizeDiagnostic({ ...base, severity: 3 }).severity).toBe('info');
    expect(normalizeDiagnostic({ ...base, severity: 4 }).severity).toBe('hint');
    expect(normalizeDiagnostic({ ...base }).severity).toBe('error');
    expect(normalizeDiagnostic({ ...base, severity: 99 }).severity).toBe('error');
    expect(normalizeDiagnostic({ ...base }).source).toBeUndefined();
  });
});

describe('LspManager (no real servers spawned)', () => {
  test('clientFor returns null for unrouted files without emitting status', async () => {
    const manager = new LspManager('/tmp', { env: { PATH: makeTempDir() } });
    const statuses: Array<[string, LspServerStatus]> = [];
    manager.onStatus((lang, status) => statuses.push([lang, status]));

    await expect(manager.clientFor('/tmp/main.rs')).resolves.toBeNull();
    expect(statuses).toEqual([]);
    await manager.disposeAll();
  });

  test('clientFor returns null and emits failed once when no binary is on PATH', async () => {
    const manager = new LspManager('/tmp', { env: { PATH: makeTempDir() } });
    const statuses: Array<[string, LspServerStatus]> = [];
    const unsubscribe = manager.onStatus((lang, status) => statuses.push([lang, status]));

    await expect(manager.clientFor('/tmp/app.ts')).resolves.toBeNull();
    await expect(manager.clientFor('/tmp/other.tsx')).resolves.toBeNull(); // cached, no respawn attempt
    expect(statuses).toEqual([['typescript', 'failed']]);

    unsubscribe();
    await expect(manager.clientFor('/tmp/app.py')).resolves.toBeNull();
    expect(statuses).toEqual([['typescript', 'failed']]); // unsubscribed
    await manager.disposeAll();
  });

  test('routeFor exposes the routing decision without spawning', () => {
    const manager = new LspManager('/tmp', { env: { PATH: '' } });
    expect(manager.routeFor('/tmp/x.py')!.languageId).toBe('python');
    expect(manager.routeFor('/tmp/x.txt')).toBeNull();
  });

  test('onDiagnostics subscriptions can be added and removed', () => {
    const manager = new LspManager('/tmp', { env: { PATH: '' } });
    const unsubscribe = manager.onDiagnostics(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
