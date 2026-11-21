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
t=$(ms); git clone -q --no-checkout /mirror/vespin.git $w/vespin; t2=$(ms); git -C $w/vespin checkout -q '"$COMMIT"'; t3=$(ms); echo "clone_ms=$(( t3 - t ))"; echo "fetch_ms=$(( t2 - t ))"; echo "checkout_ms=$(( t3 - t2 ))"
cd $w/vespin
t=$(ms); pnpm install --frozen-lockfile --reporter=append-only > /tmp/install.log 2>&1; rc=$?; echo "install_ms=$(( $(ms) - t ))"; echo "install_rc=$rc"
[ $rc -eq 0 ] || grep -E "ERR|error|Error" /tmp/install.log | tail -6 | cut -c1-200 | sed "s/^/# install: /"; echo "node_modules_mb=$(du -sm node_modules 2>/dev/null | cut -f1)"
t=$(ms); (cd packages/agent-runner && pnpm exec vitest run) > /tmp/vitest.log 2>&1; rc=$?; echo "vitest_ms=$(( $(ms) - t ))"; echo "vitest_rc=$rc"
[ $rc -eq 0 ] || tail -8 /tmp/vitest.log | sed "s/^/# vitest: /"
grep -E "Tests +[0-9]" /tmp/vitest.log | tail -1 | sed "s/^/# /"
'
printf '%s' "$steps" > "$SPIKE_ROOT/steps.sh"

# Bare box: Node 24 and pnpm as the image has them, and the mirror at the same path the VMs see.
case "$(uname -m)" in x86_64) na=x64 ;; aarch64) na=arm64 ;; esac
nf=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk -v a="linux-$na.tar.xz" '$2 ~ a"$" {print $2}')
curl -fsSL "https://nodejs.org/dist/latest-v24.x/$nf" | sudo tar -xJ -C /usr/local --strip-components=1
hash -r
sudo npm install --global --no-audit --no-fund pnpm@10.34.5 > /dev/null 2>&1
record bare.node "$(node --version) pnpm $(pnpm --version)"
sudo mkdir -p /mirror && sudo mount --bind "$SPIKE_ROOT/mirror" /mirror
mkdir -p "$SPIKE_ROOT/bare"
bash "$SPIKE_ROOT/steps.sh" "$SPIKE_ROOT/bare" 2>&1 | sed 's/^\([a-z]\)/bare.\1/' | tee -a "$RESULTS_DIR/$ROW.txt"
rm -rf "$SPIKE_ROOT/bare"

# Network: a 100 MB download on the box.
DL_URL=https://github.com/smol-machines/smolvm/releases/download/v1.35.5/smolvm-1.35.5-linux-x86_64.tar.gz
dl() { curl -sL -o /dev/null -w '%{speed_download}' --max-time 120 "$DL_URL"; }
record bare.download_bytes_per_s "$(dl)"

# The VM, its checkout on its own disk.
smol machine create --name tp "${NET_FLAGS[@]}" --mem 8192 --cpus "$(nproc)" -v "$SPIKE_ROOT/mirror:/mirror:ro" -v "$SPIKE_ROOT:/spike:ro" --image "$IMAGE" -- sleep infinity > /dev/null
smol machine start --name tp > /dev/null
smol machine exec --name tp -- bash /spike/steps.sh /vercel 2>&1 | sed 's/^\([a-z]\)/vm_disk.\1/' | tee -a "$RESULTS_DIR/$ROW.txt"
record vm_disk.download_bytes_per_s "$(smol machine exec --name tp -- curl -sL -o /dev/null -w '%{speed_download}' --max-time 120 $DL_URL)"
smol machine stop --name tp > /dev/null
smol machine delete --name tp --force > /dev/null

# The VM again, its disk writes reaching the host's disk on the host's schedule (--disk-durability deferred).
smol machine create --name tpd "${NET_FLAGS[@]}" --disk-durability deferred --mem 8192 --cpus "$(nproc)" -v "$SPIKE_ROOT/mirror:/mirror:ro" -v "$SPIKE_ROOT:/spike:ro" --image "$IMAGE" -- sleep infinity > /dev/null
smol machine start --name tpd > /dev/null
smol machine exec --name tpd -- bash /spike/steps.sh /vercel 2>&1 | sed 's/^\([a-z]\)/vm_deferred.\1/' | tee -a "$RESULTS_DIR/$ROW.txt"
smol machine stop --name tpd > /dev/null
smol machine delete --name tpd --force > /dev/null

# The VM, its checkout on a host folder mounted in (virtiofs).
mkdir -p "$SPIKE_ROOT/share" && chmod 0777 "$SPIKE_ROOT/share"
smol machine create --name tpm "${NET_FLAGS[@]}" --mem 8192 --cpus "$(nproc)" -v "$SPIKE_ROOT/mirror:/mirror:ro" -v "$SPIKE_ROOT:/spike:ro" -v "$SPIKE_ROOT/share:/work" --image "$IMAGE" -- sleep infinity > /dev/null
smol machine start --name tpm > /dev/null
smol machine exec --name tpm -- bash /spike/steps.sh /work 2>&1 | sed 's/^\([a-z]\)/vm_mount.\1/' | tee -a "$RESULTS_DIR/$ROW.txt"
smol machine stop --name tpm > /dev/null
smol machine delete --name tpm --force > /dev/null

# A VM under a credential policy and --block-private: the network path every agent VM will take.
ECHO_KEY="spike-$(openssl rand -hex 12)" smol machine create --name tpc --mem 4096 --block-private \
  --credential echo=ECHO_KEY@postman-echo.com --image "$IMAGE" -- sleep infinity > /dev/null
ECHO_KEY="spike-$(openssl rand -hex 12)" smol machine start --name tpc > /dev/null
record vm_cred.download_bytes_per_s "$(smol machine exec --name tpc -- curl -sL -o /dev/null -w '%{speed_download}' --max-time 120 $DL_URL)"
smol machine stop --name tpc > /dev/null
smol machine delete --name tpc --force > /dev/null

for k in clone_ms fetch_ms checkout_ms install_ms vitest_ms; do
  b=$(grep "^bare.$k=" "$RESULTS_DIR/$ROW.txt" | head -1 | sed -E 's/^[^=]+=([0-9]+).*/\1/')
  for place in vm_disk vm_deferred vm_mount; do
    v=$(grep "^$place.$k=" "$RESULTS_DIR/$ROW.txt" | head -1 | sed -E 's/^[^=]+=([0-9]+).*/\1/')
    [ -n "$b" ] && [ -n "$v" ] && [ "$b" -gt 0 ] && record "ratio.$place.$k" "$(awk -v v="$v" -v b="$b" 'BEGIN{printf "%.2f", v/b}')"
  done
done
