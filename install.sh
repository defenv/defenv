#!/bin/sh
# defenv installer — installs a global `defenv` command backed by Deno.
#
# Works three ways, and never prompts for a GitHub login:
#   • From a local checkout:   sh install.sh           (uses the files here)
#   • Point at a local copy:   DEFENV_SRC=/path sh install.sh
#   • Remote one-liner:        curl -fsSL https://raw.githubusercontent.com/defenv/defenv/HEAD/install.sh | sh
#
# Requirements: Deno 2.x (https://deno.land). Nothing else — no Node, no build.
set -eu

REPO="${DEFENV_REPO:-defenv/defenv}"
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
#    Ref-agnostic: HEAD follows the repo's default branch (master, main, …);
#    override with DEFENV_REF=<branch|tag|sha> if needed.
fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"
  else return 2; fi
}

if [ -z "$SRC" ]; then
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 \
    || die "need curl or wget to download (or run from a local checkout / set DEFENV_SRC)"
  SRC="$HOME_DIR/src"
  say "downloading source from $REPO …"
  ok=0
  for ref in ${DEFENV_REF:+"$DEFENV_REF"} HEAD master main; do
    rm -rf "$SRC"; mkdir -p "$SRC"
    if fetch "https://codeload.github.com/$REPO/tar.gz/$ref" 2>/dev/null \
         | tar -xz -C "$SRC" --strip-components=1 2>/dev/null \
       && [ -f "$SRC/cli.ts" ]; then
      say "fetched $REPO@$ref"; ok=1; break
    fi
  done
  [ "$ok" = 1 ] || die "download failed — is https://github.com/$REPO public? (try DEFENV_REF=<branch>, or set DEFENV_REPO)"
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
