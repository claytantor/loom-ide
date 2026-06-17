import { describe, expect, test } from 'vitest';
import { detectNonExecCandidate } from '../src/core/execBit.js';

describe('detectNonExecCandidate', () => {
  test('extracts the path from a real bash Permission denied line', () => {
    const lines = ['bash: line 1: ./scripts/echome.sh: Permission denied'];
    expect(detectNonExecCandidate('./scripts/echome.sh', lines)).toBe('./scripts/echome.sh');
  });

  test('handles a Permission denied line without the bash prefix', () => {
    const lines = ['/usr/local/bin/tool: Permission denied'];
    expect(detectNonExecCandidate('/usr/local/bin/tool', lines)).toBe('/usr/local/bin/tool');
  });

  test('picks the offending line out of mixed output', () => {
    const lines = ['running...', 'bash: line 1: ./run.sh: Permission denied', 'done?'];
    expect(detectNonExecCandidate('./run.sh --flag', lines)).toBe('./run.sh');
  });

  test('returns null for normal (non-126-shaped) output', () => {
    expect(detectNonExecCandidate('ls -la', ['total 0', 'drwxr-xr-x  .'])).toBeNull();
  });

  test('ignores a line that merely contains the phrase mid-line', () => {
    const lines = ['note: Permission denied is a common error'];
    // No fallback path either (the command first token is a bare word).
    expect(detectNonExecCandidate('echo hi', lines)).toBeNull();
  });

  test('falls back to the command first token when it looks like a path', () => {
    expect(detectNonExecCandidate('./scripts/build.sh arg1', [])).toBe('./scripts/build.sh');
    expect(detectNonExecCandidate('../tools/x.sh', [])).toBe('../tools/x.sh');
    expect(detectNonExecCandidate('bin/run', [])).toBe('bin/run');
  });

  test('does not treat a bare command or a flag as a path candidate', () => {
    expect(detectNonExecCandidate('git status', [])).toBeNull();
    expect(detectNonExecCandidate('-x foo', [])).toBeNull();
    expect(detectNonExecCandidate('', [])).toBeNull();
  });

  test('Permission denied line wins over the first-token fallback', () => {
    const lines = ['bash: line 1: ./real.sh: Permission denied'];
    expect(detectNonExecCandidate('sudo ./real.sh', lines)).toBe('./real.sh');
  });
});
