/* Command output views in the main area: /find, /diff, /blame.
   Same shell: header, single underline, scrollable body, hint status line. */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { FindResult } from '../services/ripgrep.js';
import type { BlameLine, DiffLine } from '../core/gitParse.js';
import { endTruncate } from '../core/text.js';
import { useChrome } from './context.js';

const CHROME_ROWS = 3; // header + underline + status hint

interface ShellProps {
  width: number;
  height: number;
  header: React.JSX.Element;
  hint: string;
  children: React.JSX.Element[];
}

function OutputShell(p: ShellProps): React.JSX.Element {
  const { theme, g } = useChrome();
  return (
    <Box flexDirection="column" width={p.width} height={p.height} paddingLeft={1}>
      <Box>{p.header}</Box>
      <Text color={theme.dim}>{g.hrule.repeat(Math.max(0, p.width - 2))}</Text>
      <Box flexDirection="column" height={Math.max(1, p.height - CHROME_ROWS)}>{p.children}</Box>
      <Text color={theme.dim} wrap="truncate">{p.hint}</Text>
    </Box>
  );
}

/* ── /find ──────────────────────────────────────────────────────────────── */

export interface FindRowRef {
  path: string;
  line: number;
}

/** Flat list of hits in render order — the app navigates this. */
export function flattenFind(res: FindResult): FindRowRef[] {
  const out: FindRowRef[] = [];
  for (const grp of res.groups) for (const h of grp.hits) out.push({ path: grp.path, line: h.line });
  return out;
}

export interface FindViewProps {
  result: FindResult;
  sel: number;
  width: number;
  height: number;
}

export function FindView({ result, sel, width, height }: FindViewProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const bodyHeight = Math.max(1, height - CHROME_ROWS);

  // Render rows: group headers + hits, with a blank between groups.
  const rendered = useMemo(() => {
    const rows: React.JSX.Element[] = [];
    const selRowIndex = { value: 0 };
    let hitIdx = -1;
    result.groups.forEach((grp, gi) => {
      if (gi > 0) rows.push(<Text key={`sp-${gi}`}> </Text>);
      rows.push(
        <Text key={`h-${grp.path}`} color={theme.glow} wrap="truncate">{grp.path}</Text>,
      );
      for (const hit of grp.hits) {
        hitIdx++;
        const active = hitIdx === sel;
        if (active) selRowIndex.value = rows.length;
        const text = hit.text;
        const segs: React.JSX.Element[] = [];
        let cursor = 0;
        hit.ranges.forEach((r, ri) => {
          if (r.start > cursor) segs.push(<Text key={`p${ri}`} color={theme.fg}>{text.slice(cursor, r.start)}</Text>);
          segs.push(<Text key={`m${ri}`} color={theme.glow} bold>{text.slice(r.start, r.end)}</Text>);
          cursor = r.end;
        });
        if (cursor < text.length) segs.push(<Text key="tail" color={theme.fg}>{text.slice(cursor)}</Text>);
        rows.push(
          <Box key={`${grp.path}:${hit.line}`}>
            <Text backgroundColor={active ? theme.selBg : undefined} wrap="truncate">
              <Text color={active ? theme.accent : undefined}>{active ? g.cursor + ' ' : '  '}</Text>
              <Text color={theme.dim}>{String(hit.line).padStart(5)} </Text>
              {segs}
            </Text>
          </Box>,
        );
      }
    });
    return { rows, selRowIndex: selRowIndex.value };
  }, [result, sel, theme, g]);

  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    setScroll((s) => {
      if (rendered.selRowIndex < s) return rendered.selRowIndex;
      if (rendered.selRowIndex >= s + bodyHeight) return rendered.selRowIndex - bodyHeight + 1;
      return Math.min(s, Math.max(0, rendered.rows.length - bodyHeight));
    });
  }, [rendered.selRowIndex, bodyHeight, rendered.rows.length]);

  const header = (
    <Text wrap="truncate">
      <Text color={theme.accent}>/find </Text>
      <Text color={theme.fg}>{result.query}</Text>
      <Text color={theme.dim}>
        {'  '}{result.matches} match{result.matches === 1 ? '' : 'es'} in {result.fileCount} file{result.fileCount === 1 ? '' : 's'}
        {result.truncated ? ` · capped at ${result.matches}` : ''}
        {result.engine === 'fallback' ? ' · rg not found — js fallback' : ''}
      </Text>
    </Text>
  );

  return (
    <OutputShell
      width={width}
      height={height}
      header={header}
      hint={`${g.up}${g.down} move · ${g.enter} open at match · Esc close`}
    >
      {rendered.rows.slice(scroll, scroll + bodyHeight)}
    </OutputShell>
  );
}

/* ── /diff ──────────────────────────────────────────────────────────────── */

export interface DiffViewProps {
  title: string;
  lines: DiffLine[];
  scroll: number;
  width: number;
  height: number;
}

export function DiffView({ title, lines, scroll, width, height }: DiffViewProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const bodyHeight = Math.max(1, height - CHROME_ROWS);
  const colorFor = (kind: DiffLine['kind']): string =>
    kind === 'add' ? theme.gitA : kind === 'del' ? theme.gitD : kind === 'hunk' ? theme.gitQ : kind === 'meta' ? theme.dim : theme.fg;
  const visible = lines.slice(scroll, scroll + bodyHeight);
  const header = (
    <Text wrap="truncate">
      <Text color={theme.accent}>{title}</Text>
      <Text color={theme.dim}>{'  '}{lines.length === 0 ? 'no changes' : `${lines.length} lines`}</Text>
    </Text>
  );
  return (
    <OutputShell width={width} height={height} header={header} hint={`${g.up}${g.down} scroll · Esc close`}>
      {visible.map((l, i) => (
        <Text key={scroll + i} color={colorFor(l.kind)} wrap="truncate">{l.text || ' '}</Text>
      ))}
    </OutputShell>
  );
}

/* ── /blame ─────────────────────────────────────────────────────────────── */

export interface BlameViewProps {
  title: string;
  lines: BlameLine[];
  scroll: number;
  width: number;
  height: number;
}

export function BlameView({ title, lines, scroll, width, height }: BlameViewProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const bodyHeight = Math.max(1, height - CHROME_ROWS);
  const visible = lines.slice(scroll, scroll + bodyHeight);
  const authorW = Math.min(16, Math.max(6, ...lines.map((l) => l.author.length)));
  const header = (
    <Text wrap="truncate">
      <Text color={theme.accent}>{title}</Text>
      <Text color={theme.dim}>{'  '}{lines.length} lines</Text>
    </Text>
  );
  return (
    <OutputShell width={width} height={height} header={header} hint={`${g.up}${g.down} scroll · Esc close`}>
      {visible.map((l) => (
        <Text key={l.lineNo} wrap="truncate">
          <Text color={theme.dim}>{l.hash}</Text>
          <Text color={theme.gitQ}> {l.date}</Text>
          <Text color={theme.gitM}> {endTruncate(l.author.padEnd(authorW), authorW, g.ell)}</Text>
          <Text color={theme.dim}> {String(l.lineNo).padStart(4)} </Text>
          <Text color={theme.fg}>{l.text}</Text>
        </Text>
      ))}
    </OutputShell>
  );
}

/* ── empty / welcome ────────────────────────────────────────────────────── */

export function EmptyMain({ width, height, watching }: { width: number; height: number; watching: boolean }): React.JSX.Element {
  const { theme, g } = useChrome();
  return (
    <Box width={width} height={height} alignItems="center" justifyContent="center" flexDirection="column">
      <Text color={theme.secondary} bold>l o o m</Text>
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text color={theme.dim}>type to filter · {g.enter} to open · / for commands</Text>
        <Text color={theme.dim}>{watching ? `${g.branch} watching the working tree — live` : 'not a git repository'}</Text>
      </Box>
    </Box>
  );
}
