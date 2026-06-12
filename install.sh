#!/usr/bin/env bash
# loom installer — clone, build, seed config, symlink onto $PATH.
#   curl -fsSL https://raw.githubusercontent.com/claytantor/loom-ide/main/install.sh | bash
set -euo pipefail

REPO="${LOOM_REPO:-https://github.com/claytantor/loom-ide}"
LOOM_HOME_DIR="${LOOM_HOME:-$HOME/.loom}"
DEST="$LOOM_HOME_DIR/app"
BIN_DIR="${LOOM_BIN_DIR:-$HOME/.local/bin}"

say() { printf '\033[36m→\033[0m %s\n' "$*"; }
die() { printf '\033[31mloom:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required"
command -v node >/dev/null 2>&1 || die "node >= 18 is required"
command -v npm >/dev/null 2>&1 || die "npm is required"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' \
  || die "node >= 18 required (found $(node --version))"

mkdir -p "$LOOM_HOME_DIR" "$BIN_DIR"

if [ -d "$DEST/.git" ]; then
  say "updating existing install in $DEST"
  git -C "$DEST" pull --ff-only
else
  say "cloning $REPO"
  git clone --depth 1 "$REPO" "$DEST"
fi

say "installing dependencies"
npm --prefix "$DEST" install --no-fund --no-audit --loglevel=error

say "building"
npm --prefix "$DEST" run build >/dev/null

say "seeding $LOOM_HOME_DIR (config.yml, keybindings.yml, themes/)"
LOOM_HOME="$LOOM_HOME_DIR" node -e \
  "import('file://' + process.argv[1]).then((m) => m.ensureSeeded())" \
  "$DEST/dist/services/configIo.js"

say "linking $BIN_DIR/loom"
chmod +x "$DEST/dist/cli.js"
ln -sf "$DEST/dist/cli.js" "$BIN_DIR/loom"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf '\033[33mnote:\033[0m %s is not on your PATH — add: export PATH="%s:$PATH"\n' "$BIN_DIR" "$BIN_DIR" ;;
esac

printf '\033[32m✓\033[0m loom installed — cd into a repo and run: loom\n'
