---
name: feedback-save-interception
description: How loom hosts an editable doc (e.g. /pr AI draft) in the vim editor with no disk file, and intercepts the save — plus the :wq double-effect race guard
metadata:
  type: feedback
---

To host an editable, non-file document (the `/pr` AI draft) in loom's vim editor and have "save"
mean something other than "write to disk":

**Rule:** open an ephemeral "compose buffer" via a dedicated reducer action — do NOT reuse
`open-file`.

**Why:** `open-file` calls `expandTo(tree, path)` and sets `selPath=path`, treating the label as a
real tree path — which corrupts the tree when the label is virtual (e.g. `"PR → dev"`). The
`<Editor>` is path-agnostic and renders any `vim` lines, so a separate `pr-compose-open` action sets
`vim`, `openFile=label`, `mainView:'editor'`, `focus:'editor'`, `prCompose` (the live session) and
explicitly skips `expandTo`/`selPath`. `pr-compose-close` clears it and returns focus to the tree.

**How to apply — intercept the save at ONE point:** at the very top of `saveNow(vim)` in App.tsx,
`if (stateRef.current.prCompose) { void submitPr(...); return; }` BEFORE any disk write. This single
site covers `:w`, `:wq`, AND `Ctrl-S`, because `handleVimEffects.save` calls `saveNow` and both
Ctrl-S handlers call `saveNow` directly. In `handleVimEffects` the `effects.quit` branch becomes
`if (prCompose) cancelPr(); else closeEditor();`.

**The `:wq` double-effect race (important):** `:wq` yields `{save:true, quit:true}` in ONE
synchronous `handleVimEffects` call — `save` kicks off async `submitPr`, then `quit` runs
immediately while `stateRef.current.prCompose` is STILL set (the close dispatch hasn't committed),
so a naive quit branch would `cancelPr()` and toast "cancelled" right after starting the PR. Guard
with a synchronous ref: `submitPr` sets `prSubmittingRef.current = true` before its first `await`;
the quit branch does `if (prSubmittingRef.current) return;` first. `:q!`/`:q` (quit only, ref false)
→ `cancelPr()`. Reset the ref in `submitPr`'s `finally`, in `cancelPr`, and on `pr-compose-open`.

Referencing `submitPr`/`cancelPr` (declared later as `useCallback`s) from earlier `saveNow`/
`handleVimEffects` bodies is fine — tsc allows a function body to reference a later same-scope const,
and the callbacks only run after render. Just do NOT put them in the earlier callback's DEPENDENCY
ARRAY (that literal is evaluated eagerly at render → TDZ crash). No eslint runs here anyway; keep the
later callbacks dependency-stable (`[root, toast]`) so a stale capture is harmless.
