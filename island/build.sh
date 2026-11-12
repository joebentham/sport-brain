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
codesign --force --sign - "$APP"
echo "Installed: $APP"
