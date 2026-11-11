import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANARY,
  compilerOptionsFrom,
  discardedAt,
  findDiscardedEffects,
} from "./lib/discarded-effect.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Everything the repository compiles. A program is built per group of
 * workspaces below rather than per tsconfig: this check reads no diagnostic,
 * so the differences between those tsconfigs (which `@types` package each
 * pulls in) change nothing about which values are Effects.
 */
const SOURCE_GLOBS = [
  "apps/*/src/**/*.ts",
  "apps/*/src/**/*.tsx",
  "apps/web/server/**/*.ts",
  "apps/web/tests/**/*.ts",
  "apps/web/scripts/**/*.ts",
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
  "tools/*/src/**/*.ts",
];

/**
 * The workspaces read together in one program; a workspace named in no group
 * is a program of its own. Note that we split the repository, because one
 * program over all of it kept every type it resolved and outgrew the 4 GB
 * heap `package.json` gives this check, and that we group the workspaces
 * rather than read each alone, because each program resolves again the types
 * it shares with the others: a program per workspace took twice as long. Each
 * group here peaks below the heap `apps/web` alone takes, about 2 GB, so a
 * workspace joins a group only where a measured heap says the group still
 * does; `@repo/service` and `apps/web` stand alone for that reason.
 */
const PROGRAM_GROUPS = [
  [
    "packages/runtime",
    "packages/wire",
    "packages/settings",
    "packages/sync",
    "packages/gateway",
    "packages/sandbox",
    "packages/credentials",
    "packages/agent-runner",
    "packages/database",
    "tools/claude-code-probe",
    "apps/cli",
  ],
  ["packages/brand", "packages/features", "packages/ui", "packages/panel", "apps/catalog"],
  ["packages/host", "apps/desktop", "apps/host", "packages/ui-native", "apps/mobile"],
];

/** The workspace a repository path sits in, such as `packages/panel`. */
function workspaceOf(relativePath) {
  return relativePath.split("/", 2).join("/");
}

const byWorkspace = new Map();
for await (const found of glob(SOURCE_GLOBS, { cwd: REPOSITORY_ROOT })) {
  const workspace = workspaceOf(found);
  const files = byWorkspace.get(workspace) ?? [];
  files.push(path.join(REPOSITORY_ROOT, found));
  byWorkspace.set(workspace, files);
}
const grouped = new Set(PROGRAM_GROUPS.flat());
const programs = [
  ...PROGRAM_GROUPS.map((group) => group.filter((workspace) => byWorkspace.has(workspace))),
  ...[...byWorkspace.keys()]
    .filter((workspace) => !grouped.has(workspace))
    .sort()
    .map((one) => [one]),
]
  .filter((group) => group.length > 0)
  .map((group) => ({
    name: group.join(", "),
    rootNames: group.flatMap((workspace) => byWorkspace.get(workspace)),
  }));
const sourceCount = programs.reduce((count, program) => count + program.rootNames.length, 0);

const canaryNames = [];
for await (const found of glob(`${CANARY.DIRECTORY}/*.ts`, { cwd: REPOSITORY_ROOT })) {
  canaryNames.push(path.join(REPOSITORY_ROOT, found));
}

const base = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "tsconfig.base.json"), "utf8"));
const reported = [];
for (const { name, discarded } of findDiscardedEffects({
  root: REPOSITORY_ROOT,
  programs,
  canaryNames,
  compilerOptions: compilerOptionsFrom(REPOSITORY_ROOT, base.compilerOptions),
})) {
  const canary = discarded.filter((one) => one.file.startsWith(`${CANARY.DIRECTORY}/`));
  const sighted = canary.map(discardedAt);
  if (sighted.join("\n") !== CANARY.DISCARDED.join("\n")) {
    process.stderr.write(
      `error: the canary under ${CANARY.DIRECTORY} reported ${sighted.join(", ") || "nothing"} in the program for ${name} where it must report ${CANARY.DISCARDED.join(", ")}. That program does not resolve Effect's own types, so its silence about the repository means nothing.\n`,
    );
    process.exit(1);
  }
  reported.push(...discarded.filter((one) => !one.file.startsWith(`${CANARY.DIRECTORY}/`)));
}

if (reported.length > 0) {
  const lines = reported.map(
    (one) => `  ${one.file}:${one.line}: ${one.description} discarded by \`${one.text}\``,
  );
  process.stderr.write(
    `error: these statements describe work and drop it — an Effect, Stream, or Layer written as a statement runs nothing. Yield it inside the effect that wants it, or hand it to the runtime edge that runs it:\n${lines.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(`No discarded Effect, Stream, or Layer in ${sourceCount} files.\n`);
