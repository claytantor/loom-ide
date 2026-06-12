/* AI-assisted pull-request service for the /pr command.

   Pure, root-parameterized, and unit-testable: every function takes `root` and
   delegates side effects to the git/gh service layers. The only outward reach
   is `generatePrDescription`, which talks to the Claude Agent SDK — and it does
   so behind a lazy, fail-soft import so loom boots and every non-AI path works
   even when the SDK package is absent or `~/.claude` isn't authenticated. On any
   import / auth / SDK error it silently falls back to a commit-log draft. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { currentBranch, diffRange, diffStatRange, logRange } from './git.js';
import { runGhArgv, type CommandResult, type RunOptions } from './passthru.js';

/* ── types ──────────────────────────────────────────────────────────────── */

export interface PrContext {
  /** Base branch the PR merges into, e.g. 'main' or 'dev'. */
  target: string;
  /** Head branch (the current branch) the PR is opened from. */
  head: string;
  /** Commit subjects on head that are not on target. */
  commits: string[];
  /** Full unified diff of head against target. */
  diff: string;
  /** Diff size in lines — over the limit, the AI gets a summary, not the patch. */
  diffLines: number;
  /** Per-file change summary (`git diff --stat`) — sent to the AI for large diffs. */
  diffStat: string;
  /** Contents of the repo's PR template, or null when none exists. */
  template: string | null;
}

export interface PrDraft {
  title: string;
  body: string;
}

/** A draft plus provenance: did the AI write it, and was there a fallback note? */
export interface GeneratedDraft extends PrDraft {
  usedAi: boolean;
  /** Set when generation fell back (over-limit, empty AI, SDK error, …). */
  note?: string;
}

/** Loose shape of the SDK `query()` — kept structural so this module type-checks
   with or without `@anthropic-ai/claude-agent-sdk` installed. */
export type QueryFn = (args: { prompt: string; options?: unknown }) => AsyncIterable<unknown>;

export interface GenerateOptions {
  /** Inject a fake `query` in tests; defaults to the lazily-imported SDK one. */
  query?: QueryFn;
  /** Diffs larger than this (in lines) skip the AI and use the commit log (R7). */
  diffLimit?: number;
}

export interface CreatePrInput {
  target: string;
  head: string;
  title: string;
  body: string;
  draft: boolean;
}

export interface CreatePrResult {
  /** Parsed https://…/pull/N URL from gh's output, or null if not found. */
  url: string | null;
  result: CommandResult;
}

const DEFAULT_DIFF_LIMIT = 3000;

/* Indirection so the compiler cannot statically resolve (and therefore cannot
   error on) the optional SDK specifier — `tsc --noEmit` stays green when the
   package isn't installed; the require/auth failure is caught at runtime. */
const SDK_SPECIFIER = ['@anthropic-ai', 'claude-agent-sdk'].join('/');

/* ── auth preflight (R6) ────────────────────────────────────────────────── */

export interface PreflightResult {
  ok: boolean;
  result: CommandResult;
}

/** Fail fast if gh is missing or not authenticated, before any push/AI work. */
export async function preflightAuth(root: string, opts: RunOptions = {}): Promise<PreflightResult> {
  const result = await runGhArgv(root, ['auth', 'status'], opts);
  return { ok: result.ok, result };
}

/* ── context gathering ──────────────────────────────────────────────────── */

/** Locations a PR template may live, in precedence order. */
const TEMPLATE_PATHS = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.markdown',
  'PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
];

/** First readable PR template under `root`, or null (R2). Never throws. */
export async function findPrTemplate(root: string): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  for (const rel of TEMPLATE_PATHS) {
    try {
      const text = await readFile(join(root, rel), 'utf8');
      if (text.trim().length > 0) return text;
    } catch {
      /* missing or unreadable — try the next candidate */
    }
  }
  return null;
}

/** Assemble everything the draft generators need: head branch, commit subjects,
   diff, and any PR template. Never throws — empty pieces degrade to []/''/null. */
export async function gatherPrContext(root: string, target: string): Promise<PrContext> {
  const [head, commits, diff, diffStat, template] = await Promise.all([
    currentBranch(root),
    logRange(root, target),
    diffRange(root, target),
    diffStatRange(root, target),
    findPrTemplate(root),
  ]);
  return {
    target,
    head: head ?? 'HEAD',
    commits,
    diff,
    diffLines: diff ? diff.split('\n').length : 0,
    diffStat,
    template,
  };
}

/* ── prompt + draft parsing ─────────────────────────────────────────────── */

/** Build the instruction the SDK drafts against: git-commit-style title+body,
   the commit list, the diff, and a template-fill instruction when present. */
export function buildPrompt(ctx: PrContext, opts: { summarized?: boolean } = {}): string {
  const parts: string[] = [];
  parts.push(
    'You are writing a GitHub pull request description. Output Markdown only — no preamble, no code fences around the whole thing.',
    'Use git-commit convention: the FIRST line is a concise (<72 char) imperative title, then ONE blank line, then the body.',
    `This PR merges branch "${ctx.head}" into "${ctx.target}".`,
    '',
  );
  if (ctx.commits.length > 0) {
    parts.push('Commits in this PR:', ...ctx.commits.map((c) => `- ${c}`), '');
  }
  if (ctx.template) {
    parts.push(
      'Fill out this repository PR template, preserving its headings and checklists; replace placeholder text with real content drawn from the diff:',
      '--- TEMPLATE ---',
      ctx.template.trim(),
      '--- END TEMPLATE ---',
      '',
    );
  } else {
    parts.push(
      'Structure the body with a short summary paragraph and, if useful, a "## Changes" bulleted list. Keep it factual and grounded in the diff.',
      '',
    );
  }
  if (opts.summarized) {
    parts.push(
      'The full diff is large, so you are given a per-file change summary instead of the raw patch.',
      'Write a high-level description grounded in the commits and these file changes.',
      'Changed files (git diff --stat):',
      '```',
      ctx.diffStat.trim() || '(summary unavailable)',
      '```',
    );
  } else {
    parts.push('Unified diff (head vs base):', '```diff', ctx.diff.trim() || '(no textual diff)', '```');
  }
  return parts.join('\n');
}

/** Split drafted text into {title, body} on the git-commit convention.
   First non-empty line is the title (a leading "# " is stripped); the body is
   everything after the first blank line. Forgiving — never throws. */
export function parseDraft(text: string): PrDraft {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  if (i >= lines.length) return { title: '', body: '' };
  const title = lines[i]!.replace(/^#+\s+/, '').trim();
  // Body = remainder after the title line, with one leading blank line dropped.
  let j = i + 1;
  if (j < lines.length && lines[j]!.trim() === '') j++;
  const body = lines.slice(j).join('\n').replace(/\s+$/, '');
  return { title, body };
}

/** Deterministic fallback draft built from the commit log — used by --no-ai
   (R3), the over-limit gate (R7), and any SDK failure. Never throws. */
export function commitLogDraft(ctx: PrContext): PrDraft {
  const title = (ctx.commits[0] ?? ctx.head).trim() || ctx.head;
  const sections: string[] = [];
  if (ctx.commits.length > 0) {
    sections.push('## Commits', '', ...ctx.commits.map((c) => `- ${c}`));
  } else {
    sections.push(`Changes from \`${ctx.head}\` into \`${ctx.target}\`.`);
  }
  if (ctx.template) {
    sections.push('', '---', '', ctx.template.trim());
  }
  return { title, body: sections.join('\n') };
}

/* ── AI generation (lazy, fail-soft) ────────────────────────────────────── */

/** Pull assistant text out of one (loosely-typed) SDK message. SDK shape:
   { type:'assistant', message:{ content:[{ type:'text', text:string }, …] } }. */
function extractAssistantText(msg: unknown): string {
  if (typeof msg !== 'object' || msg === null) return '';
  const m = msg as { type?: unknown; message?: unknown };
  if (m.type !== 'assistant' || typeof m.message !== 'object' || m.message === null) return '';
  const content = (m.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (
      typeof block === 'object' && block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      out += (block as { text: string }).text;
    }
  }
  return out;
}

/** Lazily resolve the SDK `query`. Returns null on any import error (package
   absent, ESM resolution failure, …) so callers fall back gracefully. */
async function loadSdkQuery(): Promise<QueryFn | null> {
  try {
    const mod = (await import(SDK_SPECIFIER)) as { query?: unknown };
    return typeof mod.query === 'function' ? (mod.query as QueryFn) : null;
  } catch {
    return null;
  }
}

/** Draft a PR description with the Claude Agent SDK, falling back to the commit
   log on over-limit (R7), a missing/unauthed SDK, an empty result, or any throw.
   Reuses `~/.claude` ambient auth (R5) — no API key handling here. */
export async function generatePrDescription(ctx: PrContext, opts: GenerateOptions = {}): Promise<GeneratedDraft> {
  const diffLimit = opts.diffLimit ?? DEFAULT_DIFF_LIMIT;
  // A large diff no longer skips the AI — it gets a `git diff --stat` summary
  // (+ commits) instead of the full patch, so big PRs still get a real draft.
  const summarized = ctx.diffLines > diffLimit;

  const query = opts.query ?? (await loadSdkQuery());
  if (!query) {
    return { ...commitLogDraft(ctx), usedAi: false, note: 'AI unavailable — using commit-log draft' };
  }

  try {
    let text = '';
    for await (const msg of query({ prompt: buildPrompt(ctx, { summarized }), options: { maxTurns: 1, allowedTools: [] } })) {
      text += extractAssistantText(msg);
    }
    const parsed = parseDraft(text);
    if (!parsed.title) {
      return { ...commitLogDraft(ctx), usedAi: false, note: 'AI returned no draft — using commit-log draft' };
    }
    return {
      ...parsed,
      usedAi: true,
      ...(summarized ? { note: `large diff (${ctx.diffLines} lines) — summarized for the AI` } : {}),
    };
  } catch {
    return { ...commitLogDraft(ctx), usedAi: false, note: 'AI failed — using commit-log draft' };
  }
}

/* ── PR creation ────────────────────────────────────────────────────────── */

const PR_URL_RE = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/;

/** Pull the first PR URL out of gh's output lines, if present. */
export function extractPrUrl(lines: string[]): string | null {
  for (const line of lines) {
    const m = PR_URL_RE.exec(line);
    if (m) return m[0];
  }
  return null;
}

/** Open the PR via `gh pr create`, passing the (possibly multi-line) body
   through a temp `--body-file` to sidestep ARG_MAX and any shell-quoting hazard.
   The temp file is always unlinked. The PR URL is parsed from gh's output. */
export async function createPr(root: string, input: CreatePrInput, opts: RunOptions = {}): Promise<CreatePrResult> {
  const dir = await mkdtemp(join(tmpdir(), 'loom-pr-'));
  const bodyFile = join(dir, 'BODY.md');
  try {
    await writeFile(bodyFile, input.body, 'utf8');
    const argv = [
      'pr', 'create',
      '--base', input.target,
      '--head', input.head,
      '--title', input.title,
      '--body-file', bodyFile,
      ...(input.draft ? ['--draft'] : []),
    ];
    const result = await runGhArgv(root, argv, opts);
    return { url: extractPrUrl(result.lines), result };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
