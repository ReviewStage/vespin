#!/usr/bin/env bash
# row8-docker-ports-chromium.sh -- row 8 and the description's ports and Chromium checks, inside the agent VM.

ROW=row8
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts

smol machine create --name dk --net --auto-ports -p 13000:3000 -v /var/lib/docker -v /var/lib/containerd --image "$IMAGE" -- sleep infinity > /dev/null
timed start smol machine start --name dk
x() { smol machine exec --name dk "$@"; }
record docker.backing_device "$(x -- sh -c 'df /var/lib/docker | tail -1 | cut -d" " -f1')"
# The image's wrapper starts dockerd through sudo on first use, as in the cloud.
t0=$(now_ms)
out=$(x --timeout 300s -- docker run --rm hello-world 2>&1)
record docker.hello_world_ms $(($(now_ms) - t0))
check docker_hello_world $(grep -q "Hello from Docker" <<< "$out"; echo $?)
[ "$(grep -c "Hello from Docker" <<< "$out")" -gt 0 ] || { tail -5 <<< "$out" | sed 's/^/# docker: /' | tee -a "$RESULTS_DIR/$ROW.txt"; x -u root -- tail -10 /var/log/dockerd.log 2>&1 | sed 's/^/# dockerd: /' | tee -a "$RESULTS_DIR/$ROW.txt"; }
cat > "$SPIKE_ROOT/compose.yaml" <<'EOF'
services:
  web:
    image: nginx:alpine
    ports: ["8088:80"]
  probe:
    image: curlimages/curl:8.11.1
    depends_on: [web]
    command: ["sh", "-c", "sleep 2; curl -s -o /dev/null -w 'compose_probe=%{http_code}\\n' http://web/"]
EOF
smol machine cp "$SPIKE_ROOT/compose.yaml" dk:/vercel/compose.yaml > /dev/null
t0=$(now_ms)
out=$(x --timeout 300s -w /vercel -- docker compose up -d 2>&1)
record compose.up_rc $?
record compose.up_ms $(($(now_ms) - t0))
sleep 6
probe=$(x -w /vercel -- docker compose logs probe 2>&1 | grep -o 'compose_probe=[0-9]*' | tail -1)
record compose.probe "$probe"
record compose.guest_curl "$(x -- curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8088/)"
# Auto ports: Docker's published 8088 appears on the host's loopback by itself.
sleep 3
record ports.auto_host_8088 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8088/)"
check compose_up $([ "$probe" = compose_probe=200 ] && echo 0 || echo 1)
x -w /vercel -- docker compose down > /dev/null 2>&1

# Ports: a dev server on 3000 (published by -p 13000:3000) and one on 5173 (auto ports).
x -d -- sh -c 'cd /vercel && exec python3 -m http.server 3000 > /tmp/p3000.log 2>&1'
x -d -- sh -c 'cd /vercel && exec python3 -m http.server 5173 > /tmp/p5173.log 2>&1'
sleep 3
record ports.explicit_13000 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:13000/)"
t0=$(now_ms)
until curl -s -o /dev/null --max-time 1 http://127.0.0.1:5173/ || [ $(($(now_ms) - t0)) -gt 15000 ]; do sleep 0.2; done
record ports.auto_5173 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:5173/)"
record ports.auto_5173_appeared_ms $(($(now_ms) - t0))
record ports.host_listeners "$(ss -ltnp 2> /dev/null | grep -E ':(13000|5173|8088) ' | awk '{print $4}' | tr '\n' ' ')"
check ports_explicit $([ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:13000/)" = 200 ] && echo 0 || echo 1)
check ports_auto $([ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:5173/)" = 200 ] && echo 0 || echo 1)

# Chromium: Playwright's headless shell and full Chromium, a page from the guest's own dev server.
cat > "$SPIKE_ROOT/shot.mjs" <<'EOF'
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";
for (const channel of [undefined, "chromium"]) {
  const t0 = Date.now();
  try {
    const browser = await chromium.launch(channel ? { channel } : {});
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:3000/");
    await page.screenshot({ path: `/tmp/shot-${channel ?? "headless"}.png` });
    await browser.close();
    console.log(`${channel ?? "headless_shell"}_ms=${Date.now() - t0}`);
  } catch (e) { console.log(`${channel ?? "headless_shell"}_error=${String(e.message).split("\n")[0].slice(0, 200)}`); }
}
EOF
smol machine cp "$SPIKE_ROOT/shot.mjs" dk:/tmp/shot.mjs > /dev/null
out=$(x --timeout 180s -- env PLAYWRIGHT_BROWSERS_PATH=0 node /tmp/shot.mjs 2>&1)
while read -r line; do [ -n "$line" ] && record "chromium.${line%%=*}" "${line#*=}"; done <<< "$out"
check chromium $(grep -q '_ms=' <<< "$out" && ! grep -q '_error=' <<< "$out"; echo $?)
smol machine cp dk:/tmp/shot-headless.png "$RESULTS_DIR/row8-chromium.png" > /dev/null 2>&1

# Docker after a stop and start: images survive on the disk volume, the daemon comes back on use.
smol machine stop --name dk > /dev/null
smol machine start --name dk > /dev/null
t0=$(now_ms)
out=$(x --timeout 120s -- docker run --rm hello-world 2>&1)
record docker.after_restart_ms $(($(now_ms) - t0))
check docker_after_restart $(grep -q "Hello from Docker" <<< "$out"; echo $?)
record docker.images_after_restart "$(x -- docker images --format '{{.Repository}}' 2>/dev/null | sort | tr '\n' ' ')"
smol machine stop --name dk > /dev/null
smol machine delete --name dk --force > /dev/null
