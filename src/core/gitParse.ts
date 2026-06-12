/* Pure parsers for git plumbing output. The spawning lives in services/git. */

import type { GitCode } from './tree.js';

export interface GitStatusResult {
  /** path → tree decoration code. */
  entries: Map<string, GitCode>;
  /** Count for the status readout ("N changed on disk"). */
  dirtyCount: number;
}

/** Parse `git status --porcelain=v1 -z` output. */
export function parseStatusPorcelainZ(out: string): GitStatusResult {
  const entries = new Map<string, GitCode>();
  const records = out.split('\0').filter((r) => r.length > 0);
  let i = 0;
  while (i < records.length) {
    const rec = records[i]!;
    if (rec.length < 4) {
      i++;
      continue;
    }
    const x = rec[0]!;
    const y = rec[1]!;
    const path = rec.slice(3);
    // Renames/copies carry the original path as the NEXT record — skip it.
    if (x === 'R' || x === 'C') i++;
    entries.set(path, codeFor(x, y));
    i++;
  }
  return { entries, dirtyCount: entries.size };
}

function codeFor(x: string, y: string): GitCode {
  if (x === '?' || y === '?') return '?';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return '!';
  if (x === 'D' || y === 'D') return '-';
  if (x === 'A' || x === 'R' || x === 'C') return '+';
  return 'M';
}

export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export function parseUnifiedDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const line of text.split('\n')) {
    if (line === '' && out.length === 0) continue;
    let kind: DiffLineKind;
    if (line.startsWith('@@')) kind = 'hunk';
    else if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ')
    ) kind = 'meta';
    else if (line.startsWith('+')) kind = 'add';
    else if (line.startsWith('-')) kind = 'del';
    else kind = 'ctx';
    out.push({ kind, text: line });
  }
  while (out.length > 0 && out[out.length - 1]!.text === '') out.pop();
  return out;
}

export interface BlameLine {
  hash: string;
  author: string;
  /** yyyy-mm-dd */
  date: string;
  lineNo: number;
  text: string;
}

/** Parse `git blame --line-porcelain` output. */
export function parseBlameLinePorcelain(text: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = text.split('\n');
  let cur: Partial<BlameLine> | null = null;
  for (const line of lines) {
    const header = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(line);
    if (header && header[1] !== undefined && header[2] !== undefined && !cur) {
      cur = { hash: header[1].slice(0, 8), lineNo: Number(header[2]) };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('author ')) {
      cur.author = line.slice('author '.length);
    } else if (line.startsWith('author-time ')) {
      const epoch = Number(line.slice('author-time '.length));
      if (Number.isFinite(epoch)) {
        cur.date = new Date(epoch * 1000).toISOString().slice(0, 10);
      }
    } else if (line.startsWith('\t')) {
      cur.text = line.slice(1);
      out.push({
        hash: cur.hash ?? '',
        author: cur.author ?? '?',
        date: cur.date ?? '',
        lineNo: cur.lineNo ?? 0,
        text: cur.text,
      });
      cur = null;
    }
  }
  return out;
}
