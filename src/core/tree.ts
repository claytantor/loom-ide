/* Tree model — pure, immutable updates (copy along the changed path only). */

import { parentPath } from './text.js';

export type GitCode = 'M' | '?' | '+' | '-' | '!';

export interface TreeNode {
  name: string;
  type: 'dir' | 'file';
  /** Repo-relative path, '' for the root node. */
  path: string;
  git?: GitCode;
  /** Dirs only: expanded state. */
  open?: boolean;
  children?: TreeNode[];
  /** Deleted on disk; rendered dimmed briefly before removal. */
  ghost?: boolean;
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

const GIT_PRIORITY: GitCode[] = ['!', 'M', '+', '-', '?'];

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
}

/** Build a tree from a flat list of file paths; intermediate dirs are created. */
export function buildTree(paths: string[], rootName = ''): TreeNode {
  const root: TreeNode = { name: rootName, type: 'dir', path: '', open: true, children: [] };
  for (const p of paths) {
    if (!p) continue;
    insertPath(root, p, 'file');
  }
  sortDeep(root);
  return root;
}

function insertPath(root: TreeNode, path: string, type: 'dir' | 'file'): void {
  const parts = path.split('/');
  let node = root;
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    acc = acc ? `${acc}/${part}` : part;
    const leaf = i === parts.length - 1;
    node.children ??= [];
    let child = node.children.find((c) => c.name === part);
    if (!child) {
      child = leaf && type === 'file'
        ? { name: part, type: 'file', path: acc }
        : { name: part, type: 'dir', path: acc, open: false, children: [] };
      node.children.push(child);
    }
    node = child;
  }
}

function sortDeep(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort(compareNodes);
  for (const c of node.children) sortDeep(c);
}

/** Visible rows honoring `open` flags. Root itself is not a row. */
export function flattenVisible(root: TreeNode): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (node: TreeNode, depth: number): void => {
    for (const c of node.children ?? []) {
      out.push({ node: c, depth });
      if (c.type === 'dir' && c.open) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  for (const c of root.children ?? []) {
    if (path === c.path || path.startsWith(c.path + '/') || c.path === '') {
      const r = findNode(c, path);
      if (r) return r;
    }
  }
  return null;
}

/** Immutably patch the node at `path`; returns a new root (or the same root if not found). */
export function updateNode(root: TreeNode, path: string, patch: Partial<TreeNode>): TreeNode {
  if (root.path === path) return { ...root, ...patch };
  if (!root.children) return root;
  let changed = false;
  const children = root.children.map((c) => {
    if (path === c.path || path.startsWith(c.path === '' ? '' : c.path + '/')) {
      const next = updateNode(c, path, patch);
      if (next !== c) changed = true;
      return next;
    }
    return c;
  });
  return changed ? { ...root, children } : root;
}

export function setDirOpen(root: TreeNode, path: string, open: boolean): TreeNode {
  return updateNode(root, path, { open });
}

/** Expand every ancestor directory of `path`. */
export function expandTo(root: TreeNode, path: string): TreeNode {
  let next = root;
  let acc = '';
  for (const part of parentPath(path).split('/')) {
    if (!part) continue;
    acc = acc ? `${acc}/${part}` : part;
    next = setDirOpen(next, acc, true);
  }
  return next;
}

/** Add a path (file or dir) creating intermediates; returns new root. */
export function addPath(root: TreeNode, path: string, type: 'dir' | 'file'): TreeNode {
  if (findNode(root, path)) return updateNode(root, path, { ghost: false });
  const clone = structuredClone(root) as TreeNode;
  insertPath(clone, path, type);
  sortDeep(clone);
  return clone;
}

export function removePath(root: TreeNode, path: string): TreeNode {
  const parent = parentPath(path);
  const parentNode = findNode(root, parent);
  if (!parentNode?.children?.some((c) => c.path === path)) return root;
  const prune = (node: TreeNode): TreeNode => {
    if (node.path === parent) {
      return { ...node, children: (node.children ?? []).filter((c) => c.path !== path) };
    }
    if (!node.children) return node;
    return { ...node, children: node.children.map(prune) };
  };
  return prune(root);
}

export function allFiles(root: TreeNode, out: TreeNode[] = []): TreeNode[] {
  if (root.type === 'file') out.push(root);
  for (const c of root.children ?? []) allFiles(c, out);
  return out;
}

export function expandedPaths(root: TreeNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode): void => {
    if (n.type === 'dir' && n.open && n.path) out.add(n.path);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

/** Restore a previously captured expansion set exactly. */
export function applyExpanded(root: TreeNode, expanded: Set<string>): TreeNode {
  const walk = (n: TreeNode): TreeNode => {
    const children = n.children?.map(walk);
    if (n.type === 'dir' && n.path) {
      return { ...n, open: expanded.has(n.path), ...(children ? { children } : {}) };
    }
    return children ? { ...n, children } : n;
  };
  return walk(root);
}

/**
 * Apply git status codes to files and roll up a summary code onto directories
 * (strongest child status wins: ! > M > + > - > ?).
 */
export function applyGitStatus(root: TreeNode, status: ReadonlyMap<string, GitCode>): TreeNode {
  const walk = (n: TreeNode): TreeNode => {
    if (n.type === 'file') {
      const git = status.get(n.path);
      if (git === n.git) return n;
      const next = { ...n };
      if (git) next.git = git;
      else delete next.git;
      return next;
    }
    const children = (n.children ?? []).map(walk);
    const changed = children.some((c, i) => c !== n.children?.[i]);
    let rollup: GitCode | undefined;
    for (const c of children) {
      if (!c.git) continue;
      if (rollup === undefined || GIT_PRIORITY.indexOf(c.git) < GIT_PRIORITY.indexOf(rollup)) {
        rollup = c.git;
      }
    }
    if (!changed && rollup === n.git) return n;
    const next = { ...n, children };
    if (rollup) next.git = rollup;
    else delete next.git;
    return next;
  };
  return walk(root);
}
