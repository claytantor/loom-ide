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

# Make sure $BIN_DIR is on PATH. If not, add it to the user's shell rc (unless
# LOOM_NO_MODIFY_PATH=1), and always print the manual line.
ensure_on_path() {
  case ":$PATH:" in *":$BIN_DIR:"*) return 0 ;; esac

  local rc line
  line="export PATH=\"$BIN_DIR:\$PATH\""
  case "$(basename "${SHELL:-sh}")" in
    zsh)  rc="${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) rc="$HOME/.bashrc"; [ -f "$rc" ] || rc="$HOME/.bash_profile" ;;
    fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path $BIN_DIR" ;;
    *)    rc="" ;;
  esac

  if [ "${LOOM_NO_MODIFY_PATH:-0}" = "1" ] || [ -z "$rc" ]; then
    printf '\033[33mnote:\033[0m %s is not on your PATH. Add it with:\n  %s\n' "$BIN_DIR" "$line"
    return 0
  fi

  if [ -f "$rc" ] && grep -qF "$BIN_DIR" "$rc"; then
    say "$BIN_DIR already on PATH via $rc"
  else
    mkdir -p "$(dirname "$rc")"
    printf '\n# added by the loom installer\n%s\n' "$line" >> "$rc"
    say "added $BIN_DIR to your PATH in $rc"
  fi
  printf '   open a new terminal or run:  \033[36msource %s\033[0m\n' "$rc"
}

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

ensure_on_path

printf '\033[32m✓\033[0m loom installed — cd into a repo and run: \033[36mloom\033[0m\n'
printf '  upgrade later with:  \033[36mloom --upgrade\033[0m\n'
