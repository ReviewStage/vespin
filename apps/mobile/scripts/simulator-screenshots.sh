#!/usr/bin/env bash
# simulator-screenshots.sh -- install a simulator build on each named simulator and run the Maestro flows on it, keeping their screenshots.
#
# Usage: scripts/simulator-screenshots.sh [--flows <name>,...] <path to Vespin.app> <output directory> <simulator name>...
#
# Each simulator is booted, handed the app, driven through the flows, and
# shut down again, so the Mac holds no booted simulator once the run ends.
# The flows are every one under maestro/, the Spotlight flow under
# maestro/spotlight/, and the notification flow under maestro/notification/,
# or with --flows only those named, each as its file under maestro/ is named
# without `.yaml` (`inbox`, `tasks`), the Spotlight flow as `spotlight`, and
# the notification flow as `notification`. Every flow runs once in the light
# appearance and once in the dark, and a device's screenshots land under
# <output>/<device slug>/<appearance>/debug/<flow>/takeScreenshot/.
# The simulator is named as `xcrun simctl list devices` names it, such as
# "iPhone 18 Pro" or "iPhone Duo"; the first available device of that name
# is used, and where none exists one is created from the device type of that
# name on the newest runtime that runs it, as CI's fresh runner needs.
set -euo pipefail

APP_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
USAGE="usage: $0 [--flows <name>,...] <path to Vespin.app> <output directory> <simulator name>..."

# The flows under test, as their files under maestro/ are named, and whether
# the Spotlight and notification flows are among them: every flow where
# --flows names none.
all_flows=1
flows=()
spotlight=1
notification=1
if [[ "${1:-}" == "--flows" ]]; then
    (($# >= 2)) || {
        echo "$USAGE" >&2
        exit 2
    }
    all_flows=0
    spotlight=0
    notification=0
    while IFS= read -r name; do
        if [[ -z "$name" ]]; then
            continue
        elif [[ "$name" == "spotlight" ]]; then
            spotlight=1
        elif [[ "$name" == "notification" ]]; then
            notification=1
        elif [[ -f "$APP_DIRECTORY/maestro/$name.yaml" ]]; then
            flows+=("$name.yaml")
        else
            echo "error: no flow named \"$name\" under maestro/" >&2
            exit 2
        fi
    done < <(printf '%s\n' "$2" | tr ',' '\n' | sed 's/^ *//; s/ *$//')
    if ((${#flows[@]} == 0 && spotlight == 0 && notification == 0)); then
        echo "error: --flows named no flow" >&2
        exit 2
    fi
    shift 2
fi
if (($# < 3)); then
    echo "$USAGE" >&2
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

# Prints `true` where the simulator of udid `$1` is an iPad, by its device
# type rather than its name, which a person may have chosen, else `false`.
simulator_is_ipad() {
    xcrun simctl list devices --json |
        node -e '
          const udid = process.argv[1];
          const { devices } = JSON.parse(require("fs").readFileSync(0, "utf8"));
          const found = Object.values(devices).flat().find((device) => device.udid === udid);
          process.stdout.write(String(/\.iPad/.test(found?.deviceTypeIdentifier ?? "")));
        ' "$1"
}

# The simulator under test is shut down however the run ends, a failed boot
# or install included, so no simulator is left running on a shared Mac.
udid=""
trap '[[ -n "$udid" ]] && xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true' EXIT

# The appearances every flow is shot in, as `xcrun simctl ui` names them.
APPEARANCES=(light dark)

# Maestro starts its XCUITest driver on the simulator and waits this long, in
# milliseconds, for it to answer; a loaded CI runner's first boot has taken
# longer than Maestro's own default, and a start in the middle of a run longer
# than three minutes, either of which then fails every flow unread. Note
# that each `maestro test` starts the driver afresh, and that the "Failed to
# connect" lines its log holds are its polls of the driver's port every half
# second while `xcodebuild` launches it, not failures; a start takes about a
# minute, so this script runs as few `maestro test`s as it can.
export MAESTRO_DRIVER_STARTUP_TIMEOUT=360000

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

# Lets the app notify on the simulator `$1`. Note that Maestro's
# `permissions: notifications: allow` sets nothing: Maestro 2.12.1 leaves
# notifications out of what it hands its pinned applesimutils, so `simctl
# push` is refused ("Source is not authorized"). Its applesimutils, or one on
# the path, is called here instead.
allow_notifications() {
    local applesimutils="$HOME/.maestro/deps/applesimutils"
    [[ -x "$applesimutils" ]] || applesimutils=$(command -v applesimutils) || {
        echo "error: no applesimutils to let the app notify; Maestro's install keeps one under ~/.maestro/deps" >&2
        return 1
    }
    "$applesimutils" --byId "$1" --bundle "$bundle_id" --setPermissions notifications=YES
}

# Runs the Maestro flow or flows at `$3` on the simulator `$1`, its output
# under `$2`. Maestro's own debug output, the screenshot it takes when a step
# fails among it, lands beside the flow's screenshots, so a failure can be
# read.
run_maestro() {
    maestro --udid "$1" test \
        --env "FLOATING_TABS=$floating_tabs" \
        --test-output-dir "$2" \
        --debug-output "$2/debug" \
        --flatten-debug-output \
        "$3"
}

# Runs the flows under test on the booted simulator `$1`, its output under
# `$2`. Note that a flow that fails is not run again: a second run passed a
# flow that failed now and then, which hid the cause.
#
# Note that named flows run from the whole of maestro/, through a workspace
# config listing them, rather than as files of their own, because Maestro
# looks for a file a flow names, `new-task.yaml`'s picture among them, only
# under the paths it was handed, and refuses the run where it is not there.
run_suite() {
    local config=()
    if ((!all_flows)); then
        ((${#flows[@]} > 0)) || return 0
        mkdir -p "$2"
        printf 'flows:\n' >"$2/flows.yaml"
        printf '  - %s\n' "${flows[@]}" >>"$2/flows.yaml"
        config=(--config "$2/flows.yaml")
    fi
    maestro --udid "$1" test \
        ${config[@]+"${config[@]}"} \
        --env "FLOATING_TABS=$floating_tabs" \
        --test-output-dir "$2" \
        --debug-output "$2/debug" \
        --flatten-debug-output \
        --format junit --output "$2/report.xml" \
        "$APP_DIRECTORY/maestro"
}

# Runs the Spotlight flow on the booted simulator `$1`, its output under `$2`:
# the app installed afresh, the simulator restarted, and
# `maestro/spotlight/spotlight.yaml` run without clearing the app. Note that
# the restart is what lets the app's Spotlight index be written, because
# until the simulator restarts after an app's install it drops every
# donation the app makes ("Set existence required and no set exists"), and
# that the flow clears nothing, because Maestro's clear reinstalls the app,
# which undoes the restart. It costs a restart and a start of Maestro's
# driver in each appearance.
run_spotlight_flow() {
    xcrun simctl uninstall "$1" "$bundle_id" || true
    xcrun simctl install "$1" "$app" || return 1
    xcrun simctl shutdown "$1" || return 1
    xcrun simctl bootstatus "$1" -b || return 1
    run_maestro "$1" "$2" "$APP_DIRECTORY/maestro/spotlight/spotlight.yaml"
}

# Runs the notification flow on the booted simulator `$1`, its output under
# `$2`: the app installed afresh and let notify, launched and sent to the
# background, `ask.apns` pushed to it, and the notification tapped, since
# Maestro cannot send a push. Note that the app is installed here rather than
# cleared by the flow's `launchApp`, because Maestro's clear reinstalls the
# app, which takes back the permission.
run_notification_flow() {
    local directory="$APP_DIRECTORY/maestro/notification"
    xcrun simctl uninstall "$1" "$bundle_id" || true
    xcrun simctl install "$1" "$app" || return 1
    allow_notifications "$1" || return 1
    run_maestro "$1" "$2" "$directory/background.yaml" || return 1
    xcrun simctl push "$1" "$bundle_id" "$directory/ask.apns" || return 1
    run_maestro "$1" "$2" "$directory/open.yaml"
}

# Runs the flows under test on the booted simulator `$1`, from a clean app,
# their output under `$2`, which a run before it is cleared from, then the
# Spotlight and notification flows where they are under test, and fails
# where any failed. Note that each runs whatever the others did, so its
# screenshots are kept even where another flow fails.
run_flows() {
    rm -rf "$2"
    xcrun simctl terminate "$1" "$bundle_id" 2>/dev/null || true
    local failed=0
    run_suite "$1" "$2" || failed=1
    if ((spotlight)); then
        run_spotlight_flow "$1" "$2/spotlight" || failed=1
    fi
    if ((notification)); then
        run_notification_flow "$1" "$2/notification" || failed=1
    fi
    return "$failed"
}

failed=0
for name in "$@"; do
    slug=$(printf '%s' "$name" | tr '[:upper:] ' '[:lower:]-')
    udid=$(simulator_udid "$name")
    # An iPad's tab bar floats at the window's top and carries no ids, so
    # its flows open a tab by name (`maestro/subflows/tab.yaml`).
    floating_tabs=$(simulator_is_ipad "$udid")
    device_output="$output/$slug"
    mkdir -p "$device_output"
    echo "==> $name ($udid)"
    prepare_simulator "$udid"
    # Every flow runs once in each appearance, so the brand's light and dark
    # colors are both seen.
    for appearance in "${APPEARANCES[@]}"; do
        set_appearance "$udid" "$appearance"
        appearance_output="$device_output/$appearance"
        if ! run_flows "$udid" "$appearance_output"; then
            echo "error: the flows failed on $name in $appearance; its output is under $appearance_output" >&2
            failed=1
        fi
    done
    xcrun simctl shutdown "$udid"
    udid=""
done
exit "$failed"
