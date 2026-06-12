/* loom-app.jsx — grid measurement, state machine, keyboard routing, shell. */
const { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "scenario": "idle",
  "theme": "neon",
  "accent": "cyan",
  "fuzzyMode": "dim",
  "slashShape": "list",
  "glyphs": "unicode",
  "gutter": true,
  "treeWidth": 32,
  "fontSize": 15
}/*EDITMODE-END*/;

/* Measure the character cell and derive cols/rows from the live viewport. */
function useGrid(ref, fontSize) {
  const [grid, setGrid] = useState({ cols: 120, rows: 40, chW: 9, lineH: 21 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => {
      const ruler = el.querySelector(".ruler");
      const chW = ruler ? ruler.getBoundingClientRect().width / 100 : fontSize * 0.6;
      const lineH = ruler ? ruler.getBoundingClientRect().height : fontSize * 1.4;
      const w = el.clientWidth, h = el.clientHeight;
      setGrid({
        cols: Math.max(20, Math.floor(w / chW)),
        rows: Math.max(8, Math.floor(h / lineH)),
        chW, lineH,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [fontSize]);
  return grid;
}

function genLines(path) {
  const base = window.LoomData.basename(path).replace(/\.\w+$/, "");
  return [
    `// ${path}`,
    `// mock buffer — full content not captured`,
    "",
    `export const ${base.replace(/[^a-z0-9]/gi, "_")} = {`,
    `  ready: true,`,
    `};`,
  ];
}

function App() {
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const rootRef = useRef(null);
  const grid = useGrid(rootRef, t.fontSize);

  const th = useMemo(() => window.resolveTheme(t), [t.theme, t.accent]);
  const g = window.GLYPHS[t.glyphs] || window.GLYPHS.unicode;

  const [tree, setTree] = useState(() => window.cloneTree(window.LoomData.tree));
  const [value, setValue] = useState("");
  const [focus, setFocus] = useState("tree");        // 'tree' | 'editor'
  const [mainView, setMainView] = useState("editor"); // 'editor' | 'find' | 'empty'
  const [openFile, setOpenFile] = useState("src/server/index.ts");
  const [lines, setLines] = useState(() => window.LoomData.files["src/server/index.ts"]);
  const [caret, setCaret] = useState(0);
  const [selPath, setSelPath] = useState("src/server/index.ts");
  const [slashSel, setSlashSel] = useState(0);
  const [findSel, setFindSel] = useState(0);
  const [dirty] = useState(true);
  const [pulse, setPulse] = useState(false);

  const branch = "main";
  const onDisk = 2;

  /* derive mode from the omni-bar value */
  const mode = value.startsWith("/") ? "slash"
    : value.startsWith(":") ? "ex"
    : value ? "filter" : "idle";
  const filtering = mode === "filter";

  /* responsive geometry */
  const layout = grid.cols >= 120 ? "wide" : grid.cols >= 80 ? "mid" : "stack";
  const treeChars = layout === "stack" ? grid.cols
    : Math.max(22, Math.min(t.treeWidth, layout === "mid" ? 30 : 46, grid.cols - 26));
  const mainChars = layout === "stack" ? grid.cols : grid.cols - treeChars - 1;
  const showFooter = grid.rows >= 22;

  /* tree rows (filtered or normal) */
  const fres = useMemo(() => {
    if (!filtering) return { rows: window.flattenTree(tree, 0), matchByPath: {}, count: 0, topPath: null };
    const r = window.computeFilter(tree, value, t.fuzzyMode);
    r.topPath = r.rows.find((x) => x.node.type === "file")?.node.path || null;
    return r;
  }, [tree, value, filtering, t.fuzzyMode]);

  const rows = fres.rows;
  const effSel = rows.some((r) => r.node.path === selPath)
    ? selPath
    : (filtering ? fres.topPath : rows[0]?.node.path) || null;
  const selIdx = rows.findIndex((r) => r.node.path === effSel);

  /* one-time status pulse to evoke a live agent change */
  useEffect(() => {
    const id = setTimeout(() => { setPulse(true); setTimeout(() => setPulse(false), 900); }, 1400);
    return () => clearTimeout(id);
  }, []);

  /* slash items */
  const slashItems = useMemo(() => {
    if (mode !== "slash") return [];
    const v = value.toLowerCase();
    return window.LoomData.slashCommands.filter((c) =>
      c.name.toLowerCase().startsWith(v) ||
      (value.length > 1 && c.name.slice(1).toLowerCase().includes(value.slice(1).toLowerCase())));
  }, [mode, value]);
  const clampedSlashSel = Math.min(slashSel, Math.max(0, slashItems.length - 1));

  /* flat list of find hits for navigation */
  const findHits = useMemo(() => {
    const out = [];
    window.LoomData.findResults.groups.forEach((grp) => grp.hits.forEach((h) => out.push({ path: grp.path, ...h })));
    return out;
  }, []);

  /* ── actions ─────────────────────────────────────────────────────────── */
  const loadFile = useCallback((path) => {
    setOpenFile(path);
    setLines(window.LoomData.files[path] || genLines(path));
    setCaret(0); setMainView("editor");
  }, []);
  const openAndFocus = useCallback((path) => { loadFile(path); setFocus("editor"); setValue(""); }, [loadFile]);
  const doFind = useCallback(() => { setMainView("find"); setFocus("editor"); setFindSel(0); setValue(""); }, []);

  const toggleDir = useCallback((path) => {
    setTree((prev) => { const c = window.cloneTree(prev); const n = window.findNode(c, path); if (n) n.open = !n.open; return c; });
  }, []);
  const setDirOpen = useCallback((path, open) => {
    setTree((prev) => { const c = window.cloneTree(prev); const n = window.findNode(c, path); if (n) n.open = open; return c; });
  }, []);

  const runSlash = useCallback((item) => {
    if (!item) { setValue(""); return; }
    if (item.name === "/find") { doFind(); return; }
    if (item.name === "/edit") {
      const n = window.findNode(tree, selPath);
      if (n && n.type === "file") openAndFocus(selPath);
      else setValue("");
      return;
    }
    setValue(""); // other commands: acknowledged, no mock view
  }, [tree, selPath, doFind, openAndFocus]);

  const runEx = useCallback((v) => {
    if (/^:wq?!?$|^:q!?$/.test(v.trim())) setFocus("tree");
    setValue("");
  }, []);

  /* apply scenario presets when the tweak changes */
  useEffect(() => {
    const s = t.scenario;
    if (s === "idle") { setValue(""); loadFile("src/server/index.ts"); setSelPath("src/server/index.ts"); setFocus("tree"); }
    else if (s === "filter") { setValue("srvind"); setFocus("tree"); setMainView("editor"); }
    else if (s === "slash") { setValue("/di"); setSlashSel(0); setFocus("tree"); }
    else if (s === "find") { loadFile("src/server/index.ts"); doFind(); }
  }, [t.scenario]); // eslint-disable-line

  /* ── keyboard ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      const tgt = e.target;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      if (tgt && tgt.closest && tgt.closest(".twk-panel")) return;

      const k = e.key;
      const printable = k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };

      // ── slash command mode ──
      if (mode === "slash") {
        if (k === "Escape") { stop(); setValue(""); return; }
        if (k === "ArrowDown") { stop(); setSlashSel((s) => Math.min(slashItems.length - 1, s + 1)); return; }
        if (k === "ArrowUp") { stop(); setSlashSel((s) => Math.max(0, s - 1)); return; }
        if (k === "Enter") { stop(); runSlash(slashItems[clampedSlashSel]); return; }
        if (k === "Backspace") { stop(); setValue((v) => v.slice(0, -1)); setSlashSel(0); return; }
        if (printable) { stop(); setValue((v) => v + k); setSlashSel(0); return; }
        return;
      }
      // ── ex mode ──
      if (mode === "ex") {
        if (k === "Escape") { stop(); setValue(""); return; }
        if (k === "Enter") { stop(); runEx(value); return; }
        if (k === "Backspace") { stop(); setValue((v) => v.slice(0, -1)); return; }
        if (printable) { stop(); setValue((v) => v + k); return; }
        return;
      }
      // ── find output focused ──
      if (mainView === "find" && focus === "editor") {
        if (k === "ArrowDown" || k === "j") { stop(); setFindSel((s) => Math.min(findHits.length - 1, s + 1)); return; }
        if (k === "ArrowUp" || k === "k") { stop(); setFindSel((s) => Math.max(0, s - 1)); return; }
        if (k === "Enter") { stop(); openAndFocus(findHits[findSel].path); return; }
        if (k === "Escape") { stop(); setFocus("tree"); setMainView(openFile ? "editor" : "empty"); return; }
        if (k === "/") { stop(); setValue("/"); setSlashSel(0); return; }
        if (k === "Tab") { stop(); setFocus("tree"); return; }
        return;
      }
      // ── editor focused ──
      if (focus === "editor") {
        if (k === "ArrowDown" || k === "j") { stop(); setCaret((c) => Math.min(lines.length - 1, c + 1)); return; }
        if (k === "ArrowUp" || k === "k") { stop(); setCaret((c) => Math.max(0, c - 1)); return; }
        if (k === "Escape" || k === "Tab") { stop(); setFocus("tree"); return; }
        if (k === "/") { stop(); setValue("/"); setSlashSel(0); return; }
        if (k === ":") { stop(); setValue(":"); return; }
        return;
      }
      // ── tree focused ──
      if (k === "Tab") { stop(); if (openFile) { setMainView("editor"); setFocus("editor"); } return; }
      if (k === "/") { stop(); setValue("/"); setSlashSel(0); return; }
      if (k === ":") { stop(); setValue(":"); return; }
      if (k === "Escape") { stop(); if (value) setValue(""); return; }

      const navUp = k === "ArrowUp" || (value === "" && k === "k");
      const navDown = k === "ArrowDown" || (value === "" && k === "j");
      const navRight = k === "ArrowRight" || (value === "" && k === "l");
      const navLeft = k === "ArrowLeft" || (value === "" && k === "h");

      if (navDown) { stop(); if (selIdx >= 0 && selIdx < rows.length - 1) setSelPath(rows[selIdx + 1].node.path); return; }
      if (navUp) { stop(); if (selIdx > 0) setSelPath(rows[selIdx - 1].node.path); return; }
      if (navRight) {
        stop();
        const n = rows[selIdx]?.node;
        if (!n) return;
        if (n.type === "dir") { if (!n.open) setDirOpen(n.path, true); else if (rows[selIdx + 1]) setSelPath(rows[selIdx + 1].node.path); }
        else openAndFocus(n.path);
        return;
      }
      if (navLeft) {
        stop();
        const n = rows[selIdx]?.node;
        if (!n) return;
        if (n.type === "dir" && n.open) setDirOpen(n.path, false);
        else {
          const parent = n.path.split("/").slice(0, -1).join("/");
          if (parent && rows.some((r) => r.node.path === parent)) setSelPath(parent);
        }
        return;
      }
      if (k === "Enter") {
        stop();
        const n = rows[selIdx]?.node;
        if (!n) return;
        if (n.type === "dir") toggleDir(n.path);
        else openAndFocus(n.path);
        return;
      }
      if (k === "Backspace") { stop(); setValue((v) => v.slice(0, -1)); return; }
      // typing → fuzzy filter
      if (printable && /[\w./\- ]/.test(k)) { stop(); setValue((v) => v + k); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ── render ──────────────────────────────────────────────────────────── */
  const gutterHint = `/edit /diff /blame on ${window.LoomData.basename(effSel || openFile || "")}`;
  const focusTree = focus === "tree";

  const treePane = (
    <window.TreePane th={th} g={g} rows={rows} selPath={effSel} matchByPath={fres.matchByPath}
      focusTree={focusTree} mode={layout === "stack" ? "stack" : "wide"} query={filtering ? value : ""}
      count={fres.count} treeChars={treeChars} showFooter={showFooter} openPath={openFile} gutterHint={gutterHint} />
  );

  const mainPane = mainView === "find"
    ? <window.FindView th={th} g={g} data={window.LoomData.findResults} sel={findSel} mainChars={mainChars} />
    : openFile
      ? <window.Editor th={th} g={g} path={openFile} lines={lines} caret={caret} gutter={t.gutter}
          focusEditor={focus === "editor"} branch={branch} dirty={dirty} onDisk={false} mainChars={mainChars} />
      : <window.EmptyMain th={th} g={g} />;

  const divider = (
    <div className="divider" aria-hidden="true" style={{ color: th.dim }}>
      <pre style={{ margin: 0 }}>{Array(grid.rows + 2).fill(g.vrule).join("\n")}</pre>
    </div>
  );

  const slashOpen = mode === "slash" && slashItems.length > 0;

  return (
    <div className="loom" ref={rootRef}
      style={{ fontSize: t.fontSize + "px", background: th.bg, color: th.fg }}>
      <span className="ruler" aria-hidden="true">{"M".repeat(100)}</span>
      <div className="meta" style={{ color: th.dim }}>{grid.cols}×{grid.rows} · {layout}</div>

      <div className="top">
        {layout === "stack"
          ? (focus === "tree" ? treePane : mainPane)
          : (<>{treePane}{divider}{mainPane}</>)}
      </div>

      {slashOpen && t.slashShape === "list" ? (
        <window.SlashPalette th={th} g={g} items={slashItems} sel={clampedSlashSel}
          query={value} selName={window.LoomData.basename(effSel || "")} shape="list" mainChars={mainChars} />
      ) : null}

      <div className="rule" style={{ color: th.dim }}>{g.hrule.repeat(grid.cols)}</div>

      <window.OmniBar th={th} g={g} value={value} mode={mode} branch={branch} dirty={dirty}
        onDisk={onDisk} cols={grid.cols} rows={grid.rows} layout={layout} pulse={pulse} />

      {slashOpen && t.slashShape === "card" ? (
        <window.SlashPalette th={th} g={g} items={slashItems} sel={clampedSlashSel}
          query={value} selName={window.LoomData.basename(effSel || "")} shape="card" mainChars={mainChars} />
      ) : null}

      <window.TweaksPanel>
        <window.TweakSection label="Scenario" />
        <window.TweakSelect label="Jump to state" value={t.scenario}
          options={[{ value: "idle", label: "idle on a file" }, { value: "filter", label: "fuzzy filter" }, { value: "slash", label: "slash palette" }, { value: "find", label: "/find results" }]}
          onChange={(v) => setTweak("scenario", v)} />

        <window.TweakSection label="Theme" />
        <window.TweakRadio label="Palette" value={t.theme} options={["neon", "mono"]}
          onChange={(v) => setTweak("theme", v)} />
        <window.TweakColor label="Accent" value={t.accent === "cyan" ? "#22D3EE" : t.accent === "amber" ? "#F0A36B" : t.accent === "green" ? "#7FD88F" : "#B392F0"}
          options={["#22D3EE", "#F0A36B", "#7FD88F", "#B392F0"]}
          onChange={(hex) => setTweak("accent", { "#22D3EE": "cyan", "#F0A36B": "amber", "#7FD88F": "green", "#B392F0": "violet" }[hex] || "cyan")} />
        <window.TweakRadio label="Glyphs" value={t.glyphs} options={["unicode", "ascii"]}
          onChange={(v) => setTweak("glyphs", v)} />

        <window.TweakSection label="Fuzzy filter" />
        <window.TweakRadio label="Non-match" value={t.fuzzyMode} options={["dim", "hide", "flat"]}
          onChange={(v) => setTweak("fuzzyMode", v)} />

        <window.TweakSection label="Slash palette" />
        <window.TweakRadio label="Shape" value={t.slashShape} options={["list", "card"]}
          onChange={(v) => setTweak("slashShape", v)} />

        <window.TweakSection label="Layout" />
        <window.TweakToggle label="Line numbers" value={t.gutter} onChange={(v) => setTweak("gutter", v)} />
        <window.TweakSlider label="Tree width" value={t.treeWidth} min={24} max={46} unit="ch"
          onChange={(v) => setTweak("treeWidth", v)} />
        <window.TweakSlider label="Font size" value={t.fontSize} min={11} max={22} unit="px"
          onChange={(v) => setTweak("fontSize", v)} />
      </window.TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
