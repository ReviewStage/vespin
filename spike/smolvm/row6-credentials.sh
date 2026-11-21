#!/usr/bin/env bash
# row6-credentials.sh -- row 6: every credential the agent uses reaches its host through a placeholder or a set header.
#
# Every provider value here is minted at run time and worthless (fake keys), except GitHub's: the
# job's own GITHUB_TOKEN (GH_REAL, gone when the job ends), which is never printed — only counted.
# A substitution is proved with an echo host: the guest sends its placeholder, the host compares
# what the echo saw with the value it holds.

ROW=row6
source "$(dirname "$0")/lib.sh"
prepare_host
host_facts
: "${GH_REAL:?the job token}"

rand() { openssl rand -hex 16; }
export ECHO_KEY="spike-echo-$(rand)"
export ANTHROPIC_API_KEY="sk-ant-api03-spike-$(rand)"
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-spike-$(rand)"
export OPENAI_API_KEY="sk-spike-$(rand)"
export CURSOR_API_KEY="key_spike$(rand)"
export VESPIN_RUNNER_BEARER="spike-runner-$(rand)"
GH_BAD="Basic $(printf 'x-access-token:%s' "spike-invalid-$(rand)" | base64 -w0)"
GH_GOOD="Basic $(printf 'x-access-token:%s' "$GH_REAL" | base64 -w0)"
export GH_AUTH="$GH_BAD"
# ECHO_KEY is left out: the echo host hands it back to the guest by design.
SECRETS=("$ANTHROPIC_API_KEY" "$CLAUDE_CODE_OAUTH_TOKEN" "$OPENAI_API_KEY" "$CURSOR_API_KEY" "$VESPIN_RUNNER_BEARER" "$GH_REAL" "$GH_GOOD")

creds=(
  --credential echo=ECHO_KEY@postman-echo.com,httpbin.org
  --credential claude_oauth=CLAUDE_CODE_OAUTH_TOKEN@api.anthropic.com
  --credential claude_key=ANTHROPIC_API_KEY@api.anthropic.com
  --credential openai=OPENAI_API_KEY@api.openai.com
  --credential cursor=CURSOR_API_KEY@api2.cursor.sh,api.cursor.com
  --credential runner=VESPIN_RUNNER_BEARER@vespin.dev
  --credential github=GH_AUTH@github.com,api.github.com:set-header=authorization
)
timed create smol machine create --name cred --block-private "${creds[@]}" --image "$IMAGE" -- sleep infinity
timed start smol machine start --name cred
x() { smol machine exec --name cred "$@"; }

# What the guest holds: placeholders, and the CA files.
for v in ECHO_KEY ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY CURSOR_API_KEY VESPIN_RUNNER_BEARER GH_AUTH; do
  record "guest.$v" "$(x -- sh -c "printenv $v | cut -c1-17")"
done
record guest.ssl_cert_file "$(x -- sh -c 'echo $SSL_CERT_FILE $NODE_EXTRA_CA_CERTS')"

# 1. Substitution, by an echo host, in the header shapes the CLIs use. The first run found
# neither value in what curl printed: the response is now decompressed and its status kept.
for echo_url in https://postman-echo.com/headers https://httpbin.org/headers; do
  host=$(cut -d/ -f3 <<< "$echo_url" | cut -d. -f1)
  r=$(x -- sh -c 'curl -s --compressed -D /tmp/h.txt "$0" -H "Authorization: Bearer $ECHO_KEY" -H "x-api-key: $ECHO_KEY"; echo; echo "STATUS $(head -1 /tmp/h.txt | tr -d "\r")"; grep -i "^content-encoding" /tmp/h.txt | tr -d "\r"' "$echo_url")
  record "echo.$host.status" "$(grep '^STATUS' <<< "$r" | cut -c8-)"
  record "echo.$host.real_value_seen_times" "$(grep -oF "$ECHO_KEY" <<< "$r" | wc -l)"
  record "echo.$host.placeholder_seen_times" "$(grep -o 'SMOL_PLACEHOLDER' <<< "$r" | wc -l)"
  record "echo.$host.has_authorization_key" "$(grep -ci '"authorization"' <<< "$r")"
  record "echo.$host.body_bytes" "$(wc -c <<< "$r")"
done
check substitution_curl $([ "$(grep -E '^echo\.[a-z-]+\.real_value_seen_times=' "$RESULTS_DIR/$ROW.txt" | cut -d= -f2 | paste -sd+ | bc)" -gt 0 ] && echo 0 || echo 1)
# Node's fetch (undici), the runner's client, trusts the machine CA through NODE_EXTRA_CA_CERTS.
r=$(x -- node -e 'fetch("https://httpbin.org/headers",{headers:{authorization:"Bearer "+process.env.ECHO_KEY}}).then(async r=>console.log(r.status, await r.text()),e=>console.log("ERR",e.cause?.code||e.message))')
record echo.node_fetch_status "$(head -c 3 <<< "$r")"
check substitution_node_fetch $([ "$(grep -cF "$ECHO_KEY" <<< "$r")" -gt 0 ] && echo 0 || echo 1)
# Refusals: in a query string, in a JSON body, to a host the binding does not name.
record refuse.query "$(x -- sh -c 'curl -s -o /dev/null -w %{http_code} "https://postman-echo.com/get?k=$ECHO_KEY"')"
record refuse.json_body "$(x -- sh -c 'curl -s -o /dev/null -w %{http_code} https://postman-echo.com/post -H content-type:application/json -d "{\"k\":\"$ECHO_KEY\"}"')"
r=$(x -- sh -c 'curl -s https://example.com/ -H "Authorization: Bearer $ECHO_KEY" -o /dev/null -w %{http_code}')
record refuse.other_host_status "$r"
# Streaming: TTFB and total for a 4 s drip on a credential host (unbuffered => TTFB well under 4 s).
record stream.drip_ttfb_total "$(x -- sh -c 'curl -s -o /dev/null -H "Authorization: Bearer $ECHO_KEY" -w "%{time_starttransfer} %{time_total}" "https://httpbin.org/drip?duration=4&numbytes=8&delay=0"')"

# 2. Claude Code, plan token then API key, through the interceptor: a real auth refusal, not TLS.
cc() { x --timeout 90s -- sh -c "$1" 2>&1 | tr '\n' ' ' | cut -c1-400; }
out=$(cc 'cd /tmp && env -u ANTHROPIC_API_KEY claude -p "say ok" --output-format stream-json --verbose 2>&1 | grep -E "api_retry|\"type\":\"result\"|rror" | tail -2')
record claude.oauth_out "$out"
check claude_oauth_reaches_anthropic $(grep -qiE '401|authentication|invalid|OAuth' <<< "$out" && ! grep -qiE 'certificate|self.signed|UNABLE_TO|ECONNREFUSED|ENOTFOUND' <<< "$out"; echo $?)
out=$(cc 'cd /tmp && env -u CLAUDE_CODE_OAUTH_TOKEN claude -p "say ok" --output-format stream-json --verbose 2>&1 | grep -E "api_retry|\"type\":\"result\"|rror" | tail -2')
record claude.apikey_out "$out"
check claude_apikey_reaches_anthropic $(grep -qiE '401|authentication|invalid|api key' <<< "$out" && ! grep -qiE 'certificate|self.signed|UNABLE_TO|ECONNREFUSED|ENOTFOUND' <<< "$out"; echo $?)

# 3. Codex with an API key: its Rust TLS must trust the machine CA (SSL_CERT_FILE).
out=$(cc 'cd /tmp && printenv OPENAI_API_KEY | codex login --with-api-key > /dev/null 2>&1; codex exec --skip-git-repo-check "say ok" 2>&1 | tail -4')
record codex.apikey_out "$out"
check codex_reaches_openai $(grep -qiE '401|invalid_api_key|Incorrect API key|Unauthorized' <<< "$out" && ! grep -qiE 'certificate|UnknownIssuer|invalid peer|tls' <<< "$out"; echo $?)
out=$(cc 'curl -s -o /dev/null -w "%{http_code}" https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"')
record codex.curl_models_status "$out"

# 4. Cursor's SDK with its key on api2.cursor.sh (HTTP/2 upstream, HTTP/1.1 guest side).
cat > "$SPIKE_ROOT/cursor-probe.mjs" <<'EOF'
const { createRequire } = await import("node:module");
const mod = await import(createRequire("/opt/agent/cursor-sdk/package.json").resolve("@cursor/sdk"));
const sdk = mod.Agent ? mod : mod.default;
const timer = setTimeout(() => { console.log("TIMEOUT"); process.exit(0); }, 60000);
try {
  const agent = await sdk.Agent.create({ apiKey: process.env.CURSOR_API_KEY, model: { id: "auto" }, local: { cwd: "/tmp" } });
  const run = await agent.send({ type: "user", text: "say ok" }, {});
  for await (const event of run) { console.log("EVENT", JSON.stringify(event).slice(0, 120)); break; }
} catch (error) { console.log("ERR", String(error?.message ?? error).slice(0, 300)); }
clearTimeout(timer); process.exit(0);
EOF
smol machine cp "$SPIKE_ROOT/cursor-probe.mjs" cred:/tmp/cursor-probe.mjs > /dev/null
out=$(cc 'node /tmp/cursor-probe.mjs')
record cursor.out "$out"
record cursor.curl_exchange_status "$(x -- sh -c 'curl -s -o /dev/null -w %{http_code} -X POST https://api2.cursor.sh/auth/exchange_user_api_key -H "Authorization: Bearer $CURSOR_API_KEY" -H content-type:application/json -d "{}"')"

# 5. The runner bearer on our deployment's host.
record runner.vespin_status "$(x -- node -e 'fetch("https://vespin.dev/api/health",{headers:{authorization:"Bearer "+process.env.VESPIN_RUNNER_BEARER}}).then(r=>console.log(r.status),e=>console.log("ERR",e.cause?.code||e.message))')"

# 6. GitHub by set-header: first the bad value, then a live rotation to the job token.
rl() { x -- sh -c 'gh api rate_limit --jq .resources.core.limit 2>&1 | head -1'; }
record github.rate_limit_before "$(rl)"
t0=$(now_ms)
GH_AUTH="$GH_GOOD" smol machine credentials refresh --name cred > /dev/null 2>&1
record github.refresh_rc $?
record github.refresh_ms $(($(now_ms) - t0))
after=$(rl)
record github.rate_limit_after_refresh "$after"
check github_rotation_live $([ "$after" -gt 60 ] 2> /dev/null && echo 0 || echo 1)
branch="spike/smolvm-scratch-${GITHUB_RUN_ID:-local}"
out=$(x --timeout 300s -- sh -c '
  set -e
  cd /vercel && rm -rf c && git clone -q --depth 1 https://github.com/'"${GITHUB_REPOSITORY:-ReviewStage/vespin}"'.git c && cd c
  git config user.name spike && git config user.email spike@example.invalid
  git checkout -q -b '"$branch"' && date > smolvm-scratch.txt && git add smolvm-scratch.txt && git commit -qm "spike: scratch (deleted at once)"
  git push -q origin HEAD 2>&1 && echo PUSH_OK
  gh pr create --dry-run --base main --head '"$branch"' --title "spike dry run" --body "dry run" > /tmp/pr.out 2>&1 && echo PR_DRY_RUN_OK || { echo PR_DRY_RUN_FAIL; tail -3 /tmp/pr.out; }
  git push -q origin --delete '"$branch"' 2>&1 && echo DELETE_OK
' 2>&1 | tr '\n' ' ')
record github.flow "$out"
record github.gh_version "$(x -- /usr/bin/gh --version | head -1)"
check github_push $(grep -q PUSH_OK <<< "$out"; echo $?)
check github_pr_dry_run $(grep -q PR_DRY_RUN_OK <<< "$out"; echo $?)

# 7. A file-backed binding, rotated in place with no call at all.
printf '%s' "$GH_BAD" > "$SPIKE_ROOT/gh-auth" && chmod 600 "$SPIKE_ROOT/gh-auth"
smol machine create --name credf --block-private --secret-file "GH_AUTH=$SPIKE_ROOT/gh-auth" \
  --credential github=GH_AUTH@api.github.com:set-header=authorization --image "$IMAGE" -- sleep infinity > /dev/null
smol machine start --name credf > /dev/null
record github_file.rate_limit_before "$(smol machine exec --name credf -- sh -c 'gh api rate_limit --jq .resources.core.limit 2>&1 | head -1')"
printf '%s' "$GH_GOOD" > "$SPIKE_ROOT/gh-auth"
after=$(smol machine exec --name credf -- sh -c 'gh api rate_limit --jq .resources.core.limit 2>&1 | head -1')
record github_file.rate_limit_after_rewrite "$after"
check github_file_rotation $([ "$after" -gt 60 ] 2> /dev/null && echo 0 || echo 1)
record guest_file.GH_AUTH "$(smol machine exec --name credf -- sh -c 'printenv GH_AUTH | cut -c1-17')"

# 8. Leaks: no real value in the guests' process environments, their disks, or smolvm's records.
leaks() { # FILE... -> count of files holding any real value
  local n=0 f s
  for f in "$@"; do
    for s in "${SECRETS[@]}"; do
      if LC_ALL=C grep -qaF -- "$s" "$f" 2> /dev/null; then n=$((n + 1)); break; fi
    done
  done
  echo "$n"
}
for m in cred credf; do
  smol machine exec --name "$m" -u root -- sh -c 'for f in /proc/[0-9]*/environ; do tr "\0" "\n" < $f; done 2>/dev/null' > "$SPIKE_ROOT/$m.environ"
  record "leak.$m.environ_lines" "$(wc -l < "$SPIKE_ROOT/$m.environ")"
  record "leak.$m.environ" "$(leaks "$SPIKE_ROOT/$m.environ")"
  smol machine exec --name "$m" -u root -- sh -c 'sync'
  dd=$(smol machine data-dir --name "$m")
  record "leak.$m.data_dir_files" "$(find "$dd" -type f | wc -l)"
  record "leak.$m.data_dir" "$(leaks $(find "$dd" -type f -size -40G))"
done
smol machine stop --name cred > /dev/null
smol machine stop --name credf > /dev/null
record leak.smolvm_state_files "$(find "$XDG_DATA_HOME/smolvm" "$XDG_CONFIG_HOME/smolvm" -type f | wc -l)"
record leak.smolvm_state "$(leaks $(find "$XDG_DATA_HOME/smolvm" "$XDG_CONFIG_HOME/smolvm" -type f))"
for m in cred credf; do
  dd=$(smol machine data-dir --name "$m")
  record "leak.$m.data_dir_after_stop" "$(leaks $(find "$dd" -type f -size -40G))"
done
total=$(grep -E '^leak\.[a-z.]*(environ|data_dir|data_dir_after_stop|smolvm_state)=' "$RESULTS_DIR/$ROW.txt" | cut -d= -f2 | paste -sd+ | bc)
check no_real_secret_in_guest_or_record $([ "$total" -eq 0 ] && echo 0 || echo 1)
smol machine delete --name cred --force > /dev/null
smol machine delete --name credf --force > /dev/null
rm -f "$SPIKE_ROOT/gh-auth"
