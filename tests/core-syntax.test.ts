import { describe, expect, test } from 'vitest';
import { langFromPath, tokenizeLine } from '../src/core/syntax.js';

describe('langFromPath', () => {
  test('maps extensions', () => {
    expect(langFromPath('a/b/index.ts')).toBe('ts');
    expect(langFromPath('x.tsx')).toBe('ts');
    expect(langFromPath('x.jsx')).toBe('js');
    expect(langFromPath('deploy.sh')).toBe('sh');
    expect(langFromPath('main.py')).toBe('py');
    expect(langFromPath('cfg.yaml')).toBe('yaml');
    expect(langFromPath('README.md')).toBe('md');
    expect(langFromPath('Makefile')).toBe('plain');
  });
});

describe('tokenizeLine ts', () => {
  test('keywords, strings, functions, types, numbers, comments', () => {
    const toks = tokenizeLine('const x = createServer("hi"); // boot', 'ts');
    const kinds = Object.fromEntries(toks.map((t) => [t.v, t.t]));
    expect(kinds['const']).toBe('kw');
    expect(kinds['createServer']).toBe('fn');
    expect(kinds['"hi"']).toBe('string');
    expect(kinds['// boot']).toBe('comment');
  });
  test('capitalized identifier is a type', () => {
    const toks = tokenizeLine('let s: Server = x;', 'ts');
    expect(toks.find((t) => t.v === 'Server')!.t).toBe('type');
  });
  test('numbers tokenized', () => {
    const toks = tokenizeLine('p = 8080;', 'ts');
    expect(toks.find((t) => t.v === '8080')!.t).toBe('num');
  });
  test('unterminated string consumes rest of line without throwing', () => {
    const toks = tokenizeLine('x = "unterminated', 'ts');
    expect(toks[toks.length - 1]!.t).toBe('string');
  });
});

describe('tokenizeLine sh/py', () => {
  test('# comments in sh', () => {
    const toks = tokenizeLine('echo hi # done', 'sh');
    expect(toks.find((t) => t.v === '# done')!.t).toBe('comment');
    expect(toks.find((t) => t.v === 'echo')!.t).toBe('kw');
  });
  test('python keywords', () => {
    const toks = tokenizeLine('def f(): return None', 'py');
    expect(toks.find((t) => t.v === 'def')!.t).toBe('kw');
    expect(toks.find((t) => t.v === 'None')!.t).toBe('kw');
  });
});

describe('tokenizeLine yaml/md', () => {
  test('yaml key highlighted', () => {
    const toks = tokenizeLine('theme: neon', 'yaml');
    expect(toks.find((t) => t.v === 'theme')!.t).toBe('type');
  });
  test('md heading is one kw token', () => {
    expect(tokenizeLine('## Title', 'md')).toEqual([{ t: 'kw', v: '## Title' }]);
  });
  test('md inline code', () => {
    const toks = tokenizeLine('use `loom` now', 'md');
    expect(toks.find((t) => t.v === '`loom`')!.t).toBe('string');
  });
});

describe('plain + empty', () => {
  test('empty line → no tokens', () => {
    expect(tokenizeLine('', 'ts')).toEqual([]);
  });
  test('plain passes through', () => {
    expect(tokenizeLine('hello world', 'plain')).toEqual([{ t: 'ident', v: 'hello world' }]);
  });
});
