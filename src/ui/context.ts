/* Theme + glyph context so components never hold literal colors. */

import { createContext, useContext } from 'react';
import { GLYPHS, resolveTheme, type Glyphs, type Theme } from '../core/theme.js';

export interface Chrome {
  theme: Theme;
  g: Glyphs;
}

export const ChromeContext = createContext<Chrome>({
  theme: resolveTheme({ theme: 'neon', accent: 'cyan' }),
  g: GLYPHS.unicode,
});

export function useChrome(): Chrome {
  return useContext(ChromeContext);
}
