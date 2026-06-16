/* System host info. Reads os.hostname() once — it's constant for the session,
   so callers should resolve it at app init and thread it through, never per frame. */

import { hostname } from 'node:os';

/** Bare short hostname, e.g. `dex-kvm` from `dex-kvm.local`.
 *  loom runs beside Claude Code over SSH; showing the host at a glance answers
 *  "which box am I on?" without leaving the TUI. */
export function shortHostname(): string {
  return hostname().split('.')[0] ?? '';
}
