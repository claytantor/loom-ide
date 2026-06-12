/* Fuzzy subsequence scorer — the spec'd algorithm from the design handoff:
   +10 at a path boundary (start, after `/` or `.`), +5 contiguous-run bonus,
   +1 otherwise, minus a small tail penalty so shorter targets rank higher. */

export interface FuzzyMatch {
  score: number;
  /** Indices into `target` of each matched character, ascending. */
  positions: number[];
}

export function fuzzyScore(query: string, target: string): FuzzyMatch | null {
  if (!query) return null;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  const positions: number[] = [];
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti);
      const boundary = ti === 0 || target[ti - 1] === '/' || target[ti - 1] === '.';
      score += boundary ? 10 : 1;
      if (ti === prevMatch + 1) score += 5;
      prevMatch = ti;
      qi++;
    }
  }
  if (qi !== q.length) return null;
  const last = positions[positions.length - 1] ?? 0;
  score -= (t.length - last) * 0.1;
  return { score, positions };
}
