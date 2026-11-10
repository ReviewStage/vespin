#!/usr/bin/env bash
# simulator-screenshots.sh -- install a simulator build on each named simulator and run the Maestro flows on it, keeping their screenshots.
#
# Usage: scripts/simulator-screenshots.sh <path to Vespin.app> <output directory> <simulator name>...
#
# Each simulator is booted, handed the app, driven through every flow under
# maestro/ and the notification flow under maestro/notification/, and shut
# down again, so the Mac holds no booted simulator once
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

# Boots the simulator `$1` and hands it the app.
prepare_simulator() {
    xcrun simctl bootstatus "$1" -b
    xcrun simctl install "$1" "$app"
}

# Sets the simulator `$1`'s appearance to `$2`. Note that the simulator's own
# appearance is set, because Maestro's `setDarkMode` leaves an iOS simulator
# light.
set_appearance() {
    xcrun simctl ui "$1" appearance "$2"
}

# Shuts the simulator `$1` down, erases it to a freshly made device, boots it
# with the app again, and sets its appearance back to `$2`. Note that a retry
# starts here, because Maestro's XCUITest driver that failed to start on a
# simulator (`IOSDriverTimeoutException`) failed the same way on a second try
# over the state the first left, which an erase clears.
erase_simulator() {
    xcrun simctl shutdown "$1" 2>/dev/null || true
    xcrun simctl erase "$1"
    prepare_simulator "$1"
    set_appearance "$1" "$2"
}

# Runs the Maestro flow or flows at `$3` on the simulator `$1`, its output
# under `$2`. Maestro's own debug output, the screenshot it takes when a step
# fails among it, lands beside the flow's screenshots, so a failure can be
# read.
run_maestro() {
    maestro --udid "$1" test \
        --test-output-dir "$2" \
        --debug-output "$2/debug" \
        --flatten-debug-output \
        "$3"
}

# Runs the notification flow on the booted simulator `$1`, its output under
# `$2`: Maestro cannot send a push, so the app is sent to the background,
# `ask.apns` pushed to it, and the notification tapped.
run_notification_flow() {
    local notification="$APP_DIRECTORY/maestro/notification"
    run_maestro "$1" "$2" "$notification/background.yaml" || return 1
    xcrun simctl push "$1" "$bundle_id" "$notification/ask.apns" || return 1
    run_maestro "$1" "$2" "$notification/open.yaml"
}

# Runs every flow under maestro/ once on the booted simulator `$1`, from a
# clean app, its output under `$2`, which a run before it is cleared from,
# then the notification flow, and fails where either failed. Note that the
# notification flow runs whatever the others did, so its screenshots are
# kept even where another flow fails, and that each step returns its own
# failure, since `set -e` stands aside inside the `until` that calls this.
run_flows() {
    rm -rf "$2"
    xcrun simctl terminate "$1" "$bundle_id" 2>/dev/null || true
    local failed=0
    run_maestro "$1" "$2" "$APP_DIRECTORY/maestro" || failed=1
    run_notification_flow "$1" "$2/notification" || failed=1
    return "$failed"
}

failed=0
for name in "$@"; do
    slug=$(printf '%s' "$name" | tr '[:upper:] ' '[:lower:]-')
    udid=$(simulator_udid "$name")
    device_output="$output/$slug"
    mkdir -p "$device_output"
    echo "==> $name ($udid)"
    prepare_simulator "$udid"
    # Every flow runs once in each appearance, so the brand's light and dark
    # colors are both seen.
    for appearance in "${APPEARANCES[@]}"; do
        set_appearance "$udid" "$appearance"
        appearance_output="$device_output/$appearance"
        # Note that a device's flows run again once where they fail, on the
        # simulator erased and prepared afresh, because a slow boot, a system
        # prompt that lands late, or a driver that never started fails a run
        # that a second one passes, and costs nothing like a whole job's rerun.
        attempt=1
        until run_flows "$udid" "$appearance_output"; do
            if ((attempt == FLOW_ATTEMPTS)); then
                echo "error: the flows failed on $name in $appearance; its output is under $appearance_output" >&2
                failed=1
                break
            fi
            attempt=$((attempt + 1))
            echo "the flows failed on $name in $appearance; erasing the simulator ($udid) and booting it again, so a driver or app state the failed try left cannot fail the next" >&2
            erase_simulator "$udid" "$appearance"
            echo "running the flows on $name in $appearance again, on the erased simulator ($attempt of $FLOW_ATTEMPTS)" >&2
        done
    done
    xcrun simctl shutdown "$udid"
    udid=""
done
exit "$failed"
