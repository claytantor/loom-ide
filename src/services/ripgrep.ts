/* Project content search: ripgrep when on $PATH, pure-TS fallback otherwise.
   Caps are reported, never silent. */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const FIND_CAP = 500;
const MAX_FALLBACK_FILE_BYTES = 1024 * 1024;

export interface FindHit {
  line: number;
  text: string;
  ranges: { start: number; end: number }[];
}

export interface FindGroup {
  path: string;
  hits: FindHit[];
}

export interface FindResult {
  query: string;
  groups: FindGroup[];
  matches: number;
  fileCount: number;
  truncated: boolean;
  engine: 'ripgrep' | 'fallback';
}

interface RgSubmatch { start: number; end: number }
interface RgMatchData {
  path?: { text?: string };
  line_number?: number;
  lines?: { text?: string };
  submatches?: RgSubmatch[];
}

export async function findInProject(
  root: string,
  query: string,
  fallbackFiles: () => Promise<string[]>,
): Promise<FindResult> {
  const viaRg = await ripgrepSearch(root, query);
  if (viaRg) return viaRg;
  return fallbackSearch(root, query, await fallbackFiles());
}

function ripgrepSearch(root: string, query: string): Promise<FindResult | null> {
  return new Promise((resolve) => {
    let proc;
    try {
      // stdin must be ignored: with a piped stdin rg searches the pipe, not cwd.
      proc = spawn('rg', ['--json', '--smart-case', '--regexp', query, '.'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve(null);
      return;
    }
    const groups = new Map<string, FindGroup>();
    let matches = 0;
    let truncated = false;
    let spawnFailed = false;

    proc.on('error', () => {
      spawnFailed = true;
      resolve(null);
    });

    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      if (truncated) return;
      let msg: { type?: string; data?: RgMatchData };
      try {
        msg = JSON.parse(line) as { type?: string; data?: RgMatchData };
      } catch {
        return;
      }
      if (msg.type !== 'match' || !msg.data) return;
      const path = msg.data.path?.text?.replace(/^\.\//, '');
      const lineNo = msg.data.line_number;
      const text = msg.data.lines?.text?.replace(/\r?\n$/, '');
      if (!path || lineNo === undefined || text === undefined) return;
      let group = groups.get(path);
      if (!group) {
        group = { path, hits: [] };
        groups.set(path, group);
      }
      group.hits.push({
        line: lineNo,
        text,
        ranges: (msg.data.submatches ?? []).map((s) => ({ start: s.start, end: s.end })),
      });
      matches++;
      if (matches >= FIND_CAP) {
        truncated = true;
        proc.kill('SIGTERM');
      }
    });

    proc.on('close', () => {
      if (spawnFailed) return;
      resolve({
        query,
        groups: [...groups.values()],
        matches,
        fileCount: groups.size,
        truncated,
        engine: 'ripgrep',
      });
    });
  });
}

export async function fallbackSearch(root: string, query: string, files: string[]): Promise<FindResult> {
  let re: RegExp;
  try {
    const caseSensitive = /[A-Z]/.test(query); // mirror rg --smart-case
    re = new RegExp(query, caseSensitive ? 'g' : 'gi');
  } catch {
    return { query, groups: [], matches: 0, fileCount: 0, truncated: false, engine: 'fallback' };
  }
  const groups: FindGroup[] = [];
  let matches = 0;
  let truncated = false;
  for (const rel of files) {
    if (truncated) break;
    let text: string;
    try {
      const buf = await readFile(join(root, rel));
      if (buf.length > MAX_FALLBACK_FILE_BYTES || buf.includes(0)) continue;
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    let group: FindGroup | null = null;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && !truncated; i++) {
      const line = lines[i]!;
      re.lastIndex = 0;
      const ranges: { start: number; end: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (m[0] === '') {
          re.lastIndex++;
          continue;
        }
        ranges.push({ start: m.index, end: m.index + m[0].length });
      }
      if (ranges.length === 0) continue;
      if (!group) {
        group = { path: rel, hits: [] };
        groups.push(group);
      }
      group.hits.push({ line: i + 1, text: line, ranges });
      matches++;
      if (matches >= FIND_CAP) truncated = true;
    }
  }
  return { query, groups, matches, fileCount: groups.length, truncated, engine: 'fallback' };
}
