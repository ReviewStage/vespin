#!/usr/bin/env bash
# simulator-bundle.sh -- put this checkout's JavaScript into a copy of a simulator app built before, naming the copy on its last line.
#
# Usage: scripts/simulator-bundle.sh <base .app> <output .app>
#
# A JavaScript change needs no native build: Metro bundles the app's
# JavaScript as Hermes bytecode (`expo export`), and the copy of a Release
# simulator app that `simulator-build.sh` built takes it as its
# `main.jsbundle`. The base must have been built from the same native
# sources, or the bundle names a native module the app lacks and the app
# dies at launch or draws blanks. The copy is signed ad hoc again, keeping
# the base's entitlements, since the App Group and the Keychain groups are
# read from them.
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <base .app> <output .app>" >&2
    exit 64
fi

APP_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# Note that a base named through a symlink is resolved, so the copy never writes into the base itself.
base=$(realpath -- "$1")
output=$2

# Metro reads the locale as CocoaPods does: a UTF-8 LANG, and no LC_ALL over it.
unset LC_ALL
export LANG=en_US.UTF-8
export EXPO_NO_TELEMETRY=1

cd "$APP_DIRECTORY"
rm -rf dist
pnpm exec expo export --platform ios --output-dir dist >&2

rm -rf "$output"
cp -R "$base" "$output"
chmod -R u+w "$output"
cp dist/_expo/static/js/ios/*.hbc "$output/main.jsbundle"
rm -rf dist

codesign --force --sign - --preserve-metadata=entitlements,identifier,flags "$output" >&2

echo "$output"
