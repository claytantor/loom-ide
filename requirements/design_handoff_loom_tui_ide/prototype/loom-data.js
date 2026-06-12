/* loom-data.js — repo model, file contents, fuzzy scorer, TS tokenizer,
   slash commands and ripgrep sample. Pure data + logic, no Ink/React. */
(function () {
  "use strict";

  // ── Repo tree ────────────────────────────────────────────────────────────
  // git: 'M' modified · '?' untracked · '+' added/staged · '-' deleted · '!' conflict
  const tree = {
    name: "loom", type: "dir", path: "", open: true, children: [
      { name: "src", type: "dir", path: "src", open: true, children: [
        { name: "server", type: "dir", path: "src/server", open: true, children: [
          { name: "index.ts", type: "file", path: "src/server/index.ts", git: "M" },
          { name: "app.ts", type: "file", path: "src/server/app.ts" },
          { name: "routes.ts", type: "file", path: "src/server/routes.ts", git: "M" },
        ]},
        { name: "ui", type: "dir", path: "src/ui", open: true, children: [
          { name: "index.ts", type: "file", path: "src/ui/index.ts" },
          { name: "tree.tsx", type: "file", path: "src/ui/tree.tsx", git: "+" },
          { name: "editor.tsx", type: "file", path: "src/ui/editor.tsx", git: "+" },
          { name: "omnibar.tsx", type: "file", path: "src/ui/omnibar.tsx" },
        ]},
        { name: "lib", type: "dir", path: "src/lib", open: false, children: [
          { name: "fuzzy.ts", type: "file", path: "src/lib/fuzzy.ts", git: "M" },
          { name: "watcher.ts", type: "file", path: "src/lib/watcher.ts" },
          { name: "theme.ts", type: "file", path: "src/lib/theme.ts" },
        ]},
        { name: "index.ts", type: "file", path: "src/index.ts" },
      ]},
      { name: "scripts", type: "dir", path: "scripts", open: true, children: [
        { name: "deploy.sh", type: "file", path: "scripts/deploy.sh", git: "?" },
        { name: "seed.ts", type: "file", path: "scripts/seed.ts" },
      ]},
      { name: "themes", type: "dir", path: "themes", open: false, children: [
        { name: "neon.json", type: "file", path: "themes/neon.json" },
        { name: "ascii.json", type: "file", path: "themes/ascii.json" },
      ]},
      { name: "package.json", type: "file", path: "package.json", git: "M" },
      { name: "tsconfig.json", type: "file", path: "tsconfig.json" },
      { name: "README.md", type: "file", path: "README.md" },
    ]
  };

  // ── File contents (for the editor) ───────────────────────────────────────
  const files = {
    "src/server/index.ts": [
      'import { createServer } from "./app.js";',
      'import { registerRoutes } from "./routes.js";',
      'import { logger } from "../lib/logger.js";',
      '',
      'const port = Number(process.env.PORT ?? 8080);',
      '',
      'const server = createServer();',
      'registerRoutes(server);',
      '',
      'server.listen(port, () => {',
      '  logger.info(`loom up on :${port}`);',
      '});',
      '',
      '// graceful shutdown for SSH sessions',
      'process.on("SIGTERM", () => {',
      '  server.close(() => process.exit(0));',
      '});',
    ],
    "src/lib/fuzzy.ts": [
      'export interface Match {',
      '  score: number;',
      '  positions: number[];',
      '}',
      '',
      '// subsequence scorer: "srvind" -> src/server/index.ts',
      'export function score(query: string, target: string): Match | null {',
      '  let qi = 0;',
      '  let score = 0;',
      '  const positions: number[] = [];',
      '  for (let ti = 0; ti < target.length && qi < query.length; ti++) {',
      '    if (target[ti].toLowerCase() === query[qi].toLowerCase()) {',
      '      positions.push(ti);',
      '      score += ti === 0 || target[ti - 1] === "/" ? 8 : 1;',
      '      qi++;',
      '    }',
      '  }',
      '  return qi === query.length ? { score, positions } : null;',
      '}',
    ],
    "src/ui/tree.tsx": [
      'import React from "react";',
      'import { Box, Text } from "ink";',
      'import { useTheme } from "../lib/theme.js";',
      '',
      'export function TreeRow({ node, selected }: RowProps) {',
      '  const t = useTheme();',
      '  const cursor = selected ? "\u2771" : " ";',
      '  return (',
      '    <Box>',
      '      <Text color={selected ? t.accent : t.fg}>',
      '        {cursor} {node.name}',
      '      </Text>',
      '    </Box>',
      '  );',
      '}',
    ],
  };

  // ── Slash commands ───────────────────────────────────────────────────────
  const slashCommands = [
    { name: "/edit",    selScoped: true,  desc: "open {sel} in the editor" },
    { name: "/diff",    selScoped: true,  desc: "git diff of {sel}" },
    { name: "/discard", selScoped: true,  desc: "revert {sel} to HEAD", danger: true },
    { name: "/blame",   selScoped: true,  desc: "git blame {sel}" },
    { name: "/rename",  selScoped: true,  desc: "rename {sel}" },
    { name: "/reveal",  selScoped: true,  desc: "reveal {sel} in tree" },
    { name: "/find",    selScoped: false, desc: "ripgrep project search" },
    { name: "/theme",   selScoped: false, desc: "switch color theme" },
    { name: "/quit",    selScoped: false, desc: "quit loom", danger: true },
  ];

  // ── /find ripgrep sample (query: "listen") ───────────────────────────────
  const findResults = {
    query: "listen",
    matches: 5,
    fileCount: 3,
    groups: [
      { path: "src/server/index.ts", hits: [
        { line: 10, pre: "server.", mid: "listen", post: "(port, () => {" },
      ]},
      { path: "src/server/app.ts", hits: [
        { line: 22, pre: "  // attach ", mid: "listen", post: "ers before boot" },
        { line: 41, pre: "  emitter.", mid: "listen", post: '("ready", onReady);' },
      ]},
      { path: "src/lib/watcher.ts", hits: [
        { line:  8, pre: "  fs.", mid: "listen", post: "ers.add(handler);" },
        { line: 53, pre: "  return () => ", mid: "listen", post: "ers.delete(h);" },
      ]},
    ],
  };

  // ── Fuzzy scorer ─────────────────────────────────────────────────────────
  // Scores a query against a path. Returns {score, positions} or null.
  function fuzzyScore(query, target) {
    const q = query.toLowerCase(), t = target.toLowerCase();
    let qi = 0, score = 0, prevMatch = -2;
    const positions = [];
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        positions.push(ti);
        const boundary = ti === 0 || target[ti - 1] === "/" || target[ti - 1] === ".";
        score += boundary ? 10 : 1;
        if (ti === prevMatch + 1) score += 5; // contiguous bonus
        prevMatch = ti;
        qi++;
      }
    }
    if (qi !== q.length) return null;
    score -= (t.length - positions[positions.length - 1]) * 0.1; // prefer shorter tails
    return { score, positions };
  }

  // Flatten tree to leaf files with full paths.
  function allFiles(node, out) {
    out = out || [];
    if (node.type === "file") out.push(node);
    else (node.children || []).forEach((c) => allFiles(c, out));
    return out;
  }

  // ── Minimal TS/JS/TSX tokenizer for the editor ───────────────────────────
  const KW = new Set("import export from const let var function return if else for while new class interface extends implements type as of in await async void null undefined true false this process".split(" "));
  function tokenizeLine(line) {
    const tokens = [];
    let i = 0;
    const push = (t, v) => tokens.push({ t, v });
    while (i < line.length) {
      const c = line[i];
      // line comment
      if (c === "/" && line[i + 1] === "/") { push("comment", line.slice(i)); break; }
      // strings
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1;
        while (j < line.length && line[j] !== c) { if (line[j] === "\\") j++; j++; }
        push("string", line.slice(i, Math.min(j + 1, line.length)));
        i = j + 1; continue;
      }
      // whitespace
      if (/\s/.test(c)) { let j = i; while (j < line.length && /\s/.test(line[j])) j++; push("ws", line.slice(i, j)); i = j; continue; }
      // identifiers / keywords
      if (/[A-Za-z_$]/.test(c)) {
        let j = i; while (j < line.length && /[A-Za-z0-9_$]/.test(line[j])) j++;
        const word = line.slice(i, j);
        let kind = "ident";
        if (KW.has(word)) kind = "kw";
        else if (line[j] === "(") kind = "fn";
        else if (/^[A-Z]/.test(word)) kind = "type";
        push(kind, word); i = j; continue;
      }
      // numbers
      if (/[0-9]/.test(c)) { let j = i; while (j < line.length && /[0-9._]/.test(line[j])) j++; push("num", line.slice(i, j)); i = j; continue; }
      // punctuation
      push("punct", c); i++;
    }
    return tokens;
  }

  function basename(p) { return String(p).split("/").pop(); }

  window.LoomData = {
    tree, files, slashCommands, findResults,
    fuzzyScore, allFiles, tokenizeLine, basename,
  };
})();
