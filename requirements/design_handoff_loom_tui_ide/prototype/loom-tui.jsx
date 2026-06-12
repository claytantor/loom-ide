/* loom-tui.jsx — themes, glyphs, pure helpers, and presentational components.
   Exports to window for loom-app.jsx to consume. Loaded via Babel. */
const { useMemo } = React;

/* ── Themes ──────────────────────────────────────────────────────────────── */
const THEMES = {
  neon: {
    bg: "#0B0E14", bgEl: "#11151F", fg: "#C7D0E0", dim: "#5A6478",
    accent: "#22D3EE", glow: "#67E8F9", secondary: "#F0A36B",
    gitM: "#E5C07B", gitQ: "#56B6C2", gitA: "#7FD88F", gitD: "#E06C75",
    danger: "#FF5C66", selBg: "rgba(34,211,238,0.12)",
  },
  mono: {
    bg: "#050705", bgEl: "#0b0f0a", fg: "#b8c0a8", dim: "#5b6356",
    accent: "#8ae234", glow: "#b6f56a", secondary: "#c4a000",
    gitM: "#c4a000", gitQ: "#73a39a", gitA: "#8ae234", gitD: "#cc6666",
    danger: "#cc6666", selBg: "rgba(138,226,52,0.13)",
  },
};
// Accent overrides (neon theme only) — keep glow a brighter sibling.
const ACCENTS = {
  cyan:   { accent: "#22D3EE", glow: "#67E8F9", selBg: "rgba(34,211,238,0.12)" },
  amber:  { accent: "#F0A36B", glow: "#FFC79A", selBg: "rgba(240,163,107,0.12)" },
  green:  { accent: "#7FD88F", glow: "#A7E8B3", selBg: "rgba(127,216,143,0.12)" },
  violet: { accent: "#B392F0", glow: "#D0BCFF", selBg: "rgba(179,146,240,0.13)" },
};

const GLYPHS = {
  unicode: { dirOpen: "▾", dirClosed: "▸", cursor: "❱", branch: "⎇", clean: "✓",
    dirty: "±", prompt: "›", filt: "▸", dot: "●", enter: "⏎", up: "↑", down: "↓",
    left: "←", right: "→", ell: "…", vrule: "│", hrule: "─", spin: "⠋", reload: "↻", arr: "›" },
  ascii: { dirOpen: "v", dirClosed: ">", cursor: ">", branch: "git:", clean: "ok",
    dirty: "*", prompt: ">", filt: ">", dot: "*", enter: "Enter", up: "^", down: "v",
    left: "<", right: ">", ell: "...", vrule: "|", hrule: "-", spin: "*", reload: "r", arr: ">" },
};

/* Resolve the active palette from tweaks. */
function resolveTheme(t) {
  const base = { ...THEMES[t.theme] };
  if (t.theme === "neon" && ACCENTS[t.accent]) Object.assign(base, ACCENTS[t.accent]);
  return base;
}

/* Syntax scope → token. */
const SYNTAX = { kw: "secondary", string: "gitA", comment: "dim", num: "gitQ",
  fn: "glow", type: "gitM", ident: "fg", punct: "fg", ws: "fg" };

/* ── Pure tree helpers ───────────────────────────────────────────────────── */
// Deep clone the seed tree so we can mutate open flags freely.
function cloneTree(n) {
  return { ...n, children: n.children ? n.children.map(cloneTree) : undefined };
}
function findNode(node, path) {
  if (node.path === path) return node;
  for (const c of node.children || []) { const r = findNode(c, path); if (r) return r; }
  return null;
}
// Visible rows under normal (unfiltered) tree, honoring open flags.
function flattenTree(node, depth, out) {
  out = out || [];
  for (const c of node.children || []) {
    out.push({ node: c, depth });
    if (c.type === "dir" && c.open) flattenTree(c, depth + 1, out);
  }
  return out;
}

/* ── Fuzzy filtering ─────────────────────────────────────────────────────── */
// Returns { rows, matchByPath, count } for a query under a given mode.
function computeFilter(rootTree, query, mode) {
  const leaves = window.LoomData.allFiles(rootTree);
  const scored = [];
  for (const f of leaves) {
    const m = window.LoomData.fuzzyScore(query, f.path);
    if (m) scored.push({ node: f, ...m });
  }
  scored.sort((a, b) => b.score - a.score);
  const matchByPath = {};
  scored.forEach((s) => { matchByPath[s.node.path] = s.positions; });

  if (mode === "flat") {
    return { rows: scored.map((s) => ({ node: s.node, depth: 0, flat: true })),
      matchByPath, count: scored.length };
  }

  // dim / hide both walk the tree; collect ancestor dirs of matches.
  const matchPaths = new Set(scored.map((s) => s.node.path));
  const keepDir = new Set();
  for (const s of scored) {
    const parts = s.node.path.split("/");
    for (let i = 1; i < parts.length; i++) keepDir.add(parts.slice(0, i).join("/"));
  }
  const rows = [];
  (function walk(node, depth) {
    for (const c of node.children || []) {
      if (c.type === "dir") {
        const onPath = keepDir.has(c.path);
        if (mode === "hide" && !onPath) continue;
        rows.push({ node: c, depth, dim: mode === "dim" && !onPath, autoOpen: onPath });
        if (onPath || (mode === "dim" && c.open)) walk(c, depth + 1);
      } else {
        const isMatch = matchPaths.has(c.path);
        if (mode === "hide" && !isMatch) continue;
        rows.push({ node: c, depth, dim: mode === "dim" && !isMatch });
      }
    }
  })(rootTree, 0);
  return { rows, matchByPath, count: scored.length };
}

/* ── Small render helpers ────────────────────────────────────────────────── */
// Highlight matched character positions (relative to `base` offset in full path).
function HiText({ text, positions, offset, glow, baseColor }) {
  if (!positions || !positions.length) return <span style={{ color: baseColor }}>{text}</span>;
  const set = new Set(positions.map((p) => p - offset));
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    out.push(<span key={i} style={hit ? { color: glow, fontWeight: 700 } : { color: baseColor }}>{text[i]}</span>);
  }
  return <span>{out}</span>;
}

const GIT_COLOR = { M: "gitM", "?": "gitQ", "+": "gitA", "-": "gitD", "!": "danger" };

/* ── Tree pane ───────────────────────────────────────────────────────────── */
function TreePane({ th, g, rows, selPath, matchByPath, focusTree, mode, query,
                    count, treeChars, showFooter, openPath, gutterHint }) {
  const hrule = g.hrule.repeat(Math.max(0, treeChars - 1));
  const headerRight = mode === "filter" || (mode === "" && query)
    ? null : null;
  return (
    <div className="pane" style={{ width: mode === "stack" ? "100%" : treeChars + "ch", flex: mode === "stack" ? 1 : "none" }}>
      {/* header */}
      <div className="row">
        <span style={{ color: focusTree ? th.accent : th.dim, fontWeight: 700, letterSpacing: "0.05em" }}>FILES</span>
        {query ? (
          <span style={{ color: th.dim, marginLeft: "2ch" }}>
            {g.filt} filter: <span style={{ color: th.fg }}>{query}</span>
          </span>
        ) : null}
      </div>
      <div className="row" style={{ color: th.dim }}>{hrule}</div>
      {/* node list */}
      <div className="treelist">
        {rows.map((r, i) => (
          <TreeRow key={r.node.path + i} th={th} g={g} row={r}
            selected={r.node.path === selPath} focusTree={focusTree}
            positions={matchByPath[r.node.path]} treeChars={treeChars} />
        ))}
      </div>
      {/* footer hint */}
      {showFooter ? (
        <div className="row treefoot" style={{ color: th.dim }}>
          {query ? (
            <span><span style={{ color: th.accent }}>{count}</span> match{count === 1 ? "" : "es"} · {g.up}{g.down} move · {g.enter} open · Esc clear</span>
          ) : (
            <span>{g.filt} {gutterHint}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TreeRow({ th, g, row, selected, focusTree, positions, treeChars }) {
  const { node, depth, dim, flat } = row;
  const isDir = node.type === "dir";
  const disc = isDir ? (node.open || row.autoOpen ? g.dirOpen : g.dirClosed) : " ";
  const baseColor = dim ? th.dim : selected ? th.fg : isDir ? th.fg : th.fg;
  const label = flat ? node.path : node.name;
  const offset = flat ? 0 : node.path.length - node.name.length;
  // budget for right-aligned git dot
  const indent = "  ".repeat(flat ? 0 : depth);
  const git = node.git;
  return (
    <div className="row treerow" style={{
      background: selected && focusTree ? th.selBg : "transparent",
    }}>
      <span style={{ color: selected ? th.accent : "transparent", width: "2ch", display: "inline-block", flex: "none" }}>
        {selected ? g.cursor : " "}
      </span>
      <span style={{ whiteSpace: "pre", color: th.dim }}>{indent}</span>
      <span style={{ color: isDir ? (dim ? th.dim : th.fg) : "transparent", width: "1ch", display: "inline-block", flex: "none" }}>{isDir ? disc : " "}</span>
      <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        <HiText text={label} positions={positions} offset={offset} glow={th.glow} baseColor={dim ? th.dim : baseColor} />
        {isDir ? <span style={{ color: th.dim }}>/</span> : null}
      </span>
      {git ? (
        <span style={{ color: th[GIT_COLOR[git]] || th.fg, flex: "none", marginLeft: "1ch" }}>{g.dot}{git}</span>
      ) : null}
    </div>
  );
}

/* ── Editor ──────────────────────────────────────────────────────────────── */
function Editor({ th, g, path, lines, caret, gutter, focusEditor, branch, dirty, onDisk, mainChars }) {
  const title = path || "(no file)";
  const underline = g.hrule.repeat(Math.max(0, mainChars - 1));
  const gutterW = String(lines.length).length + 1;
  return (
    <div className="pane main">
      <div className="row" style={{ color: focusEditor ? th.accent : th.dim }}>
        <span style={{ color: th.dim }}>{midTruncate(title, mainChars - 14)}</span>
        {dirty ? <span style={{ color: th.gitM, marginLeft: "1ch" }}>{g.dirty}</span> : null}
        {onDisk ? <span style={{ color: th.accent, marginLeft: "2ch" }}>[on-disk changed {g.reload} reload]</span> : null}
      </div>
      <div className="row" style={{ color: th.dim }}>{underline}</div>
      <div className="editor-body">
        {lines.map((ln, i) => {
          const cur = i === caret;
          return (
            <div key={i} className="row codeline" style={{ background: cur && focusEditor ? th.selBg : "transparent" }}>
              {gutter ? (
                <span style={{ color: cur ? th.accent : th.dim, width: gutterW + 1 + "ch", display: "inline-block", textAlign: "right", flex: "none", paddingRight: "1ch" }}>{i + 1}</span>
              ) : null}
              <CodeLine th={th} line={ln} />
              {cur && focusEditor ? <span className="caret" style={{ background: th.accent }} /> : null}
            </div>
          );
        })}
      </div>
      {/* editor status line */}
      <div className="row editor-status" style={{ color: th.dim }}>
        {g.hrule.repeat(2)} <span style={{ color: th.accent, fontWeight: 700 }}>NORMAL</span> {g.hrule.repeat(2)} {basename(title)}{dirty ? <span style={{ color: th.gitM }}> {g.dirty}</span> : null} {g.hrule.repeat(2)} {g.branch} {branch}
      </div>
    </div>
  );
}

function CodeLine({ th, line }) {
  const tokens = useMemo(() => window.LoomData.tokenizeLine(line), [line]);
  if (!line) return <span>&nbsp;</span>;
  return (
    <span style={{ whiteSpace: "pre" }}>
      {tokens.map((tk, i) => (
        <span key={i} style={{ color: th[SYNTAX[tk.t]] || th.fg }}>{tk.v}</span>
      ))}
    </span>
  );
}

/* ── /find ripgrep output ────────────────────────────────────────────────── */
function FindView({ th, g, data, sel, mainChars }) {
  const underline = g.hrule.repeat(Math.max(0, mainChars - 1));
  let idx = -1;
  return (
    <div className="pane main">
      <div className="row" style={{ color: th.accent }}>
        /find <span style={{ color: th.fg }}>{data.query}</span>
        <span style={{ color: th.dim, marginLeft: "2ch" }}>{data.matches} matches in {data.fileCount} files</span>
      </div>
      <div className="row" style={{ color: th.dim }}>{underline}</div>
      <div className="editor-body">
        {data.groups.map((grp) => (
          <div key={grp.path} style={{ marginBottom: "0.4em" }}>
            <div className="row" style={{ color: th.gitM }}>
              <span style={{ color: th.glow }}>{grp.path}</span>
            </div>
            {grp.hits.map((h) => {
              idx++; const active = idx === sel;
              return (
                <div key={h.line} className="row codeline" style={{ background: active ? th.selBg : "transparent" }}>
                  <span style={{ color: active ? th.accent : "transparent", width: "2ch", flex: "none" }}>{active ? g.cursor : " "}</span>
                  <span style={{ color: th.dim, width: "5ch", display: "inline-block", textAlign: "right", flex: "none", paddingRight: "1ch" }}>{h.line}</span>
                  <span style={{ whiteSpace: "pre", color: th.fg }}>{h.pre}<span style={{ color: th.glow, fontWeight: 700 }}>{h.mid}</span>{h.post}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="row editor-status" style={{ color: th.dim }}>
        {g.up}{g.down} move · {g.enter} open at match · Esc close
      </div>
    </div>
  );
}

/* ── Empty / welcome state ───────────────────────────────────────────────── */
function EmptyMain({ th, g }) {
  return (
    <div className="pane main empty">
      <div className="empty-inner">
        <div style={{ color: th.secondary, fontWeight: 700, fontSize: "2.2em", letterSpacing: "0.18em" }}>loom</div>
        <div style={{ color: th.dim, marginTop: "1.2em", lineHeight: 1.8 }}>
          <div>type to filter · {g.enter} to open · / for commands</div>
          <div>{g.branch} watching the working tree — live</div>
        </div>
      </div>
    </div>
  );
}

/* ── Slash command palette ───────────────────────────────────────────────── */
function SlashPalette({ th, g, items, sel, query, selName, shape, mainChars }) {
  const top = g.hrule === "─" ? "┄" : ".";
  if (!items.length) return null;
  const list = (
    <div className="slash-list">
      {shape === "card" ? null : (
        <div className="row" style={{ color: th.dim }}>{top} {query} {("".padEnd(0))}</div>
      )}
      {items.map((it, i) => {
        const active = i === sel;
        const desc = it.desc.replace("{sel}", selName);
        return (
          <div key={it.name} className="row slash-row" style={{ background: active ? th.selBg : "transparent" }}>
            <span style={{ color: active ? th.accent : "transparent", width: "2ch", flex: "none" }}>{active ? g.cursor : " "}</span>
            <span style={{ color: it.danger ? th.danger : (active ? th.glow : th.fg), width: "10ch", display: "inline-block", flex: "none" }}>
              <HiText text={it.name} positions={matchPositions(it.name, query)} offset={0} glow={th.glow} baseColor={it.danger ? th.danger : (active ? th.glow : th.fg)} />
            </span>
            <span style={{ color: th.dim }}>— {desc}</span>
          </div>
        );
      })}
    </div>
  );
  if (shape === "card") {
    return (
      <div className="slash-card-wrap">
        <div className="slash-card" style={{ background: th.bgEl, borderColor: th.dim }}>
          <div className="row" style={{ color: th.secondary, marginBottom: "0.3em" }}>commands <span style={{ color: th.dim }}>{query}</span></div>
          {list}
        </div>
      </div>
    );
  }
  return <div className="slash-anchored">{list}</div>;
}

/* simple contiguous-substring match positions for slash names */
function matchPositions(name, query) {
  if (!query || query === "/") return [];
  const q = query.toLowerCase(), n = name.toLowerCase();
  const at = n.indexOf(q);
  if (at < 0) return [];
  return Array.from({ length: q.length }, (_, k) => at + k);
}

/* ── Omni-bar + status readout ───────────────────────────────────────────── */
function OmniBar({ th, g, value, mode, branch, dirty, onDisk, cols, rows, layout, pulse }) {
  const modeLabel = mode === "slash" ? "command" : mode === "ex" ? "ex" : mode === "filter" ? "filter" : "ready";
  const modeColor = mode === "slash" ? th.glow : mode === "ex" ? th.secondary : mode === "filter" ? th.accent : th.dim;
  const abbreviated = layout !== "wide";
  const status = abbreviated
    ? <span><span style={{ color: pulse ? th.accent : th.dim }}>{onDisk}</span> {g.dirty === "±" ? "±" : "*"} {branch} {dirty ? g.dirty : g.clean}</span>
    : <span><span style={{ color: pulse ? th.accent : th.dim }}>{onDisk} changed on disk</span> · {g.branch} {branch} {dirty ? g.dirty : g.clean}</span>;
  return (
    <div className="omni row">
      <span style={{ color: th.secondary, fontWeight: 700 }}>{g.prompt}</span>
      <span style={{ marginLeft: "1ch", flex: 1, color: th.fg, whiteSpace: "pre" }}>
        {value}<span className="omni-caret" style={{ background: th.accent }} />
      </span>
      <span style={{ color: modeColor, flex: "none", marginLeft: "2ch" }}>[{modeLabel}]</span>
      <span style={{ color: th.dim, flex: "none", marginLeft: "2ch" }}>{status}</span>
    </div>
  );
}

/* ── string utils ────────────────────────────────────────────────────────── */
function basename(p) { return p.split("/").pop(); }
function midTruncate(p, max) {
  if (!max || p.length <= max) return p;
  const keep = Math.max(6, max - 1);
  const head = Math.ceil(keep * 0.4), tail = keep - head;
  return p.slice(0, head) + "…" + p.slice(p.length - tail);
}

Object.assign(window, {
  THEMES, GLYPHS, ACCENTS, resolveTheme, SYNTAX,
  cloneTree, findNode, flattenTree, computeFilter,
  TreePane, TreeRow, Editor, CodeLine, FindView, EmptyMain, SlashPalette, OmniBar,
  basename, midTruncate, matchPositions, HiText,
});
