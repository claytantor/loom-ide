/* CLI passthrough engine shared by /gh, /git and /bash.

   /gh and /git tokenize the arg string (quote-aware, see parseArgv) and spawn a
   fixed binary with an argv ARRAY — no shell, so there's no shell-injection
   surface and the binary's own auth/permissions apply.

   /bash is deliberately different: it spawns `bash -c <raw string>` so the user
   can use the full shell — pipes, redirects, globs, &&/||/;, subshells, $VAR
   expansion and quoting all work. The raw command string is passed through
   verbatim (no tokenization). All three reuse the same spawn/capture/timeout/
   process-group-kill/ANSI-strip core (runCaptured). */

import { spawn, type SpawnOptions } from 'node:child_process';

export interface CommandResult {
  /** Binary label shown in the header, e.g. 'gh' or 'git'. */
  label: string;
  /** Resolved argv passed to the binary (without the binary itself). */
  argv: string[];
  /** Output lines (stdout on success, stderr on failure), ANSI-stripped. */
  lines: string[];
  /** Process exit code (-1 when the binary could not be spawned). */
  code: number;
  ok: boolean;
  /** Friendly one-liner for the status readout (binary missing, timeout…). */
  error?: string;
  /** True when output hit the line cap. */
  truncated: boolean;
}

export interface PassthruSpec {
  label: string;
  /** Default binary name on PATH. */
  bin: string;
  /** Extra environment merged over process.env. */
  env?: NodeJS.ProcessEnv;
  /** Env var set to the panel width so the tool formats to it (gh: GH_FORCE_TTY). */
  forceTtyEnv?: string;
  /** Lines shown when the binary is missing from PATH. */
  notFound: string[];
}

export interface RunOptions {
  /** Terminal width handed to the tool via `forceTtyEnv`. */
  cols?: number;
  /** Binary to spawn, overriding the spec default (for tests). */
  bin?: string;
  timeoutMs?: number;
}

const TIMEOUT_MS = 30_000;
const MAX_LINES = 2000;
const MAX_BYTES = 4 * 1024 * 1024;

// ansi-regex (Sindre Sorhus) — strips SGR colour, cursor moves, and OSC links.
const ANSI = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  ].join('|'),
  'g',
);

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/** Tokenize a command string into argv, honoring single/double quotes and `\`. */
export function parseArgv(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < input.length) cur += input[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < input.length) {
      cur += input[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) {
        out.push(cur);
        cur = '';
        has = false;
      }
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

function notFoundResult(spec: PassthruSpec, argv: string[]): CommandResult {
  return {
    label: spec.label,
    argv,
    lines: spec.notFound,
    code: -1,
    ok: false,
    error: `${spec.label} not found`,
    truncated: false,
  };
}

/** Tokenize an arg string, then run. Kept for the omni-driven `/gh` `/git` flow. */
export function runPassthrough(spec: PassthruSpec, root: string, argString: string, opts: RunOptions = {}): Promise<CommandResult> {
  return runPassthroughArgv(spec, root, parseArgv(argString), opts);
}

/** Run with an explicit argv array — bypasses the tokenizer so a multi-line
   element (e.g. a PR body, or a `--body-file` path) reaches the binary intact. */
export function runPassthroughArgv(spec: PassthruSpec, root: string, argv: string[], opts: RunOptions = {}): Promise<CommandResult> {
  const bin = opts.bin ?? spec.bin;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  if (argv.length === 0) {
    return Promise.resolve({
      label: spec.label,
      argv: [],
      lines: [`usage: /${spec.label} <args>`],
      code: 0,
      ok: true,
      truncated: false,
    });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...spec.env,
    ...(spec.forceTtyEnv && opts.cols && opts.cols > 0 ? { [spec.forceTtyEnv]: String(opts.cols) } : {}),
  };

  return runCaptured({
    label: spec.label,
    argv,
    bin,
    spawnArgs: argv,
    env,
    root,
    timeoutMs,
    notFound: () => notFoundResult(spec, argv),
  });
}

interface CapturedSpec {
  /** Label shown in the result header, e.g. 'gh', 'git', 'bash'. */
  label: string;
  /** Logical argv recorded on the result (for the header echo). For /bash this
     is the single raw command string. */
  argv: string[];
  /** Binary to spawn. */
  bin: string;
  /** Actual argv array passed to spawn (for /bash: ['-c', commandString]). */
  spawnArgs: string[];
  env: NodeJS.ProcessEnv;
  root: string;
  timeoutMs: number;
  /** Result returned when the binary is missing from PATH. */
  notFound: () => CommandResult;
}

/** Shared spawn/capture/timeout/process-group-kill/ANSI-strip core. */
function runCaptured(spec: CapturedSpec): Promise<CommandResult> {
  const { label, argv, bin, spawnArgs, env, root, timeoutMs } = spec;
  return new Promise((resolve) => {
    let proc;
    try {
      // stdin ignored: the tool sees no TTY for input, so it errors instead of
      // hanging on commands that would otherwise prompt. detached makes it a
      // process-group leader so a timeout can kill the whole tree.
      const spawnOpts: SpawnOptions = { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true };
      proc = spawn(bin, spawnArgs, spawnOpts);
    } catch {
      resolve(spec.notFound());
      return;
    }

    let out = '';
    let err = '';
    let outBytes = 0;
    let settled = false;
    const finish = (r: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const killTree = (): void => {
      try {
        if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
        else proc.kill('SIGKILL');
      } catch {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    };
    const timer = setTimeout(() => {
      killTree();
      finish({
        label,
        argv,
        lines: [`${label} timed out after ${Math.round(timeoutMs / 1000)}s and was stopped.`],
        code: 124,
        ok: false,
        error: `${label} timed out`,
        truncated: false,
      });
    }, timeoutMs);

    proc.stdout?.on('data', (d: Buffer) => {
      if (outBytes < MAX_BYTES) {
        out += d.toString();
        outBytes += d.length;
      }
    });
    proc.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
    });
    proc.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') finish(spec.notFound());
      else finish({ label, argv, lines: [e.message], code: -1, ok: false, error: e.message, truncated: false });
    });
    proc.on('close', (code) => {
      if (settled) return;
      const ok = code === 0;
      const raw = ok ? (out.trim() ? out : err) : (err.trim() ? err : out);
      let lines = stripAnsi(raw)
        .split('\n')
        .map((l) => l.replace(/\r$/, '').replace(/\t/g, '  '));
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      if (lines.length === 0) lines = [ok ? '(no output)' : `${label} exited ${code ?? '?'} with no output`];
      let truncated = false;
      if (lines.length > MAX_LINES) {
        lines = lines.slice(0, MAX_LINES);
        truncated = true;
      }
      const result: CommandResult = { label, argv, lines, code: code ?? -1, ok, truncated };
      if (!ok) result.error = `${label} exited ${code ?? '?'}`;
      finish(result);
    });
  });
}

/* ── concrete passthroughs ──────────────────────────────────────────────── */

export const GH_SPEC: PassthruSpec = {
  label: 'gh',
  bin: 'gh',
  forceTtyEnv: 'GH_FORCE_TTY',
  env: { GH_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
  notFound: ['GitHub CLI (gh) not found on PATH.', '', 'install it:    https://cli.github.com', 'authenticate:  gh auth login'],
};

export const GIT_SPEC: PassthruSpec = {
  label: 'git',
  bin: 'git',
  // No editor/pager/credential prompts — they would hang on a non-interactive pipe.
  env: { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_OPTIONAL_LOCKS: '0' },
  notFound: ['git not found on PATH.', '', 'install it:  https://git-scm.com/downloads'],
};

export type PassthruLabel = 'gh' | 'git';

export function runGh(root: string, argString: string, opts: RunOptions = {}): Promise<CommandResult> {
  return runPassthrough(GH_SPEC, root, argString, opts);
}

/** gh with an explicit argv — used by the /pr flow to pass a multi-line body
   safely via `--body-file` without going through the arg tokenizer. */
export function runGhArgv(root: string, argv: string[], opts: RunOptions = {}): Promise<CommandResult> {
  return runPassthroughArgv(GH_SPEC, root, argv, opts);
}

export function runGit(root: string, argString: string, opts: RunOptions = {}): Promise<CommandResult> {
  return runPassthrough(GIT_SPEC, root, argString, opts);
}

export function runByLabel(label: PassthruLabel, root: string, argString: string, opts: RunOptions = {}): Promise<CommandResult> {
  return runPassthrough(label === 'gh' ? GH_SPEC : GIT_SPEC, root, argString, opts);
}

/* ── /bash — shell-interpreted passthrough ──────────────────────────────────
   Unlike /gh and /git this spawns `bash -c <raw string>`, so the FULL shell is
   available: pipes (|), redirects (>, >>, <), globs (*), chaining (&&, ||, ;),
   subshells, $VAR expansion and quoting all work. The command string is passed
   through verbatim — NO parseArgv tokenization (that would defeat the point). */

const BASH_NOT_FOUND = [
  'bash not found on PATH.',
  '',
  '/bash needs the bash shell to interpret your command.',
  'install bash, or use /git and /gh for git/github operations.',
];

/** Run an arbitrary shell command via `bash -c <commandString>` and capture
   its combined output. The raw string reaches the shell unchanged. */
export function runBash(root: string, commandString: string, opts: RunOptions = {}): Promise<CommandResult> {
  const cmd = commandString.trim();
  // Empty command: no-op, don't spawn a shell.
  if (cmd.length === 0) {
    return Promise.resolve({
      label: 'bash',
      argv: [],
      lines: ['usage: /bash <command>'],
      code: 0,
      ok: true,
      truncated: false,
    });
  }

  const bin = opts.bin ?? 'bash';
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const env: NodeJS.ProcessEnv = { ...process.env, PAGER: 'cat' };

  const notFound = (): CommandResult => ({
    label: 'bash',
    argv: [cmd],
    lines: BASH_NOT_FOUND,
    code: -1,
    ok: false,
    error: 'bash not found',
    truncated: false,
  });

  return runCaptured({
    label: 'bash',
    // The header echoes the whole command as a single logical "arg".
    argv: [cmd],
    bin,
    // The shell interprets the raw string; nothing is pre-tokenized.
    spawnArgs: ['-c', cmd],
    env,
    root,
    timeoutMs,
    notFound,
  });
}
