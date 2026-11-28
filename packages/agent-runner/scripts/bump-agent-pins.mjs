/**
 * bump-agent-pins.mjs -- move the pinned Claude Agent SDK, Codex, or Cursor's SDK to a newer npm release, every pin of it read off the release itself.
 *
 * `pnpm --filter @repo/agent-runner bump:agent-pins [claude|codex|cursor][@<version>]...`,
 * every tool where none is named. For each tool it picks the newest stable
 * release npm has held for at least `MIN_AGE_HOURS` (or the version named),
 * and where that is newer than the pin, it rewrites every place the release
 * lives together, as `tools/oxlint/vespin/guards/agent-pins.ts` holds them:
 * `src/pins.ts`'s sandbox pin and `HOST_CLI_VERSION`, each host pin's
 * address, size, SHA-256, and file digests, and each of its parts'
 * (`AgentToolPin.PARTS`, the Mac's Cursor SDK's), the image's `ARG`s
 * (`apps/web/agent-image/Dockerfile`), and, for Claude and Cursor, this
 * package's SDK dependency and the lockfile, whose platform packages
 * (`@cursor/sdk-linux-x64` and its siblings) move with the SDK, and for
 * Codex, the generated app-server protocol (`generate-codex-protocol.mjs`).
 *
 * Note that nothing here loosens what a host checks: each archive is fetched
 * from the address its pin names, which must be npm's own tarball address,
 * held to npm's SHA-512 integrity before anything is read off it, and a
 * signed build's Developer ID team is read off its Mach-O signature and must
 * be the team pinned already, as must the programs a pin digests, so
 * a release that changes either stops the bump for a person to decide. A
 * pin's parts are read alike: its platform package moves with the release,
 * a dependency moves to the release its new manifest names exactly, or stays
 * where it still meets the range named, or is dropped where no new manifest
 * names it, and a release that names a range its part no longer meets, or a
 * dependency no part pins, stops the bump. Each
 * bump it makes is printed to stdout as one line of JSON
 * (`{"tool","from","to"}`, and Claude's `claude` beside it); everything else
 * goes to stderr.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Predicate } from "effect";
import * as pins from "../src/pins.ts";

/** How long npm must have held a release before it is taken, so one pulled for a fault within the day is never pinned. */
const MIN_AGE_HOURS = 24;

const REGISTRY = "https://registry.npmjs.org";
const SDK = "@anthropic-ai/claude-agent-sdk";
const CODEX = "@openai/codex";
const CURSOR_SDK = "@cursor/sdk";

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
  cursor: {
    title: "Cursor SDK",
    package: CURSOR_SDK,
    current: () => pins.CURSOR_SDK_PIN.VERSION,
    // Note that the image installs the SDK from npm, its platform package beside it, so the Mac's pin alone is read off archives.
    hostPins: [["CURSOR_SDK_MAC_PIN", pins.CURSOR_SDK_MAC_PIN, CURSOR_SDK, ""]],
  },
};

/** The tools whose SDK this package depends on by name, which the lockfile moves with. */
const SDK_DEPENDENCY = { claude: SDK, cursor: CURSOR_SDK };

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

/** A part's npm package and archive file name, read off its address (`<registry>/<name>/-/<file>`). */
function partOf(archive) {
  const match = /^https:\/\/registry\.npmjs\.org\/(.+)\/-\/([^/]+)$/u.exec(archive);

  if (!match) throw new Error(`${archive} is no npm tarball address`);

  return { name: match[1], file: match[2] };
}

/** Whether a stable `x.y.z` meets an npm range of the shapes npm's manifests here name: exact, `^x.y.z`, or such joined by `||`; any other shape meets none, which stops the bump. */
function meets(version, range) {
  return range.split("||").some((each) => {
    const want = each.trim();

    if (stable(want)) return want === version;

    if (!want.startsWith("^") || !stable(want.slice(1))) return false;
    const [have, floor] = [stable(version), stable(want.slice(1))];
    // Note that a caret holds the first part that is not zero, as npm reads it.
    const held = floor.findIndex((part) => part !== 0);
    const fixed = held === -1 ? 3 : held + 1;

    return (
      have.slice(0, fixed).join() === floor.slice(0, fixed).join() && !newer(want.slice(1), version)
    );
  });
}

/** A manifest's dependencies a host must keep beside it: its own and its peers, an optional peer left out. */
function requiredOf(manifest) {
  const optional = manifest.peerDependenciesMeta ?? {};

  const peers = Object.entries(manifest.peerDependencies ?? {}).filter(
    ([name]) => optional[name]?.optional !== true,
  );

  return [...Object.entries(manifest.dependencies ?? {}), ...peers];
}

/**
 * The release one of a pin's parts is at, read off the new manifests read so
 * far: its platform package at the release itself, a dependency at the
 * release a manifest names exactly, or where it stands while it still meets
 * the range named; undefined where no manifest names it yet.
 */
function partRelease(label, each, name, to, manifests) {
  // Note that the platform package's address names `HOST_CLI_VERSION`, so the version edit moves it, never a write of its file.
  if (each.name === `${name}-darwin-arm64`) return { ...each, version: to, withRelease: true };
  const named = manifests.flatMap(requiredOf).find(([dependency]) => dependency === each.name);

  if (named === undefined) return undefined;
  const [, range] = named;
  const current = each.file.slice(each.file.lastIndexOf("-") + 1, -".tgz".length);
  const version = stable(range) ? range : meets(current, range) ? current : undefined;

  if (version === undefined) {
    throw new Error(`${label}: ${each.name}@${current} no longer meets ${range}`);
  }

  return { ...each, version, withRelease: false };
}

/**
 * The release each of a pin's parts is at the new release, read from the
 * release's own manifest and then each chosen part's, until a pass chooses
 * none more, so a dependency's own dependency is found whatever the parts'
 * order. A part no new manifest names is dropped, as a release that stops
 * depending on it (one that bundles it instead) leaves it unread on the Mac.
 * Fails where a manifest names a range its part no longer meets and names no
 * exact release, or names a dependency no part pins, or where any
 * manifest's range is not met by the release chosen for that part.
 */
async function partReleases(label, pin, name, to) {
  const manifests = [await registryJson(`${name}/${to}`)];
  const parts = pin.PARTS.map((part) => ({ part, ...partOf(part.ARCHIVE) }));
  const chosen = new Map();

  for (let found = true; found; ) {
    found = false;

    for (const each of parts.filter((part) => !chosen.has(part.name))) {
      const release = partRelease(label, each, name, to, manifests);

      if (release === undefined) continue;
      chosen.set(each.name, release);
      found = true;

      if (!release.withRelease)
        manifests.push(await registryJson(`${each.name}/${release.version}`));
    }
  }

  // Note that every range any new manifest names is held to the release chosen for it, so two parts that disagree stop the bump, as does a dependency no part keeps, which would be missing on the Mac.
  for (const [dependency, range] of manifests.flatMap(requiredOf)) {
    const version = chosen.get(dependency)?.version;

    if (version === undefined) throw new Error(`${label}: nothing pins ${dependency}@${range}`);

    if (!meets(version, range)) {
      throw new Error(`${label}: ${dependency}@${version} does not meet ${range}`);
    }
  }

  return parts.map((each) => chosen.get(each.name) ?? { ...each, dropped: true });
}

/**
 * Each of a pin's parts at its new release, fetched and held to npm's
 * integrity, and unpacked where the kept build keeps it under `root`, or
 * marked dropped where the release no longer names it.
 */
async function readParts(label, pin, name, to, root, scratch) {
  if (pin.PARTS === undefined) return [];
  const reads = [];

  for (const [index, each] of (await partReleases(label, pin, name, to)).entries()) {
    if (each.dropped) {
      say(`  ${label}.PARTS: drops ${each.name}, which the release no longer names`);
      reads.push({ part: each.part, name: each.name, from: each.file, dropped: true });
      continue;
    }

    const file = each.file.replace(/-\d+\.\d+\.\d+\.tgz$/u, `-${each.version}.tgz`);
    const archive = `${REGISTRY}/${each.name}/-/${file}`;
    say(`  ${label}.PARTS: ${archive}`);
    const bytes = await fetchArchive(each.name, each.version, archive);
    const unpacked = path.join(scratch, `part-${index}`);
    mkdirSync(unpacked);
    writeFileSync(path.join(unpacked, "archive.tgz"), bytes);
    run("tar", ["-xzf", "archive.tgz"], unpacked);
    mkdirSync(path.dirname(path.join(root, each.part.INTO)), { recursive: true });
    renameSync(path.join(unpacked, each.part.ROOT), path.join(root, each.part.INTO));
    reads.push({
      part: each.part,
      name: each.name,
      from: each.file,
      file: each.withRelease ? each.file : file,
      sha256: sha256(bytes),
      bytes: bytes.length,
    });
  }

  return reads;
}

/**
 * A host pin as the new release reads: its address, size, and digests, and
 * its parts', each read off its archive, its kept layout, team, and
 * executables checked to be the pin's own.
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
    const parts = await readParts(label, pin, name, to, root, scratch);
    const pinned = Object.keys(pin.FILES ?? {}).sort();

    const members = [
      ...pin.MEMBERS,
      ...parts.filter((read) => !read.dropped).map((read) => read.part.INTO),
    ];

    const kept = pinnedExecutables(root, members, pinned);

    // Note that a pin may digest a file that runs without being executable, an SDK's entry or a native module, which need only stand.
    const unpinned = kept.filter((file) => !pinned.includes(file));

    const absent = pinned.filter(
      (file) => !statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile(),
    );

    if (unpinned.length > 0 || absent.length > 0) {
      throw new Error(`${label} keeps executables ${kept.join(", ")}, not ${pinned.join(", ")}`);
    }

    for (const signed of pin.TEAM === undefined ? [] : (pin.SIGNED ?? [pin.BINARY])) {
      const team = machOTeam(path.join(root, signed));

      if (team !== pin.TEAM)
        throw new Error(`${label}'s ${signed} is signed by ${team}, not ${pin.TEAM}`);
    }

    const files = Object.fromEntries(
      pinned.map((file) => [file, sha256(readFileSync(path.join(root, file)))]),
    );

    return { label, pin, sha256: sha256(bytes), bytes: bytes.length, files, parts };
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

/** `pins.ts` with one dropped part's object taken out of its pin's `PARTS`, found by its archive, which names it alone. */
function dropPart(text, archive) {
  const escaped = archive.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  // Note that a dependency's object holds no braces of its own, so its text runs from the brace before its archive to the first after.
  const object = new RegExp(`\\n[ \\t]*\\{\\s*ARCHIVE: ${escaped},[^{}]*\\},`, "gu");
  const count = text.match(object)?.length ?? 0;

  if (count !== 1) throw new Error(`pins.ts holds ${archive}'s part ${count} times, not once`);

  return text.replace(object, "");
}

/** `pins.ts` with a part's archive, size, and digest moved to what its new release reads: a dependency's file name where it moved, and a dropped part taken out. */
function writePart(text, read) {
  const archive = `npmArchive("${read.name}", "${read.from}")`;

  if (read.dropped) return dropPart(text, archive);

  const named =
    read.file === read.from
      ? text
      : replaceOnce(text, archive, `npmArchive("${read.name}", "${read.file}")`, "pins.ts");

  return replaceOnce(
    replaceOnce(named, `"${read.part.SHA256}"`, `"${read.sha256}"`, "pins.ts"),
    `BYTES: ${sizeLiteral(read.part.BYTES)},`,
    `BYTES: ${sizeLiteral(read.bytes)},`,
    "pins.ts",
  );
}

/** `pins.ts` with a host pin's size and digests, and its parts', moved to what its new release reads. */
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

  return read.parts.reduce(writePart, next);
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

  if (tool === "cursor") {
    return {
      pins: [
        [
          `export const CURSOR_SDK_PIN = {\n  VERSION: "${from}",`,
          `export const CURSOR_SDK_PIN = {\n  VERSION: "${to}",`,
        ],
        [`CURSOR_SDK: "${from}"`, `CURSOR_SDK: "${to}"`],
      ],
      image: [[`ARG CURSOR_SDK_VERSION=${from}\n`, `ARG CURSOR_SDK_VERSION=${to}\n`]],
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

  if (!Predicate.isString(manifest.claudeCodeVersion)) {
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

  const dependency = SDK_DEPENDENCY[tool];

  if (dependency !== undefined) {
    rewrite(PACKAGE_FILE, (text) =>
      replaceOnce(text, `"${dependency}": "${from}"`, `"${dependency}": "${to}"`, "package.json"),
    );
    // Note that the lockfile is moved alone, then installed from as every checkout is, so the guard reads the SDK it names.
    run("pnpm", ["install", "--lockfile-only"]);
    run(path.join(repositoryRoot, "scripts", "bootstrap.sh"), []);
  } else {
    run("node", [path.join(packageRoot, "scripts", "generate-codex-protocol.mjs")]);
  }

  return { tool, from, to, ...(claude && { claude }) };
}

/** The tools asked for, each with the version named or undefined for the newest settled release. */
function requested(args) {
  const asked = args.length > 0 ? args : Object.keys(TOOLS);

  return asked.map((arg) => {
    const [tool, version] = arg.split("@");

    if (!(tool in TOOLS)) throw new Error(`no tool ${tool}: name ${Object.keys(TOOLS).join(", ")}`);

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
