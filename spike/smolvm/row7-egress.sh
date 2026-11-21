#!/usr/bin/env bash
# row7-egress.sh -- row 7: open internet allowed; metadata, the box and private ranges refused, with credential substitution on.
#
# Targets on the runner: the box itself (an HTTP server on 0.0.0.0:18080, reached at its eth0 and
# docker0 addresses and through the guest's gateway), a "LAN" service (nginx in a container at
# 172.17.0.2), Azure's metadata service (169.254.169.254) and its wire server (168.63.129.16, a
# public address that only answers from inside Azure).

ROW=row7
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts

ETH0=$(ip -4 route get 1.1.1.1 | grep -oP 'src \K\S+')
record host.eth0 "$ETH0"
python3 -m http.server 18080 --bind 0.0.0.0 > /dev/null 2>&1 &
python3 -m http.server 18082 --bind 127.0.0.1 > /dev/null 2>&1 &
docker run -d --rm --name lan -p 127.0.0.1:18081:80 nginx:alpine > /dev/null
LAN=$(docker inspect -f '{{.NetworkSettings.IPAddress}}' lan)
DOCKER0=$(ip -4 addr show docker0 | grep -oP 'inet \K[0-9.]+')
record host.lan "$LAN"
record host.docker0 "$DOCKER0"
sleep 2
record bare.imds "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -H Metadata:true 'http://169.254.169.254/metadata/instance?api-version=2021-02-01')"
record bare.wireserver "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 'http://168.63.129.16/?comp=versions')"
record bare.lan "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$LAN/")"

# Every IPv4 range but the protected ones, for the plan's --allow-cidr complement.
complement=$(python3 -I - "$ETH0" <<'EOF'
import ipaddress, sys
nets = [ipaddress.ip_network("0.0.0.0/0")]
for c in ["0.0.0.0/8","10.0.0.0/8","100.64.0.0/10","127.0.0.0/8","169.254.0.0/16","172.16.0.0/12","192.168.0.0/16","224.0.0.0/3", sys.argv[1] + "/32"]:
    x = ipaddress.ip_network(c); out = []
    for n in nets:
        out.extend(n.address_exclude(x) if x.subnet_of(n) else ([] if n.subnet_of(x) else [n]))
    nets = out
print(" ".join(f"--allow-cidr {n}" for n in sorted(nets)))
EOF
)
record complement.count "$(wc -w <<< "$complement" | awk '{print $1/2}')"

# Substitution is proven by GitHub's rate limit under a placeholder bearer (an echo shows the
# placeholder again: smolvm maps reflected values back to it).
export GH_BEARER="${GH_REAL:?the job token}"
cred=(--credential ghb=GH_BEARER@api.github.com)
declare -A FLAGS=(
  [a_block_private]="--block-private"
  [b_private_on]="--block-private --allow-private 172.16.0.0/12"
  [c_private_on_box_denied]="--block-private --allow-private 172.16.0.0/12 --deny-cidr $DOCKER0/32 --deny-cidr $ETH0/32"
  [d_allow_complement]="$complement"
  [e_net_only]="--net"
)
probe() { # machine
  local m=$1 gw
  x() { smol machine exec --name "$m" -- "$@" 2>/dev/null; }
  hc() { x curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" || true; }
  gw=$(x sh -c "ip route 2>/dev/null | awk '/default/{print \$3; exit}'")
  record "$m.gateway" "${gw:-none}"
  record "$m.public_https" "$(hc https://example.com/)"
  record "$m.public_http" "$(hc http://example.com/)"
  local r
  r=$(x sh -c 'curl -s --max-time 10 https://api.github.com/rate_limit -H "Authorization: Bearer $GH_BEARER" | jq .resources.core.limit')
  record "$m.substitution" "$([ "${r:-0}" -gt 60 ] 2> /dev/null && echo yes || echo no)"
  record "$m.imds" "$(hc -H Metadata:true 'http://169.254.169.254/metadata/instance?api-version=2021-02-01')"
  record "$m.wireserver" "$(hc 'http://168.63.129.16/?comp=versions')"
  record "$m.box_eth0" "$(hc "http://$ETH0:18080/")"
  record "$m.box_docker0" "$(hc "http://$DOCKER0:18080/")"
  if [ -n "$gw" ]; then
    record "$m.box_via_gateway" "$(hc "http://$gw:18080/")"
    record "$m.box_loopback_via_gateway" "$(hc "http://$gw:18082/")"
  fi
  record "$m.guest_addr" "$(x sh -c "ip -4 -o addr show scope global 2>/dev/null | awk '{print \$4}' | head -1")"
  record "$m.lan" "$(hc "http://$LAN/")"
  record "$m.dns_public" "$(x sh -c 'getent hosts example.com > /dev/null && echo ok || echo fail')"
}
for m in a_block_private b_private_on c_private_on_box_denied d_allow_complement e_net_only; do
  # shellcheck disable=SC2086 # the flags are word lists
  if smol machine create --name "$m" ${FLAGS[$m]} "${cred[@]}" --image "$IMAGE" -- sleep infinity > /tmp/create.err 2>&1 \
    && smol machine start --name "$m" > /tmp/start.err 2>&1; then
    record "$m.started" yes
    probe "$m"
    smol machine egress-events --name "$m" 2>&1 | tail -5 | sed "s/^/# $m egress: /" | tee -a "$RESULTS_DIR/$ROW.txt"
  else
    record "$m.started" no
    record "$m.error" "$(cat /tmp/create.err /tmp/start.err 2> /dev/null | tail -2 | tr '\n' ' ')"
  fi
done

# The LAN switch, live, on the allow-list machine: add the LAN, then take it away again.
m=d_allow_complement
if [ "$(grep "^$m.started=" "$RESULTS_DIR/$ROW.txt" | cut -d= -f2)" = yes ]; then
  smol machine update --name "$m" --allow-cidr "$LAN/32" > /dev/null 2>&1
  record live_on.lan "$(smol machine exec --name "$m" -- curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$LAN/" 2> /dev/null || true)"
  smol machine update --name "$m" --remove-allow-cidr "$LAN/32" > /dev/null 2>&1
  record live_off.lan "$(smol machine exec --name "$m" -- curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$LAN/" 2> /dev/null || true)"
fi
# The switch at rest: a stopped block-private machine recreated with private on is the cut-1 path,
# measured by b_private_on above; also try update on a stopped machine.
smol machine stop --name a_block_private > /dev/null 2>&1
record update_stopped.allow_cidr_rc "$(smol machine update --name a_block_private --allow-cidr "$LAN/32" > /tmp/upd.err 2>&1; echo $?) $(tail -1 /tmp/upd.err)"
smol machine start --name a_block_private > /dev/null 2>&1 && record update_stopped.lan "$(smol machine exec --name a_block_private -- curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$LAN/" 2> /dev/null || true)"

g() { grep "^$1=" "$RESULTS_DIR/$ROW.txt" | tail -1 | cut -d= -f2; }
closed() { case "$1" in 000 | 403 | "") return 0 ;; *) return 1 ;; esac; }
ok=0
for k in imds box_eth0 box_docker0 box_via_gateway box_loopback_via_gateway lan; do closed "$(g a_block_private.$k)" || ok=1; done
[ "$(g a_block_private.public_https)" = 200 ] && [ "$(g a_block_private.substitution)" = yes ] || ok=1
check block_private_with_credentials $ok
ok=0
[ "$(g b_private_on.lan)" = 200 ] || ok=1
closed "$(g b_private_on.imds)" || ok=1
check private_switch_on $ok
ok=0
[ "$(g c_private_on_box_denied.lan)" = 200 ] || ok=1
for k in imds box_eth0 box_docker0 box_via_gateway box_loopback_via_gateway; do closed "$(g c_private_on_box_denied.$k)" || ok=1; done
check private_on_box_still_denied $ok
ok=0
for k in imds box_eth0 box_docker0 box_via_gateway box_loopback_via_gateway lan; do closed "$(g d_allow_complement.$k)" || ok=1; done
[ "$(g d_allow_complement.substitution)" = yes ] || ok=1
check allow_complement_with_credentials $ok
for m in a_block_private b_private_on c_private_on_box_denied d_allow_complement e_net_only; do
  smol machine stop --name "$m" > /dev/null 2>&1
  smol machine delete --name "$m" --force > /dev/null 2>&1
done
docker rm -f lan > /dev/null 2>&1
