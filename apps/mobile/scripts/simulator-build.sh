#!/usr/bin/env bash
# simulator-build.sh -- generate the native project and build the app for the simulator, naming the .app it built on its last line.
#
# Usage: scripts/simulator-build.sh [<derived data directory>]
#
# Expo generates `ios/` from app.config.ts (nothing under it is committed) and
# installs its pods, then Xcode builds a Release app for the simulator, with
# the JavaScript bundle embedded so no Metro server has to run beside it,
# signed to run locally: an ad-hoc signature, which needs no team or
# certificate, under which Xcode writes the simulator's own entitlements into
# the app, so it reaches the Keychain the sign-in seals its tokens with; an
# unsigned app is refused the Keychain. The
# derived data lands under `ios/build` unless a directory is named, as CI
# names its runner's temporary one. Delete `ios/` once the app is no longer
# needed: the pods and the build together take several gigabytes.
set -euo pipefail

APP_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
derived_data=${1:-$APP_DIRECTORY/ios/build}

# CocoaPods refuses a shell whose locale is not UTF-8, as an agent's is.
if [[ "${LANG:-}" != *UTF-8* ]]; then
    export LANG=en_US.UTF-8
fi
export EXPO_NO_TELEMETRY=1

cd "$APP_DIRECTORY"
pnpm exec expo prebuild --platform ios

beautify=(cat)
if command -v xcbeautify >/dev/null 2>&1; then
    beautify=(xcbeautify --quiet)
fi
xcodebuild \
    -workspace ios/Vespin.xcworkspace \
    -scheme Vespin \
    -configuration Release \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$derived_data" \
    CODE_SIGNING_ALLOWED=YES \
    CODE_SIGN_IDENTITY=- \
    build | "${beautify[@]}"

echo "$derived_data/Build/Products/Release-iphonesimulator/Vespin.app"
