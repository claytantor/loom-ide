# Handoff: Loom — TUI IDE

## Overview

Loom is a **terminal (TUI) IDE built with [Ink](https://github.com/vadimdemedes/ink)** (React for the terminal). It runs over SSH *beside* an AI agent (Claude Code): the agent edits the repo in one pane, Loom is the human's live cockpit in another — a fuzzy-filterable file tree, a single-file vim editor, and a Claude-Code-style omni-bar that doubles as filter, command palette, and vim ex line.

This bundle delivers a **high-fidelity, fully interactive design reference** for Loom's look and behavior: the exact palette, glyphs, layout system, responsive reflow, and the four key screen states.

Three facts drive the whole design:
1. **The file tree is the hero** — the primary navigation surface and launch point for nearly every action.
2. **One thing in the main area at a time** — either the single open file (vim editor) or the output of a command. Never both, never tabs.
3. **One input at the bottom** — a mode-switched omni-bar: fuzzy-filter / slash command / vim ex, chosen by what the user types.

Aesthetic target: **"Loom neon, refined"** — a high-contrast near-black canvas with one confident neon accent used sparingly, calm like Claude Code with a recognizable Loom identity.

---

## About the design files

The files in `prototype/` are a **design reference created in HTML/CSS/JS** — a browser simulation of the terminal UI that demonstrates intended look and behavior. **They are not production code to copy directly.**

Loom's real target environment is **Node ≥18 + TypeScript + Ink** (a React renderer that paints to a terminal, not the DOM). The implementation task is to **recreate these designs in Ink** using its primitives (`<Box>`, `<Text>`, `useInput`, `<Static>`) and the suggested component tree below — *not* to ship the HTML. Where the HTML uses CSS flex/`ch` units, Ink uses Yoga flexbox with `columns`/`rows`; where the HTML uses a `keydown` listener, Ink uses `useInput`.

The HTML prototype is faithful about: colors (exact hex), glyphs, spacing rhythm, focus model, responsive breakpoints, and the fuzzy-filter visual treatment. Use it as the visual + behavioral source of truth.

The authoritative written spec lives in **`source_brief/DESIGN_GUIDE.md`** (binding constraints) and **`source_brief/README.md`** (product framing). Read both. This README distills them into an implementable checklist; where this README and the DESIGN_GUIDE disagree, the DESIGN_GUIDE wins.

---

## Fidelity

**High-fidelity (hifi).** Final colors, glyphs, spacing, focus model, and interactions are all specified. Recreate the UI faithfully in Ink. The one liberty: the prototype renders in a proportional browser window with measured character cells; in a real terminal the cell grid is exact and you get true `cols × rows` from `process.stdout`.

---

## Target stack & component tree

```
<App>                       app state store (tree, selection, filter, buffer, focus, watcher)
 └ <Layout>                 measures terminal cols×rows, chooses wide / mid / stacked
    ├ <TreePane>            the hero — left column
    │   ├ <TreeHeader>      "FILES" + active filter line
    │   ├ <TreeList>        virtualized list of <TreeRow> (render only visible)
    │   └ <TreeFooter>      contextual hint line
    ├ <Divider>            single vertical rule between tree and main
    ├ <MainPane>           holds ONE of:
    │   ├ <Editor>          vim editor (gutter, syntax, status line)
    │   └ <OutputView>      command output (/find, /diff, /blame…)
    └ <OmniBar>            bottom input, full width
        ├ <Prompt>          › caret + input
        ├ <CommandPalette>  inline slash palette, anchored above the bar
        └ <StatusReadout>   right-aligned git / on-disk / mode
```

Keep pure logic (fuzzy scorer, tree model, vim state machine, git/diff parsers, theme resolver) **free of Ink** so it unit-tests in isolation. In the prototype these live in `loom-data.js` (scorer, tokenizer, tree model) and the helper functions at the top of `loom-tui.jsx` (`computeFilter`, `flattenTree`, `resolveTheme`) — port them as plain TS modules.

---

## Design tokens

### Palette — "Loom neon, refined" (default dark theme)

Resolve every color through a theme object (truecolor with a 256-color fallback). **No literal colors in components.** Never rely on color alone — always pair state with a glyph (e.g. `●M`).

| Token | Role | Hex (truecolor) | 256 fallback |
| ----- | ---- | --------------- | ------------ |
| `bg` | canvas | `#0B0E14` | 233 |
| `bg.elevated` | tree / bars / slash card | `#11151F` | 234 |
| `fg` | primary text | `#C7D0E0` | 252 |
| `fg.dim` | inactive / structure / dividers | `#5A6478` | 244 |
| `accent` | **the** Loom neon — selection, caret, active match | `#22D3EE` | 51 |
| `accent.glow` | matched characters, file headers in results | `#67E8F9` | 87 |
| `secondary` | warm spark — `›` prompt, "loom" wordmark | `#F0A36B` | 215 |
| `git.modified` | `●M` | `#E5C07B` | 179 |
| `git.untracked` | `●?` | `#56B6C2` | 73 |
| `git.added` | `●+` | `#7FD88F` | 114 |
| `git.deleted` | `●-` | `#E06C75` | 168 |
| `danger` | errors, destructive prompts (`/discard`, `/quit`) | `#FF5C66` | 203 |
| *selection bg* | full-row tint behind selected row | `rgba(34,211,238,0.12)` | — |

**Rules of use** (the accent is a scarce resource):
- `accent` marks exactly **one** thing per region: the selected tree row, the editor caret/current line, the active result. Never decorative.
- `accent.glow` highlights matched characters inside fuzzy results and the file-group headers in `/find`.
- `secondary` appears in at most one or two places: the `›` prompt caret and the "loom" wordmark.
- Body text is `fg` on `bg`; structure (tree guides, dividers, inactive headers, hint lines) is `fg.dim`.

### Alternate themes (the prototype ships two + ASCII)

- **`mono`** — a low-color/classic-green fallback: `bg #050705`, `fg #b8c0a8`, `dim #5b6356`, `accent #8ae234`, `glow #b6f56a`, `secondary #c4a000`. Use as the 256/low-color floor demonstration.
- **Accent variants** for `neon`: cyan `#22D3EE` (default), amber `#F0A36B`, green `#7FD88F`, violet `#B392F0`. Each carries a matching brighter `glow` and selection tint.
- Themes are user-switchable via `/theme`; everything resolves through `keybindings.yml` / theme files per the brief.

### Syntax-highlight scope → token map

Consistent with the palette (reuses palette tokens, doesn't invent new colors):

| Scope | Token | Hex |
| ----- | ----- | --- |
| keyword (`import`, `const`, `return`…) | `secondary` | `#F0A36B` |
| string / template | `git.added` | `#7FD88F` |
| comment | `fg.dim` | `#5A6478` |
| number | `git.untracked` | `#56B6C2` |
| function call | `accent.glow` | `#67E8F9` |
| type / Capitalized ident | `git.modified` | `#E5C07B` |
| identifier / punctuation | `fg` | `#C7D0E0` |

### Glyphs (Unicode primary, ASCII fallback)

Prefer crisp glyphs; provide an ASCII theme variant for terminals/fonts that mangle them.

| Meaning | Unicode | ASCII |
| ------- | ------- | ----- |
| dir expanded / collapsed | `▾` / `▸` | `v` / `>` |
| selection cursor | `❱` | `>` |
| git status dot | `●` (+ `M ? + -`) | `*` |
| branch | `⎇ main` | `git: main` |
| clean / dirty | `✓` / `±` | `ok` / `*` |
| prompt caret | `›` | `>` |
| filter label | `▸ filter:` | `> filter:` |
| submit / move hints | `⏎ ↑ ↓ ← →` | `Enter ^ v < >` |
| vertical / horizontal rule | `│` / `─` | `|` / `-` |
| reload affordance | `↻` | `r` |
| mid-truncation ellipsis | `…` | `...` |

### Typography & spacing

- **Monospace only.** Prototype uses *JetBrains Mono* for crisp rendering; a real terminal uses the user's font — design for any monospace.
- Line height ≈ `1.42` in the prototype; in a terminal one row = one cell.
- One space of left padding inside the tree; indent children by **2 columns** per depth. Optional faint `fg.dim` guide only if it stays legible, otherwise plain indent.
- Git status is **right-aligned** on the row and never truncates; long names truncate in the **middle** (`src/.../index.ts`) so the basename stays visible.
- Generous vertical breathing room in prompts and command results — this is what makes it feel like Claude Code, not a 90s IDE.

### Dividers (the only sanctioned rules)

- A **single vertical rule** (`│` in `fg.dim`) between tree and main.
- A **single horizontal rule** (`─` in `fg.dim`) between the main area and the bottom bar; plus the thin underlines beneath the `FILES` header and the editor's filename header.
- **Never** draw box-drawing characters *inside* the editor or output region — selections must yield clean, copy-pasteable text.

---

## Layout system

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  FILES  ▸ filter: …          │  src/server/index.ts                  120×40 …  │
│  ───────────────────────────  │  ──────────────────────────────────            │
│  ▾ src                        │   1  import { createServer } …                  │
│    ▾ server                   │   2                                            │
│  ❱ ▸ index.ts            ●M   │   3  const port = Number(…)                    │
│      app.ts                   │  …                                            │
│  ▾ scripts                    │                                                │
│      deploy.sh           ●?   │  ── NORMAL ── index.ts ± ── ⎇ main             │
│  ▸ /edit /diff /blame …       │                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ › <input>                                         2 changed on disk · ⎇ main ± │
└──────────────────────────────────────────────────────────────────────────────┘
   TREE: ~30% width, clamped 28–40 cols     MAIN: fills remaining     BAR: full width
```

- **Tree width:** ~30% of columns, clamped **28–40**. In the prototype this is a tweakable `treeWidth` (24–46) clamped against the live column count.
- **Two focus regions:** the tree (with its filter) and the main area (the editor). The active region's header renders in `accent`, the inactive one in `fg.dim`. `Tab` toggles; opening a file moves focus to the editor; `Esc` from the editor returns focus to the tree.
- **Bottom bar is global,** always visible, owned by whichever region is active.
- A small dimmed `cols × rows · mode` readout sits top-right in the prototype to make reflow legible during review — it's a dev affordance, not required in production.

---

## Responsive behavior (must implement)

Drive layout off the live terminal **column count** (`process.stdout.columns` / Ink's `useStdout` + resize). This is the headline requirement — Loom must be usable in any terminal shape, landscape or portrait.

| Width (cols) | Behavior |
| ------------ | -------- |
| **≥ 120** (`wide`) | Ideal. Tree + vertical rule + main + roomy bottom bar. Full status readout: `2 changed on disk · ⎇ main ±`. |
| **80–119** (`mid`) | Tree narrows toward 28. Status readout abbreviates: `⎇ main ✓` → `main ✓` (prototype: `2 ± main ±`). |
| **< 80** (`stacked`) | **Tree and main no longer coexist.** Show the tree *or* the editor full-width; the bottom bar stays. Switching focus (`Tab`) swaps which view is shown. A tall, narrow (portrait) terminal lands here naturally. |
| **height < ~24 rows** | Drop the tree footer hint line first; then collapse the bottom bar to a single row. |

**Never** let the editor lose its status line; **never** let the bottom input disappear.

---

## Screens / views

The prototype exposes all four via a "Jump to state" tweak, and they're all reachable by live interaction.

### 1. Idle on a file
- **Purpose:** read/navigate; the default resting state with a file open.
- **Layout:** tree left (selection on `src/server/index.ts`, git `●M`), editor right with line-number gutter, syntax highlighting, and the status line `── NORMAL ── index.ts ± ── ⎇ main` pinned to the editor's bottom edge.
- **Tree footer hint (idle):** `▸ /edit /diff /blame on index.ts` — contextual to the selection.
- **Omni-bar:** `› ` with blinking block caret; right side shows status readout; mode label `[ready]`.

### 2. Fuzzy filter active
- **Purpose:** find any file in a few keystrokes without leaving the tree.
- **Trigger:** typing plain text while the tree is focused. Header shows `▸ filter: <query>`.
- **Behavior (the make-or-break interaction):**
  - **Fuzzy subsequence** match across full paths — `srvind` → `src/server/index.ts`.
  - The tree **stays a tree**: matching paths auto-expand, ancestors stay.
  - **Three configurable visual treatments** (prototype tweak `fuzzyMode`):
    - `dim` (default): non-matching nodes drop to `fg.dim` (`#5A6478`); matches stay `fg`; matched characters render in `accent.glow`.
    - `hide`: non-matching leaves are removed, ancestor directories of matches kept.
    - `flat`: a flat, score-ranked list of matching full paths.
  - Matched characters highlighted in `accent.glow`, **bold**.
  - Results **ranked by score**; the **top match is pre-selected** (cursor `❱`).
  - Footer shows live count: `1 match · ↑↓ move · ⏎ open · Esc clear`.
  - `Esc` clears the filter and restores the tree's prior expansion/selection **exactly**.
- **Scoring** (see `loom-data.js#fuzzyScore`): +10 for a match at a path boundary (`/` or `.`), +5 contiguous-run bonus, +1 otherwise, minus a small tail-length penalty so shorter targets rank higher.

### 3. Slash command palette
- **Purpose:** run a command; many operate on the current tree selection.
- **Trigger:** `/` in the omni-bar opens an **inline palette anchored above the bar** (does not take over the screen). Fuzzy-filtered as you type (`/di` → `/edit /diff /discard`).
- **Each entry:** `command — short description`, matched query in `accent.glow`, target substituted in (`/diff — git diff of index.ts`). Destructive commands (`/discard`, `/quit`) render in `danger`.
- **Two shapes** (prototype tweak `slashShape`): `list` (anchored above the bar, default) or `card` (a centered floating card on `bg.elevated` with a `fg.dim` border).
- Arrow keys + `Enter` to run; `Esc` to dismiss.
- Commands in the set: `/edit /diff /discard /blame /rename /reveal /find /theme /quit`.

### 4. Command output — `/find` (ripgrep)
- **Purpose:** project-wide content search (the tree's fuzzy filter finds *files*; ripgrep finds *content*).
- **Layout:** replaces the editor in the main area. Results **grouped by file**, each group headed by its path in `accent.glow`; each hit shows a right-aligned `fg.dim` line number and the source line with the **matched substring in `accent.glow` bold**.
- **Header:** `/find <query>   N matches in M files`.
- **Selection:** first hit pre-selected with `❱`; `↑↓` move, `⏎` opens the file at the match, `Esc` closes back to the editor.
- Other output views (`/diff` colored unified diff, `/blame`) follow the same shell; append-only logs should use Ink `<Static>`.

### Empty / first-run state
- No file open: main area shows a calm "loom" wordmark in `secondary` and 3–4 starter hints (`type to filter · ⏎ to open · / for commands`). Sparse and warm — the analog to Claude Code's welcome.

---

## Interactions & behavior

### Focus & key routing model
- Two focus regions: **tree** and **editor**. The active region's header is `accent`.
- `Esc` is always "step back one level" and **never quits Loom**. Quitting is explicit (`/quit`).
- `useInput` routes keys by focus region **and** omni-bar mode.

| Context | Key | Action |
| ------- | --- | ------ |
| tree | `↑` `↓` (or `k` `j` when no filter) | move selection |
| tree | `→` `l` | expand dir / descend / open file |
| tree | `←` `h` | collapse dir / ascend to parent |
| tree | `Enter` | open file / toggle dir |
| tree | *type text* | fuzzy-filter live |
| tree | `Tab` | focus editor (if a file is open) |
| editor | `↑` `↓` / `k` `j` | move caret line |
| editor | `Esc` / `Tab` | return focus to tree |
| any | `/` | open slash palette |
| any | `:` | vim ex line against the open buffer |
| omni (slash/ex) | `↑` `↓` | move palette selection |
| omni (slash/ex) | `Enter` | run; `Esc` steps back, second `Esc` clears |
| `/find` view | `↑` `↓`, `Enter`, `Esc` | move hit / open at match / close |

All bindings are **rebindable** per mode in `~/.loom/keybindings.yml` — keep the keymap data-driven.

### Omni-bar mode detection
Mode is chosen by the **leading character** of the input:
- *no prefix, non-empty* → **filter** the tree (live, debounced). Label `[filter]`, color `accent`.
- `/` → **slash command** palette. Label `[command]`, color `accent.glow`.
- `:` → **vim ex** command. Label `[ex]`, color `secondary`.
- *empty* → idle. Label `[ready]`, color `fg.dim`.

### Live sync with the agent (don't fake this in production)
- A single recursive FS watcher (respecting `.gitignore`) feeds tree + git decorations + buffer-staleness. Coalesce bursts; debounce.
- New tree nodes flash `accent.glow` for one frame then settle; deleted files fade out. **Updates must never move the user's selection out from under them.**
- The open buffer is **never silently clobbered**: if the file under edit changes on disk, the editor status line shows `[on-disk changed ↻ reload]` and waits for consent.
- On a fresh external change, briefly **pulse** the on-disk count in `accent` (the prototype fires a one-time pulse ~1.4s after load to demonstrate this).

### Motion (within Ink's limits — subtle and purposeful only)
- New/changed nodes: one-frame `accent.glow` flash.
- Match highlights and selection: instant, no animation.
- A single small braille spinner (`⠋…` in `accent`) for async work (LSP spawn, ripgrep, large diff). No progress-bar circus.
- Avoid anything that flickers on resize or thrashes scrollback.

---

## State management

App-level store (one source of truth):

| State | Type | Notes |
| ----- | ---- | ----- |
| `tree` | nested node model | `{name, type:'dir'|'file', path, git?, open?, children?}`; dirs remember `open` |
| `selPath` | string | always exactly one selected row; persists across expand/collapse; re-pinned to top match while filtering |
| `focus` | `'tree' | 'editor'` | active region |
| `mainView` | `'editor' | 'find' | 'empty'` | what the main pane shows |
| `openFile` / `lines` / `caret` | string / string[] / number | the single open buffer |
| `omni value` | string | drives derived `mode` (filter/slash/ex/idle) |
| `slashSel` / `findSel` | number | palette / results cursor index |
| `dirty` / `onDisk` / `branch` | bool / number / string | status readout inputs |
| watcher events | stream | mutate tree/git/staleness; coalesced |

Derived each render: `mode` (from omni value), `layout` (`wide|mid|stacked` from cols), `treeChars`/`mainChars`, the visible/filtered row list, and `effectiveSel` (falls back to top match when filtering or to the first row if the selection scrolled out of the filtered set).

**Performance:** virtualize `<TreeList>` and the editor viewport (render only visible lines); `<Static>` for append-only output; debounce the fuzzy filter and the FS watcher; memoize rows.

---

## Assets

None. Loom is pure text + color — no images, icons, or fonts to ship. The prototype loads *JetBrains Mono* from Google Fonts purely for crisp browser rendering; in production the user's terminal font is used. All "icons" are Unicode glyphs (with the ASCII fallback table above).

---

## Files in this bundle

```
design_handoff_loom_tui_ide/
├── README.md                     ← you are here
├── prototype/                    ← interactive HTML design reference (open Loom.html)
│   ├── Loom.html                 main file: palette tokens, structural CSS, script wiring
│   ├── loom-data.js              repo tree model, file contents, fuzzy scorer, TS tokenizer,
│   │                             slash commands, /find sample  (PURE LOGIC — port to TS)
│   ├── loom-tui.jsx              themes, glyphs, helpers (computeFilter, flattenTree,
│   │                             resolveTheme) + presentational components
│   ├── loom-app.jsx              grid measurement, state machine, keyboard routing, shell
│   └── tweaks-panel.jsx          review-only control panel (NOT part of Loom — drop it)
└── source_brief/                 ← authoritative written spec (binding)
    ├── DESIGN_GUIDE.md           palette, layout, component specs, constraints — source of truth
    └── README.md                 product framing, concepts, command reference
```

**Start here:** open `prototype/Loom.html` in a browser, resize the window (and try a tall/narrow shape) to watch the reflow, and use the Tweaks panel (toolbar) to jump between the four states and toggle the fuzzy-filter / slash-palette variants. Then read `source_brief/DESIGN_GUIDE.md` end to end before implementing.

> **Note:** `tweaks-panel.jsx` is a review affordance for this design pass only — it is **not** a Loom feature. Ignore it when implementing.

---

## Implementation checklist

- [ ] Port pure logic to TS modules: fuzzy scorer, tree model, theme resolver, tokenizer (→ real tree-sitter/LSP highlighting in production).
- [ ] Theme object with truecolor + 256 fallback; **zero literal colors** in components.
- [ ] `<Layout>` reads `stdout.columns/rows`, picks `wide | mid | stacked`, re-renders on resize.
- [ ] Tree: single persistent selection, git decorations right-aligned, middle-truncation, virtualized.
- [ ] Fuzzy filter: subsequence scoring, auto-expand, `accent.glow` match highlight, top-match pre-select, exact restore on `Esc`; all three visual modes behind config (`dim` default).
- [ ] Omni-bar: leading-char mode detection, visible mode label/color, slash palette (anchored, fuzzy, selection-scoped descriptions), ex line.
- [ ] Editor: togglable line-number gutter (current line in `accent`), syntax map, status line with `[on-disk changed ↻ reload]` affordance, **no borders**.
- [ ] `/find` output view grouped by file with `accent.glow` matches; `<Static>` for logs.
- [ ] Live watcher: tree/git/staleness updates, flash-on-change, never move selection, never clobber buffer.
- [ ] Data-driven keymap (`keybindings.yml`), `/theme` switching, ASCII glyph variant.
- [ ] Hold every result against DESIGN_GUIDE §2 (principles) and §3 (constraints) before shipping.
