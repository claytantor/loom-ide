import { describe, expect, test } from 'vitest';
import { currentLevelDir, resolveAddPath } from '../src/core/addPath.js';

describe('currentLevelDir', () => {
  test('selected dir → create inside it', () => {
    expect(currentLevelDir('src/ui', 'dir')).toBe('src/ui');
  });
  test('selected file → its parent dir (sibling)', () => {
    expect(currentLevelDir('src/ui/OmniBar.tsx', 'file')).toBe('src/ui');
  });
  test('top-level file → repo root', () => {
    expect(currentLevelDir('README.md', 'file')).toBe('');
  });
  test('nothing selected → repo root', () => {
    expect(currentLevelDir(null, 'none')).toBe('');
    expect(currentLevelDir('whatever', 'none')).toBe('');
  });
});

describe('resolveAddPath', () => {
  test('simple file at root level', () => {
    const r = resolveAddPath('', 'foo.ts');
    expect(r).toEqual({ ok: true, relPath: 'foo.ts', parentDir: '' });
  });
  test('simple file under a current level dir', () => {
    const r = resolveAddPath('src/ui', 'Panel.tsx');
    expect(r).toEqual({ ok: true, relPath: 'src/ui/Panel.tsx', parentDir: 'src/ui' });
  });
  test('nested arg implies intermediate dirs', () => {
    const r = resolveAddPath('src', 'components/Button.tsx');
    expect(r).toEqual({ ok: true, relPath: 'src/components/Button.tsx', parentDir: 'src/components' });
  });
  test('normalizes . and duplicate slashes', () => {
    const r = resolveAddPath('src', './a//b.ts');
    expect(r).toEqual({ ok: true, relPath: 'src/a/b.ts', parentDir: 'src/a' });
  });
  test('backslashes are treated as separators', () => {
    const r = resolveAddPath('src', 'a\\b.ts');
    expect(r).toEqual({ ok: true, relPath: 'src/a/b.ts', parentDir: 'src/a' });
  });

  test('empty / whitespace arg is a soft no-op', () => {
    expect(resolveAddPath('src', '')).toEqual({ ok: false, reason: 'empty' });
    expect(resolveAddPath('src', '   ')).toEqual({ ok: false, reason: 'empty' });
    expect(resolveAddPath('src', '.')).toEqual({ ok: false, reason: 'empty' });
  });

  test('.. that stays within a deep current level is allowed', () => {
    // src/ui + ../core/x.ts → src/core/x.ts (still inside the repo)
    const r = resolveAddPath('src/ui', '../core/x.ts');
    expect(r).toEqual({ ok: true, relPath: 'src/core/x.ts', parentDir: 'src/core' });
  });
  test('.. that escapes the repo root is rejected', () => {
    expect(resolveAddPath('', '../evil.ts')).toEqual({ ok: false, reason: 'traversal' });
    expect(resolveAddPath('src', '../../etc/passwd')).toEqual({ ok: false, reason: 'traversal' });
  });
  test('absolute paths are rejected', () => {
    expect(resolveAddPath('src', '/etc/passwd')).toEqual({ ok: false, reason: 'absolute' });
    expect(resolveAddPath('src', 'C:\\Windows\\x')).toEqual({ ok: false, reason: 'absolute' });
  });
});
