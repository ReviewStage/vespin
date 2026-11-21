/**
 * pins.ts -- what a coding agent's sandbox pins of Claude Code, Codex, and Cursor's SDK: their versions and where the image puts them, read by the image, the sessions, and the protocol generator alike.
 *
 * The image (`apps/web/agent-image/Dockerfile`, which
 * `tools/oxlint/vespin/guards/agent-pins.ts` holds to these) installs
 * exactly these, the sessions (`claude-code-sessions.ts`,
 * `codex-sessions.ts`) point the runner at the paths, the runner bundles
 * the same Agent SDK (this package's `package.json`), and Codex's
 * app-server protocol types are generated from the same Codex
 * (`scripts/generate-codex-protocol.mjs`). A bump moves them together.
 * What a device fetches or carries of its own, a host's Node, and the
 * Claude Code, Codex, and GitHub CLI every host, and the Cursor SDK every Mac, keeps for its agents to
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

/**
 * What every command a harness runs in the cloud is handed of the image's
 * tools: each Playwright's browsers in its own package, and the image's global
 * modules on `NODE_PATH`, so a script's `require("playwright")` resolves from
 * any folder (`PLAYWRIGHT_PIN`).
 */
export const SANDBOX_TOOL_ENV = {
  PLAYWRIGHT_BROWSERS_PATH: "0",
  NODE_PATH: `${PLAYWRIGHT_PIN.PREFIX}/lib/node_modules`,
} as const;

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
  SDK_VERSION: "0.3.329",
  VERSION: "2.1.329",
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
  VERSION: "0.171.0",
  DIRECTORY: `${SANDBOX_TOOLS_DIRECTORY}/codex`,
  /** Where the image links the binary as `codex`. */
  LINK: "/usr/local/bin/codex",
  HOME: `/home/${AGENT_USER}/.codex`,
} as const;

/**
 * Cursor's TypeScript SDK, pinned exactly, with the platform package npm
 * installs beside it on the sandbox's Linux x86-64 (`@cursor/sdk-linux-x64`:
 * its tree-sitter bindings and the `rg` its search tools run), installed as
 * root under a prefix only root writes. The runner imports the SDK from
 * here rather than bundling it, so the SDK finds that package beside itself
 * as it looks for it (`CURSOR_SDK_ENTRY`). It needs Node 22.13 or later.
 */
export const CURSOR_SDK_PIN = {
  VERSION: "1.4.2",
  DIRECTORY: `${SANDBOX_TOOLS_DIRECTORY}/cursor-sdk`,
  /** The SDK's ES module entry, under `DIRECTORY`. */
  ENTRY: "node_modules/@cursor/sdk/dist/esm/index.js",
} as const;

/** The SDK's entry's whole path, which the service names in a Cursor launch's config (`sdk`). */
export const CURSOR_SDK_ENTRY = `${CURSOR_SDK_PIN.DIRECTORY}/${CURSOR_SDK_PIN.ENTRY}`;

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
  /**
   * The files under the kept folder `codesign` checks against `TEAM`, where
   * the build that runs is not `BINARY` itself; `BINARY` alone where absent.
   */
  readonly SIGNED?: readonly string[];
  /**
   * Further archives the kept build is made of, each kept whole under a
   * folder of its own inside it, as npm lays a package's dependencies out
   * beside it; none for a tool that is one archive.
   */
  readonly PARTS?: readonly AgentToolPart[];
}

/** One more archive of a tool's kept build (`AgentToolPin.PARTS`), checked by its own size and digest before anything of it is kept. */
export interface AgentToolPart {
  /** The archive by its https address, a gzipped tar. */
  readonly ARCHIVE: string;
  readonly SHA256: string;
  readonly BYTES: number;
  /** The archive's folder kept, whole. */
  readonly ROOT: string;
  /** Where under the kept build it is kept. */
  readonly INTO: string;
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
 * The Agent SDK release every host's own Claude Code is, and the Codex,
 * Cursor SDK, and GitHub CLI releases beside it, each written out in its pins
 * below rather than read off `CLAUDE_CODE_PIN`, `CODEX_PIN`, and
 * `CURSOR_SDK_PIN`, so a bump fails the
 * repository check (`tools/oxlint/vespin/guards/agent-pins.ts`) until each
 * pin's address, size, and digests are read off the new release too.
 */
const HOST_CLI_VERSION = {
  CLAUDE_CODE: "0.3.329",
  CODEX: "0.171.0",
  CURSOR_SDK: "1.4.2",
  GH: "2.103.3",
} as const;

/**
 * Claude Code on a Mac host, This Mac's among them: the macOS arm64 build of
 * the very Agent SDK the runner pins (`CLAUDE_CODE_PIN.SDK_VERSION`), as npm
 * keeps it, signed by Anthropic.
 */
export const CLAUDE_CODE_MAC_PIN: AgentToolPin = {
  NAME: "claude",
  VERSION: HOST_CLI_VERSION.CLAUDE_CODE,
  ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-${HOST_CLI_VERSION.CLAUDE_CODE}.tgz`,
  SHA256: "8282c8c5e2a11b2344be40692fb268701d1ae0cb096f56c79fd82237402b006d",
  BYTES: 162_913_625,
  ROOT: "package",
  MEMBERS: ["claude"],
  BINARY: "claude",
  TEAM: "Q6L2SF6YDW",
  FILES: { claude: "8c1729568b19cdadedd0a978bf692f9f279ef554c8a333c4e132b94fd8725550" },
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
  SHA256: "185e1c789e5fd528390c1a89a6968dca791e9aa3138db830d53afffdc9079ae3",
  BYTES: 157_740_951,
  ROOT: "package/vendor/aarch64-apple-darwin",
  MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
  BINARY: "bin/codex",
  TEAM: "2DC432GLL2",
  FILES: {
    "bin/codex": "fc8d77cf7585aded2b9bc487dad29c4ee2f066123e4e76dd3b17653a8322ce42",
    "bin/codex-code-mode-host": "32c165500689c61b4946197406870fb8f61cff113c7215fe1dbca0d66fd403e2",
    "codex-path/rg": "8e6162ff63d0f0909ad47c8e1df575a8ac716a69a4dc6a9da1f5589bef7b1a25",
  },
};

/** Where npm keeps a package's archive, by its name and the archive's own file name. */
const npmArchive = (name: string, file: string): string =>
  `https://registry.npmjs.org/${name}/-/${file}`;

/**
 * Cursor's SDK on a Mac host: the sandbox's release (`CURSOR_SDK_PIN.VERSION`),
 * as npm keeps it, kept as the SDK's own package folder with what npm would
 * install beside it under its `node_modules`: the macOS arm64 platform
 * package, signed by Cursor (its `rg`, its sandbox, and its tree-sitter
 * bindings), and the SDK's dependencies and its `zod` peer at the releases
 * the sandbox's install resolves. The runner imports the SDK's entry
 * (`BINARY`) from here, so the SDK finds every one of them beside itself as
 * it looks for them. The SDK reads the Mac's own Cursor sign-in, which its
 * `Cursor.auth.login()` keeps at `~/.cursor/sdk/auth.json`.
 */
export const CURSOR_SDK_MAC_PIN: AgentToolPin = {
  NAME: "cursor-sdk",
  VERSION: HOST_CLI_VERSION.CURSOR_SDK,
  ARCHIVE: npmArchive("@cursor/sdk", `sdk-${HOST_CLI_VERSION.CURSOR_SDK}.tgz`),
  SHA256: "38baf2ec3d11c5567b4b885f02146e89b697a4656d462b1c8731e6caba2a12a5",
  BYTES: 4_943_696,
  ROOT: "package",
  MEMBERS: ["package.json", "dist"],
  BINARY: "dist/esm/index.js",
  TEAM: "DCNK4UB866",
  SIGNED: [
    "node_modules/@cursor/sdk-darwin-arm64/bin/rg",
    "node_modules/@cursor/sdk-darwin-arm64/bin/cursorsandbox",
  ],
  FILES: {
    "dist/esm/index.js": "bbaa5f9f0856701126a285b7cc5b418cf4a8eefa01164513e431b0a2d1b7d1d1",
    "node_modules/@cursor/sdk-darwin-arm64/bin/rg":
      "26390c7cf1a18eb518260918d9d9ba4b2d41ee2cf7453f57e874187748d6ffc3",
    "node_modules/@cursor/sdk-darwin-arm64/bin/cursorsandbox":
      "587154e9a49f3239510d4e29f228c6757a0dc0747565f38bf0344a25bb035c28",
    "node_modules/@cursor/sdk-darwin-arm64/vendor/tree-sitter/binding.node":
      "2661b7238d7641a779520152f1b22671d77b1b4c3f2aa25f8e8122642ab11e1c",
    "node_modules/@cursor/sdk-darwin-arm64/vendor/tree-sitter-bash/binding.node":
      "d9dc3d5d94e7c56e400d79928dd286bd0cdccc70db92df35683c455db41387b0",
  },
  PARTS: [
    {
      ARCHIVE: npmArchive(
        "@cursor/sdk-darwin-arm64",
        `sdk-darwin-arm64-${HOST_CLI_VERSION.CURSOR_SDK}.tgz`,
      ),
      SHA256: "38a0ddab8fe6792825094a8e23ed080161e8a19b015dca37b098adc0ea45a917",
      BYTES: 3_510_671,
      ROOT: "package",
      INTO: "node_modules/@cursor/sdk-darwin-arm64",
    },
    {
      ARCHIVE: npmArchive("@bufbuild/protobuf", "protobuf-1.10.0.tgz"),
      SHA256: "2219bc26e399a6e8ee56a3daf8a3bf47f4e935f425c22b812d991316dd665266",
      BYTES: 189_348,
      ROOT: "package",
      INTO: "node_modules/@bufbuild/protobuf",
    },
    {
      ARCHIVE: npmArchive("@connectrpc/connect", "connect-1.7.0.tgz"),
      SHA256: "cdcd4386d3f4d750bcfe5b56d1247eb6c2ed0b2ddd3e496517033f925cfe5206",
      BYTES: 104_162,
      ROOT: "package",
      INTO: "node_modules/@connectrpc/connect",
    },
    {
      ARCHIVE: npmArchive("@connectrpc/connect-web", "connect-web-1.7.0.tgz"),
      SHA256: "8c3fe6386c920e95cec20f483d228c2ba91e084fc99f9002a4445cd9707e700c",
      BYTES: 8_004,
      ROOT: "package",
      INTO: "node_modules/@connectrpc/connect-web",
    },
    {
      ARCHIVE: npmArchive("@statsig/js-client", "js-client-3.31.0.tgz"),
      SHA256: "21d69db8b144ea65fd283aaac108398046a32885e10b65358e66aac290e42ec7",
      BYTES: 231_613,
      ROOT: "package",
      INTO: "node_modules/@statsig/js-client",
    },
    {
      ARCHIVE: npmArchive("@statsig/client-core", "client-core-3.31.0.tgz"),
      SHA256: "7b598abbc7b16ab5f519da5b2747fa503e888b83c2d04a4eb2ae3efae7adba76",
      BYTES: 41_491,
      ROOT: "package",
      INTO: "node_modules/@statsig/client-core",
    },
    {
      ARCHIVE: npmArchive("zod", "zod-4.6.7.tgz"),
      SHA256: "84efd155bed93270286e793fc951be270b536cbd5b0eeb111f0fa3967201d698",
      BYTES: 1_141_941,
      ROOT: "package",
      INTO: "node_modules/zod",
    },
  ],
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
    SHA256: "9b53907c110c34e3f6d953dc288fa32e572c423a0cf37b0d97c8c7a1ea254b98",
    BYTES: 174_004_237,
    ROOT: "package",
    MEMBERS: ["claude"],
    BINARY: "claude",
    FILES: { claude: "30e2724e2aecb1bf5dc9f3130901afb71c5fa229051c190a6d7ad9aff6378d6d" },
  },
  arm64: {
    NAME: "claude",
    VERSION: HOST_CLI_VERSION.CLAUDE_CODE,
    ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64/-/claude-agent-sdk-linux-arm64-${HOST_CLI_VERSION.CLAUDE_CODE}.tgz`,
    SHA256: "afd16216a16be87e090dc93a77e5154668daee108bc8ba9555144e600d993e16",
    BYTES: 174_809_943,
    ROOT: "package",
    MEMBERS: ["claude"],
    BINARY: "claude",
    FILES: { claude: "8489e2c7ba7846b4681b84e559fed4ed5bb265e129e21dc9de9e322157fb2bea" },
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
    SHA256: "e13d67afb0533cc6160b5f4140e4ad07e2acd87adbaa081bbf69b82e90cf4e55",
    BYTES: 172_033_439,
    ROOT: "package/vendor/x86_64-unknown-linux-musl",
    MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
    BINARY: "bin/codex",
    FILES: {
      "bin/codex": "b76a027d6b210f9a8da7aaf321dd235c700f0ef7a794d4a5314b9af6c134f0f0",
      "bin/codex-code-mode-host":
        "f49bd4f0c0cc73cf1ec3a719009e07ce5b6e100520d023c760cc203fb37e5c6f",
      "codex-path/rg": "e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849",
      "codex-resources/bwrap": "91a245ea678a7ae642f383a22576c3c476d0d6d3e2321a553f3ed8d4d487ed74",
    },
  },
  arm64: {
    NAME: "codex",
    VERSION: HOST_CLI_VERSION.CODEX,
    ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${HOST_CLI_VERSION.CODEX}-linux-arm64.tgz`,
    SHA256: "26ae27788c7d962ae64321aba4673f918b99b40c4655246930bf962fa5b81b01",
    BYTES: 176_542_339,
    ROOT: "package/vendor/aarch64-unknown-linux-musl",
    MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
    BINARY: "bin/codex",
    FILES: {
      "bin/codex": "9ba12ec7712e2905b2ea00791f4ebddc9528629cc955d11d25272de445e10643",
      "bin/codex-code-mode-host":
        "f330aa2016dc441e63084cc7030dce79f3815ed14e5de6b18608528e86826656",
      "codex-path/rg": "e36d0eb52e70696bdf1781392722e05a21bb91d3b7b762ef5ec20e5df2ec687b",
      "codex-resources/bwrap": "f5065eb8b9ddd9c89cac0ce79ed1aafab5841c7d9c3e73674c94724d6bf8f7c0",
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
