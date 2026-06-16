import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepo, buildIgnorePredicate } from '../src/services/fsScan.js';
import { fallbackSearch, findInProject } from '../src/services/ripgrep.js';
import { ensureSeeded, loadSettings, saveConfig } from '../src/services/configIo.js';
import { createFile, loadBuffer, saveBuffer } from '../src/services/bufferIo.js';
import { stat } from 'node:fs/promises';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loom-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedRepo(): Promise<void> {
  await mkdir(join(dir, 'src/server'), { recursive: true });
  await mkdir(join(dir, 'dist'), { recursive: true });
  await mkdir(join(dir, '.git/objects'), { recursive: true });
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, '.gitignore'), 'dist/\n*.log\n');
  await writeFile(join(dir, 'docs/.gitignore'), 'private.md\n');
  await writeFile(join(dir, 'src/server/index.ts'), 'export const port = 8080;\nserver.listen(port);\n');
  await writeFile(join(dir, 'src/server/app.ts'), 'export const app = 1; // listen here\n');
  await writeFile(join(dir, 'dist/out.js'), 'ignored');
  await writeFile(join(dir, 'debug.log'), 'ignored');
  await writeFile(join(dir, '.git/objects/x'), 'never');
  await writeFile(join(dir, 'docs/private.md'), 'hidden by nested gitignore');
  await writeFile(join(dir, 'docs/public.md'), '# docs\n');
  await writeFile(join(dir, 'README.md'), '# readme\n');
}

describe('scanRepo', () => {
  test('respects root and nested .gitignore, always skips .git', async () => {
    await seedRepo();
    const { files, truncated } = await scanRepo(dir);
    expect(truncated).toBe(false);
    expect(files).toContain('src/server/index.ts');
    expect(files).toContain('README.md');
    expect(files).toContain('docs/public.md');
    expect(files).toContain('.gitignore');
    expect(files).not.toContain('dist/out.js');
    expect(files).not.toContain('debug.log');
    expect(files).not.toContain('docs/private.md');
    expect(files.some((f) => f.startsWith('.git/'))).toBe(false);
  });

  test('ignore predicate matches scan behavior for root rules', async () => {
    await seedRepo();
    const ignored = await buildIgnorePredicate(dir);
    expect(ignored(join(dir, 'dist'), true)).toBe(true);
    expect(ignored(join(dir, 'debug.log'), false)).toBe(true);
    expect(ignored(join(dir, '.git'), true)).toBe(true);
    expect(ignored(join(dir, 'src/server/index.ts'), false)).toBe(false);
  });
});

describe('search', () => {
  test('findInProject finds matches with ranges (rg or fallback)', async () => {
    await seedRepo();
    const res = await findInProject(dir, 'listen', async () => (await scanRepo(dir)).files);
    expect(res.matches).toBe(2);
    expect(res.fileCount).toBe(2);
    const idx = res.groups.find((g) => g.path === 'src/server/index.ts')!;
    expect(idx.hits[0]!.line).toBe(2);
    const hit = idx.hits[0]!;
    expect(hit.text.slice(hit.ranges[0]!.start, hit.ranges[0]!.end)).toBe('listen');
  });

  test('fallbackSearch mirrors smart-case and skips binary', async () => {
    await seedRepo();
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 108, 105, 115, 116, 101, 110]));
    const files = (await scanRepo(dir)).files;
    const res = await fallbackSearch(dir, 'LISTEN', files);
    expect(res.engine).toBe('fallback');
    expect(res.matches).toBe(0); // smart-case: uppercase query is case-sensitive
    const insensitive = await fallbackSearch(dir, 'listen', files);
    expect(insensitive.matches).toBe(2);
  });

  test('invalid regex yields empty result, no throw', async () => {
    await seedRepo();
    const res = await fallbackSearch(dir, '[', ['README.md']);
    expect(res.matches).toBe(0);
  });
});

describe('configIo with LOOM_HOME', () => {
  test('ensureSeeded + loadSettings + saveConfig round-trip', async () => {
    process.env.LOOM_HOME = join(dir, '.loom');
    try {
      await ensureSeeded();
      const first = await loadSettings();
      expect(first.warnings).toEqual([]);
      expect(first.config.theme).toBe('neon');
      expect(first.config.fuzzyMode).toBe('dim');
      expect(first.userThemes.has('custom-example')).toBe(true);

      await saveConfig({ ...first.config, accent: 'violet', gutter: false });
      const second = await loadSettings();
      expect(second.config.accent).toBe('violet');
      expect(second.config.gutter).toBe(false);

      // Seeding again must not clobber user changes.
      await ensureSeeded();
      const third = await loadSettings();
      expect(third.config.accent).toBe('violet');
    } finally {
      delete process.env.LOOM_HOME;
    }
  });

  test('broken yaml yields defaults plus a warning', async () => {
    process.env.LOOM_HOME = join(dir, '.loom');
    try {
      await ensureSeeded();
      await writeFile(join(dir, '.loom', 'config.yml'), 'theme: [unclosed\n');
      const settings = await loadSettings();
      expect(settings.config.theme).toBe('neon');
      expect(settings.warnings.length).toBeGreaterThan(0);
    } finally {
      delete process.env.LOOM_HOME;
    }
  });
});

describe('bufferIo', () => {
  test('load/save preserves trailing newline', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
    const buf = await loadBuffer(dir, 'a.txt');
    expect(buf.lines).toEqual(['one', 'two']);
    expect(buf.trailingNewline).toBe(true);
    await saveBuffer(dir, 'a.txt', [...buf.lines, 'three'], buf.trailingNewline);
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  test('no trailing newline preserved', async () => {
    await writeFile(join(dir, 'b.txt'), 'solo');
    const buf = await loadBuffer(dir, 'b.txt');
    expect(buf.lines).toEqual(['solo']);
    expect(buf.trailingNewline).toBe(false);
    await saveBuffer(dir, 'b.txt', buf.lines, buf.trailingNewline);
    expect(await readFile(join(dir, 'b.txt'), 'utf8')).toBe('solo');
  });

  test('binary file refuses to open', async () => {
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 1, 2]));
    await expect(loadBuffer(dir, 'bin.dat')).rejects.toThrow(/binary/);
  });
});

describe('createFile', () => {
  test('creates an empty file at the current level', async () => {
    const res = await createFile(dir, '', 'foo.ts');
    expect(res).toEqual({ ok: true, relPath: 'foo.ts' });
    expect(await readFile(join(dir, 'foo.ts'), 'utf8')).toBe('');
  });

  test('mkdir -p semantics for nested paths', async () => {
    const res = await createFile(dir, 'src', 'components/Button.tsx');
    expect(res).toEqual({ ok: true, relPath: 'src/components/Button.tsx' });
    expect(await readFile(join(dir, 'src/components/Button.tsx'), 'utf8')).toBe('');
    expect((await stat(join(dir, 'src/components'))).isDirectory()).toBe(true);
  });

  test('current level resolves under a selected dir', async () => {
    await mkdir(join(dir, 'src/ui'), { recursive: true });
    const res = await createFile(dir, 'src/ui', 'Panel.tsx');
    expect(res).toEqual({ ok: true, relPath: 'src/ui/Panel.tsx' });
    expect(await readFile(join(dir, 'src/ui/Panel.tsx'), 'utf8')).toBe('');
  });

  test('refuses to overwrite an existing file', async () => {
    await writeFile(join(dir, 'keep.ts'), 'precious');
    const res = await createFile(dir, '', 'keep.ts');
    expect(res).toEqual({ ok: false, reason: 'exists', relPath: 'keep.ts' });
    // Original content untouched.
    expect(await readFile(join(dir, 'keep.ts'), 'utf8')).toBe('precious');
  });

  test('rejects path traversal that escapes the repo', async () => {
    const res = await createFile(dir, 'src', '../../evil.ts');
    expect(res).toEqual({ ok: false, reason: 'traversal' });
  });

  test('rejects absolute paths', async () => {
    const res = await createFile(dir, 'src', '/etc/passwd');
    expect(res).toEqual({ ok: false, reason: 'absolute' });
  });

  test('empty arg is a soft no-op', async () => {
    expect(await createFile(dir, 'src', '   ')).toEqual({ ok: false, reason: 'empty' });
  });

  test('surfaces a friendly error when the parent path is a file', async () => {
    await writeFile(join(dir, 'blocked'), 'i am a file');
    const res = await createFile(dir, 'blocked', 'child.ts');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('error');
  });
});
