#!/usr/bin/env bash
# simulator-bundle.sh -- put this checkout's JavaScript into a copy of a simulator app built before, its share extension's too, naming the copy on its last line.
#
# Usage: scripts/simulator-bundle.sh <base .app> <output .app>
#
# A JavaScript change needs no native build: Metro bundles the app's
# JavaScript as Hermes bytecode (`expo export`), and the copy of a Release
# simulator app that `simulator-build.sh` built takes it as its
# `main.jsbundle`; the share extension's own entry (`share.ts`) is bundled
# the same way into the extension inside it as its `share.jsbundle`, where
# the base has an extension drawn with React Native. The base must have been
# built from the same native sources, or a bundle names a native module the
# app or the extension lacks and it dies at launch or draws blanks. The
# extension and then the copy are signed ad hoc again, each keeping the
# base's entitlements, since the App Group and the Keychain groups are read
# from them.
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

# Note that a base built before the extension drew with React Native has no bundle of its own to replace, and keeps its extension as it is.
share_extension="$output/PlugIns/ShareExtension.appex"
if [[ -f "$share_extension/share.jsbundle" ]]; then
    pnpm exec expo export:embed --entry-file share.ts --platform ios --dev false --bytecode \
        --bundle-output "$share_extension/share.jsbundle" --assets-dest "$share_extension" >&2
    codesign --force --sign - --preserve-metadata=entitlements,identifier,flags "$share_extension" >&2
fi

codesign --force --sign - --preserve-metadata=entitlements,identifier,flags "$output" >&2

echo "$output"
