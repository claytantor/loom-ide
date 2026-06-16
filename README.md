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
  WezTerm lands clean text in your clipboard. Or stay on the keyboard: a vim
  yank (`y`) copies straight to your system clipboard over OSC 52 — pane-scoped
  and SSH-safe, no X11 forwarding — and pastes arrive atomically via bracketed
  paste.
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

The installer clones Loom to `~/.loom/app`, installs dependencies, builds, seeds
your config and themes into `~/.loom`, and symlinks the `loom` executable into
`~/.local/bin`. If that directory isn't on your `PATH`, the installer adds it to
your shell rc (`.zshrc` / `.bashrc` / fish `config.fish`) and tells you to open a
new terminal or `source` it — set `LOOM_NO_MODIFY_PATH=1` to opt out and just get
the line printed. Then run it from any repo:

```bash
cd ~/my-project
loom
```

**Upgrade in place** at any time — `loom` pulls and rebuilds its own install:

```bash
loom --upgrade      # git pull + reinstall + rebuild in ~/.loom/app
```

Install locations are overridable: `LOOM_HOME` (default `~/.loom`) and
`LOOM_BIN_DIR` (default `~/.local/bin`).

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

## User guide

The practical tour — launch Loom in any repo and drive it from the keyboard.
(For the *why* behind each piece, see [Core concepts](#core-concepts) above.)

### Launch

```bash
loom            # open the current directory
loom ~/project  # open a specific repo
```

Loom runs in the alternate screen, so your scrollback is untouched and restored
on exit. Quit with `/quit`.

### Move around the tree

The file tree (left) always has a selection.

| Key | Does |
| --- | ---- |
| `↑` `↓` (or `k` `j`) | move the selection |
| `→` `l` | expand a directory / open a file |
| `←` `h` | collapse / jump to the parent |
| `Enter` | open the selected file (or toggle a directory) |
| `Tab` | jump between the tree and the open editor |

**Find a file fast:** just start typing — the tree fuzzy-filters live (`srvind`
→ `src/server/index.ts`), auto-expanding matches and pre-selecting the best one.
`Enter` opens it; `Esc` clears the filter and the tree springs back exactly as
it was.

### Edit a file

Opening a file drops you into a full vim editor (modes, motions, operators,
marks, registers, search/substitute, undo/redo).

- `:w` / `Ctrl-S` — save · `:q` / `:wq` — back to the tree (Loom keeps running)
- `Ctrl-G` — toggle the line-number gutter
- `:set wrap` / `:set nowrap` (or `:set wrap!`) — soft-wrap long lines vs.
  truncate them; off by default (set `wrap: true` in `~/.loom/config.yml` to
  default it on)
- `K` — hover docs · `gd` — go to definition (when a language server is running)

If something changes the file underneath you, Loom flags it in the status line
and waits for you to reload — it never silently clobbers your edit.

### The omni-bar (bottom input)

One bar, mode-switched by the first character:

| You type | Mode |
| -------- | ---- |
| plain text | fuzzy-filter the tree |
| `/…` | slash command (palette) |
| `:…` | vim ex command (against the open file) |

Press `/` any time for the palette; **`/help`** shows the full cheat sheet
(scroll `↑↓`, `Esc` to close).

### Slash commands

**On the selected file:** `/edit` (open), `/diff` (git diff), `/blame`,
`/rename`, `/reveal`, `/discard` (revert to HEAD).
**Anywhere:** `/find <regex>` (ripgrep search), `/bash <command>` (shell passthrough), `/theme`, `/help`, `/quit`.

### Git & GitHub passthroughs

Loom keeps `git` and `gh` one keystroke away — output lands in the main panel
(scroll `↑↓`, `Esc` to close). They are **distinct tools for distinct jobs**:

- **`/git <args>`** — core version control: `/git status -sb`,
  `/git log --oneline`, `/git branch`, `/git diff` …
- **`/gh <args>`** — GitHub features: `/gh pr list`, `/gh issue view 42`,
  `/gh run list`, `/gh api user` …
- **`/bash <command>`** — run an arbitrary shell command via `bash -c` and show
  its output in the main panel: `/bash npm test`, `/bash echo hi | tr a-z A-Z`,
  `/bash ls *.ts && wc -l src/**/*.ts` … Unlike `/git` and `/gh` (which run a
  fixed binary with tokenized args), `/bash` hands the **whole raw string to the
  shell**, so pipes (`|`), redirects (`>`, `>>`, `<`), globs (`*`), chaining
  (`&&`, `||`, `;`), subshells, and `$VAR` expansion all work. It runs in the
  project root with your environment.

`/git`/`/gh` run *your* `git`/`gh` with *your* auth; `/bash` runs *your* shell —
anything those do, you can do from Loom. Type `/git`, `/gh`, or `/bash` with no
args to get a prompt.

### AI-assisted pull requests — `/pr`

`/pr` turns the current branch into a GitHub pull request with a **Claude-drafted
title and description that you review and edit in Loom's own vim editor** before
it's created. Nothing is opened on GitHub until you save.

```
/pr dev              # PR from the current branch against `dev`, AI description
/pr main --draft     # open it as a draft PR
/pr dev --no-ai      # skip the AI; seed the draft from your commit log
/pr                  # no target → Loom prompts (or uses prDefaultTarget)
```

Step by step:

1. **Preflight** — checks `gh auth status`; fails fast in the panel if you're not
   signed in.
2. **Push** — `git push origin HEAD` (creates the remote branch if needed); a
   rejected push stops here.
3. **Gather** — `git log <target>..HEAD` + `git diff <target>..HEAD`, plus your
   `PULL_REQUEST_TEMPLATE.md` if present.
4. **Draft** — Claude (Agent SDK, one shot, no tools) writes a title + markdown
   body. For very large diffs (over `prDiffLimit`, default 3000 lines) it's
   handed a `git diff --stat` summary instead of the full patch — still a real
   AI draft, just higher-level. (Only an absent/unauthed SDK falls back to the
   bare commit log.)
5. **Review & edit** — the draft opens in the editor (first line = title, blank
   line, then body); the status line reads `PR → dev · :w create PR · :q! cancel`.
   Edit it like any buffer.
6. **Create** — `:w` (or `:wq` / `Ctrl-S`) runs `gh pr create` with your edited
   text and the **PR URL appears in the main panel**. `:q!` cancels — no PR.

**Needs:** `gh` installed and authenticated (`gh auth login`); Claude Code auth
in `~/.claude` — the Agent SDK reuses it, so **no API key** and usage counts
against your normal Claude quota. Drafting degrades gracefully to the commit-log
body if the SDK or auth is unavailable, so `/pr` never blocks on it.

**Configure** in `~/.loom/config.yml`:

```yaml
# above this many diff lines, the AI gets a `git diff --stat` summary instead
# of the full patch (it still drafts the PR either way)
prDiffLimit: 3000
# default base branch for `/pr` with no target ('' = ask each time)
prDefaultTarget: ''
```

> `/pr` is a real, mutating workflow — it pushes your branch and opens a PR. It
> always stops at the editor for your review, and **only the save creates the PR**.

### Tips

- **Beside Claude Code:** keep Claude in one pane doing agentic work and Loom in
  another. The tree, git decorations, and buffer-staleness flags update live as
  the agent edits — your cockpit on what just changed.
- **Copy-paste is normal:** no mouse capture, no borders in the work area —
  shift-drag selects clean text. Because the tree and editor share each terminal
  line, a multi-line drag in the editor would otherwise also grab the tree —
  press **`Ctrl-B`** to hide the tree (full-width editor) so the drag lands only
  on editor text, and **`Ctrl-G`** to drop the line-number gutter for code with
  nothing extra. `Ctrl-B` again (or `Tab`) brings the tree back.
- **Keyboard copy without dragging:** a vim yank (`y` in normal mode, or `y` over
  a visual / visual-line selection) copies to your **system** clipboard via OSC
  52. This is pane-scoped (never grabs the tree) and works over SSH with no X11
  forwarding — ideal on a remote box.
  - **Gnome Terminal / VTE** ignore OSC 52 writes by default. Enable
    *Preferences → your profile → "Allow setting clipboard"* (or any wording of
    the clipboard-access option) so yanks reach the clipboard. Ghostty, iTerm2,
    kitty, and WezTerm allow it out of the box.
  - Inside **tmux**, also set `set -g set-clipboard on` so tmux forwards the
    OSC 52 sequence to your terminal.
  - Very large yanks can exceed a terminal's OSC 52 length cap and be dropped
    silently — fall back to a shift-drag for those.
- **`Esc` always steps back** one level (clear filter, close a panel, leave a
  mode) and never quits Loom — only `/quit` exits.

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
- For AI-drafted pull requests (`/pr`): the GitHub CLI `gh` (authenticated via
  `gh auth login`) and the [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
  which reuses your existing `~/.claude` login (no API key needed). If the SDK or
  `~/.claude` auth is absent, `/pr` still works — it falls back to a commit-log
  draft. Use `/pr <branch> --no-ai` to skip the AI entirely.

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
| `/bash <command>` | anywhere | shell passthrough — `bash -c`, full pipes/redirects/globs/chaining → main panel |
| `/pr <branch> [--draft] [--no-ai]` | anywhere | open a PR: AI drafts title+body, you edit it in the editor, `:w` creates it |
| `/find <regex>` | anywhere | ripgrep project search |
| `/theme` | anywhere | switch color theme |
| `/help` | anywhere | keys & commands reference |
| `Ctrl-B` | anywhere | hide/show the file tree — full-width editor for clean selection |
| `Ctrl-G` | editor | toggle the line-number gutter |
| `:w` / `Ctrl-S` | editor | save (in a `/pr` draft, **creates the PR**) |
| `:q` / `:wq` | editor | back to the tree (in a `/pr` draft, `:q!` **cancels** it) |
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
