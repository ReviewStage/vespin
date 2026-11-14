import { spawn, spawnSync } from "node:child_process";
import { totalmem } from "node:os";

import { ROOT_TASKS, TEST_TASK, turboInvocation, WORKSPACE_TASKS } from "./lib/turbo.mjs";

// The checks run through Turborepo (`turbo.json`), which hashes each task's
// inputs and replays a task whose hash it has already seen pass, from the
// local cache or, given a TURBO_TOKEN, from the remote one CI and every other
// machine share. The checks are independent of one another, so they run at
// once. No build runs here: Vercel builds web on every deploy and the
// release workflow builds the desktop app, and knip and
// biome's formatter are for running by hand (`pnpm knip`, `pnpm format`) or
// on commit (lint-staged), never a check.
//
// Note that the tests run one task at a time beside the other checks rather
// than as more tasks among them, because two vitest processes on one machine
// starve each other's workers: a suite that passes alone times out in a hook
// beside another, as the whole suite in one process did at its tail. Each
// run's output is held and printed whole when it ends, so no two interleave.
//
// CI runs the tests in its own jobs beside this one, so it asks for
// everything but them with `--without test`. `--affected` runs a workspace's
// tasks only where that workspace, or one it depends on, changed since the
// merge base with origin/main; the root checks always run (`lib/turbo.mjs`).
const CHECKS = [...ROOT_TASKS, ...WORKSPACE_TASKS, "test"];
const WITHOUT_FLAG = "--without";
const AFFECTED_FLAG = "--affected";
const AFFECTED_BASE = "origin/main";
const GIBIBYTE = 1024 ** 3;

// Note that the workspace tasks run as many at once as memory holds, never
// turbo's default of ten, because each is a TypeScript 7 `tsc` that already
// checks on every core with threads of its own: a second beside it buys
// little time, and the largest (`@repo/service`'s, `@repo/panel`'s) peak near
// 4 GiB each, so on an 8 GiB machine two of them are what the kernel killed.
// The lint and the iOS bundle running beside them are held back as headroom.
const WORKSPACE_TASK_PEAK = 4 * GIBIBYTE;
const BESIDE_WORKSPACE_TASKS = 2 * GIBIBYTE;

// A container's limit, where one is set, is the memory there is, not the host's.
const memory = Math.min(totalmem(), process.constrainedMemory() || Number.POSITIVE_INFINITY);

const workspaceConcurrency = Math.max(
  1,
  Math.floor((memory - BESIDE_WORKSPACE_TASKS) / WORKSPACE_TASK_PEAK),
);

function parseArguments(argv) {
  const without = [];
  let affected = false;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === AFFECTED_FLAG) {
      affected = true;
    } else if (argv[index] === WITHOUT_FLAG && index + 1 < argv.length) {
      index += 1;
      without.push(argv[index]);
    } else {
      return { error: `error: no such argument: ${argv[index]}` };
    }
  }

  const unknown = without.filter((check) => !CHECKS.includes(check));

  if (unknown.length > 0) {
    return { error: `error: ${WITHOUT_FLAG} names no such check: ${unknown.join(", ")}` };
  }

  return { without, affected };
}

// Turbo compares against a local `main` unless told otherwise, and a
// worktree's `main` is whatever it was when the clone was made; origin/main
// is the base CI merges into. A stale one only makes more files count as
// changed, which runs more, never less.
function affectedBase(env) {
  if (env.TURBO_SCM_BASE) return env.TURBO_SCM_BASE;
  const known = spawnSync("git", ["rev-parse", "--verify", "--quiet", AFFECTED_BASE]);

  return known.status === 0 ? AFFECTED_BASE : undefined;
}

function listWorkspaces(args, env) {
  const turbo = turboInvocation(["ls", ...args, "--output=json"], env);
  const listed = spawnSync(turbo.command, turbo.args, { env: turbo.env, encoding: "utf8" });

  if (listed.status !== 0) {
    throw new Error(`turbo ls failed:\n${listed.stderr}`);
  }

  return JSON.parse(listed.stdout).packages.items;
}

// The `--filter`s that select every affected workspace with its dependents,
// or none when nothing changed. Note that we do not hand turbo `--affected`
// itself: turbo intersects `--affected` with a `--filter` rather than adding
// to it, so the whole scope is filters.
function affectedFilters() {
  const base = affectedBase(process.env);
  const env = base ? { ...process.env, TURBO_SCM_BASE: base } : process.env;
  const affected = listWorkspaces([AFFECTED_FLAG], env);

  return affected.map((workspace) => `--filter=...${workspace.name}`).sort();
}

function runTurbo(label, args, { held }) {
  return new Promise((resolve) => {
    const chunks = [];
    const turbo = turboInvocation(["run", ...args]);
    const env = { ...turbo.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" };

    const child = spawn(turbo.command, turbo.args, {
      stdio: held ? ["ignore", "pipe", "pipe"] : "inherit",
      env,
    });

    child.stdout?.on("data", (chunk) => chunks.push(chunk));
    child.stderr?.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (status) => {
      if (held) {
        process.stdout.write(
          `\n=== ${label} (${status === 0 ? "passed" : `exit ${status}`}) ===\n`,
        );
        process.stdout.write(Buffer.concat(chunks));
      }

      resolve(status === 0);
    });
  });
}

const parsed = parseArguments(process.argv.slice(2));

if (parsed.error) {
  process.stderr.write(`${parsed.error}\n`);
  process.exit(2);
}

const scope = parsed.affected ? affectedFilters() : [];
const anyWorkspace = !parsed.affected || scope.length > 0;

if (!anyWorkspace) {
  process.stdout.write(`No workspace changed since ${affectedBase(process.env) ?? "main"}.\n`);
}

const rootTasks = ROOT_TASKS.filter((task) => !parsed.without.includes(task));
const workspaceTasks = WORKSPACE_TASKS.filter((task) => !parsed.without.includes(task));
const runs = [];

if (rootTasks.length > 0) {
  runs.push({ label: rootTasks.join(", "), args: rootTasks });
}

if (anyWorkspace && workspaceTasks.length > 0) {
  runs.push({
    label: workspaceTasks.join(", "),
    args: [...workspaceTasks, `--concurrency=${workspaceConcurrency}`, ...scope],
  });
}

if (anyWorkspace && !parsed.without.includes("test")) {
  runs.push({ label: "test", args: [TEST_TASK, "--concurrency=1", ...scope] });
}

// Note that we set exitCode rather than call process.exit, because on macOS a
// piped stdout is asynchronous and an exit drops whatever a failing check's
// output has not yet flushed, which is the part that names the failure.
const results = await Promise.all(runs.map((run) => runTurbo(run.label, run.args, { held: true })));
const failed = runs.filter((_, index) => !results[index]);

if (failed.length > 0) {
  process.stderr.write(`\nerror: ${failed.map((run) => run.label).join("; ")} failed\n`);
  process.exitCode = 1;
}
