/* The single-file vim editor pane: gutter, syntax, selection/caret overlays,
   diagnostics, status line. No borders — the work area stays copy-paste clean. */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { VimState } from '../core/vim/index.js';
import { langFromPath, tokenizeLine } from '../core/syntax.js';
import { baseStylesFromTokens, composeSpans, searchRanges, type Overlay } from '../core/decorate.js';
import { basename, endTruncate } from '../core/text.js';
import { useChrome } from './context.js';
import type { Diagnostic } from '../state/types.js';

export interface EditorProps {
  vim: VimState;
  path: string;
  focused: boolean;
  gutter: boolean;
  branch: string | null;
  stale: boolean;
  diagnostics: Diagnostic[];
  width: number;
  height: number;
  /** When set (e.g. a /pr compose buffer), shown in the status line tail. */
  composeHint?: string;
}

const SCROLLOFF = 2;

const MODE_LABEL: Record<string, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'V-LINE',
  replace: 'REPLACE',
};

export function Editor(props: EditorProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const { vim, width, height } = props;
  const lines = vim.lines;
  const caret = vim.cursor;
  const lang = useMemo(() => langFromPath(props.path), [props.path]);

  const headerRows = 2;
  const statusRows = 1;
  const bodyHeight = Math.max(1, height - headerRows - statusRows);

  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    setScroll((s) => {
      const maxStart = Math.max(0, lines.length - bodyHeight);
      let next = Math.min(s, maxStart);
      if (caret.row < next + SCROLLOFF) next = Math.max(0, caret.row - SCROLLOFF);
      if (caret.row > next + bodyHeight - 1 - SCROLLOFF) {
        next = Math.min(maxStart, caret.row - bodyHeight + 1 + SCROLLOFF);
      }
      return next;
    });
  }, [caret.row, bodyHeight, lines.length]);

  const gutterW = props.gutter ? String(Math.max(1, lines.length)).length + 1 : 0;
  const diagByLine = useMemo(() => {
    const m = new Map<number, Diagnostic>();
    for (const d of props.diagnostics) {
      const existing = m.get(d.line);
      if (!existing || severityRank(d.severity) < severityRank(existing.severity)) m.set(d.line, d);
    }
    return m;
  }, [props.diagnostics]);
  const diagMargin = props.diagnostics.length > 0 ? 1 : 0;
  const contentWidth = Math.max(8, width - gutterW - diagMargin - 1);

  const visual = visualRange(vim);
  const visible: React.JSX.Element[] = [];
  const end = Math.min(lines.length, scroll + bodyHeight);
  for (let row = scroll; row < end; row++) {
    visible.push(
      <EditorLine
        key={row}
        row={row}
        text={lines[row] ?? ''}
        lang={lang}
        caret={props.focused && row === caret.row ? caret.col : null}
        caretLine={row === caret.row}
        insertMode={vim.mode === 'insert' || vim.mode === 'replace'}
        visual={visual && row >= visual.startRow && row <= visual.endRow ? visual : null}
        searchPattern={vim.searchHighlight ? vim.searchPattern : null}
        gutterW={gutterW}
        diag={diagByLine.get(row) ?? null}
        diagMargin={diagMargin}
        contentWidth={contentWidth}
      />,
    );
  }

  const errors = props.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = props.diagnostics.filter((d) => d.severity === 'warning').length;
  const caretDiag = diagByLine.get(caret.row);
  const modeLabel = MODE_LABEL[vim.mode] ?? vim.mode.toUpperCase();
  const modeColor =
    vim.mode === 'insert' ? theme.gitA
    : vim.mode === 'replace' ? theme.danger
    : vim.mode === 'normal' ? theme.accent
    : theme.secondary;

  const title = endTruncate(props.path, Math.max(10, width - 28), g.ell);

  return (
    <Box flexDirection="column" width={width} height={height} paddingLeft={1}>
      <Box>
        <Text color={props.focused ? theme.accent : theme.dim} wrap="truncate">
          <Text color={props.composeHint ? theme.secondary : theme.dim} bold={!!props.composeHint}>{title}</Text>
          {vim.dirty ? <Text color={theme.gitM}> {g.dirty}</Text> : null}
          {props.composeHint ? <Text color={theme.glow}>  {props.composeHint}</Text> : null}
          {props.stale ? <Text color={theme.accent}>  [on-disk changed {g.reload} :e reloads]</Text> : null}
        </Text>
      </Box>
      <Text color={theme.dim}>{g.hrule.repeat(Math.max(0, width - 2))}</Text>
      <Box flexDirection="column" height={bodyHeight}>{visible}</Box>
      <Text wrap="truncate">
        <Text color={theme.dim}>{g.hrule.repeat(2)} </Text>
        <Text color={modeColor} bold>{modeLabel}</Text>
        <Text color={theme.dim}> {g.hrule.repeat(2)} {basename(props.path)}</Text>
        {vim.dirty ? <Text color={theme.gitM}> {g.dirty}</Text> : null}
        {props.branch ? <Text color={theme.dim}> {g.hrule.repeat(2)} {g.branch} {props.branch}</Text> : null}
        {errors + warnings > 0 ? (
          <Text color={theme.dim}>
            {' '}{g.hrule.repeat(2)}{' '}
            {errors > 0 ? <Text color={theme.danger}>{errors}✗</Text> : null}
            {errors > 0 && warnings > 0 ? ' ' : ''}
            {warnings > 0 ? <Text color={theme.gitM}>{warnings}!</Text> : null}
          </Text>
        ) : null}
        {vim.pendingKeys ? <Text color={theme.secondary}>  {vim.pendingKeys}</Text> : null}
        {vim.message ? <Text color={theme.glow}>  {vim.message}</Text> : caretDiag ? (
          <Text color={caretDiag.severity === 'error' ? theme.danger : theme.gitM}>
            {'  '}{endTruncate(caretDiag.message, 60, g.ell)}
          </Text>
        ) : null}
      </Text>
    </Box>
  );
}

function severityRank(s: Diagnostic['severity']): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : s === 'info' ? 2 : 3;
}

interface VisualSel {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  linewise: boolean;
}

function visualRange(vim: VimState): VisualSel | null {
  if ((vim.mode !== 'visual' && vim.mode !== 'visual-line') || !vim.visualStart) return null;
  const a = vim.visualStart;
  const b = vim.cursor;
  const [start, endP] = a.row < b.row || (a.row === b.row && a.col <= b.col) ? [a, b] : [b, a];
  return {
    startRow: start.row,
    startCol: start.col,
    endRow: endP.row,
    endCol: endP.col,
    linewise: vim.mode === 'visual-line',
  };
}

interface LineProps {
  row: number;
  text: string;
  lang: ReturnType<typeof langFromPath>;
  caret: number | null;
  caretLine: boolean;
  insertMode: boolean;
  visual: VisualSel | null;
  searchPattern: string | null;
  gutterW: number;
  diag: Diagnostic | null;
  diagMargin: number;
  contentWidth: number;
}

const EditorLine = React.memo(function EditorLine(p: LineProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const padded = p.text.length < p.contentWidth ? p.text + ' '.repeat(p.contentWidth - p.text.length) : p.text.slice(0, p.contentWidth);
  const tokens = tokenizeLine(p.text, p.lang);
  const { styles } = baseStylesFromTokens(tokens, theme);

  const overlays: Overlay[] = [];
  if (p.searchPattern) {
    for (const r of searchRanges(p.text, p.searchPattern)) {
      overlays.push({ start: r.start, end: r.end, color: theme.glow, bold: true });
    }
  }
  if (p.visual) {
    const start = p.visual.linewise ? 0 : p.row === p.visual.startRow ? p.visual.startCol : 0;
    const end = p.visual.linewise
      ? padded.length
      : p.row === p.visual.endRow ? p.visual.endCol + 1 : padded.length;
    overlays.push({ start, end, bg: theme.selBg });
  } else if (p.caretLine) {
    overlays.push({ start: 0, end: padded.length, bg: theme.selBg });
  }
  if (p.caret !== null) {
    const col = Math.min(p.caret, Math.max(0, padded.length - 1));
    overlays.push({ start: col, end: col + 1, inverse: true, ...(p.insertMode ? { color: theme.accent } : {}) });
  }

  const spans = composeSpans(padded, styles, overlays);
  return (
    <Box>
      {p.diagMargin > 0 ? (
        <Text color={p.diag ? (p.diag.severity === 'error' ? theme.danger : theme.gitM) : undefined}>
          {p.diag ? g.dot : ' '}
        </Text>
      ) : null}
      {p.gutterW > 0 ? (
        <Text color={p.caretLine ? theme.accent : theme.dim}>
          {String(p.row + 1).padStart(p.gutterW - 1)}{' '}
        </Text>
      ) : null}
      <Text wrap="truncate">
        {spans.map((s, i) => (
          <Text key={i} color={s.color} backgroundColor={s.bg} bold={s.bold} inverse={s.inverse}>
            {s.text}
          </Text>
        ))}
      </Text>
    </Box>
  );
});
