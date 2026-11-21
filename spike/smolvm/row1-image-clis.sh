#!/usr/bin/env bash
# row1-image-clis.sh -- row 1, run inside the built image (docker run --privileged): every CLI runs on this arch.
# Prints `key=value` lines; the workflow appends them to the row's results.

set -u
arch=$(uname -m)
echo "clis.arch=$arch"
v() { "$@" 2>&1 | head -1 | tr -d '\r'; }
echo "clis.claude=$(v claude --version)"
echo "clis.codex=$(v codex --version)"
echo "clis.node=$(v node --version)"
echo "clis.pnpm=$(v pnpm --version)"
echo "clis.gh=$(v /usr/bin/gh --version)"
if gh stack --help > /dev/null 2>&1; then echo "clis.gh_stack=PASS"; else echo "clis.gh_stack=FAIL"; fi
case "$arch" in x86_64) sdk=x64 ;; aarch64) sdk=arm64 ;; esac
echo "clis.cursor_sdk=$(node -p "require('/opt/agent/cursor-sdk/node_modules/@cursor/sdk-linux-$sdk/package.json').version" 2>&1)"
# The Cursor SDK loads at all (its native bindings for this arch).
if node --input-type=module -e "const m = await import('/opt/agent/cursor-sdk/node_modules/@cursor/sdk/dist/index.js').catch(() => import('@cursor/sdk')); if (!m.Agent) process.exit(1)" 2> /tmp/cursor-load.err \
  || (cd /opt/agent/cursor-sdk && node --input-type=module -e "const m = await import('@cursor/sdk'); if (!m.Agent) process.exit(1)" 2>> /tmp/cursor-load.err); then
  echo "clis.cursor_sdk_import=PASS"
else
  echo "clis.cursor_sdk_import=FAIL"
  tail -3 /tmp/cursor-load.err | tr '\n' ' ' | sed 's/^/# cursor import: /'; echo
fi
# The runner bundle loads and waits for its config (exit 3 = RUNNER_EXIT.UNCONFIGURED).
node /opt/agent/agent-runner/agent-runner.mjs < /dev/null > /dev/null 2>&1
echo "clis.runner_exit=$?"
# Playwright's Chromium: a headless screenshot.
cat > /tmp/shot.mjs <<'EOF'
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";
const t0 = Date.now();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<h1>smolvm spike</h1>");
await page.screenshot({ path: "/tmp/shot.png" });
await browser.close();
console.log(`chromium_ms=${Date.now() - t0}`);
EOF
if out=$(PLAYWRIGHT_BROWSERS_PATH=0 node /tmp/shot.mjs 2>&1); then echo "clis.$out"; echo "clis.chromium=PASS"; else echo "clis.chromium=FAIL"; echo "# chromium: $(echo "$out" | tail -2 | tr '\n' ' ')"; fi
# Docker: the daemon the image ships, a hello-world.
if sudo -n true 2> /dev/null; then
  if docker run --rm hello-world 2>&1 | grep -q "Hello from Docker"; then echo "clis.docker=PASS"; else echo "clis.docker=FAIL"; tail -5 /var/log/dockerd.log 2> /dev/null | sed 's/^/# dockerd: /'; fi
fi
