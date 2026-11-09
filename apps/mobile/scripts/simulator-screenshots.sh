#!/usr/bin/env bash
# simulator-screenshots.sh -- install a simulator build on each named simulator and run the Maestro flows on it, keeping their screenshots.
#
# Usage: scripts/simulator-screenshots.sh <path to Vespin.app> <output directory> <simulator name>...
#
# Each simulator is booted, handed the app, driven through every flow under
# maestro/, and shut down again, so the Mac holds no booted simulator once
# the run ends. Every flow runs once in the light appearance and once in the
# dark, and a device's screenshots land under
# <output>/<device slug>/<appearance>/debug/<flow>/takeScreenshot/.
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

# The appearances every flow is shot in, as `xcrun simctl ui` names them.
APPEARANCES=(light dark)

# How many times a device's flows run in one appearance before they count as
# failed.
FLOW_ATTEMPTS=2

# Maestro starts its XCUITest driver on the simulator and waits this long, in
# milliseconds, for it to answer; a loaded CI runner's first boot has taken
# longer than Maestro's own default, which then fails every flow unread.
export MAESTRO_DRIVER_STARTUP_TIMEOUT=180000

# Runs every flow under maestro/ once on the booted simulator `$1`, from a
# clean app, its output under `$2`, which a run before it is cleared from.
# Maestro's own debug output, the screenshot it takes when a step fails among
# it, lands beside the flow's screenshots, so a failure can be read.
run_flows() {
    rm -rf "$2"
    xcrun simctl terminate "$1" "$bundle_id" 2>/dev/null || true
    maestro --udid "$1" test \
        --test-output-dir "$2" \
        --debug-output "$2/debug" \
        --flatten-debug-output \
        "$APP_DIRECTORY/maestro"
}

failed=0
for name in "$@"; do
    slug=$(printf '%s' "$name" | tr '[:upper:] ' '[:lower:]-')
    udid=$(simulator_udid "$name")
    device_output="$output/$slug"
    mkdir -p "$device_output"
    echo "==> $name ($udid)"
    xcrun simctl bootstatus "$udid" -b
    xcrun simctl install "$udid" "$app"
    # Every flow runs once in each appearance, so the brand's light and dark
    # colors are both seen. Note that the simulator's own appearance is set
    # here, because Maestro's `setDarkMode` leaves an iOS simulator light.
    for appearance in "${APPEARANCES[@]}"; do
        xcrun simctl ui "$udid" appearance "$appearance"
        appearance_output="$device_output/$appearance"
        # Note that a device's flows run again once where they fail, because
        # a slow boot or a system prompt that lands late fails a run that a
        # second one passes, and costs nothing like a whole job's rerun.
        attempt=1
        until run_flows "$udid" "$appearance_output"; do
            if ((attempt == FLOW_ATTEMPTS)); then
                echo "error: the flows failed on $name in $appearance; its output is under $appearance_output" >&2
                failed=1
                break
            fi
            attempt=$((attempt + 1))
            echo "the flows failed on $name in $appearance; running them again ($attempt of $FLOW_ATTEMPTS)" >&2
        done
    done
    xcrun simctl shutdown "$udid"
    udid=""
done
exit "$failed"
