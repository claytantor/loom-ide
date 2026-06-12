/* One recursive watcher over the repo, events coalesced into batches so a
   burst of agent edits lands as a single tree/git refresh. */

import { watch, type FSWatcher } from 'chokidar';
import { relative, sep } from 'node:path';
import { buildIgnorePredicate } from './fsScan.js';

export interface WatchBatch {
  added: string[];
  addedDirs: string[];
  changed: string[];
  removed: string[];
}

export interface RepoWatcher {
  close(): Promise<void>;
}

const COALESCE_MS = 80;

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

export async function watchRepo(
  root: string,
  onBatch: (batch: WatchBatch) => void,
): Promise<RepoWatcher> {
  const ignored = await buildIgnorePredicate(root);
  const watcher: FSWatcher = watch(root, {
    ignored: (path, stats) => ignored(path, stats?.isDirectory() ?? false),
    ignoreInitial: true,
    persistent: true,
  });

  let pending: WatchBatch = { added: [], addedDirs: [], changed: [], removed: [] };
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    timer = null;
    const batch = pending;
    pending = { added: [], addedDirs: [], changed: [], removed: [] };
    onBatch(batch);
  };
  const queue = (bucket: keyof WatchBatch, absPath: string): void => {
    const rel = toPosix(relative(root, absPath));
    if (!rel || rel.startsWith('..')) return;
    pending[bucket].push(rel);
    if (!timer) timer = setTimeout(flush, COALESCE_MS);
  };

  watcher.on('add', (p) => queue('added', p));
  watcher.on('addDir', (p) => queue('addedDirs', p));
  watcher.on('change', (p) => queue('changed', p));
  watcher.on('unlink', (p) => queue('removed', p));
  watcher.on('unlinkDir', (p) => queue('removed', p));
  watcher.on('error', () => { /* fs races during agent bursts are expected */ });

  return {
    async close(): Promise<void> {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}
