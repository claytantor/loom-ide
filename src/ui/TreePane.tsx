/* The hero: file tree with fuzzy filtering, git decorations, live flashes. */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { FilterRow } from '../core/filter.js';
import { GIT_TOKEN } from '../core/theme.js';
import { basename, endTruncate, midTruncate } from '../core/text.js';
import { useChrome } from './context.js';
import { HiText } from './HiText.js';

export interface TreePaneProps {
  rows: FilterRow[];
  selPath: string | null;
  matchByPath: ReadonlyMap<string, number[]>;
  flash: ReadonlyMap<string, number>;
  focused: boolean;
  query: string;
  count: number;
  width: number;
  height: number;
  showFooter: boolean;
  footerHint: string;
}

export function TreePane(props: TreePaneProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const { rows, selPath, width, height } = props;
  const headerRows = 2;
  const footerRows = props.showFooter ? 1 : 0;
  const listHeight = Math.max(1, height - headerRows - footerRows);

  const selIdx = useMemo(() => rows.findIndex((r) => r.node.path === selPath), [rows, selPath]);
  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    if (selIdx < 0) {
      setScroll((s) => Math.min(s, Math.max(0, rows.length - listHeight)));
      return;
    }
    setScroll((s) => {
      if (selIdx < s) return selIdx;
      if (selIdx >= s + listHeight) return selIdx - listHeight + 1;
      return Math.min(s, Math.max(0, rows.length - listHeight));
    });
  }, [selIdx, listHeight, rows.length]);

  const visible = rows.slice(scroll, scroll + listHeight);
  const innerWidth = Math.max(8, width - 1); // 1 col left padding

  return (
    <Box flexDirection="column" width={width} height={height} paddingLeft={1}>
      <Box>
        <Text color={props.focused ? theme.accent : theme.dim} bold>FILES</Text>
        {props.query ? (
          <Text color={theme.dim}>
            {'  '}{g.filt} filter: <Text color={theme.fg}>{props.query}</Text>
          </Text>
        ) : null}
      </Box>
      <Text color={theme.dim}>{g.hrule.repeat(Math.max(0, innerWidth - 1))}</Text>
      <Box flexDirection="column" height={listHeight}>
        {visible.map((row) => (
          <TreeRowLine
            key={row.node.path}
            row={row}
            selected={row.node.path === selPath}
            focused={props.focused}
            positions={props.matchByPath.get(row.node.path)}
            flashed={props.flash.has(row.node.path)}
            width={innerWidth}
          />
        ))}
        {visible.length === 0 ? (
          <Text color={theme.dim}>{props.query ? 'no matches' : '(empty)'}</Text>
        ) : null}
      </Box>
      {props.showFooter ? (
        <Text color={theme.dim} wrap="truncate">
          {props.query ? (
            <>
              <Text color={theme.accent}>{props.count}</Text>
              {` match${props.count === 1 ? '' : 'es'} · ${g.up}${g.down} move · ${g.enter} open · Esc clear`}
            </>
          ) : (
            `${g.filt} ${props.footerHint}`
          )}
        </Text>
      ) : null}
    </Box>
  );
}

interface RowProps {
  row: FilterRow;
  selected: boolean;
  focused: boolean;
  positions: number[] | undefined;
  flashed: boolean;
  width: number;
}

function TreeRowLine({ row, selected, focused, positions, flashed, width }: RowProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const { node, depth, dim, flat } = row;
  const isDir = node.type === 'dir';
  const ghost = node.ghost === true;

  const indent = flat ? '' : '  '.repeat(depth);
  const disc = isDir ? (node.open || row.autoOpen ? g.dirOpen : g.dirClosed) : ' ';
  const gitBadge = node.git ? `${g.dot}${node.git}` : '';
  const gitWidth = gitBadge ? gitBadge.length + 1 : 0;

  // cursor(2) + indent + disc(2) + label + dirSlash + git
  const labelBudget = Math.max(4, width - 2 - indent.length - 2 - gitWidth - (isDir ? 1 : 0));
  const rawLabel = flat ? node.path : node.name;
  const label = flat ? midTruncate(rawLabel, labelBudget, g.ell) : endTruncate(rawLabel, labelBudget, g.ell);
  const offset = flat ? 0 : node.path.length - node.name.length;

  const baseColor = ghost || dim ? theme.dim : flashed ? theme.glow : theme.fg;
  const bg = selected && focused ? theme.selBg : undefined;
  const gitColor = node.git ? theme[GIT_TOKEN[node.git] ?? 'fg'] : theme.fg;
  const pad = Math.max(0, labelBudget - label.length);

  return (
    <Box width={width}>
      <Text backgroundColor={bg} wrap="truncate">
        <Text color={selected ? theme.accent : undefined}>{selected ? g.cursor + ' ' : '  '}</Text>
        <Text color={theme.dim}>{indent}</Text>
        <Text color={ghost || dim ? theme.dim : theme.fg}>{isDir ? disc : ' '}{isDir ? ' ' : ' '}</Text>
        <HiText
          text={label}
          positions={label === rawLabel ? positions : undefined}
          offset={offset}
          baseColor={baseColor}
        />
        {isDir ? <Text color={theme.dim}>/</Text> : null}
        {gitBadge ? (
          <>
            <Text>{' '.repeat(pad)}</Text>
            <Text color={ghost ? theme.dim : gitColor}> {gitBadge}</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}
