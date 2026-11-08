#!/usr/bin/env bash
# simulator-screenshots.sh -- install a simulator build on each named simulator and run the Maestro flows on it, keeping their screenshots.
#
# Usage: scripts/simulator-screenshots.sh <path to Vespin.app> <output directory> <simulator name>...
#
# Each simulator is booted, handed the app, driven through every flow under
# maestro/, and shut down again, so the Mac holds no booted simulator once
# the run ends. A device's screenshots land under <output>/<device slug>/,
# and those of the flows tagged `appearance`, shot again in dark mode, under
# <output>/<device slug>/dark/.
# The simulator is named as `xcrun simctl list devices` names it, such as
# "iPhone 18 Pro" or "iPhone Duo"; the first available device of that name
# is used, and where none exists one is created from the device type of that
# name on the newest runtime that runs it, as CI's fresh runner needs.
set -euo pipefail

APP_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

if (($# < 3)); then
    echo "usage: $0 <path to Vespin.app> <output directory> <simulator name>..." >&2
    exit 2
fi
app=$1
output=$2
shift 2

# Maestro runs on a Java the Mac may hold only through Homebrew's keg-only
# openjdk, which is on no PATH of its own; CI's runners carry a Java already.
if ! java -version >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
    JAVA_HOME=$(brew --prefix openjdk)
    export JAVA_HOME
    export PATH="$JAVA_HOME/bin:$PATH"
fi
command -v maestro >/dev/null 2>&1 || {
    echo "error: maestro is not installed; see apps/mobile/AGENTS.md" >&2
    exit 1
}

bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")

simulator_udid() {
    local udid
    udid=$(xcrun simctl list devices available --json |
        node -e '
          const name = process.argv[1];
          const { devices } = JSON.parse(require("fs").readFileSync(0, "utf8"));
          const found = Object.values(devices).flat().find((device) => device.name === name);
          process.stdout.write(found ? found.udid : "");
        ' "$1")
    if [[ -z "$udid" ]]; then
        echo "creating a \"$1\" simulator" >&2
        udid=$(xcrun simctl create "$1" "$1") || udid=""
    fi
    if [[ -z "$udid" ]]; then
        echo "error: no \"$1\" simulator exists and none could be created; an installed iOS runtime must support that device type" >&2
        return 1
    fi
    printf '%s' "$udid"
}

# The simulator under test is shut down however the run ends, a failed boot
# or install included, so no simulator is left running on a shared Mac.
udid=""
trap '[[ -n "$udid" ]] && xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true' EXIT

failed=0
for name in "$@"; do
    slug=$(printf '%s' "$name" | tr '[:upper:] ' '[:lower:]-')
    udid=$(simulator_udid "$name")
    device_output="$output/$slug"
    mkdir -p "$device_output"
    echo "==> $name ($udid)"
    xcrun simctl bootstatus "$udid" -b
    xcrun simctl install "$udid" "$app"
    # The flows read a clean app, so a state another run left is cleared first.
    xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
    # Maestro's own debug output, the screenshot it takes when a step fails
    # among it, lands beside the flow's screenshots, so a failure can be read.
    if ! maestro --udid "$udid" test \
        --test-output-dir "$device_output" \
        --debug-output "$device_output/debug" \
        --flatten-debug-output \
        "$APP_DIRECTORY/maestro"; then
        echo "error: the flows failed on $name; its output is under $device_output" >&2
        failed=1
    fi
    # A flow tagged `appearance` is shot again in dark mode, under dark/.
    xcrun simctl ui "$udid" appearance dark
    if ! maestro --udid "$udid" test \
        --include-tags appearance \
        --test-output-dir "$device_output/dark" \
        --flatten-debug-output \
        "$APP_DIRECTORY/maestro"; then
        echo "error: the dark flows failed on $name; its output is under $device_output/dark" >&2
        failed=1
    fi
    xcrun simctl ui "$udid" appearance light
    xcrun simctl shutdown "$udid"
    udid=""
done
exit "$failed"
