---
name: feedback-lazy-optional-dep
description: Pattern for importing an optional npm package that may be absent, keeping tsc --noEmit green and tests passing whether or not it is installed
metadata:
  type: feedback
---

To depend on an npm package that may NOT be installed at typecheck/test time (loom uses this for
`@anthropic-ai/claude-agent-sdk` in `src/services/pr.ts`), while keeping `npm run typecheck` and
`npm test` green with the package absent:

**Rule:** import it lazily, through a COMPUTED specifier, typed as `unknown`, inside try/catch.

**Why:** A literal `await import('@pkg/name')` (or static import) under `NodeNext` emits
`TS2307: Cannot find module` when the package isn't installed — verified. A computed specifier the
compiler can't statically resolve sidesteps that without any `@ts-ignore` suppression.

**How to apply:**
```ts
const SDK_SPECIFIER = ['@anthropic-ai', 'claude-agent-sdk'].join('/'); // tsc can't resolve → can't error
type QueryFn = (args: { prompt: string; options?: unknown }) => AsyncIterable<unknown>;
async function loadSdkQuery(): Promise<QueryFn | null> {
  try {
    const mod = (await import(SDK_SPECIFIER)) as { query?: unknown };
    return typeof mod.query === 'function' ? (mod.query as QueryFn) : null;
  } catch { return null; }
}
```
Keep SDK message types loose (`unknown` + structural narrowing), never import the package's types.
On any failure (absent / ESM-resolution / auth / runtime throw) fall back to a non-AI path so the
feature degrades instead of crashing. The build emits the dynamic `import(SDK_SPECIFIER)` verbatim —
it is resolved at runtime only when the package is actually present.

**Testing:** make the function accept an injectable `query` (`opts.query`) so unit tests stub an
async generator yielding SDK-shaped messages (`{type:'assistant', message:{content:[{type:'text',
text}]}}`) — cover success, empty→fallback, sync-throw→fallback, async-throw-mid-iteration→fallback,
and the no-arg/no-SDK path (returns null → fallback). This keeps tests fast and SDK-independent.
Relevant for any optional/peer dependency, not just the Anthropic SDK.
