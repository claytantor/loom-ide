import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GH_SPEC, GIT_SPEC, parseArgv, runByLabel, runGh, runGit, runPassthrough, stripAnsi } from '../src/services/passthru.js';

describe('parseArgv', () => {
  test('splits on whitespace', () => {
    expect(parseArgv('pr list --limit 5')).toEqual(['pr', 'list', '--limit', '5']);
  });
  test('keeps double-quoted spans together', () => {
    expect(parseArgv('commit -m "fix the bug" --amend')).toEqual(['commit', '-m', 'fix the bug', '--amend']);
  });
  test('keeps single-quoted spans together', () => {
    expect(parseArgv("log --format='%h %s'")).toEqual(['log', '--format=%h %s']);
  });
  test('handles backslash escapes outside quotes', () => {
    expect(parseArgv('show HEAD:foo\\ bar')).toEqual(['show', 'HEAD:foo bar']);
  });
  test('empty / whitespace-only yields no args', () => {
    expect(parseArgv('   ')).toEqual([]);
    expect(parseArgv('')).toEqual([]);
  });
});

describe('stripAnsi', () => {
  test('removes SGR colour codes but keeps text', () => {
    expect(stripAnsi('\x1b[32m+added\x1b[0m')).toBe('+added');
    expect(stripAnsi('\x1b[1;31mfatal\x1b[m: boom')).toBe('fatal: boom');
  });
  test('removes OSC-8 hyperlinks but keeps the link text', () => {
    expect(stripAnsi('\x1b]8;;https://example.com\x07text\x1b]8;;\x07')).toBe('text');
  });
  test('leaves plain text untouched', () => {
    expect(stripAnsi('just text')).toBe('just text');
  });
});

describe('specs', () => {
  test('gh forces a tty width, git disables pager/editor/prompt', () => {
    expect(GH_SPEC.forceTtyEnv).toBe('GH_FORCE_TTY');
    expect(GIT_SPEC.forceTtyEnv).toBeUndefined();
    expect(GIT_SPEC.env).toMatchObject({ GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' });
  });
});

describe('runPassthrough', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loom-pt-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function fake(body: string): Promise<string> {
    const p = join(dir, 'fakebin');
    await writeFile(p, `#!/usr/bin/env bash\n${body}\n`);
    await chmod(p, 0o755);
    return p;
  }

  test('captures stdout, labels the result, reports success', async () => {
    const bin = await fake('echo "On branch main"; echo "nothing to commit"');
    const r = await runPassthrough(GIT_SPEC, dir, 'status', { bin });
    expect(r.label).toBe('git');
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.argv).toEqual(['status']);
    expect(r.lines).toEqual(['On branch main', 'nothing to commit']);
  });

  test('strips ANSI from forced-tty output', async () => {
    const bin = await fake('printf "\\033[32mOPEN\\033[0m pr\\n"');
    const r = await runPassthrough(GH_SPEC, dir, 'pr status', { bin, cols: 80 });
    expect(r.lines).toEqual(['OPEN pr']);
  });

  test('non-zero exit surfaces stderr as failure with label', async () => {
    const bin = await fake('echo "fatal: not a git repository" >&2; exit 128');
    const r = await runPassthrough(GIT_SPEC, dir, 'log', { bin });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(128);
    expect(r.lines).toEqual(['fatal: not a git repository']);
    expect(r.error).toBe('git exited 128');
  });

  test('passes quoted args through to the binary verbatim', async () => {
    const bin = await fake('printf "%s\\n" "$@"');
    const r = await runPassthrough(GIT_SPEC, dir, 'commit -m "hello world"', { bin });
    expect(r.lines).toEqual(['commit', '-m', 'hello world']);
  });

  test('missing binary yields a friendly hint, not a crash', async () => {
    const r = await runPassthrough(GIT_SPEC, dir, 'status', { bin: join(dir, 'nope-xyz') });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('git not found');
    expect(r.lines.join('\n')).toContain('git-scm.com');
  });

  test('empty arg string returns usage without spawning', async () => {
    const r = await runPassthrough(GH_SPEC, dir, '   ', { bin: 'definitely-not-real' });
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toContain('usage: /gh');
  });

  test('timeout kills a hanging command tree', async () => {
    const bin = await fake('sleep 5');
    const r = await runPassthrough(GIT_SPEC, dir, 'fetch', { bin, timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(124);
    expect(r.error).toContain('timed out');
  });

  test('runGh / runGit / runByLabel set the right label', async () => {
    const bin = await fake('echo hi');
    expect((await runGh(dir, 'x', { bin })).label).toBe('gh');
    expect((await runGit(dir, 'x', { bin })).label).toBe('git');
    expect((await runByLabel('git', dir, 'x', { bin })).label).toBe('git');
  });
});
