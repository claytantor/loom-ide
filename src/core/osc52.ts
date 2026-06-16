// OSC 52 clipboard escape encoding. Pure — no Node, no stdout. The actual write
// to the terminal is a side effect and lives in services/clipboard.ts.
//
// OSC 52 lets a terminal set the system clipboard from inside the session, with
// no X11 forwarding — so a yank over SSH still lands on the local clipboard,
// exactly how tmux's `set-clipboard` works. Format:
//
//   ESC ] 52 ; c ; <base64 of UTF-8 text> BEL
//
// The `c` selection target is the clipboard (vs `p` primary). We always target
// `c` so a yank behaves like a normal copy.

const ESC = '\x1b';
const BEL = '\x07';

/** Base64 of the UTF-8 bytes of `text` (Node Buffer; not browser btoa). */
export function base64Utf8(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/**
 * Build the OSC 52 escape sequence that copies `text` to the clipboard.
 * Empty text still yields a well-formed (empty-payload) sequence — callers that
 * want to skip empty yanks should guard before calling.
 *
 * Note: very large yanks can exceed a terminal's OSC 52 length limit and be
 * silently dropped by the terminal — that is acceptable and never crashes here.
 */
export function encodeOsc52(text: string): string {
  return `${ESC}]52;c;${base64Utf8(text)}${BEL}`;
}
