/* Slash command registry — the fixed set from the design handoff.
   Filtering mirrors the prototype: prefix match, then substring. */

export interface SlashCommand {
  name: string;
  /** Description template; '{sel}' is replaced with the selection basename. */
  desc: string;
  selScoped: boolean;
  danger?: boolean;
  /** Accepts trailing text after the name (e.g. `/find listen`). */
  takesArg?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/edit', selScoped: true, desc: 'open {sel} in the editor' },
  { name: '/diff', selScoped: true, desc: 'git diff of {sel}' },
  { name: '/discard', selScoped: true, desc: 'revert {sel} to HEAD', danger: true },
  { name: '/blame', selScoped: true, desc: 'git blame {sel}' },
  { name: '/rename', selScoped: true, desc: 'rename {sel}', takesArg: true },
  { name: '/reveal', selScoped: true, desc: 'reveal {sel} in tree' },
  { name: '/find', selScoped: false, desc: 'ripgrep project search', takesArg: true },
  { name: '/theme', selScoped: false, desc: 'switch color theme', takesArg: true },
  { name: '/help', selScoped: false, desc: 'keys & commands' },
  { name: '/quit', selScoped: false, desc: 'quit loom', danger: true },
];

export interface SlashItem extends SlashCommand {
  /** Arg already typed after the command name, trimmed. */
  arg: string;
}

/** `/di` → /diff /discard. `/find listen` → /find with arg. */
export function filterSlash(value: string): SlashItem[] {
  if (!value.startsWith('/')) return [];
  const space = value.indexOf(' ');
  const head = (space < 0 ? value : value.slice(0, space)).toLowerCase();
  const arg = space < 0 ? '' : value.slice(space + 1).trim();

  // Exact command + arg typed → only that command.
  const exact = SLASH_COMMANDS.find((c) => c.name === head);
  if (exact && space >= 0) {
    return exact.takesArg ? [{ ...exact, arg }] : [{ ...exact, arg: '' }];
  }

  const q = head.slice(1);
  const out: SlashItem[] = [];
  for (const c of SLASH_COMMANDS) {
    if (c.name.toLowerCase().startsWith(head)) out.push({ ...c, arg: '' });
  }
  if (q.length > 0) {
    for (const c of SLASH_COMMANDS) {
      if (!c.name.toLowerCase().startsWith(head) && c.name.slice(1).toLowerCase().includes(q)) {
        out.push({ ...c, arg: '' });
      }
    }
  }
  return out;
}

/** Contiguous-substring highlight positions for a palette entry (prototype rule). */
export function slashMatchPositions(name: string, value: string): number[] {
  const space = value.indexOf(' ');
  const head = space < 0 ? value : value.slice(0, space);
  if (!head || head === '/') return [];
  const q = head.toLowerCase();
  const n = name.toLowerCase();
  let at = n.indexOf(q);
  let len = q.length;
  if (at < 0) {
    at = n.indexOf(q.slice(1));
    len = q.length - 1;
    if (at < 0 || len === 0) return [];
  }
  return Array.from({ length: len }, (_, k) => at + k);
}

/** Theme entries surfaced when the user types `/theme …`. */
export interface ThemeEntry {
  id: string;
  label: string;
  theme: string;
  accent: 'cyan' | 'amber' | 'green' | 'violet';
}

export function themeEntries(userThemes: ReadonlyMap<string, unknown>): ThemeEntry[] {
  const out: ThemeEntry[] = [
    { id: 'neon/cyan', label: 'neon · cyan', theme: 'neon', accent: 'cyan' },
    { id: 'neon/amber', label: 'neon · amber', theme: 'neon', accent: 'amber' },
    { id: 'neon/green', label: 'neon · green', theme: 'neon', accent: 'green' },
    { id: 'neon/violet', label: 'neon · violet', theme: 'neon', accent: 'violet' },
    { id: 'mono', label: 'mono · classic green', theme: 'mono', accent: 'cyan' },
  ];
  for (const name of userThemes.keys()) {
    out.push({ id: name, label: `${name} · user theme`, theme: name, accent: 'cyan' });
  }
  return out;
}

export function filterThemeEntries(entries: ThemeEntry[], arg: string): ThemeEntry[] {
  if (!arg) return entries;
  const q = arg.toLowerCase();
  return entries.filter((e) => e.id.toLowerCase().includes(q) || e.label.toLowerCase().includes(q));
}
