#!/usr/bin/env bash
# row9-upgrade.sh -- row 9: VMs made under one smolvm minor, then the next minor takes over.
#
# usage: row9-upgrade.sh <from-version> <to-version>
# One machine stopped and one paused under FROM; then TO starts the stopped one and resumes the
# paused one, or the paused one falls back to a clean start.

FROM=${1:-1.34.4}
TO=${2:-1.35.5}
ROW=row9-$FROM-to-$TO
source "$(dirname "$0")/lib.sh"
SMOLVM_VERSION=$FROM prepare_host
record from "$FROM"
record to "$TO"

for m in up_stopped up_paused; do
  smol machine create --name "$m" --net --image "$IMAGE" -- sleep infinity > /dev/null
  smol machine start --name "$m" > /dev/null
  smol machine exec --name "$m" -- sh -c 'echo kept > /vercel/marker; sync'
done
smol machine exec --name up_paused -- tmux new-session -d -s shell 'i=0; while true; do i=$((i+1)); echo $i > /tmp/counter; sleep 1; done'
sleep 3
smol machine stop --name up_stopped > /dev/null
smol machine pause --name up_paused
record from.pause_rc $?
smol machine ls 2>&1 | sed 's/^/# from ls: /' | tee -a "$RESULTS_DIR/$ROW.txt"

install_smolvm "$TO"
record smolvm.version_now "$("$SMOLVM" --version 2>&1)"
smol machine ls 2>&1 | sed 's/^/# to ls: /' | tee -a "$RESULTS_DIR/$ROW.txt"
timed to_start_stopped smol machine start --name up_stopped
check stopped_disk_survives $([ "$(smol machine exec --name up_stopped -- cat /vercel/marker 2>&1)" = kept ] && echo 0 || echo 1)
record runner_probe_after "$(runner_probe up_stopped)"

t0=$(now_ms)
out=$(smol machine resume --name up_paused 2>&1)
rc=$?
record to_resume_rc "$rc"
record to_resume_ms $(($(now_ms) - t0))
record to_resume_out "$(tail -2 <<< "$out" | tr '\n' ' ' | cut -c1-300)"
if [ "$rc" -eq 0 ]; then
  record resumed_tmux "$(smol machine exec --name up_paused -- tmux ls 2>&1)"
  check paused_resumes_or_falls_back 0
else
  # The fallback: discard the saved execution, keep the disk, start clean.
  record fallback_start "$(smol machine start --name up_paused 2>&1 | tail -1)"
  record fallback_delete_hint "$(smol machine status --name up_paused 2>&1 | tail -1)"
  ok=$([ "$(smol machine exec --name up_paused -- cat /vercel/marker 2>&1)" = kept ] && echo 0 || echo 1)
  record fallback_disk_kept "$ok"
  check paused_resumes_or_falls_back "$ok"
fi
check paused_disk_survives $([ "$(smol machine exec --name up_paused -- cat /vercel/marker 2>&1)" = kept ] && echo 0 || echo 1)
delete_all_machines
