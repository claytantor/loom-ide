// System-clipboard bridge via OSC 52. The encoding is pure (core/osc52); this
// module owns the side effect of writing the escape sequence to the terminal.
//
// Writing the OSC 52 sequence to stdout asks the terminal itself to set the
// system clipboard, which works over SSH with no X11 forwarding — the primary
// loom use case. Some terminals gate this behind a setting (see caveats below).

import { encodeOsc52 } from '../core/osc52.js';

/** Minimal stdout sink — accepts Node's WriteStream and Ink's stdout alike. */
export interface ClipboardSink {
  write(chunk: string): unknown;
}

/**
 * Copy `text` to the system clipboard by emitting an OSC 52 escape to `out`
 * (defaults to process.stdout). Returns false (and writes nothing) for empty
 * text so an empty yank is a no-op.
 *
 * Caveats:
 *  - Gnome Terminal / VTE require "Allow setting clipboard" to be enabled, else
 *    the sequence is ignored. Ghostty, iTerm2, kitty, WezTerm support it by
 *    default. tmux needs `set -g set-clipboard on`.
 *  - Very large payloads may exceed a terminal's OSC 52 length cap and be
 *    dropped silently; that is acceptable and never throws.
 */
export function copyToClipboard(text: string, out: ClipboardSink = process.stdout): boolean {
  if (text === '') return false;
  out.write(encodeOsc52(text));
  return true;
}
