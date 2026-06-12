/* Line tokenizer for editor syntax highlighting.
   Stateless per line (multi-line comments/strings render as code — accepted
   limitation, noted in docs). Scopes map to theme tokens via SYNTAX_TOKEN. */

export type TokenKind = 'kw' | 'string' | 'comment' | 'num' | 'fn' | 'type' | 'ident' | 'punct' | 'ws';

export interface Token {
  t: TokenKind;
  v: string;
}

export type Lang = 'ts' | 'js' | 'json' | 'sh' | 'py' | 'yaml' | 'md' | 'plain';

const EXT_LANG: Record<string, Lang> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  json: 'json',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  py: 'py', pyi: 'py',
  yml: 'yaml', yaml: 'yaml',
  md: 'md', markdown: 'md',
};

export function langFromPath(path: string): Lang {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'plain';
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? 'plain';
}

const TS_KW = new Set(
  ('import export from const let var function return if else for while do switch case break continue new class ' +
    'interface extends implements type as of in await async void null undefined true false this super typeof ' +
    'instanceof keyof readonly enum namespace declare default try catch finally throw yield static get set ' +
    'public private protected abstract satisfies').split(' '),
);
const PY_KW = new Set(
  ('def return if elif else for while in not and or is None True False import from as class try except finally ' +
    'raise with lambda yield global nonlocal pass break continue del assert async await match case self').split(' '),
);
const SH_KW = new Set(
  ('if then else elif fi for while do done case esac function in local return exit export readonly set unset ' +
    'echo source shift trap').split(' '),
);

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c);
}

function tokenizeCode(line: string, kw: ReadonlySet<string>, comment: '//' | '#'): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (t: TokenKind, v: string): void => {
    if (v) tokens.push({ t, v });
  };
  while (i < line.length) {
    const c = line[i]!;
    if (comment === '//' ? c === '/' && line[i + 1] === '/' : c === '#') {
      push('comment', line.slice(i));
      break;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== c) {
        if (line[j] === '\\') j++;
        j++;
      }
      push('string', line.slice(i, Math.min(j + 1, line.length)));
      i = j + 1;
      continue;
    }
    if (/\s/.test(c)) {
      let j = i;
      while (j < line.length && /\s/.test(line[j]!)) j++;
      push('ws', line.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < line.length && isWordChar(line[j]!)) j++;
      const word = line.slice(i, j);
      let kind: TokenKind = 'ident';
      if (kw.has(word)) kind = 'kw';
      else if (line[j] === '(') kind = 'fn';
      else if (/^[A-Z]/.test(word)) kind = 'type';
      push(kind, word);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < line.length && /[0-9._xa-fA-F]/.test(line[j]!)) j++;
      push('num', line.slice(i, j));
      i = j;
      continue;
    }
    push('punct', c);
    i++;
  }
  return tokens;
}

function tokenizeYaml(line: string): Token[] {
  const m = /^(\s*)(- )?([^:#'"]+)(:)(\s|$)/.exec(line);
  if (m) {
    const head = (m[1] ?? '') + (m[2] ?? '');
    const key = m[3] ?? '';
    const rest = line.slice(head.length + key.length + 1);
    const out: Token[] = [];
    if (head) out.push({ t: 'ws', v: head });
    out.push({ t: 'type', v: key }, { t: 'punct', v: ':' });
    out.push(...tokenizeCode(rest, new Set(), '#'));
    return out;
  }
  return tokenizeCode(line, new Set(['true', 'false', 'null']), '#');
}

function tokenizeMd(line: string): Token[] {
  if (/^#{1,6}\s/.test(line)) return [{ t: 'kw', v: line }];
  if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
    const m = /^(\s*)([-*+]|\d+\.)(\s)/.exec(line)!;
    const head = m[0]!;
    return [{ t: 'punct', v: head }, ...inlineMd(line.slice(head.length))];
  }
  if (/^\s{4,}|^\t/.test(line) || /^```/.test(line)) return [{ t: 'string', v: line }];
  if (/^>/.test(line)) return [{ t: 'comment', v: line }];
  return inlineMd(line);
}

function inlineMd(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let plain = '';
  const flush = (): void => {
    if (plain) out.push({ t: 'ident', v: plain });
    plain = '';
  };
  while (i < text.length) {
    if (text[i] === '`') {
      const j = text.indexOf('`', i + 1);
      if (j > i) {
        flush();
        out.push({ t: 'string', v: text.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  flush();
  return out;
}

export function tokenizeLine(line: string, lang: Lang): Token[] {
  if (!line) return [];
  switch (lang) {
    case 'ts':
    case 'js':
      return tokenizeCode(line, TS_KW, '//');
    case 'json':
      return tokenizeCode(line, new Set(['true', 'false', 'null']), '//');
    case 'sh':
      return tokenizeCode(line, SH_KW, '#');
    case 'py':
      return tokenizeCode(line, PY_KW, '#');
    case 'yaml':
      return tokenizeYaml(line);
    case 'md':
      return tokenizeMd(line);
    default:
      return [{ t: 'ident', v: line }];
  }
}
