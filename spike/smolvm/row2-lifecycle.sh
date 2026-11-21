#!/usr/bin/env bash
# row2-lifecycle.sh -- row 2: create with a persistent disk, start, runner, stop, warm start, delete.

ROW=row2
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts

# Warm the image cache once, so the create below is "with the image cached".
smol machine create --name warm "${NET_FLAGS[@]}" --image "$IMAGE" -- sleep infinity > /dev/null
timed seed_first_start smol machine start --name warm
smol machine stop --name warm > /dev/null
smol machine delete --name warm --force > /dev/null

t0=$(now_ms)
timed create smol machine create --name life "${NET_FLAGS[@]}" --image "$IMAGE" -- sleep infinity
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

# Disk per VM: 8 VMs from the cached image, each writing 100 MiB, against what the cache held before.
# Row 4's 16 busy VMs grew the cache to 55 GB (3.4 GB each); this tells the image's share from the VMs' writes.
cache_kb() { du -sk "$XDG_CACHE_HOME/smolvm" | cut -f1; }
cache_app_kb() { du -sk --apparent-size "$XDG_CACHE_HOME/smolvm" | cut -f1; }
before=$(cache_kb)
record disk.cache_before_mb $((before / 1024))
for i in 1 2 3 4 5 6 7 8; do
  smol machine create --name "k$i" "${NET_FLAGS[@]}" --image "$IMAGE" -- sleep infinity > /dev/null
  smol machine start --name "k$i" > /dev/null
done
sync
after_start=$(cache_kb)
record disk.per_vm_after_start_mb $(((after_start - before) / 8 / 1024))
for i in 1 2 3 4 5 6 7 8; do
  smol machine exec --name "k$i" -- sh -c 'head -c 104857600 /dev/urandom > /vercel/blob && sync'
done
sync
after_write=$(cache_kb)
record disk.per_vm_after_100mb_write_mb $(((after_write - before) / 8 / 1024))
record disk.cache_apparent_mb $(($(cache_app_kb) / 1024))
record disk.vm_dirs "$(du -sm "$XDG_CACHE_HOME"/smolvm/vms/* 2> /dev/null | sort -n | awk '{print $1}' | tr '\n' ' ')"
record disk.vm_dir_files "$(ls -la "$(ls -d "$XDG_CACHE_HOME"/smolvm/vms/* | head -1)" | awk '{print $5, $9}' | tr '\n' ';' | cut -c1-400)"
record disk.vm_dir_du_detail "$(du -sm "$(ls -d "$XDG_CACHE_HOME"/smolvm/vms/* | head -1)"/* 2> /dev/null | tr '\t\n' ' ;' | cut -c1-400)"
check disk_near_written $([ $(((after_write - before) / 8 / 1024)) -lt 400 ] && echo 0 || echo 1)
for i in 1 2 3 4 5 6 7 8; do smol machine stop --name "k$i" > /dev/null; smol machine delete --name "k$i" --force > /dev/null; done
