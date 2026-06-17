import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUpgrade, upgradeSteps, type UpgradeStep } from '../src/services/upgrade.js';

describe('upgradeSteps', () => {
  test('fetches, hard-resets to origin/main, reinstalls, then builds — in that order', () => {
    expect(upgradeSteps().map((s) => `${s.cmd} ${s.args.join(' ')}`)).toEqual([
      'git fetch --tags origin main',
      'git reset --hard origin/main',
      'npm install --no-fund --no-audit --loglevel=error',
      'npm run build',
    ]);
  });
});

describe('runUpgrade', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loom-up-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('refuses a non-git install with a reinstall hint, running nothing', () => {
    const calls: UpgradeStep[] = [];
    const res = runUpgrade(dir, (s) => {
      calls.push(s);
      return true;
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/git install/i);
    expect(res.message).toContain('install.sh');
    expect(calls).toEqual([]);
  });

  test('runs every step in order, in the app dir, on success', async () => {
    await mkdir(join(dir, '.git'));
    const calls: string[] = [];
    const res = runUpgrade(dir, (s, cwd) => {
      calls.push(`${s.cmd}:${cwd === dir}`);
      return true;
    });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/up to date/i);
    expect(calls).toEqual(['git:true', 'git:true', 'npm:true', 'npm:true']);
  });

  test('stops at the first failing step and names it', async () => {
    await mkdir(join(dir, '.git'));
    const calls: string[] = [];
    const res = runUpgrade(dir, (s) => {
      calls.push(s.cmd);
      return s.cmd !== 'npm'; // fail at `npm install`
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/installing dependencies/);
    expect(calls).toEqual(['git', 'git', 'npm']); // build never runs
  });

  test('a git failure carries the network/remote hint', async () => {
    await mkdir(join(dir, '.git'));
    const res = runUpgrade(dir, (s) => s.cmd !== 'git'); // fail at `git fetch`
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/network|origin\/main|reachable/i);
  });
});
