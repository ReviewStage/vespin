#!/usr/bin/env bash
# lib.sh -- shared helpers for the smolvm spike's row scripts: install, KVM, timing, and results.
#
# Every row script sources this, sets ROW, and writes `key=value` lines to $RESULTS_DIR/$ROW.txt
# through `record`, so the results page reads numbers, not log prose. Nothing here prints a
# credential: a secret is only ever compared by count (`grep -c`), never echoed.

set -uo pipefail

SPIKE_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_ROOT="${SPIKE_ROOT:-/mnt/smol}"
RESULTS_DIR="${RESULTS_DIR:-${GITHUB_WORKSPACE:-$PWD}/results}"
SMOLVM_VERSION="${SMOLVM_VERSION:-1.35.5}"
IMAGE="${IMAGE:-}"
# The network every agent VM gets: virtio-net, the backend a credential binding selects anyway.
NET_FLAGS=(--net --net-backend "${NET_BACKEND:-virtio-net}")
mkdir -p "$RESULTS_DIR"

# A row already measured is left out of a rerun by naming it in skip-rows, since the App that pushes
# here can neither dispatch the workflow nor edit its matrix.
if [ -n "${ROW:-}" ] && grep -qx -- "$ROW" "$SPIKE_HERE/skip-rows" 2> /dev/null; then
  echo "skipped=$ROW" | tee "$RESULTS_DIR/$ROW-skipped.txt"
  exit 0
fi

export XDG_DATA_HOME="$SPIKE_ROOT/data" XDG_CACHE_HOME="$SPIKE_ROOT/cache" XDG_CONFIG_HOME="$SPIKE_ROOT/config"

now_ms() { date +%s%3N; }

record() {
  printf '%s=%s\n' "$1" "$2" | tee -a "$RESULTS_DIR/${ROW:?}.txt"
}

note() {
  printf '# %s\n' "$*" | tee -a "$RESULTS_DIR/${ROW:?}.txt"
}

# check NAME CONDITION-RESULT(0|nonzero) — records PASS or FAIL.
check() {
  if [ "$2" -eq 0 ]; then record "check.$1" PASS; else record "check.$1" FAIL; fi
}

# timed NAME CMD... — runs CMD, records NAME_ms and NAME_rc, returns CMD's status.
timed() {
  local name=$1
  shift
  local t0 rc
  t0=$(now_ms)
  "$@"
  rc=$?
  record "${name}_ms" $(($(now_ms) - t0))
  record "${name}_rc" "$rc"
  return "$rc"
}

smol() { "$SMOLVM" "$@"; }

smolvm_dir() { printf '%s/bin/%s' "$SPIKE_ROOT" "$1"; }

use_smolvm() {
  SMOLVM="$(smolvm_dir "$1")/smolvm"
  export SMOLVM
}

install_smolvm() {
  local version=$1 arch dir tgz
  case "$(uname -m)" in
    x86_64) arch=linux-x86_64 ;;
    aarch64 | arm64) arch=linux-arm64 ;;
  esac
  dir="$(smolvm_dir "$version")"
  if [ ! -x "$dir/smolvm" ]; then
    mkdir -p "$dir" "$SPIKE_ROOT/dl"
    tgz="smolvm-$version-$arch.tar.gz"
    curl -fsSL -o "$SPIKE_ROOT/dl/$tgz" "https://github.com/smol-machines/smolvm/releases/download/v$version/$tgz"
    curl -fsSL -o "$SPIKE_ROOT/dl/checksums-$version.sha256" "https://github.com/smol-machines/smolvm/releases/download/v$version/checksums.sha256"
    (cd "$SPIKE_ROOT/dl" && grep " $tgz\$" "checksums-$version.sha256" | sha256sum -c -) || return 1
    tar -xzf "$SPIKE_ROOT/dl/$tgz" -C "$dir" --strip-components=1
  fi
  use_smolvm "$version"
}

# The host: KVM open to this user, state on the big disk, GHCR auth by an env reference.
prepare_host() {
  if [ -e /dev/kvm ]; then
    echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules > /dev/null
    sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm
    sleep 1
  fi
  sudo mkdir -p "$SPIKE_ROOT" && sudo chown "$(id -u):$(id -g)" "$SPIKE_ROOT"
  mkdir -p "$XDG_CONFIG_HOME/smolvm"
  cat > "$XDG_CONFIG_HOME/smolvm/config.toml" <<EOF
[images.registries."ghcr.io"]
username = "${GITHUB_ACTOR:-spike}"
password_env = "GHCR_TOKEN"
EOF
  install_smolvm "$SMOLVM_VERSION"
}

host_facts() {
  record host.kernel "$(uname -r)"
  record host.arch "$(uname -m)"
  record host.cpus "$(nproc)"
  record host.mem_total_mb "$(free -m | awk '/^Mem:/{print $2}')"
  record host.kvm "$([ -r /dev/kvm ] && [ -w /dev/kvm ] && echo yes || echo no)"
  record host.cpu_model "$(awk -F': ' '/model name/{print $2; exit}' /proc/cpuinfo)"
  record host.disk_mnt_free_gb "$(df -BG --output=avail "$SPIKE_ROOT" | tail -1 | tr -dc 0-9)"
  record smolvm.version "$("$SMOLVM" --version 2>&1 | head -1)"
}

host_used_mb() { free -m | awk '/^Mem:/{print $3}'; }

# The VMM processes: each machine's pid as `machine ls --json` reports it, and their children.
vmm_pids() {
  local p
  for p in $(smol machine ls --json 2> /dev/null | jq -r '.[] | .pid // empty'); do
    [ -d "/proc/$p" ] || continue
    echo "$p"
    pgrep -P "$p" 2> /dev/null
  done | sort -u
}

pss_of_pids() {
  local total=0 p kb
  for p in "$@"; do
    kb=$(awk '/^Pss:/{print $2}' "/proc/$p/smaps_rollup" 2> /dev/null)
    total=$((total + ${kb:-0}))
  done
  echo $((total / 1024))
}

# The VMM processes' summed PSS in MiB.
vmm_pss_mb() {
  # shellcheck disable=SC2046 # one pid per word
  pss_of_pids $(vmm_pids)
}

vmm_count() { smol machine ls --json 2> /dev/null | jq '[.[] | select(.pid != null)] | length'; }

# One machine's VMM PSS, MiB.
vmm_pss_of() {
  local p
  p=$(smol machine ls --json 2> /dev/null | jq -r --arg n "$1" '.[] | select(.name == $n) | .pid // empty')
  [ -n "$p" ] || { echo -1; return; }
  # shellcheck disable=SC2046
  pss_of_pids "$p" $(pgrep -P "$p")
}

host_avail_mb() { free -m | awk '/^Mem:/{print $7}'; }

# Start of the runner bundle: node loads it and, with no config line on stdin, exits 3
# (RUNNER_EXIT.UNCONFIGURED) — the earliest point a launch could hand it its config.
runner_probe() {
  local name=$1
  smol machine exec --name "$name" -- sh -c 'node /opt/agent/agent-runner/agent-runner.mjs < /dev/null > /dev/null 2>&1; echo $?'
}

# The ready script a launch runs (sandbox-machine.ts's readyScript, reduced to what a VM needs):
# the agent user, its docker group, the runner unit installed root-owned, the checkout shared.
ready_script() {
  cat <<'EOF'
set -eu
id agent > /dev/null 2>&1 || useradd --create-home --shell /bin/bash agent
usermod -aG docker agent
install -d -m 0755 /var/lib/vespin
git config --system --get-all safe.directory 2>/dev/null | grep -Fxq /workspace/checkout || git config --system --add safe.directory /workspace/checkout
: > /var/lib/vespin/readied
EOF
}

# A JSON-ish dump of a machine's stats, single line.
stats_line() { smol machine stats --name "$1" --json 2>/dev/null | tr -d '\n' | head -c 600; }

delete_all_machines() {
  local n
  for n in $(smol machine ls --json 2>/dev/null | jq -r '.[]?.name // empty' 2>/dev/null); do
    smol machine stop --name "$n" > /dev/null 2>&1
    smol machine delete --name "$n" --force > /dev/null 2>&1
  done
}
