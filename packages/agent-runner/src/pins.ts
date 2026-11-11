/**
 * pins.ts -- what a coding agent's sandbox pins of Claude Code and Codex: their versions and where the image puts them, read by the image, the sessions, and the protocol generator alike.
 *
 * The image (`apps/web/agent-image/Dockerfile`, whose `ARG`s must match
 * these) installs
 * exactly these, the sessions (`claude-code-sessions.ts`,
 * `codex-sessions.ts`) point the runner at the paths, the runner bundles
 * the same Agent SDK (this package's `package.json`), and Codex's
 * app-server protocol types are generated from the same Codex
 * (`scripts/generate-codex-protocol.mjs`). A bump moves them together.
 * What a device fetches or carries of its own, a host's Node, and the
 * Claude Code, Codex, and GitHub CLI every host keeps for its agents to
 * run on the box itself, is an `AgentToolPin` checked by size, digest, and
 * signature where it has one before it is kept (`@repo/host`'s
 * `localAgentTool`). Erasable syntax alone, so Node runs the generator over
 * it as it stands.
 */

/** The unprivileged user the harness runs as, which a sandbox makes as the Sandbox SDK makes a user (`sandbox-machine.ts`). */
export const AGENT_USER = "agent";

/**
 * Where an agent saves a file the service reads back, a screenshot it shows or a
 * page it posts: a folder each launch makes `agent`'s and world-readable,
 * since the service reads a file as the sandbox's default user, who reads no
 * folder private to `agent`.
 */
export const SHARED_FILES_DIRECTORY = "/tmp/shared";

/**
 * Playwright as the image installs it, where every user of every machine
 * reaches it: the package and its `playwright` command under `/usr/local`,
 * on every PATH and in `NODE_PATH`'s usual root, and its browsers inside its
 * own playwright-core, Playwright's hermetic install, rather than in the
 * cache of the user who built the image, whose home the cloud's `agent`
 * does not read. Each Playwright looks in
 * its own package for its browsers only where `PLAYWRIGHT_BROWSERS_PATH` is
 * `0`, so the runner hands both harnesses' commands that in the cloud alone
 * (`SANDBOX_TOOL_ENV`, `launch.ts`'s `toolEnvOf`), which also has a
 * repository's own Playwright install its browsers in its own
 * `node_modules`, which the agent writes, rather than in a shared folder it
 * may not. A host's agents keep the machine's own Playwright settings. `BROWSERS` is where npm's global install puts them, which the
 * image checks and our own browser reads.
 */
export const PLAYWRIGHT_PIN = {
  VERSION: "1.64.1",
  PREFIX: "/usr/local",
  BROWSERS: "/usr/local/lib/node_modules/playwright/node_modules/playwright-core/.local-browsers",
} as const;

/**
 * Our own browser in an agent's sandbox, as its start (`@repo/service`'s
 * `browser/sandbox-browser.ts`) runs it: Chromium's DevTools port and the X
 * display Xvfb draws it on. It runs as the sandbox's default user, and a
 * stop of the sandbox keeps the browser's profile on its disk.
 */
export const SANDBOX_BROWSER_PIN = {
  /** Chromium's DevTools port on the sandbox's loopback, as its `--remote-debugging-port` flag names it. */
  DEVTOOLS_PORT: 9333,
  /** The program Xvfb runs as, and the display its first argument names. */
  XVFB: "Xvfb",
  DISPLAY: 77,
} as const;

/** What every command a harness runs in the cloud is handed of the image's tools: each Playwright's browsers in its own package (`PLAYWRIGHT_PIN`). */
export const SANDBOX_TOOL_ENV = { PLAYWRIGHT_BROWSERS_PATH: "0" } as const;

/**
 * The directory the image installs our own tools under, only root writing
 * it. Note that a persistent sandbox resumes from its own snapshot of the
 * image it was made from, so one made before the product's rename holds them
 * under `SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME`, which each launch links this
 * name to (`sandbox-machine.ts`'s launch).
 */
export const SANDBOX_TOOLS_DIRECTORY = "/opt/agent";

/** Where a sandbox made before the rename holds our tools, read through `SANDBOX_TOOLS_DIRECTORY`'s link and never written. */
export const SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME = "/opt/luke";

/** Where a sandbox keeps the runner's unit (`RUNNER_UNIT`): the image's, which each launch installs the deploy's over (`apps/web/agent-image/Dockerfile`). */
export const RUNNER_DIRECTORY = `${SANDBOX_TOOLS_DIRECTORY}/agent-runner`;

/**
 * The runner as one unit, every file of it named once: its bundle and each
 * file the bundle loads from beside itself, as its build leaves them in
 * `dist/`. Sentry's profiler binary is the one for the sandbox's x64 glibc
 * Linux on Node 24, ABI 137 (`scripts/profiler-binary.mjs`). The image's
 * context holds the unit in a folder of its own, the web build ships it the
 * same way beside each function that opens a sandbox
 * (`apps/web/scripts/agent-image.ts`), and each cloud launch installs it
 * whole over `RUNNER_DIRECTORY` (`@repo/service`'s `sandbox-machine.ts`), so
 * no file of it comes from another build than the bundle, whatever disk the
 * sandbox resumed on.
 */
export const RUNNER_UNIT = {
  BUNDLE: "agent-runner.mjs",
  PROFILER: "sentry_cpu_profiler-linux-x64-glibc-137.node",
} as const;

/**
 * The Claude Agent SDK, pinned exactly, and the `claude` binary its
 * platform package carries (the SDK's own `claudeCodeVersion`), so
 * installing the one installs the other. Installed as root in a directory
 * only root writes; the binary is the Linux x86-64 build, the Vercel
 * sandbox's architecture.
 */
export const CLAUDE_CODE_PIN = {
  SDK_VERSION: "0.3.322",
  VERSION: "2.1.322",
  DIRECTORY: `${SANDBOX_TOOLS_DIRECTORY}/claude-agent-sdk`,
  /** The binary, under `DIRECTORY`. */
  BINARY: "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude",
  /** Where the image links the binary as `claude`. */
  LINK: "/usr/local/bin/claude",
} as const;

/** The binary's whole path, which the runner hands the SDK, since the bundled SDK cannot find it on its own. */
export const CLAUDE_EXECUTABLE = `${CLAUDE_CODE_PIN.DIRECTORY}/${CLAUDE_CODE_PIN.BINARY}`;

/**
 * Codex, pinned exactly, installed as root under a prefix only root writes.
 * Its `CODEX_HOME` is in `agent`'s home, on the sandbox's persisted disk, so
 * the threads it keeps there outlive a stop.
 */
export const CODEX_PIN = {
  VERSION: "0.167.0",
  DIRECTORY: `${SANDBOX_TOOLS_DIRECTORY}/codex`,
  /** Where the image links the binary as `codex`. */
  LINK: "/usr/local/bin/codex",
  HOME: `/home/${AGENT_USER}/.codex`,
} as const;

/**
 * A binary a local agent's Mac or host fetches once and keeps (`@repo/host`'s
 * `localAgentTool`), checked before anything in it is kept: an archive at a
 * pinned address, its exact size and SHA-256, and what of it is kept. A bump
 * moves every field together, its digest and size read off the release
 * itself.
 */
export interface AgentToolPin {
  /** The folder it is kept under, beside the other tools. */
  readonly NAME: string;
  /** The folder under `NAME` this release is kept in. */
  readonly VERSION: string;
  /**
   * The archive by its https address: a gzipped tar, or a zip where only a
   * Mac fetches it, which macOS's own tar reads alike.
   */
  readonly ARCHIVE: string;
  /** The archive's SHA-256, in hex: what decides whether anything of it is kept. */
  readonly SHA256: string;
  /** The archive's exact size; an answer past it is refused as it arrives. */
  readonly BYTES: number;
  /** The archive's folder the kept build is. */
  readonly ROOT: string;
  /** The paths under `ROOT` kept, their layout kept. */
  readonly MEMBERS: readonly string[];
  /** The executable, under the kept folder. */
  readonly BINARY: string;
  /**
   * The Developer ID team the binary is signed by, as read off the pinned
   * release, which macOS's own `codesign` must verify and name before the
   * build is kept; none where the release is not signed so, and its digests
   * alone decide.
   */
  readonly TEAM?: string;
  /**
   * The SHA-256 of each kept file that runs on the device, by its path under
   * the kept folder, read off the pinned release: the kept build is answered only while each still matches, since anything of
   * the developer's could have written it since its archive was checked.
   */
  readonly FILES?: Readonly<Record<string, string>>;
}

/**
 * A tool's builds for a host (`apps/host`), one per architecture it runs on,
 * by Node's `process.arch` names (`@repo/features/device-agent-wire`'s
 * `DEVICE_ARCH`), each decided by its digest.
 */
export interface LinuxToolPins {
  readonly x64: AgentToolPin;
  readonly arm64: AgentToolPin;
}

/** The Node release a host's daemon runs on, the one the runner's bundle targets (`node24`). */
const NODE_VERSION = "24.22.1";

/**
 * The Node a host's daemon runs on, as nodejs.org keeps its Linux builds,
 * which the host's release carries (`apps/host/scripts/package.ts`) rather
 * than fetches.
 */
export const NODE_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "node",
    VERSION: NODE_VERSION,
    ARCHIVE: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
    SHA256: "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c",
    BYTES: 58_290_700,
    ROOT: `node-v${NODE_VERSION}-linux-x64`,
    MEMBERS: ["bin/node"],
    BINARY: "bin/node",
  },
  arm64: {
    NAME: "node",
    VERSION: NODE_VERSION,
    ARCHIVE: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.gz`,
    SHA256: "33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3",
    BYTES: 58_021_129,
    ROOT: `node-v${NODE_VERSION}-linux-arm64`,
    MEMBERS: ["bin/node"],
    BINARY: "bin/node",
  },
};

/**
 * The Node a Mac's `vespin-host` runs on, the same release as a Linux host's,
 * which a Mac's release carries (`apps/host/scripts/package.ts --os darwin`).
 */
export const NODE_MAC_PIN: AgentToolPin = {
  NAME: "node",
  VERSION: NODE_VERSION,
  ARCHIVE: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
  SHA256: "89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7",
  BYTES: 53_062_778,
  ROOT: `node-v${NODE_VERSION}-darwin-arm64`,
  MEMBERS: ["bin/node"],
  BINARY: "bin/node",
};

/**
 * The Agent SDK release every host's own Claude Code is, and the Codex and
 * GitHub CLI releases beside it, each written out in its pins below rather
 * than read off `CLAUDE_CODE_PIN` and `CODEX_PIN`, so a bump reads each
 * pin's address, size, and digests off the new release too
 * (`scripts/bump-agent-pins.mjs`).
 */
const HOST_CLI_VERSION = { CLAUDE_CODE: "0.3.322", CODEX: "0.167.0", GH: "2.103.3" } as const;

/**
 * Claude Code on a Mac host, This Mac's among them: the macOS arm64 build of
 * the very Agent SDK the runner pins (`CLAUDE_CODE_PIN.SDK_VERSION`), as npm
 * keeps it, signed by Anthropic.
 */
export const CLAUDE_CODE_MAC_PIN: AgentToolPin = {
  NAME: "claude",
  VERSION: HOST_CLI_VERSION.CLAUDE_CODE,
  ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-${HOST_CLI_VERSION.CLAUDE_CODE}.tgz`,
  SHA256: "7b0c90817ff94002578389efd5280337cde9ecfc43115fc0f76d64ac4e6db128",
  BYTES: 147_737_860,
  ROOT: "package",
  MEMBERS: ["claude"],
  BINARY: "claude",
  TEAM: "Q6L2SF6YDW",
  FILES: { claude: "a9d237949db816a0b7afd88a9a8e1df36b3a597a30f5a41d1c0539eb180a3450" },
};

/**
 * Codex on a Mac host: the sandbox's release (`CODEX_PIN.VERSION`), as npm
 * keeps its macOS arm64 package, signed by OpenAI, its build's folder kept
 * whole, so the binary finds its `codex-path` tools and its resources beside
 * it.
 */
export const CODEX_MAC_PIN: AgentToolPin = {
  NAME: "codex",
  VERSION: HOST_CLI_VERSION.CODEX,
  ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${HOST_CLI_VERSION.CODEX}-darwin-arm64.tgz`,
  SHA256: "6989512a93d5fc74cb221dd348c972bf3cd83592e471bfd9557bccb45eb6fffc",
  BYTES: 148_361_216,
  ROOT: "package/vendor/aarch64-apple-darwin",
  MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
  BINARY: "bin/codex",
  TEAM: "2DC432GLL2",
  FILES: {
    "bin/codex": "030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc",
    "bin/codex-code-mode-host": "5cc29d144fc05e3563f5f90c36adc95bdc287e2297b48ecf0bf4abdf1892d3ab",
    "codex-path/rg": "13424ef22134a65a211e490475bc17a4671e4fad3c82ad4c613fe5978f022a6d",
  },
};

/** GitHub's CLI on a Mac host, as cli/cli's release keeps its macOS arm64 build, a zip, signed by GitHub. */
export const GH_MAC_PIN: AgentToolPin = {
  NAME: "gh",
  VERSION: HOST_CLI_VERSION.GH,
  ARCHIVE: `https://github.com/cli/cli/releases/download/v${HOST_CLI_VERSION.GH}/gh_${HOST_CLI_VERSION.GH}_macOS_arm64.zip`,
  SHA256: "d700207eae9ae98fe2b89535c2c087c07823d4628c56364695a5a07ef311c062",
  BYTES: 14_106_091,
  ROOT: `gh_${HOST_CLI_VERSION.GH}_macOS_arm64`,
  MEMBERS: ["bin/gh"],
  BINARY: "bin/gh",
  TEAM: "VEKTX9H2N7",
  FILES: { "bin/gh": "5f8d7527e2bdf584249b030cdd1550c91d75e8afb40aa3c11573d416817a1260" },
};

/** Claude Code on a Linux host: the glibc Linux builds of the very Agent SDK the runner pins, as npm keeps them. */
export const CLAUDE_CODE_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "claude",
    VERSION: HOST_CLI_VERSION.CLAUDE_CODE,
    ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/-/claude-agent-sdk-linux-x64-${HOST_CLI_VERSION.CLAUDE_CODE}.tgz`,
    SHA256: "cc294a64eacb94472983ba3912612ceecf97c0bf9372027fc94485c89e4594e2",
    BYTES: 159_262_449,
    ROOT: "package",
    MEMBERS: ["claude"],
    BINARY: "claude",
    FILES: { claude: "bfb3703ad5380242328459bc62ada4bde8ae7ba57c6e1eeadb9c00e08874c478" },
  },
  arm64: {
    NAME: "claude",
    VERSION: HOST_CLI_VERSION.CLAUDE_CODE,
    ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64/-/claude-agent-sdk-linux-arm64-${HOST_CLI_VERSION.CLAUDE_CODE}.tgz`,
    SHA256: "5344081b93b8e03ca2a9af70eedae3319e4752460f00b5868c657c61e1b15385",
    BYTES: 160_278_104,
    ROOT: "package",
    MEMBERS: ["claude"],
    BINARY: "claude",
    FILES: { claude: "f220ca50ea4f3222043ff83cc224a1262e0196e9897acc0871efa94235b0c1fd" },
  },
};

/**
 * Codex on a Linux host: the sandbox's release, as npm keeps its Linux
 * packages, static musl builds, each build's folder kept whole, so the
 * binary finds its `codex-path` tools and its own bubblewrap beside it.
 */
export const CODEX_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "codex",
    VERSION: HOST_CLI_VERSION.CODEX,
    ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${HOST_CLI_VERSION.CODEX}-linux-x64.tgz`,
    SHA256: "2dc9aa871abb513c3539d20d025f701faf1974c46ee906bda3a1e1f5026d4434",
    BYTES: 173_743_288,
    ROOT: "package/vendor/x86_64-unknown-linux-musl",
    MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
    BINARY: "bin/codex",
    FILES: {
      "bin/codex": "cdcb45aaa01d0f14e298985e09465aebccd47f64ecd298aea44814af7b62bbda",
      "bin/codex-code-mode-host":
        "83f3e174c2da2f1ca8655cce686e302509640d34c0f4407c1155056f64536e0f",
      "codex-path/rg": "e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849",
      "codex-resources/bwrap": "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c",
    },
  },
  arm64: {
    NAME: "codex",
    VERSION: HOST_CLI_VERSION.CODEX,
    ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${HOST_CLI_VERSION.CODEX}-linux-arm64.tgz`,
    SHA256: "e24d7b6f0af5695a36c04692c3a79672bdadebcac7c44005259cb3cad36ac40e",
    BYTES: 165_851_263,
    ROOT: "package/vendor/aarch64-unknown-linux-musl",
    MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
    BINARY: "bin/codex",
    FILES: {
      "bin/codex": "2fe94d848540ff2a6868c7ebcc494126a974aa409711676d14fa0379e49e6143",
      "bin/codex-code-mode-host":
        "e7b772ff332c16ca2df587e99fe87f217e3ab3432a63846fb1ca1bccbaa24409",
      "codex-path/rg": "e36d0eb52e70696bdf1781392722e05a21bb91d3b7b762ef5ec20e5df2ec687b",
      "codex-resources/bwrap": "0f543a7356ab343b4827222f910461d4196778f328b28acd6c126ef18e9557ab",
    },
  },
};

/** GitHub's CLI on a Linux host, as cli/cli's release keeps its static Linux builds. */
export const GH_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "gh",
    VERSION: HOST_CLI_VERSION.GH,
    ARCHIVE: `https://github.com/cli/cli/releases/download/v${HOST_CLI_VERSION.GH}/gh_${HOST_CLI_VERSION.GH}_linux_amd64.tar.gz`,
    SHA256: "4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d",
    BYTES: 15_031_972,
    ROOT: `gh_${HOST_CLI_VERSION.GH}_linux_amd64`,
    MEMBERS: ["bin/gh"],
    BINARY: "bin/gh",
    FILES: { "bin/gh": "b768184570b12536be4ac1528893f6340d1c6a7b40b56ad45bca9cd0e87ad34d" },
  },
  arm64: {
    NAME: "gh",
    VERSION: HOST_CLI_VERSION.GH,
    ARCHIVE: `https://github.com/cli/cli/releases/download/v${HOST_CLI_VERSION.GH}/gh_${HOST_CLI_VERSION.GH}_linux_arm64.tar.gz`,
    SHA256: "ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63",
    BYTES: 13_661_485,
    ROOT: `gh_${HOST_CLI_VERSION.GH}_linux_arm64`,
    MEMBERS: ["bin/gh"],
    BINARY: "bin/gh",
    FILES: { "bin/gh": "a82a52e1bbe05bcd485f8cbbd5aa67e11a76fce6bdad394a2d179e1c24cfe367" },
  },
};
