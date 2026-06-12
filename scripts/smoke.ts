#!/usr/bin/env tsx
/*
 * End-to-end PTY smoke test for the built loom binary.
 *
 * Boots `dist/cli.js` inside a real pseudo-terminal (allocated via util-linux
 * `script`, since Ink needs an interactive TTY) against a throwaway git repo,
 * drives keystrokes through the four screens — idle, fuzzy filter, slash
 * palette, /find output — then quits and asserts the app booted, rendered its
 * chrome, and exited without a crash. Run after `npm run build`:
 *
 *   npx tsx scripts/smoke.ts
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve('dist/cli.js');
if (!existsSync(cli)) {
  console.error('smoke: dist/cli.js not found — run `npm run build` first');
  process.exit(2);
}

/* ── throwaway fixture repo ───────────────────────────────────────────── */
const fixture = mkdtempSync(join(tmpdir(), 'loom-smoke-'));
mkdirSync(join(fixture, 'src', 'server'), { recursive: true });
writeFileSync(join(fixture, 'src', 'server', 'index.ts'), 'export const port = 8080;\nserver.listen(port);\n');
writeFileSync(join(fixture, 'src', 'server', 'app.ts'), 'export const app = 1; // listen\n');
writeFileSync(join(fixture, 'README.md'), '# fixture repo\n');
try {
  const git = (...a: string[]): void => { execFileSync('git', ['-C', fixture, ...a], { stdio: 'ignore' }); };
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  // leave one tracked file dirty so git decorations + status readout have data
  writeFileSync(join(fixture, 'src', 'server', 'index.ts'), 'export const port = 9090;\n');
} catch {
  // git absent — loom still runs, just without decorations
}

/* ── boot in a PTY and drive keys ─────────────────────────────────────── */
// `script` allocates a PTY but leaves it sizeless; size it with stty first so
// the app sees real columns/rows (Ink/loom render nothing in a 0x0 terminal).
const COLS = 120;
const ROWS = 40;
const child = spawn('script', ['-qfec', `stty cols ${COLS} rows ${ROWS}; node ${cli} ${fixture}`, '/dev/null'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, LOOM_HOME: join(fixture, '.loom'), COLUMNS: String(COLS), LINES: String(ROWS), TERM: 'xterm-256color' },
});

let out = '';
child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
child.stderr.on('data', (d: Buffer) => { out += d.toString(); });

const ESC = '\x1b';
const CR = '\r';
const send = (s: string): void => { try { child.stdin.write(s); } catch { /* exited */ } };

// Type a string one key at a time (terminals deliver discrete keystrokes; Ink
// parses a multi-char write as ONE input event, so bursts mis-submit). Returns
// the timestamp after the last key so the next step can chain off it.
const KEY_GAP = 90;
let clock = 1200; // let the async boot (scan + settings) settle first
function type(keys: string[], gap = KEY_GAP): void {
  for (const k of keys) {
    const t = clock;
    setTimeout(() => send(k), t);
    clock += gap;
  }
}
function pause(ms: number): void { clock += ms; }

type([...'srv']);             // 1. fuzzy filter the tree
pause(700);
type([ESC]);                  //    clear filter (restores tree exactly)
pause(500);
type(['/', ...'di']);         // 2. slash palette → /diff /discard ...
pause(500);
type([ESC]);                  //    dismiss palette
pause(400);
type([CR]);                   // 3. open the selected file in the editor
pause(700);
type([ESC]);                  //    back to tree
pause(400);
type(['/', ...'find', ' ', ...'listen', CR]); // 4. /find with inline arg
pause(900);
type([ESC]);                  //    close find view
pause(400);
type(['/', ...'quit', CR]);   //    quit cleanly

const code: number = await new Promise((res) => {
  let settled = false;
  const finish = (c: number): void => { if (!settled) { settled = true; res(c); } };
  child.on('exit', (c) => finish(c ?? 0));
  child.on('error', () => finish(-1));
  setTimeout(() => { try { child.stdin.write('/quit' + CR); } catch { /* */ } }, 9000);
  setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } finish(124); }, 12000);
});

/* ── assert ───────────────────────────────────────────────────────────── */
const clean = out
  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  .replace(/\x1b[()][AB0]/g, '')
  .replace(/\x1b[<>=]/g, '');

rmSync(fixture, { recursive: true, force: true });

const looksLikeCrash =
  /\n\s+at\s+.+\(.+:\d+:\d+\)/.test(clean) ||
  /\b(TypeError|ReferenceError|SyntaxError|Cannot read|is not a function|UnhandledPromiseRejection)\b/.test(clean);

const checks: [string, boolean][] = [
  ['rendered the FILES tree chrome', clean.includes('FILES')],
  ['rendered a known fixture node', clean.includes('index.ts') || clean.includes('README') || clean.includes('server')],
  ['no crash / stack trace in output', !looksLikeCrash],
  ['exited cleanly (code 0)', code === 0],
];

let ok = true;
console.log('loom PTY smoke test');
for (const [name, pass] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${name}`);
  if (!pass) ok = false;
}
console.log(`  exit code: ${code}`);
if (!ok) {
  console.log('\n--- captured (cleaned, tail) ---\n' + clean.split('\n').slice(-40).join('\n'));
}
process.exit(ok ? 0 : 1);
