/* Bottom omni-bar: › input + mode label + abbreviating status readout. */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useChrome } from './context.js';
import type { InputMode, OmniMode } from '../state/types.js';

export interface OmniBarProps {
  value: string;
  mode: OmniMode;
  inputMode: InputMode | null;
  branch: string | null;
  isRepo: boolean;
  vimDirty: boolean;
  onDisk: number;
  pulse: boolean;
  layout: 'wide' | 'mid' | 'stacked';
  spinner: string | null;
  width: number;
}

const SPIN_INTERVAL = 120;

export function OmniBar(props: OmniBarProps): React.JSX.Element {
  const { theme, g } = useChrome();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!props.spinner) return;
    const id = setInterval(() => setFrame((f) => f + 1), SPIN_INTERVAL);
    return () => clearInterval(id);
  }, [props.spinner]);

  const prompt = promptFor(props.inputMode);
  const modeLabel =
    props.inputMode ? props.inputMode.kind
    : props.mode === 'slash' ? 'command'
    : props.mode === 'ex' ? 'ex'
    : props.mode === 'filter' ? 'filter'
    : 'ready';
  const modeColor =
    props.inputMode?.kind === 'confirm' ? theme.danger
    : props.inputMode ? theme.secondary
    : props.mode === 'slash' ? theme.glow
    : props.mode === 'ex' ? theme.secondary
    : props.mode === 'filter' ? theme.accent
    : theme.dim;

  const dirtyGlyph = props.vimDirty ? g.dirty : g.clean;
  const status = !props.isRepo ? (
    <Text color={theme.dim}>no git</Text>
  ) : props.layout === 'wide' ? (
    <Text color={theme.dim}>
      <Text color={props.pulse ? theme.accent : theme.dim}>{props.onDisk} changed on disk</Text>
      {' · '}{g.branch} {props.branch ?? '?'} {dirtyGlyph}
    </Text>
  ) : (
    <Text color={theme.dim}>
      <Text color={props.pulse ? theme.accent : theme.dim}>{props.onDisk}</Text>
      {` ${g.dirty} `}{props.branch ?? '?'} {dirtyGlyph}
    </Text>
  );

  return (
    <Box width={props.width} paddingLeft={1} justifyContent="space-between">
      <Box flexShrink={1}>
        <Text wrap="truncate">
          <Text color={theme.secondary} bold>{g.prompt} </Text>
          {prompt ? <Text color={theme.secondary}>{prompt} </Text> : null}
          <Text color={theme.fg}>{props.value}</Text>
          <Text inverse> </Text>
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={2}>
        <Text wrap="truncate">
          {props.spinner ? (
            <Text color={theme.accent}>{g.spin[frame % g.spin.length]} {props.spinner}  </Text>
          ) : null}
          <Text color={modeColor}>[{modeLabel}]</Text>
          <Text> </Text>
          {status}
        </Text>
      </Box>
    </Box>
  );
}

function promptFor(input: InputMode | null): string | null {
  if (!input) return null;
  switch (input.kind) {
    case 'find':
      return 'find:';
    case 'passthru':
      return input.label;
    case 'pr':
      return 'pr →';
    case 'rename':
      return `rename ${input.target} ${'→'}`;
    case 'confirm':
      return `${input.question} [y/n]`;
  }
}
