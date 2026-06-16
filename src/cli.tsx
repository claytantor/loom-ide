#!/usr/bin/env node
/* loom — entry point. Runs the app full-screen in the alternate buffer so the
   user's scrollback is untouched and restored intact on exit. */

import React from 'react';
import { render } from 'ink';
import { resolve, dirname } from 'node:path';
import { statSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { App } from './app/App.js';
import { runUpgrade } from './services/upgrade.js';

const ALT_SCREEN_ON = '\x1b[?1049h\x1b[H';
const ALT_SCREEN_OFF = '\x1b[?1049l';
// Bracketed paste: pasted text arrives wrapped in \x1b[200~ … \x1b[201~ as one
// block instead of a key storm that would trip vim commands / autoindent. Same
// enable-on-start / disable-on-teardown lifecycle as the alt-screen buffer so
// it's always cleaned up on exit.
const BRACKETED_PASTE_ON = '\x1b[?2004h';
const BRACKETED_PASTE_OFF = '\x1b[?2004l';

function usage(): void {
  process.stdout.write(
    [
      'loom — an Ink-powered TUI IDE that sits beside Claude Code',
      '',
      'usage: loom [directory]',
      '',
      '  directory      repo to open (default: current directory)',
      '  -h, --help     show this help',
      '  -V, --version  print version',
      '  --upgrade      update loom in place (git pull + reinstall + build)',
      '',
      'config lives in ~/.loom (config.yml, keybindings.yml, themes/)',
      '',
    ].join('\n'),
  );
}

/** The loom install root (the dir containing dist/ + package.json). Resolves the
   symlink so an installed `loom` on $PATH finds its real ~/.loom/app clone. */
function appRoot(): string {
  const cli = realpathSync(fileURLToPath(import.meta.url)); // …/app/dist/cli.js
  return resolve(dirname(cli), '..');
}

function upgrade(): void {
  const dir = appRoot();
  process.stdout.write(`upgrading loom in ${dir}\n`);
  const res = runUpgrade(dir);
  if (res.ok) {
    process.stdout.write(`\x1b[32m✓\x1b[0m ${res.message} — loom ${version()}\n`);
  } else {
    process.stderr.write(`\x1b[31mloom:\x1b[0m ${res.message}\n`);
    process.exit(1);
  }
}

function version(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function main(): void {
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') {
    usage();
    return;
  }
  if (arg === '--version' || arg === '-V') {
    process.stdout.write(`loom ${version()}\n`);
    return;
  }
  if (arg === '--upgrade' || arg === 'upgrade') {
    upgrade();
    return;
  }
  const root = resolve(arg ?? process.cwd());
  try {
    if (!statSync(root).isDirectory()) {
      process.stderr.write(`loom: not a directory: ${root}\n`);
      process.exit(1);
    }
  } catch {
    process.stderr.write(`loom: can't open ${root}\n`);
    process.exit(1);
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write('loom: needs an interactive terminal\n');
    process.exit(1);
  }

  process.stdout.write(ALT_SCREEN_ON);
  process.stdout.write(BRACKETED_PASTE_ON);
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    process.stdout.write(BRACKETED_PASTE_OFF);
    process.stdout.write(ALT_SCREEN_OFF);
  };
  process.on('exit', restore);
  process.on('SIGTERM', () => {
    restore();
    process.exit(0);
  });

  const app = render(<App root={root} />, { exitOnCtrlC: true });
  void app.waitUntilExit().then(
    () => {
      restore();
      // The watcher (chokidar) and LSP child processes hold the event loop
      // open after unmount — exit explicitly so `/quit` actually returns the
      // shell instead of hanging in the alternate screen.
      process.exit(0);
    },
    () => {
      restore();
      process.exit(1);
    },
  );
}

main();
