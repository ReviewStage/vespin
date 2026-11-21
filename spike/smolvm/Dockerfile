# syntax=docker/dockerfile:1
#
# Dockerfile -- the smolvm spike's host agent image: apps/web/agent-image's body on a public
# ubuntu:24.04 base, for amd64 and arm64. Throwaway (spike/smolvm-workspace-agents, never merged).
#
# What Vercel's base supplies is made here: Node 24, pnpm, git, sudo, the `ubuntu` user and
# HOME=/vercel. Every architecture-specific path is chosen by TARGETARCH.

FROM ubuntu:24.04

ARG TARGETARCH
ARG NODE_MAJOR=24
ARG PNPM_VERSION=10.34.5
ARG PLAYWRIGHT_VERSION=1.64.1
ARG CLAUDE_AGENT_SDK_VERSION=0.3.328
ARG CLAUDE_CODE_VERSION=2.1.328
ARG CODEX_VERSION=0.170.0
ARG CURSOR_SDK_VERSION=1.4.2
ARG GH_STACK_VERSION=v0.2.1
ARG DEBIAN_FRONTEND=noninteractive

USER root
ENV HOME=/root

# What Vercel's node:24 base carries: git, sudo, CA roots, xz for Node's tarball, and the ubuntu user
# (ubuntu:24.04 already has uid 1000 `ubuntu`) with passwordless sudo.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git sudo xz-utils openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && echo 'ubuntu ALL=(ALL:ALL) NOPASSWD: ALL' > /etc/sudoers.d/ubuntu && chmod 0440 /etc/sudoers.d/ubuntu

# Node from nodejs.org, its tarball checked against the release's SHASUMS256, then pnpm.
RUN case "$TARGETARCH" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) echo "arch $TARGETARCH" >&2; exit 1 ;; esac \
 && base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x" \
 && file=$(curl -fsSL "$base/SHASUMS256.txt" | awk -v a="linux-${node_arch}.tar.xz" '$2 ~ a"$" {print $2}') \
 && curl -fsSLO "$base/$file" \
 && curl -fsSL "$base/SHASUMS256.txt" | grep " $file\$" | sha256sum -c - \
 && tar -xJf "$file" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude LICENSE --exclude README.md \
 && rm "$file" \
 && npm install --global --no-audit --no-fund "pnpm@${PNPM_VERSION}" \
 && node --version && pnpm --version

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python-is-python3 tmux gh \
      jq ripgrep unzip zstd procps bind9-dnsutils ffmpeg \
      poppler-utils libheif-examples libheif-plugin-libde265 \
 && rm -rf /var/lib/apt/lists/*
COPY tmux.conf /etc/tmux.conf

RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io docker-compose-v2 docker-buildx \
 && usermod -aG docker ubuntu \
 && rm -rf /var/lib/apt/lists/*

RUN npm install --global --prefix /usr/local --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} \
 && PLAYWRIGHT_BROWSERS_PATH=0 playwright install --with-deps chromium \
 && apt-get install -y --no-install-recommends libgtk-3-0t64 \
 && chmod -R a+rX /usr/local/lib/node_modules/playwright/node_modules/playwright-core/.local-browsers \
 && ls -d /usr/local/lib/node_modules/playwright/node_modules/playwright-core/.local-browsers/chromium-* \
 && rm -rf /var/lib/apt/lists/* \
 && npm cache clean --force

# The amd64-only pins of apps/web/agent-image, made per architecture: the SDK's platform package.
RUN case "$TARGETARCH" in amd64) sdk_arch=x64 ;; arm64) sdk_arch=arm64 ;; esac \
 && npm install --prefix /opt/agent/claude-agent-sdk --no-audit --no-fund --save-exact \
      @anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION} \
 && ln -sfn /opt/agent/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-${sdk_arch}/claude /usr/local/bin/claude \
 && claude --version | grep -q "^${CLAUDE_CODE_VERSION} " \
 && npm install --global --prefix /opt/agent/codex --no-audit --no-fund @openai/codex@${CODEX_VERSION} \
 && ln -sfn /opt/agent/codex/bin/codex /usr/local/bin/codex \
 && codex --version | grep -Fxq "codex-cli ${CODEX_VERSION}" \
 && npm cache clean --force

# Cursor's SDK, its platform package checked by architecture (sdk-linux-x64 or sdk-linux-arm64).
RUN case "$TARGETARCH" in amd64) sdk_arch=x64 ;; arm64) sdk_arch=arm64 ;; esac \
 && npm install --prefix /opt/agent/cursor-sdk --no-audit --no-fund --save-exact \
      @cursor/sdk@${CURSOR_SDK_VERSION} \
 && node -p "require('/opt/agent/cursor-sdk/node_modules/@cursor/sdk-linux-${sdk_arch}/package.json').version" \
      | grep -Fxq "${CURSOR_SDK_VERSION}" \
 && npm cache clean --force

COPY --chmod=0755 <<'EOF' /usr/local/bin/gh
#!/usr/bin/env bash
export GH_TOKEN="${GH_TOKEN:-"ghp_"000000000000000000000000000000000000}"
if [ "${1:-}" = stack ]; then shift; exec /usr/local/lib/gh-stack/gh-stack "$@"; fi
exec /usr/bin/gh "$@"
EOF

COPY --chmod=0755 <<'EOF' /usr/local/bin/docker
#!/usr/bin/env bash
case "${DOCKER_HOST:-}" in "" | unix:///var/run/docker.sock | unix:///run/docker.sock) local_host=1 ;; *) local_host= ;; esac
case "${DOCKER_CONTEXT:-}" in "" | default) local_context=1 ;; *) local_context= ;; esac
if [ -n "$local_host" ] && [ -n "$local_context" ]; then
  if ! pgrep -x dockerd > /dev/null; then
    sudo -n sh -c 'setsid -f dockerd >> /var/log/dockerd.log 2>&1 < /dev/null'
  fi
  if ! timeout 30 sh -c 'until /usr/bin/docker info > /dev/null 2>&1; do sleep 0.2; done'; then
    echo "docker: the daemon did not answer; its log is /var/log/dockerd.log" >&2
  fi
fi
exec /usr/bin/docker "$@"
EOF

COPY --chmod=0440 <<'EOF' /etc/sudoers.d/agent
agent ALL=(ALL:ALL) NOPASSWD: ALL
EOF
RUN visudo -cf /etc/sudoers.d/agent

# gh-stack per architecture, each with the digest GitHub publishes for that asset.
RUN case "$TARGETARCH" in \
      amd64) asset=linux-amd64; sum=ffe9d48b6342faffc3b0cb420202ff1df32e24faf32693debd7423274bbdf859 ;; \
      arm64) asset=linux-arm64; sum=25ec261a391261a1462d38f85c230b0e0b14ae3547926130996541f62f25f78b ;; \
    esac \
 && install -d /usr/local/lib/gh-stack \
 && curl -fsSL -o /usr/local/lib/gh-stack/gh-stack "https://github.com/github/gh-stack/releases/download/${GH_STACK_VERSION}/${asset}" \
 && echo "${sum}  /usr/local/lib/gh-stack/gh-stack" | sha256sum -c - \
 && chmod 0755 /usr/local/lib/gh-stack/gh-stack \
 && runuser -u nobody -- env HOME=/tmp GH_STACK_NO_UPDATE_NOTIFIER=1 gh stack --help > /dev/null

RUN install -d -m 0755 /opt/agent/agent-runner
COPY --chmod=0444 agent-runner/ /opt/agent/agent-runner/
RUN runuser -u nobody -- cat /opt/agent/agent-runner/* > /dev/null

RUN install -d -o ubuntu -g ubuntu /workspace /vercel

USER ubuntu
ENV HOME=/vercel
WORKDIR /vercel
CMD ["sleep", "infinity"]
