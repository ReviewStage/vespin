#!/usr/bin/env bash
# working-manager.sh -- one run of the installed app on a simulator with the fixture's release Manager at work, its turn streaming at a live rate, and what its page cost the JS thread over a minute: the long tasks, the page's and its composer's draws, and the document's changes (`src/rig-agent-load.ts`).
#
# Usage: scripts/working-manager.sh [--stream-ms <ms>] [--type] [--trace] <simulator udid> <output directory>
#
# The app must already be installed on the booted simulator, built from the
# same commit as this tree. The run:
#   1. launches it on the Inbox fixture, opened on the release Manager's
#      chat, with `-streamTurn <ms>` (150 unless named: the service answers
#      a turn's follow in bursts about 100 ms apart, and the host polls again
#      100 ms after each, so a phone hears some 5 to 10 changes a second),
#      through maestro/rig/working-manager.yaml, which with --type also types
#      a sentence into the composer key by key while the turn streams;
#   2. with --trace, records Instruments' Time Profiler on every thread from
#      the flow's end until the window's;
#   3. waits for the page's measure, written once its window from the page's
#      first draw ends, and copies it to the output directory.
set -euo pipefail

APP_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
USAGE="usage: $0 [--stream-ms <ms>] [--type] [--trace] <simulator udid> <output directory>"
BUNDLE_ID=dev.vespin.ios
# How long the measure may take to stand after the flow: the page's window (`WINDOW_MS`) with room for a slow launch.
MEASURE_WAIT_SECONDS=150

stream_ms=150
typed=false
trace=0
while (($# > 0)); do
    case "$1" in
    --stream-ms) stream_ms=$2; shift 2 ;;
    --type) typed=true; shift ;;
    --trace) trace=1; shift ;;
    --) shift; break ;;
    -*) echo "$USAGE" >&2; exit 2 ;;
    *) break ;;
    esac
done
if (($# != 2)); then
    echo "$USAGE" >&2
    exit 2
fi
udid=$1
output=$2
mkdir -p "$output"
# Note that an earlier run's measure and trace are let go first, so a run that writes none never leaves an older one standing as its own.
rm -f "$output/agent-load.json" "$output/xctrace.log"
rm -rf "$output/working.trace"

echo "opening the working Manager, a change every ${stream_ms} ms, typing: ${typed}"
maestro --udid "$udid" test -e STREAM_MS="$stream_ms" -e TYPE="$typed" \
    "$APP_DIRECTORY/maestro/rig/working-manager.yaml" >"$output/flow.log" 2>&1 || {
    echo "error: the flow failed; see $output/flow.log" >&2
    exit 1
}

measure="$(xcrun simctl get_app_container "$udid" "$BUNDLE_ID" data)/Documents/host/rig/agent-load.json"
recorder=
if ((trace)); then
    pid=$(xcrun simctl spawn "$udid" launchctl list | awk -v id="$BUNDLE_ID" '$3 ~ id { print $1; exit }')
    xcrun xctrace record --template 'Time Profiler' --device "$udid" --attach "$pid" \
        --time-limit 60s --output "$output/working.trace" >"$output/xctrace.log" 2>&1 &
    recorder=$!
fi

waited=0
until [[ -f "$measure" ]]; do
    if ((waited >= MEASURE_WAIT_SECONDS)); then
        echo "error: the page wrote no measure in ${MEASURE_WAIT_SECONDS}s; was it left, or the app sent to the background?" >&2
        exit 1
    fi
    sleep 1
    waited=$((waited + 1))
done
if [[ -n "$recorder" ]] && ! wait "$recorder"; then
    echo "warning: the Time Profiler recording failed; see $output/xctrace.log" >&2
fi
cp "$measure" "$output/agent-load.json"
echo "agent-load $(cat "$output/agent-load.json")"
