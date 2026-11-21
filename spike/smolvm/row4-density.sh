#!/usr/bin/env bash
# row4-density.sh -- row 4: RAM that N agent VMs commit idle, under pnpm install each, and after (the balloon).
#
# usage: row4-density.sh <N> [mem-mib | host-default]
# Default: N=4 runs at smolvm's own default memory (half the host's RAM, at most 8 GiB, per VM), the
# case that lost its runner; 8 and 16 run at 4096 MiB each.
# The first run (default memory, half the host's RAM, 8 GiB, per VM) lost its runner a minute into
# the installs at every N; each VM now gets MEM, and a guard stops every VM before the host runs out.
# Each VM clones vespin from the box's mirror (mounted read-only) onto its own disk and runs
# `pnpm install --frozen-lockfile --filter @repo/agent-runner...` (the runner's slice of the
# workspace: a real install that fits 16 disks on a runner), all at once.

N=${1:-4}
MEM=${2:-$([ "$N" = 4 ] && echo host-default || echo 4096)}
ROW=row4-n$N
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts
record mem_per_vm "$MEM"

mirror=$SPIKE_ROOT/mirror/vespin.git
[ -d "$mirror" ] || git clone --mirror -q "${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-ReviewStage/vespin}.git" "$mirror"
mem_flags=()
[ "$MEM" != host-default ] && mem_flags=(--mem "$MEM")

base_used=$(host_used_mb)
record base.host_used_mb "$base_used"
# Seed the image cache with one start so the N starts measure VMs, not the pull.
smol machine create --name seed "${NET_FLAGS[@]}" --image "$IMAGE" -- sleep infinity > /dev/null
smol machine start --name seed > /dev/null
smol machine stop --name seed > /dev/null
smol machine delete --name seed --force > /dev/null
base_used=$(host_used_mb)
record base_after_seed.host_used_mb "$base_used"

t0=$(now_ms)
for i in $(seq 1 "$N"); do
  smol machine create --name "d$i" "${NET_FLAGS[@]}" "${mem_flags[@]}" -v "$SPIKE_ROOT/mirror:/mirror:ro" --image "$IMAGE" -- sleep infinity > /dev/null
  smol machine start --name "d$i" > /dev/null || record "start_fail.d$i" 1
done
record start_all_ms $(($(now_ms) - t0))
record vmm_count "$(vmm_count)"
sleep 60
idle_used=$(host_used_mb)
idle_pss=$(vmm_pss_mb)
record idle.host_used_mb "$idle_used"
record idle.vmm_pss_total_mb "$idle_pss"
record idle.per_vm_host_delta_mb $(((idle_used - base_used) / N))
record idle.per_vm_pss_mb $((idle_pss / N))
record idle.guest_used_mb_d1 "$(smol machine exec --name d1 -- free -m | awk '/^Mem:/{print $3}')"
record idle.stats_d1 "$(stats_line d1)"
check idle_under_300mb_each $([ $((idle_pss / N)) -lt 300 ] && echo 0 || echo 1)

ps -eo pid,ppid,rss,comm,args --sort=-rss | head -8 | cut -c1-160 | sed 's/^/# ps: /' | tee -a "$RESULTS_DIR/$ROW.txt"
# Sample host memory every 2 s while every VM installs, into the job log too (a lost runner keeps
# no artifact); below 600 MiB available, stop every VM so the runner and its results survive.
( while :; do
    line="$(now_ms) $(host_used_mb) $(vmm_pss_mb) $(free -m | awk '/^Swap:/{print $3}') $(host_avail_mb)"
    echo "$line" >> "$RESULTS_DIR/$ROW.samples"
    echo "# sample $line"
    if [ "$(host_avail_mb)" -lt 600 ]; then
      echo "guard.host_exhausted_at_ms=$(now_ms)" | tee -a "$RESULTS_DIR/$ROW.txt"
      for i in $(seq 1 "$N"); do smol machine stop --name "d$i" > /dev/null 2>&1 & done
      wait
      break
    fi
    sleep 2
  done ) &
sampler=$!
t0=$(now_ms)
for i in $(seq 1 "$N"); do
  smol machine exec --name "d$i" -- bash -c '
    set -e
    t0=$(date +%s%3N)
    git clone -q /mirror/vespin.git /vercel/vespin
    cd /vercel/vespin
    export ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=1 HUSKY=0
    pnpm install --frozen-lockfile --filter "@repo/agent-runner..." --reporter=silent > /tmp/install.log 2>&1 || { tail -5 /tmp/install.log; exit 1; }
    echo "ms=$(( $(date +%s%3N) - t0 )) nm_mb=$(du -sm node_modules | cut -f1)"
  ' > "$SPIKE_ROOT/install-d$i.out" 2>&1 &
done
wait_fail=0
for job in $(jobs -p); do [ "$job" = "$sampler" ] && continue; wait "$job" || wait_fail=$((wait_fail + 1)); done
record install_all_ms $(($(now_ms) - t0))
record install_failures "$wait_fail"
for i in $(seq 1 "$N"); do record "install.d$i" "$(tail -1 "$SPIKE_ROOT/install-d$i.out" | tr '\n' ' ')"; done
record install.min_avail_mb "$(awk 'BEGIN{m=1e9}{if($5<m)m=$5}END{print m}' "$RESULTS_DIR/$ROW.samples")"
peak=$(awk 'BEGIN{m=0}{if($2>m)m=$2}END{print m}' "$RESULTS_DIR/$ROW.samples")
peak_pss=$(awk 'BEGIN{m=0}{if($3>m)m=$3}END{print m}' "$RESULTS_DIR/$ROW.samples")
record install.peak_host_used_mb "$peak"
record install.peak_vmm_pss_mb "$peak_pss"
record install.peak_per_vm_mb $(((peak - base_used) / N))
record install.peak_swap_mb "$(awk 'BEGIN{m=0}{if($4>m)m=$4}END{print m}' "$RESULTS_DIR/$ROW.samples")"
record install.oom_kills "$(sudo dmesg 2> /dev/null | grep -ci 'out of memory' || true)"

# The balloon: after the installs, idle for 2 minutes, then ask the guests to drop their caches.
sleep 120
record after_120s.host_used_mb "$(host_used_mb)"
record after_120s.vmm_pss_mb "$(vmm_pss_mb)"
for i in $(seq 1 "$N"); do smol machine exec --name "d$i" -u root -- sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches' > /dev/null 2>&1; done
sleep 60
after_drop=$(host_used_mb)
after_drop_pss=$(vmm_pss_mb)
kill "$sampler" 2> /dev/null
record after_drop.host_used_mb "$after_drop"
record after_drop.vmm_pss_mb "$after_drop_pss"
record after_drop.per_vm_mb $(((after_drop - base_used) / N))
check balloon_returns_memory $([ "$after_drop_pss" -lt "$peak_pss" ] && [ $((peak_pss - after_drop_pss)) -gt $((N * 100)) ] && echo 0 || echo 1)
record disk.cache_du_mb "$(du -sm "$XDG_CACHE_HOME/smolvm" | cut -f1)"
for i in $(seq 1 "$N"); do smol machine stop --name "d$i" > /dev/null 2>&1; smol machine delete --name "d$i" --force > /dev/null 2>&1; done
