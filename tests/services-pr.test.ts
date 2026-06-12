import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, chmod, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  buildPrompt, commitLogDraft, createPr, extractPrUrl, findPrTemplate,
  generatePrDescription, parseDraft, preflightAuth,
  type PrContext, type QueryFn,
} from '../src/services/pr.js';

// The real-import fallback can only be exercised when the SDK is genuinely
// absent; with it installed, `loadSdkQuery()` returns the real `query`, which
// would spawn a live `claude` subprocess. Detect presence so that test can skip.
const SDK_INSTALLED = (() => {
  try {
    createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
    return true;
  } catch {
    return false;
  }
})();

/* ── pure parsing ─────────────────────────────────────────────────────────── */

describe('parseDraft', () => {
  test('first non-empty line is the title; body follows the first blank line', () => {
    expect(parseDraft('Add login flow\n\nThis wires the form to the API.\nWith retries.')).toEqual({
      title: 'Add login flow',
      body: 'This wires the form to the API.\nWith retries.',
    });
  });
  test('strips a leading markdown heading from the title', () => {
    expect(parseDraft('# Fix the bug\n\nbody').title).toBe('Fix the bug');
    expect(parseDraft('### Deep\n\nbody').title).toBe('Deep');
  });
  test('skips leading blank lines before the title', () => {
    expect(parseDraft('\n\n\nTitle here\n\nbody')).toEqual({ title: 'Title here', body: 'body' });
  });
  test('title-only input yields an empty body', () => {
    expect(parseDraft('Just a title')).toEqual({ title: 'Just a title', body: '' });
  });
  test('empty / whitespace input never throws and yields empty fields', () => {
    expect(parseDraft('')).toEqual({ title: '', body: '' });
    expect(parseDraft('   \n  \n')).toEqual({ title: '', body: '' });
  });
  test('handles CRLF line endings', () => {
    expect(parseDraft('Title\r\n\r\nbody line')).toEqual({ title: 'Title', body: 'body line' });
  });
});

describe('commitLogDraft', () => {
  const base: PrContext = { target: 'main', head: 'feature/x', commits: [], diff: '', diffLines: 0, diffStat: '', template: null };

  test('title is the first commit subject; body lists all commits', () => {
    const d = commitLogDraft({ ...base, commits: ['Add A', 'Fix B', 'Refactor C'] });
    expect(d.title).toBe('Add A');
    expect(d.body).toContain('## Commits');
    expect(d.body).toContain('- Add A');
    expect(d.body).toContain('- Fix B');
    expect(d.body).toContain('- Refactor C');
  });
  test('falls back to the branch name when there are no commits', () => {
    const d = commitLogDraft(base);
    expect(d.title).toBe('feature/x');
    expect(d.body).toContain('feature/x');
    expect(d.body).toContain('main');
  });
  test('appends the template when present', () => {
    const d = commitLogDraft({ ...base, commits: ['Add A'], template: '## Checklist\n- [ ] tests' });
    expect(d.body).toContain('## Checklist');
    expect(d.body).toContain('- [ ] tests');
  });
});

describe('buildPrompt', () => {
  test('includes commits, the diff, and base/head, and asks for title-first output', () => {
    const p = buildPrompt({ target: 'dev', head: 'feat', commits: ['Do thing'], diff: '+added line', diffLines: 1, diffStat: '', template: null });
    expect(p).toContain('"feat"');
    expect(p).toContain('"dev"');
    expect(p).toContain('- Do thing');
    expect(p).toContain('+added line');
    expect(p.toLowerCase()).toContain('first line');
  });
  test('threads a template through when present', () => {
    const p = buildPrompt({ target: 'dev', head: 'feat', commits: [], diff: '', diffLines: 0, diffStat: '', template: '## My Template' });
    expect(p).toContain('## My Template');
    expect(p).toContain('TEMPLATE');
  });
  test('summarized mode sends the diff --stat, not the full patch', () => {
    const p = buildPrompt(
      { target: 'dev', head: 'feat', commits: ['Big change'], diff: 'HUGE_PATCH', diffLines: 9999, diffStat: ' app.ts | 200 ++++', template: null },
      { summarized: true },
    );
    expect(p).toContain('git diff --stat');
    expect(p).toContain('app.ts | 200');
    expect(p).not.toContain('HUGE_PATCH');
  });
});

describe('extractPrUrl', () => {
  test('pulls the pull-request URL out of mixed output', () => {
    expect(extractPrUrl(['Warning: ...', 'https://github.com/acme/widgets/pull/42'])).toBe(
      'https://github.com/acme/widgets/pull/42',
    );
  });
  test('returns null when no URL is present', () => {
    expect(extractPrUrl(['nothing here', 'still nothing'])).toBeNull();
  });
});

/* ── template discovery (temp dirs) ───────────────────────────────────────── */

describe('findPrTemplate', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loom-prtmpl-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('returns null when no template exists', async () => {
    expect(await findPrTemplate(dir)).toBeNull();
  });
  test('finds .github/PULL_REQUEST_TEMPLATE.md', async () => {
    await mkdir(join(dir, '.github'), { recursive: true });
    await writeFile(join(dir, '.github', 'PULL_REQUEST_TEMPLATE.md'), '## Summary\n\n- describe it');
    expect(await findPrTemplate(dir)).toContain('## Summary');
  });
  test('finds a repo-root pull_request_template.md', async () => {
    await writeFile(join(dir, 'pull_request_template.md'), '## Root template');
    expect(await findPrTemplate(dir)).toContain('## Root template');
  });
  test('ignores an empty template file', async () => {
    await mkdir(join(dir, '.github'), { recursive: true });
    await writeFile(join(dir, '.github', 'PULL_REQUEST_TEMPLATE.md'), '   \n  \n');
    expect(await findPrTemplate(dir)).toBeNull();
  });
});

/* ── AI generation with a stubbed query (no SDK, no network) ───────────────── */

/** Build a QueryFn that yields SDK-shaped assistant messages with the given text. */
function fakeQuery(text: string): QueryFn {
  return async function* () {
    yield { type: 'system', subtype: 'init' };
    yield { type: 'assistant', message: { content: [{ type: 'text', text }] } };
    yield { type: 'result', subtype: 'success' };
  };
}

const ctx: PrContext = {
  target: 'main',
  head: 'feature/login',
  commits: ['Add login form', 'Wire API'],
  diff: '+const a = 1;\n-const a = 0;',
  diffLines: 2,
  diffStat: ' login.ts | 2 +-',
  template: null,
};

describe('generatePrDescription', () => {
  test('parses a successful AI draft and marks usedAi', async () => {
    const query = fakeQuery('Add login\n\nImplements the login form and wires it to the API.');
    const d = await generatePrDescription(ctx, { query });
    expect(d.usedAi).toBe(true);
    expect(d.title).toBe('Add login');
    expect(d.body).toContain('login form');
    expect(d.note).toBeUndefined();
  });

  test('concatenates text across multiple text blocks', async () => {
    const query: QueryFn = async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Title line\n\nbody ' }, { type: 'text', text: 'continued.' }] } };
    };
    const d = await generatePrDescription(ctx, { query });
    expect(d.title).toBe('Title line');
    expect(d.body).toBe('body continued.');
  });

  test('empty AI output falls back to the commit-log draft', async () => {
    const query = fakeQuery('   ');
    const d = await generatePrDescription(ctx, { query });
    expect(d.usedAi).toBe(false);
    expect(d.title).toBe('Add login form'); // first commit subject
    expect(d.note).toMatch(/commit-log/i);
  });

  test('a throwing query falls back to the commit-log draft', async () => {
    const query: QueryFn = () => {
      throw new Error('SDK exploded');
    };
    const d = await generatePrDescription(ctx, { query });
    expect(d.usedAi).toBe(false);
    expect(d.title).toBe('Add login form');
    expect(d.note).toMatch(/commit-log/i);
  });

  test('an async-throwing query (mid-iteration) also falls back', async () => {
    const query: QueryFn = async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } };
      throw new Error('stream died');
    };
    const d = await generatePrDescription(ctx, { query });
    expect(d.usedAi).toBe(false);
    expect(d.note).toMatch(/commit-log/i);
  });

  test('an over-limit diff STILL uses the AI, but with a diff --stat summary', async () => {
    let seenPrompt = '';
    const query: QueryFn = async function* (args) {
      seenPrompt = args.prompt;
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Big feature\n\nsummary' }] } };
    };
    const big = { ...ctx, diffLines: 5000, diffStat: ' a.ts | 999 ++++', diff: 'FULL_PATCH' };
    const d = await generatePrDescription(big, { query, diffLimit: 1000 });
    expect(d.usedAi).toBe(true); // no longer skipped
    expect(d.title).toBe('Big feature');
    expect(d.note).toMatch(/large diff.*5000/i);
    expect(seenPrompt).toContain('git diff --stat'); // summarized prompt
    expect(seenPrompt).not.toContain('FULL_PATCH'); // full patch withheld
  });

  // Only meaningful when the SDK is absent — with it installed, the real import
  // succeeds and `query()` would spawn a live `claude` subprocess.
  test.skipIf(SDK_INSTALLED)('without an injected query and no SDK installed, falls back without throwing', async () => {
    // No opts.query, package absent → loadSdkQuery() returns null → commit-log.
    const d = await generatePrDescription(ctx);
    expect(d.usedAi).toBe(false);
    expect(d.title).toBe('Add login form');
    expect(d.note).toMatch(/AI unavailable|commit-log/i);
  });
});

/* ── gh-backed flows with a fake bin (reuses the passthru fake-bin harness) ── */

describe('preflightAuth + createPr (fake gh)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loom-pr-gh-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function fake(body: string): Promise<string> {
    const p = join(dir, 'fakegh');
    await writeFile(p, `#!/usr/bin/env bash\n${body}\n`);
    await chmod(p, 0o755);
    return p;
  }

  test('preflightAuth reports ok on a zero-exit gh auth status', async () => {
    const bin = await fake('echo "Logged in to github.com as octocat"');
    const r = await preflightAuth(dir, { bin });
    expect(r.ok).toBe(true);
    expect(r.result.argv).toEqual(['auth', 'status']);
  });

  test('preflightAuth reports failure on a non-zero gh auth status', async () => {
    const bin = await fake('echo "You are not logged into any GitHub hosts." >&2; exit 1');
    const r = await preflightAuth(dir, { bin });
    expect(r.ok).toBe(false);
    expect(r.result.lines.join(' ')).toContain('not logged into');
  });

  test('createPr passes a well-formed argv and extracts the PR URL', async () => {
    // Echo argv (one per line) so we can assert the exact shape gh received.
    const bin = await fake('printf "%s\\n" "$@"; echo "https://github.com/acme/widgets/pull/7"');
    const { url, result } = await createPr(
      dir,
      { target: 'main', head: 'feature/x', title: 'My title', body: 'line one\nline two', draft: false },
      { bin },
    );
    expect(result.ok).toBe(true);
    expect(url).toBe('https://github.com/acme/widgets/pull/7');
    // argv shape: pr create --base main --head feature/x --title <t> --body-file <path>
    expect(result.argv.slice(0, 8)).toEqual([
      'pr', 'create', '--base', 'main', '--head', 'feature/x', '--title', 'My title',
    ]);
    expect(result.argv[8]).toBe('--body-file');
    expect(result.argv[9]).toMatch(/BODY\.md$/);
    expect(result.argv).not.toContain('--draft');
  });

  test('createPr appends --draft when requested (R4)', async () => {
    const bin = await fake('printf "%s\\n" "$@"');
    const { result } = await createPr(
      dir,
      { target: 'dev', head: 'feat', title: 't', body: 'b', draft: true },
      { bin },
    );
    expect(result.argv).toContain('--draft');
    expect(result.argv[result.argv.length - 1]).toBe('--draft');
  });

  test('createPr writes the body verbatim to the --body-file gh receives', async () => {
    // The fake gh copies its --body-file to a sentinel we can read back.
    const sentinel = join(dir, 'received-body.txt');
    const bin = await fake(`
      while [ "$#" -gt 0 ]; do
        if [ "$1" = "--body-file" ]; then cp "$2" "${sentinel}"; shift; fi
        shift
      done
      echo "https://github.com/x/y/pull/1"
    `);
    const body = 'Summary line\n\n## Changes\n- one\n- two\nwith $special `chars`';
    await createPr(dir, { target: 'main', head: 'f', title: 't', body, draft: false }, { bin });
    expect(await readFile(sentinel, 'utf8')).toBe(body);
  });

  test('createPr cleans up its temp dir even on a gh failure', async () => {
    const before = await readdir(tmpdir());
    const bin = await fake('echo "gh: pull request already exists" >&2; exit 1');
    const { url, result } = await createPr(
      dir,
      { target: 'main', head: 'f', title: 't', body: 'b', draft: false },
      { bin },
    );
    expect(result.ok).toBe(false);
    expect(url).toBeNull();
    // No leftover loom-pr-* temp dirs from this call (the finally unlinks them).
    const after = (await readdir(tmpdir())).filter((n) => n.startsWith('loom-pr-'));
    const leaked = after.filter((n) => !before.includes(n));
    expect(leaked).toEqual([]);
  });
});
