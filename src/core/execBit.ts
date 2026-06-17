/* Pure detection of bash's "not executable" failure. No Node, no fs — just
   string analysis over the original /bash command and its captured output, so it
   unit-tests in isolation.

   When `bash -c "./scripts/x.sh"` runs a file that lacks the execute bit, bash
   exits 126 and emits a line like:

     bash: line 1: ./scripts/echome.sh: Permission denied

   The path is the segment immediately before `: Permission denied`. This module
   extracts that candidate so the app layer can offer to chmod +x and re-run.
   The detector is deliberately conservative about *shape* only — the real gate
   (resolves under the repo root, is an existing non-executable regular file)
   happens in the service/fs layer, so a false positive here is harmless. */

const PERMISSION_DENIED = ': Permission denied';

/**
 * Given the original `/bash` command string and the captured result lines,
 * return a candidate script path to chmod +x, or null when nothing looks like a
 * not-executable failure.
 *
 * Primary signal: a result line ending in `: Permission denied` — the path is
 * the token immediately before that suffix.
 *
 * Fallback: when no such line is present, use the command's first whitespace-
 * delimited token if it looks like a runnable file path (starts with `./`,
 * `../`, `/`, or contains a `/`), never a flag/option.
 */
export function detectNonExecCandidate(command: string, lines: readonly string[]): string | null {
  for (const line of lines) {
    const idx = line.indexOf(PERMISSION_DENIED);
    // The suffix must terminate the line so we don't misread a path that merely
    // contains the phrase mid-line.
    if (idx >= 0 && line.slice(idx) === PERMISSION_DENIED) {
      const candidate = line.slice(0, idx).trimEnd();
      // bash prefixes the path with `bash: line N: ` — strip everything up to and
      // including the last `: ` so we're left with just the path token.
      const lastColon = candidate.lastIndexOf(': ');
      const path = (lastColon >= 0 ? candidate.slice(lastColon + 2) : candidate).trim();
      if (path) return path;
    }
  }

  // Fallback: the first token of the command, if it reads like a file path.
  const first = command.trim().split(/\s+/)[0];
  if (first && !first.startsWith('-') && looksLikePath(first)) return first;
  return null;
}

/** A token is a runnable file-path candidate if it's explicitly relative,
   absolute, or otherwise contains a path separator (not a bare `git`/`ls`). */
function looksLikePath(token: string): boolean {
  return token.startsWith('./') || token.startsWith('../') || token.startsWith('/') || token.includes('/');
}
