/**
 * workspace-drive.test.ts -- a workspace's drive, over the test's own database, a GitHub that answers from the test's own installation, and `Sandbox` kept in memory: a fill adds only the repositories it is handed and records those that landed, one that fails gets no row, a fill past its deadline fails and releases the drive, and a disconnect prunes the lost repository's folder and row. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { workspaceDriveRepositories } from "@repo/database/models/workspace-drive-repositories";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { Sandbox } from "@repo/sandbox";
import { type MemoryCommand, memorySandbox } from "@repo/sandbox/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
} from "../testing/github-app-fake.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import {
  fillWorkspaceDrive,
  pruneWorkspaceDrive,
  WORKSPACE_DRIVE,
  WorkspaceDriveDeadline,
  workspaceDriveName,
} from "./workspace-drive.js";

const IMAGE = "agent-image:fixture";
const { VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

/** The fill's checkout run straight on the test's own runtime. */
const run: SandboxRunner = (effect) => Effect.runPromise(effect);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** An installation granting the repositories named, under an id of its own so cases never share one. */
const installationOf = (id: number, names: readonly string[]): InstallationFixture => ({
  id,
  login: "acme",
  repositories: names.map((name) => ({ owner: "acme", name })),
});

/** The folders a batch's sync brought to its default branch, one a line of its list. */
const foldersOf = (command: MemoryCommand) =>
  (command.ask.env?.[VARIABLE.SYNC_LIST] ?? "").split("\n").map((line) => line.split(" ")[0]);

const isSync = (command: MemoryCommand) => Object.hasOwn(command.ask.env ?? {}, VARIABLE.SYNC_LIST);

/** Every folder the commands synced, in the order their batches listed them. */
const syncedOf = (commands: readonly MemoryCommand[]) => commands.filter(isSync).flatMap(foldersOf);

const isInstall = (command: MemoryCommand) =>
  command.ask.args.some((arg) => arg.includes("pnpm install"));

const isPrune = (command: MemoryCommand) => Object.hasOwn(command.ask.env ?? {}, VARIABLE.KEEP);

/** The sandboxes kept in memory, each command a success but the sync of the folder named, which its batch says failed, and every sync where `stalled`, which never ends. */
function fixture(failing?: string, stalled = false) {
  return memorySandbox({
    run: (command) => {
      if (stalled && isSync(command)) return Effect.never;

      return failing !== undefined && isSync(command) && foldersOf(command).includes(failing)
        ? { exitCode: 0, stdout: `failed ${failing}\n`, stderr: "" }
        : undefined;
    },
  });
}

type Workspace = { readonly workspaceId: string; readonly userId: string };

/** The repositories given added to the workspace's drive, its GitHub the installation given. */
const filled = (
  memory: ReturnType<typeof memorySandbox>,
  installation: InstallationFixture,
  workspace: Workspace,
  repositories: readonly string[],
) =>
  fillWorkspaceDrive(run, IMAGE, workspace, repositories).pipe(
    Effect.provide(githubReaching([installation]).layer),
    Effect.provideService(Sandbox, memory.service),
  );

/** The workspace's drive pruned to what the installation given still grants. */
const pruned = (
  memory: ReturnType<typeof memorySandbox>,
  installation: InstallationFixture,
  workspace: Workspace,
) =>
  pruneWorkspaceDrive(run, IMAGE, workspace).pipe(
    Effect.provide(githubReaching([installation]).layer),
    Effect.provideService(Sandbox, memory.service),
  );

/** A workspace of a new owner's, connected to the installation given. */
const connected = (installation: InstallationFixture) =>
  Effect.gen(function* () {
    const userId = yield* openAccount;
    const workspaceId = yield* openWorkspace(userId);
    yield* connectWorkspaceGitHub(workspaceId, installation);

    return { workspaceId, userId };
  });

it.layer(getTestDB())("a workspace's drive", (it) => {
  it.effect(
    "a fill adds only the repositories it is handed, installs and prunes nothing, and records them",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(7201, ["relay", "ledger"]);
        const workspace = yield* connected(installation);
        const memory = fixture();

        assert.deepEqual(yield* filled(memory, installation, workspace, ["acme/Relay"]), [
          "acme/relay",
        ]);

        const name = workspaceDriveName(workspace.workspaceId);
        const { commands } = memory.state;
        assert.deepEqual([...memory.state.drives.keys()], [name]);
        assert.deepEqual(syncedOf(commands), ["acme/relay"]);
        assert.deepEqual(commands.filter(isInstall), []);
        assert.deepEqual(commands.filter(isPrune), []);
        assert.deepEqual(memory.state.deleted, [name]);
        assert.deepEqual(yield* workspaceDriveRepositories(workspace.workspaceId), ["acme/relay"]);
      }),
  );

  it.effect("a repository that fails gets no row while the others land", () =>
    Effect.gen(function* () {
      const installation = installationOf(7202, ["relay", "ledger"]);
      const workspace = yield* connected(installation);
      const memory = fixture("acme/ledger");

      const landed = yield* filled(memory, installation, workspace, ["acme/relay", "acme/ledger"]);

      assert.deepEqual(landed, ["acme/relay"]);
      assert.deepEqual(syncedOf(memory.state.commands).toSorted(), ["acme/ledger", "acme/relay"]);
      assert.deepEqual(yield* workspaceDriveRepositories(workspace.workspaceId), ["acme/relay"]);
    }),
  );

  it.effect("a fill still syncing at its deadline fails and releases the drive", () =>
    Effect.gen(function* () {
      const installation = installationOf(7203, ["relay"]);
      const workspace = yield* connected(installation);
      const memory = fixture(undefined, true);

      const fiber = yield* Effect.forkChild(
        Effect.flip(filled(memory, installation, workspace, ["acme/relay"])),
      );

      yield* TestClock.adjust(WORKSPACE_DRIVE.DEADLINE);
      const failure = yield* Fiber.join(fiber);

      assert.ok(failure instanceof WorkspaceDriveDeadline);
      assert.deepEqual(memory.state.deleted, [workspaceDriveName(workspace.workspaceId)]);
      assert.deepEqual(yield* workspaceDriveRepositories(workspace.workspaceId), []);
    }),
  );

  it.effect(
    "a disconnect prunes the folder and the row of the repository lost, and syncs nothing",
    () =>
      Effect.gen(function* () {
        const both = installationOf(7204, ["relay", "ledger"]);
        const workspace = yield* connected(both);
        const memory = fixture();
        yield* filled(memory, both, workspace, ["acme/relay", "acme/ledger"]);
        const before = memory.state.commands.length;

        assert.equal(yield* pruned(memory, installationOf(7204, ["relay"]), workspace), true);

        const ran = memory.state.commands.slice(before);
        assert.deepEqual(syncedOf(ran), []);
        assert.deepEqual(
          ran.filter(isPrune).map((each) => each.ask.env?.[VARIABLE.KEEP]),
          ["acme/relay"],
        );
        assert.deepEqual(yield* workspaceDriveRepositories(workspace.workspaceId), ["acme/relay"]);
      }),
  );
});
