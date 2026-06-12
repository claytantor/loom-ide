/* Fuzzy filtering of the tree — the make-or-break interaction.
   Three visual treatments (config `fuzzyMode`):
     dim  — tree silhouette intact; non-matches drop to fg.dim
     hide — non-matching leaves removed; ancestors of matches kept
     flat — score-ranked flat list of matching paths */

import { fuzzyScore } from './fuzzy.js';
import { allFiles, type TreeNode } from './tree.js';

export type FuzzyMode = 'dim' | 'hide' | 'flat';

export interface FilterRow {
  node: TreeNode;
  depth: number;
  /** Render label/git in fg.dim (dim mode, non-match). */
  dim?: boolean;
  /** Flat mode: label is the full path. */
  flat?: boolean;
  /** Dir is force-expanded because a match lives beneath it. */
  autoOpen?: boolean;
}

export interface FilterResult {
  rows: FilterRow[];
  /** Matched char positions (into the full path) per matching file path. */
  matchByPath: ReadonlyMap<string, number[]>;
  /** Number of matching files. */
  count: number;
  /** Best-scored match — pre-selected while filtering. */
  topPath: string | null;
}

export function computeFilter(root: TreeNode, query: string, mode: FuzzyMode): FilterResult {
  const leaves = allFiles(root);
  const scored: { node: TreeNode; score: number; positions: number[] }[] = [];
  for (const f of leaves) {
    const m = fuzzyScore(query, f.path);
    if (m) scored.push({ node: f, ...m });
  }
  scored.sort((a, b) => b.score - a.score);
  const matchByPath = new Map<string, number[]>();
  for (const s of scored) matchByPath.set(s.node.path, s.positions);
  const topPath = scored[0]?.node.path ?? null;

  if (mode === 'flat') {
    return {
      rows: scored.map((s) => ({ node: s.node, depth: 0, flat: true })),
      matchByPath,
      count: scored.length,
      topPath,
    };
  }

  // dim / hide both walk the tree; collect ancestor dirs of matches.
  const matchPaths = new Set(scored.map((s) => s.node.path));
  const keepDir = new Set<string>();
  for (const s of scored) {
    const parts = s.node.path.split('/');
    for (let i = 1; i < parts.length; i++) keepDir.add(parts.slice(0, i).join('/'));
  }
  const rows: FilterRow[] = [];
  const walk = (node: TreeNode, depth: number): void => {
    for (const c of node.children ?? []) {
      if (c.type === 'dir') {
        const onPath = keepDir.has(c.path);
        if (mode === 'hide' && !onPath) continue;
        rows.push({ node: c, depth, dim: mode === 'dim' && !onPath, autoOpen: onPath });
        if (onPath || (mode === 'dim' && c.open)) walk(c, depth + 1);
      } else {
        const isMatch = matchPaths.has(c.path);
        if (mode === 'hide' && !isMatch) continue;
        rows.push({ node: c, depth, dim: mode === 'dim' && !isMatch });
      }
    }
  };
  walk(root, 0);
  return { rows, matchByPath, count: scored.length, topPath };
}
