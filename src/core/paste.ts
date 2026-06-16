// Bracketed-paste marker parsing. Pure string logic — no Node, no Ink.
//
// When bracketed paste mode is on (ESC [ ? 2004 h), terminals wrap pasted text
// in start/end markers so the app can treat a paste as one atomic block instead
// of a key storm that would trigger vim commands / autoindent havoc:
//
//   ESC [ 200 ~   <pasted text>   ESC [ 201 ~
//
// Ink's input pipeline strips a single leading ESC from each input event, so by
// the time a paste reaches our useInput handler the START marker can arrive as
// either "\x1b[200~" or "[200~". We tolerate both. The END marker is left intact
// ("\x1b[201~") but we also accept the ESC-less form for safety.

const ESC = '\x1b';

// Both the ESC-prefixed and ESC-stripped (Ink) forms of each marker.
const START_MARKERS = [`${ESC}[200~`, '[200~'] as const;
const END_MARKERS = [`${ESC}[201~`, '[201~'] as const;

/** True if `input` contains a bracketed-paste start marker (either form). */
export function hasPasteMarker(input: string): boolean {
  return START_MARKERS.some((m) => input.includes(m)) || END_MARKERS.some((m) => input.includes(m));
}

/**
 * Strip every bracketed-paste marker (start and end, both forms) from `input`,
 * leaving only the literal payload. Used so a marker can never reach the buffer
 * as literal text, in any mode.
 */
export function stripPasteMarkers(input: string): string {
  let out = input;
  for (const m of [...START_MARKERS, ...END_MARKERS]) {
    out = out.split(m).join('');
  }
  return out;
}

/**
 * Extract the literal pasted text from an input event that contains a paste.
 * Returns the content between the start and (optional) end marker with all
 * markers removed. If no start marker is present, returns the whole input with
 * any stray markers stripped (handles pastes that arrive split across events).
 */
export function extractPaste(input: string): string {
  return stripPasteMarkers(input);
}
