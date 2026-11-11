/**
 * bump-agent-pins.mjs -- move the pinned Claude Agent SDK or Codex to a newer npm release, every pin of it read off the release itself.
 *
 * `pnpm --filter @repo/agent-runner bump:agent-pins [claude|codex][@<version>]...`,
 * both tools where none is named. For each tool it picks the newest stable
 * release npm has held for at least `MIN_AGE_HOURS` (or the version named),
 * and where that is newer than the pin, it rewrites every place the release
 * lives together, as `tools/anti-slop/guards/agent-pins.ts` holds them:
 * `src/pins.ts`'s sandbox pin and `HOST_CLI_VERSION`, each host pin's
 * address, size, SHA-256, and file digests, the image's `ARG`s
 * (`apps/web/agent-image/Dockerfile`), and, for Claude, this package's SDK
 * dependency and the lockfile, and for Codex, the generated app-server
 * protocol (`generate-codex-protocol.mjs`).
 *
 * Note that nothing here loosens what a host checks: each archive is fetched
 * from the address its pin names, which must be npm's own tarball address,
 * held to npm's SHA-512 integrity before anything is read off it, and a
 * signed build's Developer ID team is read off its Mach-O signature and must
 * be the team pinned already, as must the programs a pin digests, so
 * a release that changes either stops the bump for a person to decide. Each
 * bump it makes is printed to stdout as one line of JSON
 * (`{"tool","from","to"}`, and Claude's `claude` beside it); everything else
 * goes to stderr.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as pins from "../src/pins.ts";

/** How long npm must have held a release before it is taken, so one pulled for a fault within the day is never pinned. */
const MIN_AGE_HOURS = 24;

const REGISTRY = "https://registry.npmjs.org";
const SDK = "@anthropic-ai/claude-agent-sdk";
const CODEX = "@openai/codex";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const PINS_FILE = path.join(packageRoot, "src", "pins.ts");
const PACKAGE_FILE = path.join(packageRoot, "package.json");
const DOCKERFILE = path.join(repositoryRoot, "apps", "web", "agent-image", "Dockerfile");

/** Mach-O's magic numbers and the one load command read here (`<mach-o/loader.h>`, `<kern/cs_blobs.h>`). */
const MACH_O = {
  MAGIC_64: 0xfeedfacf,
  FAT_MAGIC: 0xcafebabe,
  CPU_TYPE_ARM64: 0x0100000c,
  LC_CODE_SIGNATURE: 0x1d,
  EMBEDDED_SIGNATURE: 0xfade0cc0,
  CODE_DIRECTORY: 0xfade0c02,
  /** The first CodeDirectory version to carry a team. */
  SUPPORTS_TEAM_ID: 0x20200,
};

/** Each tool: its npm package, its host pins with the npm package and version each build is, and where its versions stand. */
const TOOLS = {
  claude: {
    title: "Claude Agent SDK",
    package: SDK,
    current: () => pins.CLAUDE_CODE_PIN.SDK_VERSION,
    hostPins: [
      ["CLAUDE_CODE_MAC_PIN", pins.CLAUDE_CODE_MAC_PIN, `${SDK}-darwin-arm64`, ""],
      ["CLAUDE_CODE_LINUX_PINS.x64", pins.CLAUDE_CODE_LINUX_PINS.x64, `${SDK}-linux-x64`, ""],
      ["CLAUDE_CODE_LINUX_PINS.arm64", pins.CLAUDE_CODE_LINUX_PINS.arm64, `${SDK}-linux-arm64`, ""],
    ],
  },
  codex: {
    title: "Codex",
    package: CODEX,
    current: () => pins.CODEX_PIN.VERSION,
    hostPins: [
      ["CODEX_MAC_PIN", pins.CODEX_MAC_PIN, CODEX, "-darwin-arm64"],
      ["CODEX_LINUX_PINS.x64", pins.CODEX_LINUX_PINS.x64, CODEX, "-linux-x64"],
      ["CODEX_LINUX_PINS.arm64", pins.CODEX_LINUX_PINS.arm64, CODEX, "-linux-arm64"],
    ],
  },
};

/** Write a line of progress to stderr, which stdout's JSON leaves clean. */
function say(line) {
  process.stderr.write(`${line}\n`);
}

/** Run a command from the repository's root, its output to stderr. */
function run(command, args, cwd = repositoryRoot) {
  execFileSync(command, args, { cwd, stdio: ["ignore", process.stderr, process.stderr] });
}

async function registryJson(name) {
  const answer = await fetch(`${REGISTRY}/${name}`);
  if (!answer.ok) throw new Error(`${REGISTRY}/${name} answered ${answer.status}`);
  return answer.json();
}

/** A stable `x.y.z` as numbers, or undefined for a prerelease or a platform build (`0.167.0-linux-x64`). */
function stable(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  return match ? match.slice(1).map(Number) : undefined;
}

function newer(left, right) {
  const [a, b] = [stable(left), stable(right)];
  const index = a.findIndex((part, at) => part !== b[at]);
  return index !== -1 && a[index] > b[index];
}

/** The newest stable release at or below `latest` that npm has held for `MIN_AGE_HOURS`. */
async function chooseRelease(name) {
  const packument = await registryJson(name);
  const latest = packument["dist-tags"].latest;
  const before = Date.now() - MIN_AGE_HOURS * 3_600_000;
  const settled = Object.keys(packument.versions).filter(
    (version) =>
      stable(version) &&
      !newer(version, latest) &&
      Date.parse(packument.time[version]) <= before &&
      !packument.versions[version].deprecated,
  );
  if (settled.length === 0) throw new Error(`${name} has no stable release ${MIN_AGE_HOURS}h old`);
  return settled.reduce((best, version) => (newer(version, best) ? version : best));
}

/**
 * The executables a pin's digests must cover: each regular file with an
 * executable bit under the kept `members` that stands in a folder the pinned
 * `files` already name one in, by its path under `root`. Note that a new
 * program beside the pinned ones (another `bin/codex-*`) is what this
 * catches, while a folder of libraries the pin never digested is left alone.
 */
function pinnedExecutables(root, members, files) {
  const folders = new Set(files.map((file) => path.dirname(file)));
  const found = [];
  for (const member of members) {
    const at = path.join(root, member);
    const entries = statSync(at).isDirectory()
      ? readdirSync(at, { recursive: true, withFileTypes: true }).map((entry) =>
          path.join(entry.parentPath, entry.name),
        )
      : [at];
    for (const file of entries) {
      const info = statSync(file, { throwIfNoEntry: false });
      const relative = path.relative(root, file);
      const executable = info?.isFile() && (info.mode & 0o111) !== 0;
      if (executable && folders.has(path.dirname(relative))) found.push(relative);
    }
  }
  return found.sort();
}

/** The team a CodeDirectory names, or undefined where its version carries none. */
function codeDirectoryTeam(bytes, directory) {
  if (bytes.readUInt32BE(directory) !== MACH_O.CODE_DIRECTORY) throw new Error("no CodeDirectory");
  if (bytes.readUInt32BE(directory + 8) < MACH_O.SUPPORTS_TEAM_ID) return undefined;
  const offset = bytes.readUInt32BE(directory + 48);
  if (offset === 0) return undefined;
  const start = directory + offset;
  return bytes.toString("latin1", start, bytes.indexOf(0, start));
}

/** The embedded signature's first CodeDirectory (slot 0), read from its SuperBlob, which is big-endian. */
function signatureTeam(bytes, blob) {
  if (bytes.readUInt32BE(blob) !== MACH_O.EMBEDDED_SIGNATURE) throw new Error("no signature");
  const count = bytes.readUInt32BE(blob + 8);
  for (let index = 0; index < count; index += 1) {
    const entry = blob + 12 + index * 8;
    if (bytes.readUInt32BE(entry) === 0) {
      return codeDirectoryTeam(bytes, blob + bytes.readUInt32BE(entry + 4));
    }
  }
  throw new Error("a signature with no CodeDirectory");
}

/** Where a binary's arm64 Mach-O starts: the file's start, or its arm64 slice of a universal binary. */
function arm64Slice(bytes) {
  if (bytes.readUInt32BE(0) !== MACH_O.FAT_MAGIC) return 0;
  const count = bytes.readUInt32BE(4);
  for (let index = 0; index < count; index += 1) {
    const arch = 8 + index * 20;
    if (bytes.readUInt32BE(arch) === MACH_O.CPU_TYPE_ARM64) return bytes.readUInt32BE(arch + 8);
  }
  throw new Error("a universal binary with no arm64 slice");
}

/**
 * The Developer ID team a macOS binary's signature claims, read from its
 * Mach-O as `codesign -dv` reports it. Note that this only reads the claim:
 * the Mac verifies the signature before it keeps the build, and here the
 * claim must be the team already pinned.
 */
function machOTeam(file) {
  const bytes = readFileSync(file);
  const base = arm64Slice(bytes);
  if (bytes.readUInt32LE(base) !== MACH_O.MAGIC_64) throw new Error(`${file} is no 64-bit Mach-O`);
  const commands = bytes.readUInt32LE(base + 16);
  let at = base + 32;
  for (let index = 0; index < commands; index += 1) {
    if (bytes.readUInt32LE(at) === MACH_O.LC_CODE_SIGNATURE) {
      return signatureTeam(bytes, base + bytes.readUInt32LE(at + 8));
    }
    at += bytes.readUInt32LE(at + 4);
  }
  throw new Error(`${file} is not signed`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** An archive npm keeps, fetched and held to npm's own integrity before anything is read off it. */
async function fetchArchive(name, version, archive) {
  const manifest = await registryJson(`${name}/${version}`);
  if (manifest.dist.tarball !== archive) {
    throw new Error(`the pin's address ${archive} is not npm's ${manifest.dist.tarball}`);
  }
  const answer = await fetch(archive);
  if (!answer.ok) throw new Error(`${archive} answered ${answer.status}`);
  const bytes = Buffer.from(await answer.arrayBuffer());
  const [algorithm, digest] = manifest.dist.integrity.split("-");
  if (createHash(algorithm).update(bytes).digest("base64") !== digest) {
    throw new Error(`${archive} does not match npm's integrity`);
  }
  return bytes;
}

/**
 * A host pin as the new release reads: its address, size, and digests, each
 * read off the archive, its kept layout, team, and executables checked to be
 * the pin's own.
 */
async function readHostPin([label, pin, name, suffix], from, to) {
  const archive = pin.ARCHIVE.replaceAll(from, to);
  say(`  ${label}: ${archive}`);
  const bytes = await fetchArchive(name, `${to}${suffix}`, archive);
  const scratch = mkdtempSync(path.join(tmpdir(), "agent-pin-"));
  try {
    writeFileSync(path.join(scratch, "archive.tgz"), bytes);
    run("tar", ["-xzf", "archive.tgz"], scratch);
    const root = path.join(scratch, pin.ROOT);
    const pinned = Object.keys(pin.FILES ?? {}).sort();
    const kept = pinnedExecutables(root, pin.MEMBERS, pinned);
    if (kept.join() !== pinned.join()) {
      throw new Error(`${label} keeps executables ${kept.join(", ")}, not ${pinned.join(", ")}`);
    }
    const team = pin.TEAM && machOTeam(path.join(root, pin.BINARY));
    if (team !== pin.TEAM) throw new Error(`${label} is signed by ${team}, not ${pin.TEAM}`);
    const files = Object.fromEntries(
      pinned.map((file) => [file, sha256(readFileSync(path.join(root, file)))]),
    );
    return { label, pin, sha256: sha256(bytes), bytes: bytes.length, files };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A size as `pins.ts` writes it, its thousands set off by underscores. */
function sizeLiteral(bytes) {
  return String(bytes).replace(/\B(?=(\d{3})+(?!\d))/gu, "_");
}

/** `text` with `from` replaced by `to`, where `from` stands exactly once. */
function replaceOnce(text, from, to, where) {
  const count = text.split(from).length - 1;
  if (count !== 1)
    throw new Error(`${where} names ${JSON.stringify(from)} ${count} times, not once`);
  return text.replace(from, () => to);
}

/** `pins.ts` with a host pin's size and digests moved to what its new release reads. */
function writeHostPin(text, read) {
  let next = replaceOnce(text, `"${read.pin.SHA256}"`, `"${read.sha256}"`, "pins.ts");
  next = replaceOnce(
    next,
    `BYTES: ${sizeLiteral(read.pin.BYTES)},`,
    `BYTES: ${sizeLiteral(read.bytes)},`,
    "pins.ts",
  );
  for (const [file, digest] of Object.entries(read.files)) {
    next = replaceOnce(next, `"${read.pin.FILES[file]}"`, `"${digest}"`, "pins.ts");
  }
  return next;
}

/** A file rewritten through `edit`, with what it wrote. */
function rewrite(file, edit) {
  writeFileSync(file, edit(readFileSync(file, "utf8")));
}

/** Every version-naming line of the sandbox's pin, the hosts' versions, and the image moved for one tool. */
function versionEdits(tool, from, to, claude) {
  if (tool === "claude") {
    return {
      pins: [
        [`SDK_VERSION: "${from}"`, `SDK_VERSION: "${to}"`],
        [`  VERSION: "${pins.CLAUDE_CODE_PIN.VERSION}",`, `  VERSION: "${claude}",`],
        [`CLAUDE_CODE: "${from}"`, `CLAUDE_CODE: "${to}"`],
      ],
      image: [
        [`ARG CLAUDE_AGENT_SDK_VERSION=${from}\n`, `ARG CLAUDE_AGENT_SDK_VERSION=${to}\n`],
        [
          `ARG CLAUDE_CODE_VERSION=${pins.CLAUDE_CODE_PIN.VERSION}\n`,
          `ARG CLAUDE_CODE_VERSION=${claude}\n`,
        ],
      ],
    };
  }
  return {
    pins: [
      [`  VERSION: "${from}",`, `  VERSION: "${to}",`],
      [`CODEX: "${from}"`, `CODEX: "${to}"`],
    ],
    image: [[`ARG CODEX_VERSION=${from}\n`, `ARG CODEX_VERSION=${to}\n`]],
  };
}

/** The `claude` binary a release of the SDK carries, as the SDK's own manifest names it. */
async function claudeCodeVersion(version) {
  const manifest = await registryJson(`${SDK}/${version}`);
  if (typeof manifest.claudeCodeVersion !== "string") {
    throw new Error(`${SDK}@${version} names no claudeCodeVersion`);
  }
  return manifest.claudeCodeVersion;
}

/**
 * One tool moved to `to`: every host pin read off the release first, so a
 * release that fails a check leaves every file as it stood, then each file
 * written, then what is generated from them.
 */
async function bump(tool, to) {
  const spec = TOOLS[tool];
  const from = spec.current();
  const claude = tool === "claude" ? await claudeCodeVersion(to) : undefined;
  say(`${spec.title}: ${from} -> ${to}${claude ? ` (claude ${claude})` : ""}`);
  const reads = [];
  for (const hostPin of spec.hostPins) reads.push(await readHostPin(hostPin, from, to));
  const edits = versionEdits(tool, from, to, claude);
  rewrite(PINS_FILE, (text) =>
    reads.reduce(
      writeHostPin,
      edits.pins.reduce((next, [old, now]) => replaceOnce(next, old, now, "pins.ts"), text),
    ),
  );
  rewrite(DOCKERFILE, (text) =>
    edits.image.reduce((next, [old, now]) => replaceOnce(next, old, now, "the Dockerfile"), text),
  );
  run("pnpm", ["exec", "biome", "format", "--write", PINS_FILE]);
  if (tool === "claude") {
    rewrite(PACKAGE_FILE, (text) =>
      replaceOnce(text, `"${SDK}": "${from}"`, `"${SDK}": "${to}"`, "package.json"),
    );
    // Note that the lockfile is moved alone, then installed from as every checkout is, so the guard reads the SDK it names.
    run("pnpm", ["install", "--lockfile-only"]);
    run(path.join(repositoryRoot, "scripts", "bootstrap.sh"), []);
  } else {
    run("node", [path.join(packageRoot, "scripts", "generate-codex-protocol.mjs")]);
  }
  return { tool, from, to, ...(claude ? { claude } : {}) };
}

/** The tools asked for, each with the version named or undefined for the newest settled release. */
function requested(args) {
  const asked = args.length > 0 ? args : Object.keys(TOOLS);
  return asked.map((arg) => {
    const [tool, version] = arg.split("@");
    if (!(tool in TOOLS))
      throw new Error(`no tool ${tool}: name ${Object.keys(TOOLS).join(" or ")}`);
    if (version !== undefined && !stable(version))
      throw new Error(`${arg} names no stable release`);
    return { tool, version };
  });
}

async function main(args) {
  for (const { tool, version } of requested(args)) {
    const spec = TOOLS[tool];
    const to = version ?? (await chooseRelease(spec.package));
    // Note that a pin is moved only forward from a newest release, since npm's `latest` can briefly point back.
    if (version === undefined && !newer(to, spec.current())) {
      say(`${spec.title}: ${spec.current()} is current (${to} is the newest settled release)`);
      continue;
    }
    process.stdout.write(`${JSON.stringify(await bump(tool, to))}\n`);
  }
}

await main(process.argv.slice(2));
