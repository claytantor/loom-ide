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
  /** Soft-wrap long lines (`:set wrap`) instead of truncating them. */
  wrap: boolean;
  branch: string | null;
  stale: boolean;
  diagnostics: Diagnostic[];
  width: number;
  height: number;
  /** When set (e.g. a /pr compose buffer), shown in the status line tail. */
  composeHint?: string;
}

/** One rendered row. Without wrap, one per buffer line; with wrap, a long line
 * expands into several, each covering [colStart, colStart+contentWidth). */
interface VisualRow {
  bufferRow: number;
  colStart: number;
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

  // Display-row layout. Without wrap, one row per buffer line (the cheap path,
  // unchanged). With wrap, a long line expands into contentWidth-wide segments.
  // Scroll + caret-visibility math then operate uniformly over these rows.
  const rows = useMemo<VisualRow[]>(() => {
    if (!props.wrap) return lines.map((_, i) => ({ bufferRow: i, colStart: 0 }));
    const out: VisualRow[] = [];
    for (let i = 0; i < lines.length; i++) {
      const len = (lines[i] ?? '').length;
      if (len <= contentWidth) {
        out.push({ bufferRow: i, colStart: 0 });
        continue;
      }
      for (let c = 0; c < len; c += contentWidth) out.push({ bufferRow: i, colStart: c });
    }
    return out;
  }, [props.wrap, lines, contentWidth]);

  // The display row that holds the caret (its buffer row's segment of caret.col).
  const caretVisualRow = useMemo(() => {
    if (!props.wrap) return caret.row;
    let idx = rows.findIndex((r) => r.bufferRow === caret.row);
    if (idx < 0) return 0;
    while (idx + 1 < rows.length && rows[idx + 1]!.bufferRow === caret.row && caret.col >= rows[idx + 1]!.colStart) idx++;
    return idx;
  }, [props.wrap, rows, caret.row, caret.col]);

  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    setScroll((s) => {
      const maxStart = Math.max(0, rows.length - bodyHeight);
      let next = Math.min(s, maxStart);
      if (caretVisualRow < next + SCROLLOFF) next = Math.max(0, caretVisualRow - SCROLLOFF);
      if (caretVisualRow > next + bodyHeight - 1 - SCROLLOFF) {
        next = Math.min(maxStart, caretVisualRow - bodyHeight + 1 + SCROLLOFF);
      }
      return next;
    });
  }, [caretVisualRow, bodyHeight, rows.length]);

  const visual = visualRange(vim);
  const insertMode = vim.mode === 'insert' || vim.mode === 'replace';
  const searchPattern = vim.searchHighlight ? vim.searchPattern : null;
  const visible: React.JSX.Element[] = [];
  const end = Math.min(rows.length, scroll + bodyHeight);
  for (let i = scroll; i < end; i++) {
    const { bufferRow, colStart } = rows[i]!;
    const isLastSeg = i + 1 >= rows.length || rows[i + 1]!.bufferRow !== bufferRow;
    // Caret column relative to this segment (or null if it isn't here). At an
    // exact-width line end the caret clamps onto the last segment's last cell.
    let caretRel: number | null = null;
    if (props.focused && bufferRow === caret.row) {
      const rel = caret.col - colStart;
      if (rel >= 0 && rel < contentWidth) caretRel = rel;
      else if (isLastSeg && rel >= contentWidth) caretRel = contentWidth - 1;
    }
    visible.push(
      <EditorLine
        key={i}
        bufferRow={bufferRow}
        lineNumber={bufferRow + 1}
        colStart={colStart}
        isFirst={colStart === 0}
        width={contentWidth}
        text={lines[bufferRow] ?? ''}
        lang={lang}
        caret={caretRel}
        caretLine={bufferRow === caret.row}
        insertMode={insertMode}
        visual={visual && bufferRow >= visual.startRow && bufferRow <= visual.endRow ? visual : null}
        searchPattern={searchPattern}
        gutterW={gutterW}
        diag={colStart === 0 ? (diagByLine.get(bufferRow) ?? null) : null}
        diagMargin={diagMargin}
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
  bufferRow: number;
  lineNumber: number;
  /** Column this display row starts at (0 unless a wrapped continuation). */
  colStart: number;
  /** Width of the segment ( == editor contentWidth ). */
  width: number;
  /** First display row of the buffer line — only it shows the line number. */
  isFirst: boolean;
  text: string;
  lang: ReturnType<typeof langFromPath>;
  /** Caret column relative to colStart, or null when not on this segment. */
  caret: number | null;
  caretLine: boolean;
  insertMode: boolean;
  visual: VisualSel | null;
  searchPattern: string | null;
  gutterW: number;
  diag: Diagnostic | null;
  diagMargin: number;
}

const EditorLine = React.memo(function EditorLine(p: LineProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const tokens = tokenizeLine(p.text, p.lang);
  const { styles: fullStyles } = baseStylesFromTokens(tokens, theme);

  // Overlays computed in FULL-line columns, then sliced into this segment. The
  // `+ p.width` on row-spanning ranges makes the highlight fill the segment's
  // padded width even on an empty or short final segment.
  const full: Overlay[] = [];
  if (p.searchPattern) {
    for (const r of searchRanges(p.text, p.searchPattern)) {
      full.push({ start: r.start, end: r.end, color: theme.glow, bold: true });
    }
  }
  if (p.visual) {
    const start = p.visual.linewise ? 0 : p.bufferRow === p.visual.startRow ? p.visual.startCol : 0;
    const end = p.visual.linewise
      ? p.text.length + p.width
      : p.bufferRow === p.visual.endRow ? p.visual.endCol + 1 : p.text.length + p.width;
    full.push({ start, end, bg: theme.selBg });
  } else if (p.caretLine) {
    full.push({ start: 0, end: p.text.length + p.width, bg: theme.selBg });
  }

  // Slice the segment [colStart, colStart+width) and shift overlays into it.
  const seg = p.text.slice(p.colStart, p.colStart + p.width);
  const padded = seg.length < p.width ? seg + ' '.repeat(p.width - seg.length) : seg;
  const styles = fullStyles.slice(p.colStart, p.colStart + p.width);
  const overlays: Overlay[] = [];
  for (const ov of full) {
    const s = Math.max(0, ov.start - p.colStart);
    const e = Math.min(p.width, ov.end - p.colStart);
    if (e > s) overlays.push({ ...ov, start: s, end: e });
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
          {p.isFirst ? String(p.lineNumber).padStart(p.gutterW - 1) : ' '.repeat(Math.max(0, p.gutterW - 1))}{' '}
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
