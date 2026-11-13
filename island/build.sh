#!/bin/bash
# Builds the island app and installs it to ~/Applications. Needs only the Xcode command-line tools.
set -euo pipefail
cd "$(dirname "$0")"
SCRATCH="${TMPDIR:-/tmp}/sport-brain-island-build"
swift build -c release --scratch-path "$SCRATCH"
APP="$HOME/Applications/Sport Brain Island.app"
pkill -x SportBrainIsland 2>/dev/null || true
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$SCRATCH/release/SportBrainIsland" "$APP/Contents/MacOS/"
cp Info.plist "$APP/Contents/"
# The Apple TV launcher and its one-time setup ride along inside the app (see appletv/README.md).
mkdir -p "$APP/Contents/Resources"
cp ../appletv/sportbrain_atv.py ../appletv/setup.sh "$APP/Contents/Resources/"
chmod +x "$APP/Contents/Resources/setup.sh"
codesign --force --sign - "$APP"
echo "Installed: $APP"
