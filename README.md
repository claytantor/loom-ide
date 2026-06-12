# Loom

**An Ink-powered TUI IDE that sits beside Claude Code.**

Loom is a terminal IDE for remote work over SSH. It is built to run *next to* an
agent — you keep Claude Code in one pane doing the heavy lifting, and Loom in
another as your live cockpit on the same repo: a fast, fuzzy-filterable file
tree, a single-file vim editor, and a slash-command bar that feels like Claude
Code. When Claude edits a file, Loom shows it. When you need to read, navigate,
or make a precise hand edit, Loom is already there.

> **Status:** Loom is in active development. This README describes the product
> we are building — the design of record, not a changelog. Expect rapid change.

---

## Why Loom exists

Most TTY editors fight your terminal: they grab the mouse, hijack scrollback, or
hide behind tmux copy-mode. Loom does the opposite. It keeps your terminal's own
copy-paste, scroll, and clipboard intact, then layers a modern, agent-aware IDE
on top.

- **Built to run beside an agent.** Loom is a *sibling* to Claude Code, not a
  replacement. They share the filesystem and git; Loom watches the working tree
  and reflects every change the agent makes — files appearing, mutating, and
  disappearing in real time.
- **The file tree is the product.** A VS Code-style, keyboard-driven tree is the
  primary way you move through a repo, with a genuinely good fuzzy filter that
  finds anything in a few keystrokes without ever leaving the tree.
- **One file, fully.** Loom opens a single file at a time and gives it a complete
  vim engine — modes, motions, operators, marks, ex commands, undo/redo — instead
  of a dozen half-attended tabs.
- **One bar to drive it all.** A single Claude-Code-style input at the bottom is
  your filter, your command palette, and your ex line. Type to filter, `/` to
  command, `:` to run vim ex commands.
- **Copy-paste actually works.** No mouse capture, no border characters inside
  the work area — shift-drag in Gnome Terminal / iTerm2 / kitty / Alacritty /
  WezTerm lands clean text in your clipboard.
- **Zero ceremony to install.** A single `curl | bash` clones, installs, seeds
  your config and themes, and symlinks `loom` onto your `$PATH`.

---

## The shape of the screen

```
┌─ loom ──────────────────────────────────────────────────────────────────────┐
│ FILES  ▸ filter: srv/ind                  │  src/server/index.ts             │
│ ───────────────────────────────────────── │  ──────────────────────────────  │
│ ▾ src                                      │   1  import { createServer }     │
│   ▾ server                                 │   2  from "./app.js";            │
│   ▸ ❱ index.ts            ●M               │   3                              │
│       app.ts                               │   4  const port = Number(        │
│   ▸ ui                                     │   5    process.env.PORT ?? 8080   │
│     index.ts                               │   6  );                          │
│ ▾ scripts                                  │   7                              │
│     deploy.sh            ●?                 │   8  createServer().listen(port) │
│   package.json                             │   9                              │
│                                            │  ── NORMAL ── index.ts ── ⎇ main │
│ 14 matches · ↑↓ move · ⏎ open             │                                  │
├────────────────────────────────────────────────────────────────────────────┤
│ › srv/ind                                       2 changed on disk · ⎇ main ✓ │
└────────────────────────────────────────────────────────────────────────────┘
```

Three regions, always:

1. **Left — the file tree.** Hierarchical, collapsible, decorated with git and
   live-change status. The tree always has a selection; nearly everything you do
   starts by selecting something here.
2. **Center — the main area.** Holds exactly one thing at a time: the open file
   (the vim editor) or the output of a command. One file, one focus.
3. **Bottom — the omni-bar + status.** A single input line, mode-switched, plus a
   compact status readout (git branch, on-disk changes, mode).

---

## Core concepts

### The file tree

The tree is Loom's primary navigation surface, and the most carefully designed
part of the product. Arrow keys move the selection; `→`/`←` (or `l`/`h`) expand
and collapse; `Enter` opens the selected file. Directories remember their
expanded state. The current selection is always visible and always actionable.

A **range of slash commands operates on the current selection** — `/edit`,
`/diff`, `/blame`, `/reveal`, `/rename`, and more — so the tree is not just a
viewer but the launch point for everything you do to a file.

### The fuzzy filter

Start typing in the omni-bar (with the tree focused) and the tree filters live.
Loom uses **fuzzy subsequence matching** — `srvind` finds `src/server/index.ts` —
and, crucially, **the tree stays a tree**: non-matching nodes fade out, every
matching path auto-expands, matched characters are highlighted, and results are
ranked by score with the best match pre-selected. Clear the filter and the tree
springs back exactly as it was. No mode flip into a flat list, no losing your
place.

### One file at a time

Loom intentionally opens a single buffer. `/edit` (or `Enter` on a file) loads
the selection into the center area with a full vim editor. There are no tabs to
manage and no split-attention; when you open a different file, the current one
is saved-or-prompted and replaced. `:w` / `Ctrl-S` saves; `:q` returns you to
the tree without quitting Loom.

### The omni-bar

One input, three modes, chosen by what you type:

| You type… | Loom does… |
| --------- | ---------- |
| plain text | fuzzy-filters the file tree |
| `/command` | opens the slash-command palette / runs a command |
| `:excmd`   | runs a vim ex command against the open buffer |

Focus follows intent: the tree and the editor are the two focusable regions, and
the bar reflects whichever you're driving. Vim insert/normal input happens inside
the editor itself — the bar is for navigation and commands.

### Live sync with Claude Code

Loom watches the working tree. As Claude Code (or anything else) edits the repo,
the file tree updates, new files appear, deletions vanish, and git decorations
refresh — live. Your **open buffer is never silently clobbered**: if the file
you're editing changes on disk, Loom flags it and offers a reload, so an agent
working in the next pane can't overwrite an edit you're in the middle of.

### Full vim engine

The complete editing model carries over from `loom-tty-ide`: normal/insert/visual
modes, motions, operators, text objects, marks, registers, search/substitute,
ex commands, and undo/redo. Save with `:w` or `Ctrl-S`; `:wq` returns to the
tree without quitting Loom.

---

## Pillars, rethought for Ink

These exist in `loom-tty-ide`; Loom reimagines their presentation to fit the
tree-first, single-file, agent-adjacent model:

- **Git, first-class.** Status flags decorate the tree (`●M` modified, `●?`
  untracked, `●+` staged); `/diff` and `/blame` operate on the selection; the
  branch and dirty state live in the bottom status readout.
- **LSP, on demand.** TypeScript and Python language servers spawn automatically
  when their binaries are on `$PATH`, surfacing diagnostics, hovers, and
  go-to-definition inside the single open buffer.
- **ripgrep search.** Project-wide search via `/find` renders results into the
  center area; selecting a result opens the file at the match. The tree's fuzzy
  filter handles *finding files*; ripgrep handles *finding content*.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/claytantor/loom-ide/main/install.sh | bash
```

The installer clones Loom to `~/.loom/app`, installs dependencies, seeds your
config and themes into `~/.loom`, and symlinks the `loom` executable onto your
`$PATH`. Run it from any directory to open that repo:

```bash
cd ~/my-project
loom
```

---

## Configuration

Everything lives under `~/.loom`:

```
~/.loom/
  app/                  # the Loom install
  config.yml            # general settings
  keybindings.yml       # per-mode keybindings, fully overridable
  themes/               # bundled + custom color themes
```

Keybindings are defined per mode (tree, editor, command, ex) so a binding only
ever means one thing in one context. Switch or author a theme with `/theme`.

---

## Requirements

- **Node.js ≥ 18** with ES modules (the install target; broadest SSH-box
  compatibility).
- **TypeScript / [Ink](https://github.com/vadimdemedes/ink)** — Loom is a React
  app for the terminal.
- A terminal with truecolor or 256-color support for the full theme
  (Gnome Terminal, iTerm2, kitty, Alacritty, WezTerm all qualify).
- Optional, auto-detected when present: `git`, `rg` (ripgrep),
  `typescript-language-server`, `pyright`/`pylsp`.

---

## Command & key reference (essentials)

| Key / command | Context | Action |
| ------------- | ------- | ------ |
| `↑` `↓` | tree | move selection |
| `→` `←` / `l` `h` | tree | expand / collapse |
| `Enter` / `/edit` | tree | open selected file |
| *type text* | tree | fuzzy-filter |
| `/diff` `/blame` | selection | git on the selected file |
| `/git <args>` | anywhere | git passthrough — branches, commits, diffs, history → main panel |
| `/gh <args>` | anywhere | GitHub CLI passthrough — PRs, issues, releases → main panel |
| `/find <regex>` | anywhere | ripgrep project search |
| `/theme` | anywhere | switch color theme |
| `/help` | anywhere | keys & commands reference |
| `:w` / `Ctrl-S` | editor | save |
| `:q` / `:wq` | editor | back to the tree (Loom stays open) |
| `Esc` | anywhere | step back a mode / clear filter |

Everything above is rebindable in `~/.loom/keybindings.yml`.

---

## Design

The full visual and interaction specification — palette, layout system,
component behavior, and ASCII mockups — lives in
**[DESIGN_GUIDE.md](./DESIGN_GUIDE.md)**. It doubles as the design brief for
contributors and for AI-assisted design work. The interactive design handoff
(HTML prototype + binding spec) is under
[`requirements/design_handoff_loom_tui_ide/`](./requirements/design_handoff_loom_tui_ide/).

---

## Development

Loom is 100% TypeScript — strict mode, ES modules, zero literal colors in
components (everything resolves through the theme).

```bash
npm install        # dependencies
npm run dev        # run from source against the current directory (tsx)
npm test           # vitest: core, vim engine, services, lsp, ui smoke tests
npm run typecheck  # tsc --noEmit, strict
npm run build      # compile to dist/ (the `loom` bin)
```

Layout of `src/`:

```
src/
  core/       pure logic, no Ink/Node: fuzzy scorer, tree model + filter,
              vim engine, theme/glyphs, tokenizer, decorators, git parsers,
              keymap, config schema
  services/   side effects: fs scan (.gitignore-aware), watcher, git, ripgrep,
              LSP (framing/client/manager), config IO, buffer IO
  state/      reducer + command registry (pure, tested without a terminal)
  ui/         Ink components: TreePane, Editor, OutputViews, OmniBar, palette
  app/        App.tsx — wiring, key routing, layout
  cli.tsx     entry point (alt-screen, args)
```

The pure `core/` modules never import Ink or Node built-ins, so the vim
engine, fuzzy filter, and parsers unit-test in milliseconds; UI behavior is
covered with `ink-testing-library`.

## License

MIT.
