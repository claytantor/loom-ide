/* Text with fuzzy-match character highlighting (accent.glow, bold). */

import React from 'react';
import { Text } from 'ink';
import { useChrome } from './context.js';

interface Props {
  text: string;
  /** Highlight positions relative to `text` after subtracting `offset`. */
  positions?: readonly number[] | undefined;
  offset?: number;
  baseColor: string;
  bold?: boolean;
}

export function HiText({ text, positions, offset = 0, baseColor, bold }: Props): React.JSX.Element {
  const { theme } = useChrome();
  if (!positions || positions.length === 0) {
    return <Text color={baseColor} bold={bold}>{text}</Text>;
  }
  const set = new Set(positions.map((p) => p - offset));
  const chunks: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = chunks[chunks.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else chunks.push({ text: text[i]!, hit });
  }
  return (
    <Text>
      {chunks.map((c, i) => (
        <Text key={i} color={c.hit ? theme.glow : baseColor} bold={c.hit || bold}>
          {c.text}
        </Text>
      ))}
    </Text>
  );
}
