#!/usr/bin/env bash
# row3-suspend.sh -- row 3: pause a VM with a dev server and a shell running, resume it after WAIT seconds.
#
# usage: row3-suspend.sh <wait-seconds> [branchable]

WAIT=${1:-60}
MODE=${2:-plain}
ROW=row3-$MODE-${WAIT}s
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts

start_flags=()
[ "$MODE" = branchable ] && start_flags=(--branchable)
smol machine create --name sus "${NET_FLAGS[@]}" -p 18000:8000 --image "$IMAGE" -- sleep infinity > /dev/null
timed start smol machine start --name sus "${start_flags[@]}"
# A dev server, a tmux shell counting in RAM and on disk, and ~400 MB the guest touches.
smol machine exec --name sus -d -- sh -c 'cd /vercel && exec python3 -m http.server 8000 > /tmp/http.log 2>&1'
smol machine exec --name sus -- tmux new-session -d -s shell 'i=0; while true; do i=$((i+1)); echo $i > /tmp/counter; sleep 1; done'
smol machine exec --name sus -d -- node -e 'const b = Buffer.alloc(400*1024*1024, 1); setInterval(() => b[0]++, 1000)'
sleep 8
before_pid=$(smol machine exec --name sus -- pgrep -f 'http.server 8000' | head -1)
before_counter=$(smol machine exec --name sus -- cat /tmp/counter)
record before.http_pid "$before_pid"
record before.counter "$before_counter"
record before.guest_used_mb "$(smol machine exec --name sus -- free -m | awk '/^Mem:/{print $3}')"
record before.vmm_pss_mb "$(vmm_pss_mb)"
record before.host_used_mb "$(host_used_mb)"
record before.host_curl "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:18000/)"
dd=$(smol machine data-dir --name sus)
record before.data_dir_du_mb "$(du -sm "$dd" | cut -f1)"

timed pause smol machine pause --name sus
record paused.state "$(smol machine ls --json | jq -r '.[] | select(.name=="sus") | .state')"
record paused.vmm_count "$(vmm_count)"
record paused.vmm_pss_mb "$(vmm_pss_mb)"
record paused.host_used_mb "$(host_used_mb)"
record paused.data_dir_du_mb "$(du -sm "$dd" | cut -f1)"
record paused.data_dir_files "$(cd "$dd" && ls -la | tr -s ' ' | cut -d' ' -f5,9 | tr '\n' ';')"

sleep "$WAIT"
record paused_after_wait.vmm_pss_mb "$(vmm_pss_mb)"
record paused_after_wait.host_used_mb "$(host_used_mb)"
# Resume, then how long until the dev server answers inside and on the host's forwarded port.
t0=$(now_ms)
smol machine resume --name sus
rc=$?
t1=$(now_ms)
record resume_ms $((t1 - t0))
record resume_rc "$rc"
until curl -s -o /dev/null --max-time 1 http://127.0.0.1:18000/ || [ $(($(now_ms) - t1)) -gt 30000 ]; do sleep 0.05; done
record resume_to_host_http_ms $(($(now_ms) - t0))
after_pid=$(smol machine exec --name sus -- pgrep -f 'http.server 8000' | head -1)
c1=$(smol machine exec --name sus -- cat /tmp/counter)
sleep 3
c2=$(smol machine exec --name sus -- cat /tmp/counter)
record after.http_pid "$after_pid"
record after.counter "$c1 -> $c2"
record after.guest_http "$(smol machine exec --name sus -- curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/)"
record after.host_curl "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:18000/)"
record after.tmux "$(smol machine exec --name sus -- tmux ls 2>&1)"
record after.node_alive "$(smol machine exec --name sus -- pgrep -f 'Buffer.alloc' > /dev/null && echo yes || echo no)"
record after.vmm_pss_mb "$(vmm_pss_mb)"
check resume_under_1s $([ $((t1 - t0)) -lt 1000 ] && echo 0 || echo 1)
check processes_survive $([ -n "$after_pid" ] && [ "$after_pid" = "$before_pid" ] && [ "$c2" -gt "$c1" ] && echo 0 || echo 1)
check host_port_after_resume $([ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:18000/)" = 200 ] && echo 0 || echo 1)
# A second pause and resume in a row, for a steadier number.
timed pause2 smol machine pause --name sus
timed resume2 smol machine resume --name sus
smol machine stop --name sus > /dev/null 2>&1
smol machine delete --name sus --force > /dev/null
