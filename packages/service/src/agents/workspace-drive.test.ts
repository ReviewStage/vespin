/**
 * workspace-drive.test.ts -- a workspace's drive, over the test's own database, a GitHub that answers from the test's own installation, and `Sandbox` kept in memory: a fill brings each connected repository into its own folder and installs nothing, a repository that fails is passed by while the rest are filled, a repository no longer connected is left out of the folders the drive keeps. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { Sandbox } from "@repo/sandbox";
import { type MemoryCommand, memorySandbox } from "@repo/sandbox/testing";
import { Effect } from "effect";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
} from "../testing/github-app-fake.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import { fillWorkspaceDrive, workspaceDriveName } from "./workspace-drive.js";

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

/** The sandboxes kept in memory, each command a success but the sync of the folder named, which its batch says failed. */
function fixture(failing?: string) {
  return memorySandbox({
    run: (command) =>
      failing !== undefined && isSync(command) && foldersOf(command).includes(failing)
        ? { exitCode: 0, stdout: `failed ${failing}\n`, stderr: "" }
        : undefined,
  });
}

/** The workspace's drive filled as the installation given has it. */
const filled = (
  memory: ReturnType<typeof memorySandbox>,
  installation: InstallationFixture,
  workspace: { readonly workspaceId: string; readonly userId: string },
) =>
  fillWorkspaceDrive(run, IMAGE, workspace).pipe(
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
    "a fill brings each connected repository into its own folder on the one drive and installs nothing",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(7201, ["relay", "ledger"]);
        const workspace = yield* connected(installation);
        const memory = fixture();

        assert.equal(yield* filled(memory, installation, workspace), true);

        const name = workspaceDriveName(workspace.workspaceId);
        const { commands } = memory.state;
        assert.deepEqual([...memory.state.drives.keys()], [name]);
        assert.deepEqual(syncedOf(commands).toSorted(), ["acme/ledger", "acme/relay"]);
        assert.deepEqual(commands.filter(isInstall), []);
        assert.deepEqual(memory.state.deleted, [name]);
      }),
  );

  it.effect("a repository that fails is passed by and the others are still filled", () =>
    Effect.gen(function* () {
      const installation = installationOf(7202, ["relay", "ledger"]);
      const workspace = yield* connected(installation);
      // The workspace's repositories are listed by name, so relay's sync comes after the one that failed.
      const memory = fixture("acme/ledger");

      assert.equal(yield* filled(memory, installation, workspace), true);

      const { commands } = memory.state;
      assert.deepEqual(syncedOf(commands), ["acme/ledger", "acme/relay"]);
      // The failed repository is still connected, so its folder is kept as it stood.
      const kept = commands.filter(isPrune).at(-1)?.ask.env?.[VARIABLE.KEEP];
      assert.deepEqual(kept?.split("\n").toSorted(), ["acme/ledger", "acme/relay"]);
      assert.deepEqual(memory.state.deleted, [workspaceDriveName(workspace.workspaceId)]);
    }),
  );

  it.effect(
    "a repository no longer connected is neither fetched nor kept on the next fill, which prunes its folder",
    () =>
      Effect.gen(function* () {
        const both = installationOf(7203, ["relay", "ledger"]);
        const workspace = yield* connected(both);
        const memory = fixture();
        yield* filled(memory, both, workspace);
        const before = memory.state.commands.length;

        yield* filled(memory, installationOf(7203, ["relay"]), workspace);

        const ran = memory.state.commands.slice(before);
        assert.deepEqual(syncedOf(ran), ["acme/relay"]);
        assert.deepEqual(
          ran.filter(isPrune).map((each) => each.ask.env?.[VARIABLE.KEEP]),
          ["acme/relay"],
        );
      }),
  );
});
