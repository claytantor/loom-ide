# Loom — Design Guide

> **How to use this document.** This is the design brief for Loom, a terminal
> (TUI) IDE built with [Ink](https://github.com/vadimdemedes/ink). It is written
> to be handed directly to an AI design assistant *or* a human contributor as the
> single source of truth for how Loom looks and behaves. When generating designs
> or components, treat every constraint here as binding and every mockup as
> indicative of intent, not pixel law. Where this guide is silent, prefer the
> calmest, most terminal-native option that upholds the principles below.

---

## 1. Product context (read first)

Loom is a TUI IDE that runs over SSH, **beside Claude Code**. The user keeps an
AI agent working in one pane and Loom in another, on the same repository. Loom is
the human's cockpit: navigate the repo, watch what the agent changes live, and
make precise hand edits to one file at a time.

Three facts drive the entire design:

1. **The file tree is the hero.** It is the primary navigation surface and the
   launch point for almost every action. More design care goes here than
   anywhere else.
2. **One thing in the main area at a time.** Either the single open file (a full
   vim editor) or the output of a command. Never both, never tabs.
3. **One input at the bottom.** A mode-switched omni-bar: fuzzy-filter, slash
   command, or vim ex line, chosen by what the user types.

The aesthetic target is **"Loom neon, refined"**: carry Loom's neon-bright
heritage, but disciplined — a high-contrast dark canvas with one or two
confident accent colors used sparingly, not a noisy rainbow. It should read as
modern and calm like Claude Code, with a recognizable Loom identity.

---

## 2. Design principles

1. **The terminal is sacred.** Never capture the mouse. Never draw border
   characters *inside* the work area (the editor and output region). Selections
   must yield clean, copy-pasteable text. The line-number gutter must be
   togglable so users can select code without line numbers.
2. **Tree-first.** Optimize relentlessly for finding and acting on files from the
   tree. Every interaction should reward keyboard fluency and reveal the next
   action without a manual.
3. **One focus.** Resist density. A single open file, a single main view, a
   single input. Calm beats crowded.
4. **Color is meaning.** The neon accent is a scarce resource. Reserve it for the
   active selection, the caret, and live/important state. If everything glows,
   nothing does.
5. **Live, but never destructive.** The UI reflects on-disk changes in real time,
   yet never overwrites the user's in-progress edit without consent.
6. **Legible at a glance.** Status (mode, git branch, on-disk changes, match
   count) is always answerable from the chrome without running a command.
7. **Rebindable and themable.** Nothing about layout or color should be
   hard-coded past the point a `keybindings.yml` or theme can reach.

---

## 3. Hard constraints (terminal & Ink realities)

- **No mouse capture; no in-work-area borders.** Use whitespace, a single
  vertical rule between tree and main, and color — not box-drawing — to separate
  content the user might select.
- **Minimum usable size: 80×24.** Design must degrade gracefully below the ideal
  (≈120×40). Define behavior at narrow widths (see §6).
- **Render cheaply.** Ink re-renders on state change; avoid layouts that thrash.
  Prefer `<Static>` for append-only logs, throttle the filter/watcher, and keep
  the editor viewport virtualized (render only visible lines).
- **Truecolor preferred, 256-color floor.** Every theme color needs a sensible
  256-color fallback. Never rely on a color alone to convey state — pair it with
  a glyph (e.g. `●M`) so colorblind and low-color terminals still work.
- **Unicode glyphs, ASCII fallback.** Prefer crisp glyphs (`▾ ▸ ● ⎇ › ❱ ⏎`) but
  provide an ASCII theme variant for fonts/terminals that mangle them.

---

## 4. Visual language

### 4.1 Palette ("Loom neon, refined" — default dark theme)

A dark, near-black canvas with a single neon-cyan signature accent and a warm
secondary. Tune to taste, but keep this *structure*: one canvas, one dim
chrome, one primary accent, one secondary accent, plus semantic git/status hues.

| Token | Role | Suggested hex | 256 fallback |
| ----- | ---- | ------------- | ------------ |
| `bg` | canvas | `#0B0E14` | 233 |
| `bg.elevated` | tree / bars | `#11151F` | 234 |
| `fg` | primary text | `#C7D0E0` | 252 |
| `fg.dim` | inactive / structure | `#5A6478` | 244 |
| `accent` | **the** Loom neon (selection, caret) | `#22D3EE` | 51 |
| `accent.glow` | match highlight / active edge | `#67E8F9` | 87 |
| `secondary` | warm spark (prompt `›`, brand) | `#F0A36B` | 215 |
| `git.modified` | `●M` | `#E5C07B` | 179 |
| `git.untracked` | `●?` | `#56B6C2` | 73 |
| `git.added` | `●+` | `#7FD88F` | 114 |
| `git.deleted` | `●-` | `#E06C75` | 168 |
| `danger` | errors, destructive prompts | `#FF5C66` | 203 |

Rules of use:
- **`accent`** marks exactly one thing per region: the selected tree row, the
  editor caret/cursor line, the active match. Never decorative.
- **`accent.glow`** highlights the matched characters inside fuzzy results.
- **`secondary`** is the brand spark — the `›` prompt caret and the Loom wordmark.
  Used in at most one or two places on screen.
- Body text is `fg` on `bg`; structure (tree guides, dividers, inactive labels)
  is `fg.dim`.

### 4.2 Typography & glyphs

It is a monospace world; rhythm comes from glyphs and spacing.

- Tree disclosure: `▾` expanded, `▸` collapsed; leaf files get a single space of
  alignment, no icon noise.
- Selection cursor: `❱` (or a full-row `accent` background) marks the current row.
- Git status sits **right-aligned** on the row: `●M ●? ●+ ●- ●●` (conflict).
- Prompt caret: `›` in `secondary`. Active filter label: `▸ filter:`.
- Submit/affordance hints use `⏎ ↑ ↓ ← → Esc` literally in the hint line.
- Branch: `⎇ main`; clean `✓`, dirty `±`.

### 4.3 Spacing, density, dividers

- One space of left padding inside the tree; indent children by 2 columns with a
  faint `fg.dim` guide only if it stays legible (otherwise plain indent).
- A **single vertical rule** (`│` in `fg.dim`, or just a column of background
  contrast) divides tree from main. A **single horizontal rule** divides the main
  area from the bottom bar. These are the *only* sanctioned rules; never box the
  editor or output.
- Generous vertical breathing room in prompts and command results; this is what
  makes it feel like Claude Code rather than a 90s IDE.

---

## 5. Layout system

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  TREE (left)                    │  MAIN (center/right)                         │
│  width: 28–40 cols, ~30%        │  fills remaining width                       │
│  - header: FILES + filter line  │  holds ONE of:                               │
│  - scrollable node list         │    • the open file (vim editor), OR          │
│  - footer: match/▸ hint line    │    • command output (diff, find, blame…)      │
│                                 │  - editor status line at its bottom edge      │
├──────────────────────────────────────────────────────────────────────────────┤
│  OMNI-BAR + STATUS (bottom, full width, 1–2 rows)                              │
│  › <input>                                        <git> · <on-disk> · <mode>   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Tree width:** ~30% of columns, clamped to 28–40. Collapsible to a thin
  strip / hidden via command when the user wants the file full-bleed.
- **Two focus regions:** the tree (with its filter) and the main area (the
  editor). A clear focus indicator (active region's header in `accent`, inactive
  in `fg.dim`) tells the user who owns the keyboard. `Tab` toggles; opening a
  file moves focus to the editor; `Esc` from the editor returns focus to the tree.
- **Bottom bar is global,** always visible, owned by whichever region is active.

---

## 6. Responsive behavior

| Width | Behavior |
| ----- | -------- |
| ≥ 120 | Ideal. Tree + main + roomy bottom bar. |
| 80–119 | Tree narrows toward 28; status readout abbreviates (`⎇ main ✓` → `main ✓`). |
| < 80 | **Stacked mode:** tree and main no longer coexist. Show the tree *or* the editor full-width; the bottom bar stays. Switching focus swaps the view. |
| height < 24 | Drop the tree footer hint line first, then collapse the bottom bar to a single row. |

Never let the editor lose its status line; never let the bottom input disappear.

---

## 7. Component specifications

### 7.1 File tree (the hero)

**Purpose:** primary navigation; launch point for file actions.

States & behavior:
- Always has exactly one **selected** row, rendered with the `accent` cursor
  (`❱` glyph and/or full-row background). Selection persists across expand/collapse.
- `↑`/`↓` move; `→`/`l` expand (or descend), `←`/`h` collapse (or ascend to
  parent); `Enter` opens a file (`/edit`), expands a directory.
- Directories show `▾`/`▸`; files align beneath. Long names truncate in the
  middle (`src/.../index.ts`) so the basename stays visible; git status stays
  right-aligned and never truncates.
- **Git decorations** right-aligned per row; parent directories may roll up a
  summary dot when collapsed.
- **Live updates:** nodes appear/disappear/restyle as the watcher fires. New
  files get a brief `accent.glow` flash then settle; deleted files fade out.
  Updates must never move the user's selection out from under them.
- Footer hint line: contextual, e.g. `14 matches · ↑↓ move · ⏎ open` while
  filtering, or `▸ /edit /diff /blame on src/server/index.ts` when idle on a file.

### 7.2 Fuzzy filter (in-tree)

**Purpose:** find any file in a few keystrokes without leaving the tree.

- Triggered by typing in the omni-bar while the tree is focused. The bar shows
  `▸ filter: <query>`.
- **Fuzzy subsequence** matching across full paths (`srvind` → `src/server/index.ts`).
- The tree **stays a tree**: non-matching nodes dim to `fg.dim` or hide
  (configurable; default: hide leaves, keep ancestor directories of matches),
  matching paths **auto-expand**, matched characters render in `accent.glow`,
  results are **ranked by score**, and the **top match is pre-selected**.
- Live result count in the footer. `Esc` clears the filter and restores the tree
  to its prior expansion/selection state exactly.
- Must stay responsive on large repos: debounce input, cap the working set, and
  rank incrementally.

### 7.3 Editor (single file, vim)

**Purpose:** complete editing of one file.

- Full vim engine: normal/insert/visual modes, motions, operators, text objects,
  marks, registers, search/substitute, ex commands, undo/redo.
- **No borders** around the editing surface. A toggleable line-number gutter
  (`fg.dim`); the current line number renders in `accent`. Gutter off ⇒ clean
  code selection.
- Editor **status line** along its bottom edge: `── NORMAL ── index.ts ── ⎇ main`,
  with mode in `accent`, dirty marker `±`, and an `[on-disk changed ↻ reload]`
  affordance when the watcher detects an external edit to this buffer.
- Syntax highlighting via a scope→theme-color map consistent with the palette.
- Viewport virtualized; only visible lines render.

### 7.4 Omni-bar (bottom input)

**Purpose:** one input, three modes.

- Prompt caret `›` in `secondary`. Single line that grows to two if needed.
- Mode by leading character:
  - *no prefix* → **filter** the tree (live).
  - `/` → **slash command**: opens an inline palette of commands, fuzzy-filtered,
    with one-line descriptions; many operate on the current tree selection.
  - `:` → **vim ex** command against the open buffer.
- The bar shows which mode it's in (label/color shift) so the user is never
  guessing. `Esc` exits command/ex back to filter/idle; a second `Esc` clears.

### 7.5 Status readout

Right side of the bottom bar, always current:
`<N changed on disk> · ⎇ <branch> <✓|±>`. Abbreviates as width shrinks (§6). On a
fresh external change, briefly pulse the count in `accent` to signal the agent
did something.

### 7.6 Command palette (slash)

- Inline, anchored above the omni-bar; does not take over the whole screen.
- Each entry: `command  —  short description`, with the matched query in
  `accent.glow` and the target (if selection-scoped) shown, e.g.
  `/diff — git diff of src/server/index.ts`.
- Arrow keys + `Enter` to run; `Esc` to dismiss.

### 7.7 Command output / result view

- Renders into the main area (replacing the editor). Examples: `/diff` (colored
  unified diff, semantic git hues), `/find` (ripgrep results grouped by file,
  `Enter` opens at the match), `/blame`.
- Append-only logs use Ink `<Static>`. `Esc` returns the main area to the editor
  (or empty state) and focus to the tree.

### 7.8 Notifications / toasts

- Transient, single-line, top-right or just above the bottom bar. Used for
  saves, reload prompts, errors. Never modal unless destructive (e.g. discard
  unsaved edits), where a clear `[y/n]`-style inline confirm appears in `danger`.

### 7.9 Empty & first-run states

- No file open: main area shows a calm Loom wordmark (in `secondary`) and 3–4
  starter hints (`type to filter · ⏎ to open · / for commands`). This is the
  closest analog to Claude Code's welcome — keep it sparse and warm.

---

## 8. Interaction & focus model (summary)

- Two focus regions: **tree** and **editor**. Active region's header in `accent`.
- Typing while tree-focused ⇒ filter. `Enter` ⇒ open ⇒ focus moves to editor.
- In the editor, vim owns keys; `:` ex commands route to the bar; `Esc` from
  normal mode (when buffer is clean or after confirm) returns focus to the tree.
- `/` from either region opens the slash palette.
- `Esc` is always "step back one level" and never quits Loom. Quitting is an
  explicit command (`/quit`).

---

## 9. Motion & feedback (within Ink's limits)

Subtle and purposeful only:
- New/changed tree nodes: one-frame `accent.glow` flash, then settle.
- Match highlights and selection: instant, no animation.
- Spinners for async work (LSP spawn, ripgrep, large diff) — a single small
  braille spinner in `accent`, never a progress-bar circus.
- Avoid anything that flickers on resize or thrashes the scrollback.

---

## 10. Voice & copy

- Terse, lowercase, friendly. Hints read like `↑↓ move · ⏎ open`, not full
  sentences.
- Errors are plain and actionable: `can't open scripts/deploy.sh — permission
  denied`.
- The brand voice is quiet confidence; let the neon accent and the speed do the
  talking.

---

## 11. Reference mockups

**Idle on a file (full size):**

```
 FILES                                    │  src/server/index.ts
 ───────────────────────────────────────  │  ───────────────────────────────────
 ▾ src                                     │   1  import { createServer } from "./app.js"
   ▾ server                                │   2
 ❱ ▸ index.ts                        ●M    │   3  const port = Number(process.env.PORT ?? 8080)
       app.ts                              │   4
   ▸ ui                                    │   5  createServer().listen(port, () => {
 ▾ scripts                                 │   6    console.log(`up on ${port}`)
     deploy.sh                       ●?    │   7  })
   package.json                            │
                                           │  ── NORMAL ── index.ts ± ── ⎇ main
 ▸ /edit /diff /blame on index.ts          │
─────────────────────────────────────────────────────────────────────────────────
 › _                                              2 changed on disk · ⎇ main ±
```

**Fuzzy filtering (`srvind`):**

```
 FILES   ▸ filter: srvind                  │  src/server/index.ts
 ───────────────────────────────────────  │  ───────────────────────────────────
 ▾ src                                     │   (preview / last opened)
   ▾ server                                │
 ❱ ▸ index.ts        ◂match: s·r·v·ind ●M  │
   ▾ ui                                     │
       index.ts                            │
                                           │
 2 matches · ↑↓ move · ⏎ open · Esc clear  │
─────────────────────────────────────────────────────────────────────────────────
 › srvind                                         2 changed on disk · ⎇ main ±
```

**Slash palette open:**

```
 ┄ /di                                                                           ┄
   /diff   — git diff of src/server/index.ts
   /discard — revert src/server/index.ts to HEAD
─────────────────────────────────────────────────────────────────────────────────
 › /di                                            2 changed on disk · ⎇ main ±
```

**Below 80 cols (stacked, tree focused):**

```
 FILES   ▸ filter: dep
 ─────────────────────────────
 ▾ scripts
 ❱   deploy.sh               ●?
 1 match · ⏎ open · Tab → editor
 ─────────────────────────────
 › dep                  main ±
```

---

## 12. Implementation notes (Ink)

- **Stack:** Node ≥18, TypeScript, Ink (React for the terminal). Functional
  components + hooks; one store for app state (tree, selection, filter, buffer,
  focus, watcher events).
- **Suggested component tree:**
  `<App>` → `<Layout>` → { `<TreePane>` (`<TreeHeader>`, `<TreeList>` of
  `<TreeRow>`, `<TreeFooter>`), `<MainPane>` (`<Editor>` | `<OutputView>`),
  `<OmniBar>` (`<Prompt>`, `<CommandPalette>`, `<StatusReadout>`) }.
- **Input:** `useInput` for key handling, routed by focus region and mode; a
  small text-input for the omni-bar. Keep keymaps data-driven so
  `keybindings.yml` can override them.
- **Performance:** virtualize `<TreeList>` and the editor viewport; `<Static>`
  for append-only output; debounce the fuzzy filter and the FS watcher; memoize
  rows.
- **Watcher:** a single recursive watcher over the repo (respecting
  `.gitignore`), feeding tree + git + buffer-staleness state. Coalesce bursts.
- **Theming:** resolve all colors through a theme object (truecolor with 256
  fallback); no literal colors in components.
- **Testability:** keep pure logic (fuzzy scorer, tree model, vim state machine,
  git/diff parsers) free of Ink so it unit-tests in isolation; use
  `ink-testing-library` for component behavior.

---

## 13. What to deliver (for an AI design pass)

When designing against this guide, produce:
1. The full default dark theme as a concrete color/token table (truecolor + 256).
2. Component-by-component specs/mockups for §7, including focus, empty, error,
   and loading states.
3. The exact fuzzy-filter visual treatment (dim vs hide, match highlight,
   ranking, restore-on-clear) — this is the make-or-break interaction.
4. Responsive layouts for ≥120, 80–119, and <80 columns.
5. An ASCII-fallback theme variant for low-Unicode terminals.

Hold every result against §2 (principles) and §3 (constraints) before shipping.
