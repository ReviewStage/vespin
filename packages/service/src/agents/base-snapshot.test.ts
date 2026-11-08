/**
 * base-snapshot.test.ts -- a workspace's repository's base snapshot, against `Sandbox` kept in memory: filled once from the image with the repository cloned and its dependencies installed and no credential left behind, filled by one of several launches at once, filled again on another image or in place of a snapshot a launch found unusable, and gone after a fill that failed.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { OPEN_INTERNET, SANDBOX_STATUS, Sandbox, type SandboxService } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Duration, Effect, Fiber, Redacted } from "effect";
import {
  BASE_SNAPSHOT,
  BASE_STATE,
  BASE_WANTED,
  type BaseSnapshotOf,
  baseSnapshotName,
  fillBaseSnapshot,
  readBaseSnapshot,
} from "./base-snapshot.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import type { RepositorySandbox } from "./repository-shell.js";
import { composePolicy } from "./sandbox-firewall.js";

const IMAGE = "agent-image:fixture";
const NEXT_IMAGE = "agent-image:next";
const TOKEN = "ghs_fixtureBaseSnapshotToken";
const RELAY: BaseSnapshotOf = {
  workspaceId: "workspace-relay",
  fullName: "Acme/Relay",
  defaultBranch: "trunk",
};
const CREDENTIAL = { token: Redacted.make(TOKEN), access: { kind: GITHUB_ACCESS.APP } } as const;

/** Whether a command was the install. */
const isInstall = (args: readonly string[]) => args.some((arg) => arg.includes("pnpm install"));

/** The sandboxes kept in memory, each command a success unless the install is to fail. */
function fixture(installExit = 0) {
  const memory = memorySandbox({
    run: ({ ask }) => ({ exitCode: isInstall(ask.args) ? installExit : 0, stdout: "", stderr: "" }),
  });
  return { memory, state: memory.state };
}

/** The fill's sandbox as the clone reaches it: each run straight to `Sandbox` on the build's run, and each policy composed from the sources its write names. */
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

/** The base snapshot filled for the repository given, on the image given, in place of the snapshot named where one is. */
const filled = (
  memory: ReturnType<typeof memorySandbox>,
  image = IMAGE,
  base = image,
  replacing?: string,
) =>
  fillBaseSnapshot(
    RELAY,
    { reference: image, base },
    CREDENTIAL,
    opener(memory.service),
    replacing === undefined ? undefined : { snapshotId: replacing, reason: BASE_WANTED.LAPSED },
  ).pipe(Effect.provideService(Sandbox, memory.service));

/** The base as a launch on the image given reads it. */
const readOn = (memory: ReturnType<typeof memorySandbox>, image = IMAGE) =>
  readBaseSnapshot(RELAY, image).pipe(Effect.provideService(Sandbox, memory.service));

/** The base's snapshot as a launch on the image given reads it, where it is ready. */
const readySnapshot = (memory: ReturnType<typeof memorySandbox>, image = IMAGE) =>
  Effect.map(readOn(memory, image), (read) =>
    read.state === BASE_STATE.READY ? read.snapshotId : undefined,
  );

it.effect(
  "a repository with no base snapshot has one filled from the image: cloned with the token at the firewall for the clone alone, installed, and snapshotted to lapse a month after its last use",
  () =>
    Effect.gen(function* () {
      const { memory, state } = fixture();
      const before = yield* readOn(memory);

      yield* filled(memory);

      assert.equal(before.state, BASE_STATE.WANTED);
      const sandbox = state.sandboxes.get(baseSnapshotName(RELAY));
      assert.ok(sandbox !== undefined);
      assert.deepEqual(
        [sandbox.from, sandbox.status, state.deleted],
        [{ image: IMAGE }, SANDBOX_STATUS.STOPPED, []],
      );
      assert.deepEqual(
        state.snapshots.map((each) => [each.id, each.lapseMs]),
        [[sandbox.snapshotId, Duration.toMillis(BASE_SNAPSHOT.LAPSE)]],
      );
      assert.equal(yield* readySnapshot(memory), sandbox.snapshotId);
      const clone = state.commands.findIndex((each) =>
        Object.hasOwn(each.ask.env ?? {}, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.URL),
      );
      const install = state.commands.findIndex((each) => isInstall(each.ask.args));
      assert.ok(clone !== -1 && install > clone);
      // The token stood at the firewall for the clone, and came off before the install.
      assert.ok(JSON.stringify(state.policies[0]?.policy).includes("Basic "));
      assert.deepEqual(state.policies.at(-1)?.policy, OPEN_INTERNET);
      assert.equal(
        JSON.stringify([state.commands, [...state.sandboxes.values()]]).includes(TOKEN),
        false,
      );

      yield* filled(memory);
      assert.equal(state.snapshots.length, 1);
    }),
);

it.effect("launches that fill at once leave one base snapshot", () =>
  Effect.gen(function* () {
    const { memory, state } = fixture();

    const fibers = yield* Effect.forEach([1, 2, 3], () => Effect.forkChild(filled(memory)));
    yield* Effect.forEach(fibers, Fiber.join);

    assert.equal(state.sandboxes.size, 1);
    assert.equal(state.snapshots.length, 1);
  }),
);

it.effect(
  "a base made on another image is not created from, and the next fill makes it again on the new image, while one whose runner alone moved stands",
  () =>
    Effect.gen(function* () {
      const { memory, state } = fixture();
      yield* filled(memory);
      yield* filled(memory, NEXT_IMAGE, IMAGE);
      assert.equal(state.snapshots.length, 1, "a runner's change alone filled the base again");

      const onNext = yield* readySnapshot(memory, NEXT_IMAGE);
      yield* filled(memory, NEXT_IMAGE);

      assert.equal(onNext, undefined);
      assert.deepEqual(state.deleted, [baseSnapshotName(RELAY)]);
      assert.deepEqual(state.sandboxes.get(baseSnapshotName(RELAY))?.from, { image: NEXT_IMAGE });
      assert.equal(yield* readySnapshot(memory, NEXT_IMAGE), state.snapshots[1]?.id);
    }),
);

it.effect(
  "a fill in place of the snapshot a launch found unusable makes it again, and one in place of a snapshot already replaced leaves the base be",
  () =>
    Effect.gen(function* () {
      const { memory, state } = fixture();
      yield* filled(memory);
      const first = state.snapshots[0]?.id ?? "";

      yield* filled(memory, IMAGE, IMAGE, first);
      yield* filled(memory, IMAGE, IMAGE, first);

      assert.equal(state.snapshots.length, 2);
      assert.equal(yield* readySnapshot(memory), state.snapshots[1]?.id);
    }),
);

it.effect("a fill whose install failed leaves no base snapshot", () =>
  Effect.gen(function* () {
    const { memory, state } = fixture(1);

    const failed = yield* Effect.result(filled(memory));

    assert.equal(failed._tag, "Failure");
    assert.deepEqual(state.snapshots, []);
    assert.deepEqual(state.deleted, [baseSnapshotName(RELAY)]);
    assert.equal((yield* readOn(memory)).state, BASE_STATE.WANTED);
  }),
);
