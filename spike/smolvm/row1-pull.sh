#!/usr/bin/env bash
# row1-pull.sh -- row 1's pull half: how long smolvm takes to pull the agent image the first time, and what it holds on disk.

ROW=row1
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts

timed pull_create smol machine create --name pull --net --image "$IMAGE" -- sleep infinity
# The first start fetches the layers; it is the "first pull" a box pays.
timed pull_first_start smol machine start --name pull
check first_pull_under_5min $([ "$(grep '^pull_first_start_ms=' "$RESULTS_DIR/$ROW.txt" | tail -1 | cut -d= -f2)" -lt 300000 ] && echo 0 || echo 1)
record pull.image_cache_du_mb "$(du -sm "$XDG_CACHE_HOME/smolvm" 2> /dev/null | cut -f1)"
smol machine images 2>&1 | sed 's/^/# images: /' | tee -a "$RESULTS_DIR/$ROW.txt"
record pull.runner_probe "$(runner_probe pull)"
record pull.guest_arch "$(smol machine exec --name pull -- uname -m 2>&1)"
smol machine stop --name pull
smol machine delete --name pull --force
# A second machine from the cached image: no pull.
timed cached_create smol machine create --name pull2 --net --image "$IMAGE" -- sleep infinity
timed cached_first_start smol machine start --name pull2
smol machine stop --name pull2
smol machine delete --name pull2 --force
