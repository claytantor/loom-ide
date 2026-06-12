---
name: project-loom-ide
description: loom-ide overview — an Ink TUI IDE; Ink major version, verification gates, state/service architecture, where the editor save flow lives
metadata:
  type: project
---

loom-ide is an Ink-powered terminal IDE that runs beside Claude Code: fuzzy file tree (left),
single-file vim editor or command output (center), omni-bar (bottom). Pure-TS, ESM, `.js` import
specifiers, strict tsconfig (`strict:true`, `NodeNext`).

**Ink major version: v5 (`ink@^5.2.1`)** — NOT v6. React 18. `ink-testing-library` for view tests.
Do not assume v6-only props/hooks.

**Verification gates (the only ones that run — there is NO eslint installed/configured):**
- `npm run typecheck` (tsc --noEmit, 0 errors)
- `npm test` (vitest run)
- `npm run build` (tsc -p tsconfig.build.json; build includes only `src`, not tests)
- `npm run smoke` (scripts/smoke.ts — drives the built `dist/cli.js` in a real PTY via util-linux
  `script`, asserts no crash + clean exit). PTY smoke scripts use top-level await, so a standalone
  copy must be `.mts` (or live in the project) or tsx infers CJS and fails.

**Architecture (the load-bearing split):**
- `src/app/App.tsx` — the ONLY place with side effects (disk/git/lsp/timers/clipboard). All the
  command orchestration callbacks live here (`runPr`, `runPassthru`, `runFind`, `saveNow`,
  `handleVimEffects`, key router in one big `useInput`). State lives in a `useReducer`; a
  `stateRef.current` mirror is read inside callbacks/key-handlers (dispatch is async).
- `src/state/{types,reducer,commands}.ts` — pure. Reducer is synchronous state arithmetic, no
  engine/IO imports. `commands.ts` `SLASH_COMMANDS` registry drives both the palette and the
  `/help` rows (HELP_ROWS in OutputViews.tsx) — add a command once, it shows in both.
- `src/services/*` — typed, root-parameterized, unit-testable. `passthru.ts` spawns CLIs
  (`/gh`,`/git`) with no shell (quote-aware `parseArgv`); `git.ts` wraps the git binary via
  execFile and degrades to null/empty. `pr.ts` is the `/pr` PR service.
- `src/core/vim/*` — the vim engine (pure). `runEx` returns `{state, effects:VimEffects}` where
  effects are `{save?,quit?,forced?,message?}`. `:w`→save, `:wq`→save+quit, `:q!`→quit+forced.

**Editor is path-agnostic:** `<Editor>` renders whatever `vim` lines it's given and shows `path`
in its status line — it does not require a real file. This is what makes the `/pr` ephemeral
compose buffer possible. See [[feedback-save-interception]].

**Config:** `LoomConfig` in `src/core/config.ts`, validated field-by-field in `mergeConfig` (push a
warning + keep default on bad input). Seed docs in `src/services/seeds.ts` (`SEED_CONFIG_YML`).
`saveConfig` round-trips the whole object to `~/.loom/config.yml` automatically.

**Test harness to reuse:** `tests/services-passthru.test.ts` has a fake-bin pattern — write a bash
script to a tmp file, `chmod 0o755`, pass it via `opts.bin`. Lets you assert exact argv a CLI
received without a real `gh`/`git`. `pr.ts`/`passthru.ts` all take `opts.bin` for this reason.
