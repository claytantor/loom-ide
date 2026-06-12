/* Inline slash palette, anchored above the omni-bar. */

import React from 'react';
import { Box, Text } from 'ink';
import { slashMatchPositions, type SlashItem, type ThemeEntry } from '../state/commands.js';
import { useChrome } from './context.js';
import { HiText } from './HiText.js';

export interface SlashPaletteProps {
  items: SlashItem[];
  themeItems: ThemeEntry[] | null;
  sel: number;
  query: string;
  selName: string;
  width: number;
}

export function SlashPalette(props: SlashPaletteProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const top = g.hrule === '─' ? '┄' : '.';

  if (props.themeItems) {
    return (
      <Box flexDirection="column" width={props.width} paddingLeft={1}>
        <Text color={theme.dim}>{top} themes</Text>
        {props.themeItems.map((t, i) => {
          const active = i === props.sel;
          return (
            <Box key={t.id}>
              <Text backgroundColor={active ? theme.selBg : undefined} wrap="truncate">
                <Text color={active ? theme.accent : undefined}>{active ? g.cursor + ' ' : '  '}</Text>
                <Text color={active ? theme.glow : theme.fg}>{t.id.padEnd(14)}</Text>
                <Text color={theme.dim}> — {t.label}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={props.width} paddingLeft={1}>
      <Text color={theme.dim}>{top} {props.query}</Text>
      {props.items.map((it, i) => {
        const active = i === props.sel;
        const desc = it.desc.replace('{sel}', props.selName || '(none)');
        const nameColor = it.danger ? theme.danger : active ? theme.glow : theme.fg;
        return (
          <Box key={it.name}>
            <Text backgroundColor={active ? theme.selBg : undefined} wrap="truncate">
              <Text color={active ? theme.accent : undefined}>{active ? g.cursor + ' ' : '  '}</Text>
              <HiText
                text={it.name.padEnd(10)}
                positions={slashMatchPositions(it.name, props.query)}
                baseColor={nameColor}
              />
              <Text color={theme.dim}> — {desc}{it.arg ? ` "${it.arg}"` : ''}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
