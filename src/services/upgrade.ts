/* In-place self-upgrade for an installed loom (`loom --upgrade`). loom installs
   as a git clone under ~/.loom/app (symlinked onto $PATH), so upgrading is just
   pull + reinstall + rebuild in that clone. The control flow is kept pure (an
   injectable step runner) so it unit-tests without spawning git/npm. */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface UpgradeStep {
  label: string;
  cmd: string;
  args: string[];
}

/** Runs one step in `cwd`; returns true on success. Injectable for tests. */
export type StepRunner = (step: UpgradeStep, cwd: string) => boolean;

const INSTALL_CMD =
  'curl -fsSL https://raw.githubusercontent.com/claytantor/loom-ide/main/install.sh | bash';

export function upgradeSteps(): UpgradeStep[] {
  return [
    { label: 'fetching latest', cmd: 'git', args: ['pull', '--ff-only'] },
    { label: 'installing dependencies', cmd: 'npm', args: ['install', '--no-fund', '--no-audit', '--loglevel=error'] },
    { label: 'building', cmd: 'npm', args: ['run', 'build'] },
  ];
}

const defaultRunner: StepRunner = (step, cwd) =>
  spawnSync(step.cmd, step.args, { cwd, stdio: 'inherit' }).status === 0;

export interface UpgradeResult {
  ok: boolean;
  message: string;
}

/** Upgrade the loom install rooted at `appDir` (the git clone the binary lives
   in). Returns a result instead of exiting, so the caller owns process exit. */
export function runUpgrade(appDir: string, run: StepRunner = defaultRunner): UpgradeResult {
  if (!existsSync(join(appDir, '.git'))) {
    return {
      ok: false,
      message: `${appDir} isn't a git install, so loom can't upgrade itself here.\nreinstall with:\n  ${INSTALL_CMD}`,
    };
  }
  for (const step of upgradeSteps()) {
    if (!run(step, appDir)) {
      const hint =
        step.cmd === 'git' ? ' — uncommitted changes or no upstream? resolve those and retry' : '';
      return { ok: false, message: `upgrade failed while ${step.label} (\`${step.cmd} ${step.args.join(' ')}\`)${hint}` };
    }
  }
  return { ok: true, message: 'loom is up to date' };
}
