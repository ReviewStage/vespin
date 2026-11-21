#!/usr/bin/env bash
# row5-throughput.sh -- row 5: clone from the box's mirror, pnpm install, one package's vitest, bare vs VM disk vs VM mount.

ROW=row5
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts

mirror=$SPIKE_ROOT/mirror/vespin.git
mkdir -p "$SPIKE_ROOT/mirror"
[ -d "$mirror" ] || git clone --mirror -q "${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-ReviewStage/vespin}.git" "$mirror"
COMMIT=${GITHUB_SHA_MAIN:-$(git -C "$mirror" rev-parse main)}
record commit "$COMMIT"

# The steps, the same in each place: $1 is the working folder.
steps='
set -u
w=$1
export ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=1 HUSKY=0 npm_config_store_dir=$w/.store
ms() { date +%s%3N; }
t=$(ms); git clone -q /mirror/vespin.git $w/vespin && git -C $w/vespin checkout -q '"$COMMIT"'; echo "clone_ms=$(( $(ms) - t ))"
cd $w/vespin
t=$(ms); pnpm install --frozen-lockfile --reporter=silent > /tmp/install.log 2>&1; rc=$?; echo "install_ms=$(( $(ms) - t )) install_rc=$rc"
[ $rc -eq 0 ] || tail -5 /tmp/install.log | sed "s/^/# install: /"
t=$(ms); (cd packages/agent-runner && pnpm exec vitest run) > /tmp/vitest.log 2>&1; rc=$?; echo "vitest_ms=$(( $(ms) - t )) vitest_rc=$rc"
[ $rc -eq 0 ] || tail -8 /tmp/vitest.log | sed "s/^/# vitest: /"
grep -E "Tests +[0-9]" /tmp/vitest.log | tail -1 | sed "s/^/# /"
'
printf '%s' "$steps" > "$SPIKE_ROOT/steps.sh"

# Bare box: the mirror at the same path the VMs see.
sudo mkdir -p /mirror && sudo mount --bind "$SPIKE_ROOT/mirror" /mirror
mkdir -p "$SPIKE_ROOT/bare"
bash "$SPIKE_ROOT/steps.sh" "$SPIKE_ROOT/bare" 2>&1 | sed 's/^\([a-z]\)/bare.\1/' | tee -a "$RESULTS_DIR/$ROW.txt"
rm -rf "$SPIKE_ROOT/bare"

# Network: a 100 MB download on the box.
dl() { curl -s -o /dev/null -w '%{speed_download}' --max-time 120 'https://speed.cloudflare.com/__down?bytes=100000000'; }
record bare.download_bytes_per_s "$(dl)"

# The VM, its checkout on its own disk.
smol machine create --name tp --net --mem 8192 --cpus "$(nproc)" -v "$SPIKE_ROOT/mirror:/mirror:ro" -v "$SPIKE_ROOT:/spike:ro" --image "$IMAGE" -- sleep infinity > /dev/null
smol machine start --name tp > /dev/null
smol machine exec --name tp -- bash /spike/steps.sh /vercel 2>&1 | sed 's/^\([a-z]\)/vm_disk.\1/' | tee -a "$RESULTS_DIR/$ROW.txt"
record vm_disk.download_bytes_per_s "$(smol machine exec --name tp -- curl -s -o /dev/null -w '%{speed_download}' --max-time 120 'https://speed.cloudflare.com/__down?bytes=100000000')"
smol machine stop --name tp > /dev/null
smol machine delete --name tp --force > /dev/null

# The VM, its checkout on a host folder mounted in (virtiofs).
mkdir -p "$SPIKE_ROOT/share" && chmod 0777 "$SPIKE_ROOT/share"
smol machine create --name tpm --net --mem 8192 --cpus "$(nproc)" -v "$SPIKE_ROOT/mirror:/mirror:ro" -v "$SPIKE_ROOT:/spike:ro" -v "$SPIKE_ROOT/share:/work" --image "$IMAGE" -- sleep infinity > /dev/null
smol machine start --name tpm > /dev/null
smol machine exec --name tpm -- bash /spike/steps.sh /work 2>&1 | sed 's/^\([a-z]\)/vm_mount.\1/' | tee -a "$RESULTS_DIR/$ROW.txt"
smol machine stop --name tpm > /dev/null
smol machine delete --name tpm --force > /dev/null

# A VM under a credential policy and --block-private: the network path every agent VM will take.
ECHO_KEY="spike-$(openssl rand -hex 12)" smol machine create --name tpc --mem 4096 --block-private \
  --credential echo=ECHO_KEY@postman-echo.com --image "$IMAGE" -- sleep infinity > /dev/null
ECHO_KEY="spike-$(openssl rand -hex 12)" smol machine start --name tpc > /dev/null
record vm_cred.download_bytes_per_s "$(smol machine exec --name tpc -- curl -s -o /dev/null -w '%{speed_download}' --max-time 120 'https://speed.cloudflare.com/__down?bytes=100000000')"
smol machine stop --name tpc > /dev/null
smol machine delete --name tpc --force > /dev/null

for k in clone_ms install_ms vitest_ms; do
  b=$(grep "^bare.$k=" "$RESULTS_DIR/$ROW.txt" | head -1 | sed -E 's/^[^=]+=([0-9]+).*/\1/')
  for place in vm_disk vm_mount; do
    v=$(grep "^$place.$k=" "$RESULTS_DIR/$ROW.txt" | head -1 | sed -E 's/^[^=]+=([0-9]+).*/\1/')
    [ -n "$b" ] && [ -n "$v" ] && [ "$b" -gt 0 ] && record "ratio.$place.$k" "$(awk -v v="$v" -v b="$b" 'BEGIN{printf "%.2f", v/b}')"
  done
done
