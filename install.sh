#!/bin/sh
# defenv installer — installs a global `defenv` command backed by Deno.
#
# Works three ways, and never prompts for a GitHub login:
#   • From a local checkout:   sh install.sh           (uses the files here)
#   • Point at a local copy:   DEFENV_SRC=/path sh install.sh
#   • Remote one-liner:        curl -fsSL <raw>/install.sh | sh   (downloads a tarball)
#
# Requirements: Deno 2.x (https://deno.land). Nothing else — no Node, no build.
set -eu

REPO="${DEFENV_REPO:-OWNER/defenv}"
HOME_DIR="${DEFENV_HOME:-$HOME/.defenv}"

say()  { printf '\033[32m›\033[0m %s\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }
die()  { printf '\033[31mx %s\033[0m\n' "$1" >&2; exit 1; }

command -v deno >/dev/null 2>&1 || die "Deno is required: https://deno.land/#installation"

# 1) Resolve the source directory without any network or git auth.
SRC=""
if [ -n "${DEFENV_SRC:-}" ] && [ -f "${DEFENV_SRC%/}/cli.ts" ]; then
  SRC="${DEFENV_SRC%/}"
else
  # If this script sits next to cli.ts, install straight from here.
  SELF="$0"
  case "$SELF" in sh|-sh|bash|-bash|dash|-) SELF="" ;; esac
  if [ -n "$SELF" ] && [ -f "$(dirname "$SELF")/cli.ts" ]; then
    SRC="$(CDPATH= cd -- "$(dirname "$SELF")" && pwd)"
  elif [ -f "./cli.ts" ] && [ -f "./deno.json" ]; then
    SRC="$(pwd)"
  fi
fi

# 2) Otherwise download a tarball over HTTPS (curl/wget never prompt for creds).
if [ -z "$SRC" ]; then
  [ "$REPO" = "OWNER/defenv" ] && warn "using placeholder repo '$REPO' — set DEFENV_REPO=you/defenv if this 404s"
  SRC="$HOME_DIR/src"
  TARBALL="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
  say "downloading source from $REPO …"
  rm -rf "$SRC"; mkdir -p "$SRC"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$TARBALL" | tar -xz -C "$SRC" --strip-components=1 || die "download failed (is the repo public? is DEFENV_REPO correct?)"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$TARBALL" | tar -xz -C "$SRC" --strip-components=1 || die "download failed (is the repo public? is DEFENV_REPO correct?)"
  else
    die "need curl or wget to download (or run from a local checkout / set DEFENV_SRC)"
  fi
else
  say "installing from local source: $SRC"
fi

# 3) Install the global command (points at the resolved source).
say "installing the 'defenv' command …"
deno install -gf -A --name defenv "$SRC/cli.ts"

say "done. try:"
echo "    defenv help"
echo "    defenv ui        # launch the web UI at http://localhost:8765"
echo
case ":$PATH:" in
  *":$HOME/.deno/bin:"*) ;;
  *) warn "add Deno's bin dir to PATH:  export PATH=\"\$HOME/.deno/bin:\$PATH\"" ;;
esac
