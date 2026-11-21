#!/usr/bin/env bash
# row2-lifecycle.sh -- row 2: create with a persistent disk, start, runner, stop, warm start, delete.

ROW=row2
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts

# Warm the image cache once, so the create below is "with the image cached".
smol machine create --name warm --net --image "$IMAGE" -- sleep infinity > /dev/null
timed seed_first_start smol machine start --name warm
smol machine stop --name warm > /dev/null
smol machine delete --name warm --force > /dev/null

t0=$(now_ms)
timed create smol machine create --name life --net --image "$IMAGE" -- sleep infinity
timed first_start smol machine start --name life
probe=$(runner_probe life)
record first_runner_exit "$probe"
record first_create_to_runner_ms $(($(now_ms) - t0))
check first_create_under_30s $([ $(($(now_ms) - t0)) -lt 30000 ] && echo 0 || echo 1)

ready_script > /tmp/ready.sh
timed ready_script smol machine exec --name life -u root -- bash -c "$(cat /tmp/ready.sh)"
record agent_user "$(smol machine exec --name life -- id agent 2>&1)"
smol machine exec --name life -- sh -c 'echo persisted-$(date +%s) > /vercel/marker && sync'
smol machine exec --name life -u root -- sh -c 'mkdir -p /workspace/checkout && echo disk > /workspace/checkout/f && sync'
marker=$(smol machine exec --name life -- cat /vercel/marker)
record guest_df_root "$(smol machine exec --name life -- df -h / 2>&1 | tail -1 | tr -s ' ')"
record guest_mem "$(smol machine exec --name life -- free -m 2>&1 | awk '/^Mem:/{print $2"/"$3}')"

# Five warm starts: stop, start, runner ready.
for i in 1 2 3 4 5; do
  timed stop_$i smol machine stop --name life > /dev/null
  t1=$(now_ms)
  smol machine start --name life > /dev/null
  t2=$(now_ms)
  p=$(runner_probe life)
  t3=$(now_ms)
  record warm_start_$i"_ms" $((t2 - t1))
  record warm_start_to_runner_$i"_ms" $((t3 - t1))
  record warm_runner_exit_$i "$p"
done
best=$(grep '^warm_start_to_runner_[0-9]_ms=' "$RESULTS_DIR/$ROW.txt" | cut -d= -f2 | sort -n | head -1)
median=$(grep '^warm_start_to_runner_[0-9]_ms=' "$RESULTS_DIR/$ROW.txt" | cut -d= -f2 | sort -n | sed -n 3p)
record warm_to_runner_median_ms "$median"
check warm_start_to_runner_under_2s $([ "$median" -lt 2000 ] && echo 0 || echo 1)

after=$(smol machine exec --name life -- cat /vercel/marker)
check disk_survives_restart $([ "$after" = "$marker" ] && echo 0 || echo 1)
check agent_user_survives $(smol machine exec --name life -- id agent > /dev/null 2>&1; echo $?)
check workspace_survives $([ "$(smol machine exec --name life -- cat /workspace/checkout/f 2>&1)" = disk ] && echo 0 || echo 1)
record data_dir_du_mb "$(du -sm "$(smol machine data-dir --name life)" 2> /dev/null | cut -f1)"
record data_dir_apparent_mb "$(du -sm --apparent-size "$(smol machine data-dir --name life)" 2> /dev/null | cut -f1)"

# The runner path the plan wants: the host's runner bundle copied in (smolvm machine cp) then run.
if [ -f "${RUNNER_BUNDLE:-}" ]; then
  timed cp_bundle smol machine cp "$RUNNER_BUNDLE" life:/tmp/agent-runner.mjs
  record copied_runner_exit "$(smol machine exec --name life -- sh -c 'node /tmp/agent-runner.mjs < /dev/null > /dev/null 2>&1; echo $?')"
fi
smol machine stop --name life > /dev/null
timed delete smol machine delete --name life --force
check deleted $(smol machine ls --json | jq -e 'map(select(.name=="life")) | length == 0' > /dev/null; echo $?)
