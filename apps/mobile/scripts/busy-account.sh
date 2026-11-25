#!/usr/bin/env bash
# busy-account.sh -- one cold launch of the installed app on a simulator as a busy account after a gap, and what its first minutes held: the launch's own `launch:load` rungs, and an Instruments trace where asked.
#
# Usage: scripts/busy-account.sh [--scale <n>] [--seconds <s>] [--trace] <simulator udid> <output directory>
#
# The app must already be installed on the booted simulator, built from the
# same commit as this tree, since the seed's local copy is written through
# this tree's host and opens only under the schema it wrote
# (`tools/busy-account/seed.ts`). The run:
#   1. seeds the busy account at --scale (1 unless named): the local copy,
#      and the answers the stub serves under `-busyAccount true`;
#   2. signs the stub's account in once from a clean install
#      (maestro/rig/busy-account-sign-in.yaml), and stops the app;
#   3. lays the seed over the signed-in account's folder under the app's
#      Documents/host/, as a phone that was away keeps it;
#   4. launches the app cold with `-authServer stub -busyAccount true`, and
#      with --trace records Instruments' Time Profiler on every thread for
#      the window, attached to the app's process;
#   5. waits out the window, --seconds (190 unless named), and copies the
#      launch's `launch:load` rungs (`src/launch-load.ts`) and the trace to
#      the output directory.
# Input during the window (scrolls, taps) is the caller's to drive, with
# Maestro or by hand, so the same launch can be watched as a person meets it.
set -euo pipefail

APP_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
REPOSITORY=$(CDPATH= cd -- "$APP_DIRECTORY/../.." && pwd)
USAGE="usage: $0 [--scale <n>] [--seconds <s>] [--trace] <simulator udid> <output directory>"
BUNDLE_ID=dev.vespin.ios
# The stub's account, whose folder the host opens once the stub signs it in (`src/host/stub-auth-server.ts`'s `STUB_ACCOUNT.sub`).
ACCOUNT=stub-account

scale=1
seconds=190
trace=0
while (($# > 0)); do
    case "$1" in
    --scale) scale=$2; shift 2 ;;
    --seconds) seconds=$2; shift 2 ;;
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
seed=$(mktemp -d)
trap 'rm -rf "$seed"' EXIT

echo "seeding a busy account at ${scale}x"
pnpm --dir "$REPOSITORY" --filter @repo/busy-account seed --out "$seed" --scale "$scale"

echo "signing the stub's account in"
maestro --udid "$udid" test "$APP_DIRECTORY/maestro/rig/busy-account-sign-in.yaml" >"$output/sign-in.log" 2>&1 || {
    echo "error: the sign-in flow failed; see $output/sign-in.log" >&2
    exit 1
}
xcrun simctl terminate "$udid" "$BUNDLE_ID" 2>/dev/null || true

# Note that the seed is laid over the folders the signed-in launch made, so the next launch reads the account's tokens as it kept them and the seeded rows beside them.
host="$(xcrun simctl get_app_container "$udid" "$BUNDLE_ID" data)/Documents/host"
rm -rf "$host/accounts/$ACCOUNT" "$host/busy-account"
mkdir -p "$host/accounts"
cp -R "$seed/accounts/$ACCOUNT" "$host/accounts/$ACCOUNT"
cp -R "$seed/busy-account" "$host/busy-account"

echo "launching cold as the busy account for ${seconds}s"
launched=$(xcrun simctl launch "$udid" "$BUNDLE_ID" -authServer stub -busyAccount true)
pid=${launched##*: }
date +%s >"$output/launched-at"
if ((trace)); then
    xcrun xctrace record --template 'Time Profiler' --device "$udid" --attach "$pid" \
        --time-limit "${seconds}s" --output "$output/launch.trace" >"$output/xctrace.log" 2>&1 &
fi
sleep "$seconds"
wait || true

if [[ -f "$host/busy-account/launch-load.json" ]]; then
    cp "$host/busy-account/launch-load.json" "$output/launch-load.json"
    echo "launch:load $(cat "$output/launch-load.json")"
else
    echo "warning: the launch wrote no launch:load; was it sent to the background, or begun there?" >&2
fi
