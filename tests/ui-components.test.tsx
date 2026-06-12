import { describe, expect, test } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { TreePane } from '../src/ui/TreePane.js';
import { OmniBar } from '../src/ui/OmniBar.js';
import { SlashPalette } from '../src/ui/SlashPalette.js';
import { CommandView, EmptyMain, HelpView, HELP_ROWS } from '../src/ui/OutputViews.js';
import { Editor } from '../src/ui/Editor.js';
import { buildTree, flattenVisible, setDirOpen, applyGitStatus, type GitCode } from '../src/core/tree.js';
import { computeFilter } from '../src/core/filter.js';
import { filterSlash } from '../src/state/commands.js';
import { createVim } from '../src/core/vim/index.js';

const PATHS = ['src/server/index.ts', 'src/server/app.ts', 'scripts/deploy.sh', 'package.json'];

function makeTree() {
  let t = buildTree(PATHS, 'repo');
  t = setDirOpen(setDirOpen(t, 'src', true), 'src/server', true);
  return applyGitStatus(t, new Map<string, GitCode>([
    ['src/server/index.ts', 'M'],
    ['scripts/deploy.sh', '?'],
  ]));
}

describe('TreePane', () => {
  test('renders header, rows, selection cursor, git dots, idle footer', () => {
    const tree = makeTree();
    const rows = flattenVisible(tree);
    const { lastFrame } = render(
      <TreePane
        rows={rows}
        selPath="src/server/index.ts"
        matchByPath={new Map()}
        flash={new Map()}
        focused
        query=""
        count={0}
        width={36}
        height={14}
        showFooter
        footerHint="/edit /diff /blame on index.ts"
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('FILES');
    expect(frame).toContain('❱');
    expect(frame).toContain('index.ts');
    expect(frame).toContain('●M');
    expect(frame).toContain('●?');
    expect(frame).toContain('/edit /diff /blame on index.ts');
  });

  test('filter mode shows query chip and match count footer', () => {
    const tree = makeTree();
    const res = computeFilter(tree, 'srvind', 'dim');
    const { lastFrame } = render(
      <TreePane
        rows={res.rows}
        selPath={res.topPath}
        matchByPath={res.matchByPath}
        flash={new Map()}
        focused
        query="srvind"
        count={res.count}
        width={50}
        height={14}
        showFooter
        footerHint=""
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('filter: srvind');
    expect(frame).toMatch(/1 match/);
    expect(frame).toContain('Esc clear');
  });

  test('hide mode drops non-matching branches from render', () => {
    const tree = makeTree();
    const res = computeFilter(tree, 'deploy', 'hide');
    const { lastFrame } = render(
      <TreePane
        rows={res.rows}
        selPath={res.topPath}
        matchByPath={res.matchByPath}
        flash={new Map()}
        focused
        query="deploy"
        count={res.count}
        width={38}
        height={14}
        showFooter
        footerHint=""
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('deploy.sh');
    expect(frame).not.toContain('package.json');
  });
});

describe('OmniBar', () => {
  test('wide layout shows the full status readout', () => {
    const { lastFrame } = render(
      <OmniBar
        value=""
        mode="idle"
        inputMode={null}
        branch="main"
        isRepo
        vimDirty={false}
        onDisk={2}
        pulse={false}
        layout="wide"
        spinner={null}
        width={100}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('›');
    expect(frame).toContain('[ready]');
    expect(frame).toContain('2 changed on disk');
    expect(frame).toContain('⎇ main ✓');
  });

  test('mid layout abbreviates; filter mode labeled', () => {
    const { lastFrame } = render(
      <OmniBar
        value="srv"
        mode="filter"
        inputMode={null}
        branch="main"
        isRepo
        vimDirty
        onDisk={3}
        pulse={false}
        layout="mid"
        spinner={null}
        width={70}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('[filter]');
    expect(frame).not.toContain('changed on disk');
    expect(frame).toContain('main ±');
  });

  test('confirm prompt renders question in input mode', () => {
    const { lastFrame } = render(
      <OmniBar
        value=""
        mode="input"
        inputMode={{ kind: 'confirm', question: 'discard changes to a.ts?', action: { kind: 'quit' } }}
        branch="main"
        isRepo
        vimDirty={false}
        onDisk={0}
        pulse={false}
        layout="wide"
        spinner={null}
        width={100}
      />,
    );
    expect(lastFrame()!).toContain('discard changes to a.ts? [y/n]');
  });
});

describe('SlashPalette', () => {
  test('renders filtered commands with selection-scoped descriptions and danger color', () => {
    const items = filterSlash('/di');
    const { lastFrame } = render(
      <SlashPalette items={items} themeItems={null} sel={0} query="/di" selName="index.ts" width={80} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('/diff');
    expect(frame).toContain('git diff of index.ts');
    expect(frame).toContain('/discard');
  });
});

describe('EmptyMain', () => {
  test('welcome wordmark and hints', () => {
    const { lastFrame } = render(<EmptyMain width={60} height={10} watching />);
    const frame = lastFrame()!;
    expect(frame).toContain('l o o m');
    expect(frame).toContain('type to filter');
    expect(frame).toContain('/help for keys');
  });
});

describe('Editor wrap', () => {
  // 58 cols; at width 40 the editor's content area is ~37, so this wraps.
  const longLine = 'HEAD' + '.'.repeat(50) + 'TAIL';
  const frameFor = (wrap: boolean): string =>
    render(
      <Editor
        vim={createVim(longLine)}
        path="notes.md"
        focused
        gutter
        wrap={wrap}
        branch="main"
        stale={false}
        diagnostics={[]}
        width={40}
        height={12}
      />,
    ).lastFrame()!;

  test('nowrap truncates the long line — the tail is hidden', () => {
    const frame = frameFor(false);
    expect(frame).toContain('HEAD');
    expect(frame).not.toContain('TAIL');
  });

  test('wrap renders the continuation on a second row — the tail is visible', () => {
    const frame = frameFor(true);
    expect(frame).toContain('HEAD');
    expect(frame).toContain('TAIL');
  });

  test('a wrapped buffer still numbers later lines once (continuations are blank)', () => {
    const vim = createVim(longLine + '\nsecond line');
    const frame = render(
      <Editor vim={vim} path="notes.md" focused gutter wrap branch="main" stale={false} diagnostics={[]} width={40} height={12} />,
    ).lastFrame()!;
    expect(frame).toContain('TAIL'); // line 1 wrapped
    expect(frame).toContain('second line'); // line 2 present
    expect(frame).toMatch(/\b2\b/); // line 2 keeps its number
  });
});

describe('HelpView', () => {
  test('renders header, sections, key binds and a command from the registry', () => {
    const { lastFrame } = render(<HelpView scroll={0} width={80} height={40} />);
    const frame = lastFrame()!;
    expect(frame).toContain('/help');
    expect(frame).toContain('keys & commands');
    expect(frame).toContain('file tree');
    expect(frame).toContain('fuzzy-filter the file tree');
    expect(frame).toContain('/diff');
    expect(frame).toContain('Esc close');
  });

  test('scroll offset drops earlier rows and shows a "more" affordance when clipped', () => {
    const top = render(<HelpView scroll={0} width={80} height={8} />).lastFrame()!;
    expect(top).toContain('omni-bar'); // first section visible at scroll 0
    expect(top).toContain('more'); // content exceeds the short viewport
    const scrolled = render(<HelpView scroll={HELP_ROWS.length - 2} width={80} height={8} />).lastFrame()!;
    expect(scrolled).not.toContain('omni-bar'); // scrolled past the top
  });
});

describe('CommandView', () => {
  test('labels gh output and renders lines on success', () => {
    const { lastFrame } = render(
      <CommandView
        result={{ label: 'gh', argv: ['pr', 'list'], lines: ['#1  Fix bug  OPEN', '#2  Add x  MERGED'], code: 0, ok: true, truncated: false }}
        scroll={0}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('gh pr list');
    expect(frame).toContain('#1  Fix bug  OPEN');
    expect(frame).toContain('2 lines');
    expect(frame).toContain('Esc close');
  });

  test('labels git output distinctly from gh', () => {
    const { lastFrame } = render(
      <CommandView
        result={{ label: 'git', argv: ['status', '-sb'], lines: ['## main', ' M src/app.ts'], code: 0, ok: true, truncated: false }}
        scroll={0}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('git status -sb');
    expect(frame).toContain('## main');
  });

  test('shows the error in the header on failure', () => {
    const { lastFrame } = render(
      <CommandView
        result={{ label: 'git', argv: ['log'], lines: ['fatal: not a git repository'], code: 128, ok: false, error: 'git exited 128', truncated: false }}
        scroll={0}
        width={80}
        height={20}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('git log');
    expect(frame).toContain('git exited 128');
    expect(frame).toContain('fatal: not a git repository');
  });
});
