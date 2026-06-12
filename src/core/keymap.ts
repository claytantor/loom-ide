/* Data-driven keymap. Chrome/navigation keys are rebindable per context via
   ~/.loom/keybindings.yml; vim-mode keys inside the editor belong to the vim
   engine and are not remapped here (documented in the seed file). */

export type KeyContext = 'tree' | 'find' | 'output' | 'slash' | 'ex' | 'editor';

export type KeyAction =
  | 'nav.up'
  | 'nav.down'
  | 'nav.left'
  | 'nav.right'
  | 'select'
  | 'back'
  | 'focus.toggle'
  | 'save'
  | 'gutter.toggle';

/** Normalized key descriptor: lowercase, '+'-joined modifiers, e.g. 'ctrl+s', 'up', 'h'. */
export type KeyDesc = string;

export type Keymap = Record<KeyContext, Partial<Record<KeyAction, KeyDesc[]>>>;

export const DEFAULT_KEYMAP: Keymap = {
  tree: {
    'nav.up': ['up'],
    'nav.down': ['down'],
    'nav.left': ['left'],
    'nav.right': ['right'],
    select: ['return'],
    back: ['escape'],
    'focus.toggle': ['tab'],
  },
  find: {
    'nav.up': ['up', 'k'],
    'nav.down': ['down', 'j'],
    select: ['return'],
    back: ['escape'],
    'focus.toggle': ['tab'],
  },
  output: {
    'nav.up': ['up', 'k'],
    'nav.down': ['down', 'j'],
    back: ['escape'],
    'focus.toggle': ['tab'],
  },
  slash: {
    'nav.up': ['up'],
    'nav.down': ['down'],
    select: ['return'],
    back: ['escape'],
  },
  ex: {
    select: ['return'],
    back: ['escape'],
  },
  editor: {
    'focus.toggle': ['tab'],
    save: ['ctrl+s'],
    'gutter.toggle': ['ctrl+g'],
  },
};

const CONTEXTS: KeyContext[] = ['tree', 'find', 'output', 'slash', 'ex', 'editor'];
const ACTIONS: KeyAction[] = [
  'nav.up', 'nav.down', 'nav.left', 'nav.right',
  'select', 'back', 'focus.toggle', 'save', 'gutter.toggle',
];

export interface KeymapLoadResult {
  keymap: Keymap;
  warnings: string[];
}

/** Merge a parsed keybindings.yml object over the defaults, validating shape. */
export function applyKeymapOverrides(defaults: Keymap, raw: unknown): KeymapLoadResult {
  const warnings: string[] = [];
  const keymap: Keymap = structuredClone(defaults);
  if (raw === null || raw === undefined) return { keymap, warnings };
  if (typeof raw !== 'object') {
    warnings.push('keybindings.yml: top level must be a mapping');
    return { keymap, warnings };
  }
  for (const [ctx, bindings] of Object.entries(raw as Record<string, unknown>)) {
    if (!CONTEXTS.includes(ctx as KeyContext)) {
      warnings.push(`keybindings.yml: unknown context '${ctx}'`);
      continue;
    }
    if (bindings === null || typeof bindings !== 'object') {
      warnings.push(`keybindings.yml: context '${ctx}' must be a mapping`);
      continue;
    }
    for (const [action, keys] of Object.entries(bindings as Record<string, unknown>)) {
      if (!ACTIONS.includes(action as KeyAction)) {
        warnings.push(`keybindings.yml: unknown action '${ctx}.${action}'`);
        continue;
      }
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : null;
      if (!list || !list.every((k) => typeof k === 'string' && k.length > 0)) {
        warnings.push(`keybindings.yml: '${ctx}.${action}' must be a key or list of keys`);
        continue;
      }
      keymap[ctx as KeyContext][action as KeyAction] = list.map((k) => k.toLowerCase());
    }
  }
  return { keymap, warnings };
}

export function lookupAction(keymap: Keymap, context: KeyContext, desc: KeyDesc): KeyAction | null {
  const bindings = keymap[context];
  for (const [action, keys] of Object.entries(bindings)) {
    if (keys?.includes(desc)) return action as KeyAction;
  }
  return null;
}

/** Build a normalized key descriptor from Ink's useInput (input, key) pair. */
export function keyDescFromInk(
  input: string,
  key: {
    upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean;
    return?: boolean; escape?: boolean; tab?: boolean; backspace?: boolean; delete?: boolean;
    pageDown?: boolean; pageUp?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean;
  },
): KeyDesc {
  let base = '';
  if (key.upArrow) base = 'up';
  else if (key.downArrow) base = 'down';
  else if (key.leftArrow) base = 'left';
  else if (key.rightArrow) base = 'right';
  else if (key.return) base = 'return';
  else if (key.escape) base = 'escape';
  else if (key.tab) base = 'tab';
  else if (key.backspace) base = 'backspace';
  else if (key.delete) base = 'delete';
  else if (key.pageUp) base = 'pageup';
  else if (key.pageDown) base = 'pagedown';
  else base = input.toLowerCase();
  const mods: string[] = [];
  if (key.ctrl) mods.push('ctrl');
  if (key.meta) mods.push('meta');
  return mods.length ? `${mods.join('+')}+${base}` : base;
}
