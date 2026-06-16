import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GH_SPEC, GIT_SPEC, parseArgv, runBash, runByLabel, runGh, runGhArgv, runGit, runPassthrough, runPassthroughArgv, stripAnsi } from '../src/services/passthru.js';

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

describe('runPassthroughArgv', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loom-ptargv-'));
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

  test('passes an explicit argv array straight through, no tokenization', async () => {
    const bin = await fake('printf "%s\\n" "$@"');
    const r = await runPassthroughArgv(GH_SPEC, dir, ['pr', 'create', '--title', 'a b c'], { bin });
    expect(r.lines).toEqual(['pr', 'create', '--title', 'a b c']);
  });

  test('keeps a MULTI-LINE argv element intact (the PR-body fix)', async () => {
    // Count the lines of the 4th arg ($4) to prove the newline survived as one arg.
    const bin = await fake('printf "%s" "$4" | wc -l | tr -d " "');
    const body = 'first line\nsecond line\nthird line';
    const r = await runPassthroughArgv(GH_SPEC, dir, ['pr', 'create', '--body', body], { bin });
    // wc -l counts newlines: 2 between 3 lines.
    expect(r.lines).toEqual(['2']);
  });

  test('empty argv returns usage without spawning', async () => {
    const r = await runPassthroughArgv(GIT_SPEC, dir, [], { bin: 'not-real' });
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toContain('usage: /git');
  });

  test('runGhArgv labels the result gh and forwards argv', async () => {
    const bin = await fake('printf "%s\\n" "$@"');
    const r = await runGhArgv(dir, ['auth', 'status'], { bin });
    expect(r.label).toBe('gh');
    expect(r.argv).toEqual(['auth', 'status']);
  });
});

describe('runBash', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loom-bash-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('labels the result bash and echoes the raw command as the single arg', async () => {
    const r = await runBash(dir, 'echo hello');
    expect(r.label).toBe('bash');
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.argv).toEqual(['echo hello']);
    expect(r.lines).toEqual(['hello']);
  });

  test('interprets a PIPE through the shell (not argv-tokenized)', async () => {
    const r = await runBash(dir, 'echo hi | tr a-z A-Z');
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(['HI']);
  });

  test('interprets && chaining', async () => {
    const r = await runBash(dir, 'echo one && echo two');
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(['one', 'two']);
  });

  test('interprets || on failure of the left side', async () => {
    const r = await runBash(dir, 'false || echo fallback');
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(['fallback']);
  });

  test('expands a glob against the cwd (= repo root)', async () => {
    await writeFile(join(dir, 'alpha.txt'), '');
    await writeFile(join(dir, 'beta.txt'), '');
    const r = await runBash(dir, 'echo *.txt');
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(['alpha.txt beta.txt']);
  });

  test('honors a redirect, then reads the file back', async () => {
    const r = await runBash(dir, 'echo persisted > out.txt && cat out.txt');
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(['persisted']);
  });

  test('expands $VAR (raw string reaches the shell, not pre-tokenized)', async () => {
    const r = await runBash(dir, 'X=world; echo "hi $X"');
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(['hi world']);
  });

  test('passes single-quoted content through verbatim — shell, not parseArgv', async () => {
    // parseArgv would strip the quotes; the shell keeps the literal spacing.
    const r = await runBash(dir, "printf '%s\\n' 'a    b'");
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(['a    b']);
  });

  test('captures stderr', async () => {
    const r = await runBash(dir, 'echo oops >&2');
    expect(r.ok).toBe(true);
    // success with empty stdout falls back to stderr in the capture core.
    expect(r.lines).toEqual(['oops']);
  });

  test('surfaces a non-zero exit code with output', async () => {
    const r = await runBash(dir, 'echo before; exit 3');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(3);
    expect(r.lines).toEqual(['before']);
    expect(r.error).toBe('bash exited 3');
  });

  test('empty command returns usage without spawning', async () => {
    const r = await runBash(dir, '   ', { bin: 'definitely-not-bash' });
    expect(r.ok).toBe(true);
    expect(r.argv).toEqual([]);
    expect(r.lines[0]).toContain('usage: /bash');
  });

  test('missing bash binary yields a friendly hint, not a crash', async () => {
    const r = await runBash(dir, 'echo hi', { bin: join(dir, 'nope-bash-xyz') });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bash not found');
    expect(r.lines.join('\n')).toContain('bash not found on PATH');
  });

  test('timeout kills a hanging shell tree', async () => {
    const r = await runBash(dir, 'sleep 5', { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(124);
    expect(r.error).toContain('timed out');
  });

  test('strips ANSI from shell output', async () => {
    const r = await runBash(dir, 'printf "\\033[32mGREEN\\033[0m\\n"');
    expect(r.lines).toEqual(['GREEN']);
  });
});
