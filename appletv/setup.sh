#!/bin/bash
# One-time setup for "Watch on Apple TV": makes a private Python environment with pyatv, then pairs
# with the Apple TV (you type the PIN it shows on the TV) and reads which apps are installed.
# Safe to run again: it reuses the environment and re-pairs.
#   appletv/setup.sh                     pair with the only Apple TV on the network
#   appletv/setup.sh --name "Living Room"  pick one when there are several
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPPORT="$HOME/Library/Application Support/SportBrain"
VENV="$SUPPORT/venv"
mkdir -p "$SUPPORT"

PY=""
for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$c" ] && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "Need Python 3.9 or newer." >&2; exit 1; }

if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -c 'import pyatv' 2>/dev/null; then
  echo "Installing pyatv into $VENV ..."
  rm -rf "$VENV"
  "$PY" -m venv "$VENV"
fi
# srptools 2.0 made an argument keyword-only, which breaks pyatv 0.18's pairing ("SRPClientSession.__init__()
# takes 2 positional arguments"). Pin it below 2; this also repairs an environment made before the pin.
"$VENV/bin/pip" install --quiet --disable-pip-version-check "pyatv>=0.18,<0.19" "srptools<2"

echo
echo "Make sure the TV is on and showing the Apple TV, then follow the prompts."
echo
"$VENV/bin/python" "$HERE/sportbrain_atv.py" pair "$@"
echo
echo "Done. The Sport Brain island will now offer \"Watch on Apple TV\"."
