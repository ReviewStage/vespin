/**
 * base-drive.test.ts -- a workspace's repository's base drive, against `Sandbox` kept in memory: filled once from the image with the repository cloned onto it and its dependencies installed and no credential left behind, filled by one of several launches at once, refilled over its checkout where a launch asks, and read unfinished after a fill that failed until a later fill replaces it.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { OPEN_INTERNET, SANDBOX_STATUS, Sandbox, type SandboxService } from "@repo/sandbox";
import { type MemoryCommand, type MemorySandboxRecord, memorySandbox } from "@repo/sandbox/testing";
import { Effect, Fiber, Redacted } from "effect";
import {
  BASE_STATE,
  BASE_WANTED,
  type BaseDriveOf,
  type BaseRefill,
  baseDriveName,
  fillBaseDrive,
  readBaseDrive,
} from "./base-drive.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import type { RepositorySandbox } from "./repository-shell.js";
import { composePolicy } from "./sandbox-firewall.js";

const IMAGE = "agent-image:fixture";
const TOKEN = "ghs_fixtureBaseDriveToken";
const RELAY: BaseDriveOf = {
  workspaceId: "workspace-relay",
  fullName: "Acme/Relay",
  defaultBranch: "trunk",
};
const CREDENTIAL = { token: Redacted.make(TOKEN), access: { kind: GITHUB_ACCESS.APP } } as const;
const { VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

/** Whether a command was the install. */
const isInstall = (command: MemoryCommand) =>
  command.ask.args.some((arg) => arg.includes("pnpm install"));

/** Whether a command was the clone, or the refresh of a checkout standing. */
const isClone = (command: MemoryCommand) => Object.hasOwn(command.ask.env ?? {}, VARIABLE.URL);
const isRefresh = (command: MemoryCommand) =>
  Object.hasOwn(command.ask.env ?? {}, VARIABLE.REFRESH);

/**
 * The sandboxes kept in memory, each command a success but these: a refresh
 * on a drive no clone has filled, which holds no checkout to refresh, and the
 * install where it is to fail.
 */
function fixture(installExit = 0) {
  const install = { exit: installExit };
  const cloned = new Set<string>();
  /** Every drive a command ran on, and where it was mounted. */
  const mounted = new Set<string>();
  const ran = (command: MemoryCommand, sandbox: MemorySandboxRecord) => {
    const drive = sandbox.drive?.name ?? "";
    mounted.add(`${drive} at ${sandbox.drive?.at}`);
    if (isClone(command)) cloned.add(drive);
    const exitCode = isInstall(command)
      ? install.exit
      : isRefresh(command) && !cloned.has(drive)
        ? 1
        : 0;
    return { exitCode, stdout: "", stderr: "" };
  };
  const memory = memorySandbox({ run: ran });
  return { memory, state: memory.state, install, mounted };
}

/** The fill's sandbox as the clone reaches it: each run straight to `Sandbox` on the fill's run, and each policy composed from the sources its write names. */
function opener(api: SandboxService) {
  return (running: { readonly name: string; readonly running: string }): RepositorySandbox => ({
    run: (ask) =>
      Effect.runPromise(
        api.run(running, {
          command: "bash",
          args: ["-c", ask.command],
          ...(ask.workingDirectory === undefined ? undefined : { cwd: ask.workingDirectory }),
          ...(ask.env === undefined ? undefined : { env: ask.env }),
        }),
      ),
    firewall: {
      write: (sources) => api.updateNetworkPolicy(running, composePolicy(sources, new Map())),
    },
  });
}

/** The base drive filled for the repository, for the reason a launch names where it names one. */
const filled = (memory: ReturnType<typeof memorySandbox>, refill?: BaseRefill) =>
  fillBaseDrive(RELAY, IMAGE, CREDENTIAL, opener(memory.service), refill).pipe(
    Effect.provideService(Sandbox, memory.service),
  );

/** The base as a launch reads it. */
const readOn = (memory: ReturnType<typeof memorySandbox>) =>
  readBaseDrive(RELAY).pipe(Effect.provideService(Sandbox, memory.service));

it.effect(
  "a launch whose fork found no base drive has one filled from the image: mounted at the workspace, cloned onto with the token at the firewall for the clone alone, installed, and its sandbox stopped and deleted",
  () =>
    Effect.gen(function* () {
      const { memory, state, mounted } = fixture();
      const name = baseDriveName(RELAY);

      yield* filled(memory, BASE_WANTED.MISSING);

      assert.deepEqual([...state.drives.keys()], [name]);
      assert.deepEqual([...mounted], [`${name} at ${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}`]);
      assert.deepEqual(
        [state.stopped.map((each) => each.name), state.deleted, state.sandboxes.size],
        [[name], [name], 0],
      );
      assert.equal((yield* readOn(memory)).state, BASE_STATE.READY);
      const clone = state.commands.findIndex(isClone);
      const install = state.commands.findIndex(isInstall);
      assert.ok(clone !== -1 && install > clone);
      // The token stood at the firewall for the clone, and came off before the install.
      assert.ok(JSON.stringify(state.policies[0]?.policy).includes("Basic "));
      assert.deepEqual(state.policies.at(-1)?.policy, OPEN_INTERNET);
      assert.equal(JSON.stringify(state.commands).includes(TOKEN), false);

      // A base free to fork is filled again only for a reason a launch names.
      yield* filled(memory);
      assert.equal(state.deleted.length, 1);
    }),
);

it.effect("launches that fill at once leave one base drive and fail none", () =>
  Effect.gen(function* () {
    const { memory, state } = fixture();

    const fibers = yield* Effect.forEach([1, 2, 3], () =>
      Effect.forkChild(filled(memory, BASE_WANTED.MISSING)),
    );
    yield* Effect.forEach(fibers, Fiber.join);

    assert.deepEqual([...state.drives.keys()], [baseDriveName(RELAY)]);
    assert.equal(state.sandboxes.size, 0);
  }),
);

it.effect(
  "a refill for a lockfile a launch moved brings the checkout standing up to the default branch and installs again, cloning nothing",
  () =>
    Effect.gen(function* () {
      const { memory, state } = fixture();
      yield* filled(memory, BASE_WANTED.MISSING);
      const before = state.commands.length;

      yield* filled(memory, BASE_WANTED.LOCKFILE_MOVED);

      const refill = state.commands.slice(before);
      assert.deepEqual(
        [refill.some(isRefresh), refill.some(isClone), refill.some(isInstall)],
        [true, false, true],
      );
      assert.deepEqual([...state.drives.keys()], [baseDriveName(RELAY)]);
    }),
);

it.effect(
  "a fill whose install failed leaves its sandbox stopped, so the base reads unfinished and is forked by no launch until a later fill replaces it",
  () =>
    Effect.gen(function* () {
      const { memory, state, install } = fixture(1);
      const name = baseDriveName(RELAY);

      const failed = yield* Effect.result(filled(memory, BASE_WANTED.MISSING));

      assert.equal(failed._tag, "Failure");
      assert.deepEqual(
        [state.sandboxes.get(name)?.status, state.deleted],
        [SANDBOX_STATUS.STOPPED, []],
      );
      const read = yield* readOn(memory);
      assert.equal(read.state === BASE_STATE.WANTED && read.reason, BASE_WANTED.UNFINISHED);

      install.exit = 0;
      yield* filled(memory);

      assert.deepEqual(state.deleted, [name, name]);
      assert.equal((yield* readOn(memory)).state, BASE_STATE.READY);
    }),
);
