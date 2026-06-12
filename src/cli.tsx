#!/usr/bin/env node
/* loom — entry point. Runs the app full-screen in the alternate buffer so the
   user's scrollback is untouched and restored intact on exit. */

import React from 'react';
import { render } from 'ink';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { App } from './app/App.js';

const ALT_SCREEN_ON = '\x1b[?1049h\x1b[H';
const ALT_SCREEN_OFF = '\x1b[?1049l';

function usage(): void {
  process.stdout.write(
    [
      'loom — an Ink-powered TUI IDE that sits beside Claude Code',
      '',
      'usage: loom [directory]',
      '',
      '  directory   repo to open (default: current directory)',
      '  -h, --help     show this help',
      '  -V, --version  print version',
      '',
      'config lives in ~/.loom (config.yml, keybindings.yml, themes/)',
      '',
    ].join('\n'),
  );
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
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
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
