#!/usr/bin/env node
// tsconfig-references.mjs -- write each workspace's TypeScript project references from the workspaces its package.json names.
//
//   node scripts/tsconfig-references.mjs           rewrite every tsconfig.json's references
//   node scripts/tsconfig-references.mjs --check   fail where one no longer matches
//
// A workspace's `tsc` reads a referenced workspace's emitted declarations
// rather than its source (`tsconfig.package.json`), so its references must
// name every `@repo/*` workspace it imports. One left out is read as source
// again: in a package `tsc` refuses it as a file outside the project, and in
// an app it quietly loads that package's whole graph back into memory. The
// package.json is the one list of what a workspace imports, so the
// references are written from it and checked against it here.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKSPACE_PARENTS = ["apps", "packages", "tools"];
const EXTRA_WORKSPACES = ["tools/oxlint/vespin"];
const PACKAGE_BASE = "tsconfig.package.json";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

function workspaceDirectories() {
  const listed = WORKSPACE_PARENTS.flatMap((parent) =>
    readdirSync(path.join(ROOT, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name)),
  );

  return [...listed, ...EXTRA_WORKSPACES].filter((directory) =>
    existsSync(path.join(ROOT, directory, "package.json")),
  );
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function workspacesByName(directories) {
  const byName = new Map();

  for (const directory of directories) {
    byName.set(readJson(path.join(ROOT, directory, "package.json")).name, directory);
  }

  return byName;
}

// The references a workspace's package.json implies, as tsconfig paths relative to it.
function expectedReferences(directory, byName) {
  const manifest = readJson(path.join(ROOT, directory, "package.json"));
  const names = new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));

  return [...names]
    .flatMap((name) => {
      const target = byName.get(name);

      const typed =
        target !== undefined &&
        name !== manifest.name &&
        existsSync(path.join(ROOT, target, "tsconfig.json"));

      return typed ? [{ path: path.relative(directory, target) }] : [];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

// Note that a referenced workspace must be a composite project, which only a
// package is: an app or a tool is imported by none.
function referenceProblems(directory, references) {
  return references
    .filter((reference) => {
      const target = path.join(directory, reference.path);
      const config = readJson(path.join(ROOT, target, "tsconfig.json"));

      return !String(config.extends ?? "").endsWith(PACKAGE_BASE);
    })
    .map(
      (reference) =>
        `${directory} imports ${reference.path}, which does not extend ${PACKAGE_BASE}`,
    );
}

function main(check) {
  const directories = workspaceDirectories();
  const byName = workspacesByName(directories);
  const problems = [];

  for (const directory of directories) {
    const file = path.join(ROOT, directory, "tsconfig.json");

    if (!existsSync(file)) continue;

    const config = readJson(file);
    const references = expectedReferences(directory, byName);
    problems.push(...referenceProblems(directory, references));

    if (JSON.stringify(config.references ?? []) === JSON.stringify(references)) continue;

    if (check) {
      problems.push(`${directory}/tsconfig.json: references do not match its package.json`);
    } else {
      const { references: _, ...rest } = config;
      const next = references.length > 0 ? { ...rest, references } : rest;
      writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    }
  }

  if (problems.length > 0) {
    process.stderr.write(
      `error: ${problems.join("\n")}\nRun \`node scripts/tsconfig-references.mjs\` to rewrite the references.\n`,
    );
    process.exitCode = 1;
  }
}

main(process.argv.includes("--check"));
