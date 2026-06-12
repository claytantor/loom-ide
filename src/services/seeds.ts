/* First-run seed content for ~/.loom — kept as TS constants so the entire
   codebase stays TypeScript; written to disk by configIo.ensureSeeded(). */

export const SEED_CONFIG_YML = `# loom — general settings (~/.loom/config.yml)
# theme: neon | mono | <name of a file in ~/.loom/themes/>
theme: neon
# accent (neon theme only): cyan | amber | green | violet
accent: cyan
# glyphs: unicode | ascii   (ascii for terminals/fonts that mangle ▾ ❱ ⎇ …)
glyphs: unicode
# fuzzyMode — how the tree treats non-matching nodes while filtering:
#   dim  — keep the whole tree visible, dim non-matches (default)
#   hide — remove non-matching leaves, keep ancestors of matches
#   flat — score-ranked flat list of matching paths
fuzzyMode: dim
# line-number gutter in the editor (toggle live with ctrl+g)
gutter: true
# soft-wrap long lines in the editor (toggle live with :set wrap / :set nowrap)
wrap: false
# preferred tree width in columns (clamped 24–46 against the live terminal)
treeWidth: 32
# /pr — diffs larger than this many lines skip the AI and use a commit-log draft
prDiffLimit: 1000
# /pr — default base branch for \`/pr\` with no target ('' = ask each time)
prDefaultTarget: ''
`;

export const SEED_KEYBINDINGS_YML = `# loom — keybindings (~/.loom/keybindings.yml)
#
# Bindings are listed per context. A key is a lowercase descriptor:
#   plain:      a … z, 0 … 9
#   named:      up down left right return escape tab backspace delete pageup pagedown
#   modifiers:  ctrl+<key>  meta+<key>     e.g. ctrl+s
#
# Vim keys inside the editor buffer belong to the vim engine and are not
# remapped here — this file covers loom's chrome: tree navigation, panels,
# and editor chrome keys (save, focus, gutter).
#
# Contexts and actions (defaults shown, uncomment to override):
#
# tree:
#   nav.up: [up]
#   nav.down: [down]
#   nav.left: [left]
#   nav.right: [right]
#   select: [return]
#   back: [escape]
#   focus.toggle: [tab]
# find:
#   nav.up: [up, k]
#   nav.down: [down, j]
#   select: [return]
#   back: [escape]
#   focus.toggle: [tab]
# output:
#   nav.up: [up, k]
#   nav.down: [down, j]
#   back: [escape]
#   focus.toggle: [tab]
# slash:
#   nav.up: [up]
#   nav.down: [down]
#   select: [return]
#   back: [escape]
# ex:
#   select: [return]
#   back: [escape]
# editor:
#   focus.toggle: [tab]
#   save: [ctrl+s]
#   gutter.toggle: [ctrl+g]
`;

/** Example user theme — any token from the palette may be overridden. */
export const SEED_THEME_EXAMPLE_JSON = `${JSON.stringify(
  {
    name: 'custom-example',
    accent: '#B392F0',
    glow: '#D0BCFF',
    secondary: '#F0A36B',
  },
  null,
  2,
)}
`;
