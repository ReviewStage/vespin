#!/usr/bin/env bash
# glitch-sweep.sh -- records each glitch-sweep journey (maestro/rig/glitch/) as a screen video on one simulator, with the clock it started on and Maestro's per-command timings, for a frame-by-frame read (STAG-5012). A probe, not a test: nothing is asserted.
#
# Usage: scripts/glitch-sweep.sh [--busy] [--gap <s>] <simulator udid> <output directory> [journey ...]
#
# The app must already be installed on the booted simulator. Each journey
# (j01 … j10 unless named) writes, under <output>/<journey>/:
#   raw.mp4        the simulator's own recording (variable frame rate);
#   cfr60.mp4      the same at a constant 60 fps, half size, for frame reads;
#   started-ms     the epoch milliseconds the recording started at;
#   debug/         Maestro's --debug-output (commands-*.json carry each step's start);
#   maestro.log    Maestro's console.
# --busy adds the busy-account lane: busy-account.sh's seeded launch, busy-a.yaml
# driving it, Home for --gap seconds (420 unless named), the app brought
# forward, and busy-b.yaml, all in one recording under <output>/busy/.
set -uo pipefail

APP_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
FLOWS="$APP_DIRECTORY/maestro/rig/glitch"
BUNDLE_ID=dev.vespin.ios
USAGE="usage: $0 [--busy] [--gap <s>] <simulator udid> <output directory> [journey ...]"

busy=0
gap=420
while (($# > 0)); do
    case "$1" in
    --busy) busy=1; shift ;;
    --gap) gap=$2; shift 2 ;;
    --) shift; break ;;
    -*) echo "$USAGE" >&2; exit 2 ;;
    *) break ;;
    esac
done
(($# >= 2)) || { echo "$USAGE" >&2; exit 2; }
udid=$1
output=$2
shift 2
journeys=("$@")
if ((${#journeys[@]} == 0)); then
    journeys=(j01-launch-inbox j02-thread-answer j03-manager-chat j04-tasks-task j05-agent j06-search j07-new-task j08-double-tap j09-background j10-long-transcript)
fi
mkdir -p "$output"

now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }

# Starts the simulator's recorder into $1/raw.mp4 and writes the epoch ms it began at; leaves its pid in $recorder.
start_recording() {
    local directory=$1
    rm -f "$directory/raw.mp4" "$directory/recorder.log"
    xcrun simctl io "$udid" recordVideo --codec=h264 --force "$directory/raw.mp4" >"$directory/recorder.log" 2>&1 &
    recorder=$!
    # Note that the recorder says it started only once its first frame is taken, so the clock is read then rather than at the spawn.
    for _ in $(seq 1 100); do
        grep -q "Recording started" "$directory/recorder.log" 2>/dev/null && break
        sleep 0.05
    done
    now_ms >"$directory/started-ms"
}

stop_recording() {
    local directory=$1
    sleep 1
    kill -INT "$recorder" 2>/dev/null
    wait "$recorder" 2>/dev/null
    ffmpeg -loglevel error -y -i "$directory/raw.mp4" -vf "fps=60,scale=iw/2:-2" -c:v libx264 -crf 20 -pix_fmt yuv420p "$directory/cfr60.mp4" ||
        echo "warning: $directory/cfr60.mp4 was not written" >&2
}

for journey in "${journeys[@]}"; do
    directory="$output/$journey"
    mkdir -p "$directory"
    echo "recording $journey"
    start_recording "$directory"
    maestro --udid "$udid" test --debug-output "$directory/debug" "$FLOWS/$journey.yaml" >"$directory/maestro.log" 2>&1
    echo "$journey: maestro exit $?" | tee "$directory/exit"
    stop_recording "$directory"
done

if ((busy)); then
    directory="$output/busy"
    mkdir -p "$directory"
    echo "recording the busy-account lane (gap ${gap}s)"
    rm -f "$directory/rig/launched-at"
    start_recording "$directory"
    "$APP_DIRECTORY/scripts/busy-account.sh" --seconds $((gap + 150)) "$udid" "$directory/rig" >"$directory/rig.log" 2>&1 &
    rig=$!
    for _ in $(seq 1 600); do
        [[ -f "$directory/rig/launched-at" ]] && break
        sleep 0.5
    done
    now_ms >"$directory/launched-ms"
    maestro --udid "$udid" test --debug-output "$directory/debug-a" "$FLOWS/busy-a.yaml" >"$directory/maestro-a.log" 2>&1
    echo "busy-a: maestro exit $?" | tee "$directory/exit"
    now_ms >"$directory/home-ms"
    sleep "$gap"
    # Note that the app is brought forward, never relaunched: a process iOS kept answers as a phone's would, and one it ended is the rig's to report (pid below).
    xcrun simctl spawn "$udid" launchctl list 2>/dev/null | grep -q "$BUNDLE_ID" && echo "alive" >"$directory/alive-at-return" || echo "ended" >"$directory/alive-at-return"
    now_ms >"$directory/return-ms"
    xcrun simctl launch "$udid" "$BUNDLE_ID" -authServer stub -busyAccount true >"$directory/return.log" 2>&1
    maestro --udid "$udid" test --debug-output "$directory/debug-b" "$FLOWS/busy-b.yaml" >"$directory/maestro-b.log" 2>&1
    echo "busy-b: maestro exit $?" | tee -a "$directory/exit"
    stop_recording "$directory"
    wait "$rig"
    echo "busy rig exit $?" >>"$directory/exit"
fi
echo "done: $output"
