/**
 * workspace-drive.test.ts -- a workspace's drive, over the test's own database, a GitHub that answers from the test's own installation, and `Sandbox` kept in memory: a fill clones each connected repository into its own folder and installs it, a repository that fails is passed by while the rest are filled, and a repository no longer connected is left out of the folders the drive keeps. Synthetic accounts throughout.
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
const { PATH, VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

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

/** The folder a command ran on: the one it brought to its default branch, or the one it ran in. */
const folderOf = (command: MemoryCommand) =>
  command.ask.env?.[VARIABLE.FOLDER] ?? command.ask.cwd?.replace(`${PATH.WORKSPACE}/`, "");

const isSync = (command: MemoryCommand) => Object.hasOwn(command.ask.env ?? {}, VARIABLE.FOLDER);
const isInstall = (command: MemoryCommand) =>
  command.ask.args.some((arg) => arg.includes("pnpm install"));
const isPrune = (command: MemoryCommand) => Object.hasOwn(command.ask.env ?? {}, VARIABLE.KEEP);

/**
 * The sandboxes kept in memory, each command a success but these: `git
 * rev-parse` in a folder no sync has cloned yet, which holds no checkout,
 * and the sync of the folder named to fail.
 */
function fixture(failing?: string) {
  const cloned = new Set<string>();
  const memory = memorySandbox({
    run: (command) => {
      const folder = folderOf(command);
      if (isSync(command) && folder === failing) return { exitCode: 1, stdout: "", stderr: "" };
      if (isSync(command) && folder !== undefined) cloned.add(folder);
      const head = command.ask.args.some((arg) => arg === "git rev-parse HEAD");
      if (head && (folder === undefined || !cloned.has(folder))) {
        return { exitCode: 128, stdout: "", stderr: "not a git repository" };
      }
      return { exitCode: 0, stdout: head ? "c0ffee\n" : "", stderr: "" };
    },
  });
  return memory;
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
    "a fill clones each connected repository into its own folder on the one drive and installs it there",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(7201, ["relay", "ledger"]);
        const workspace = yield* connected(installation);
        const memory = fixture();

        assert.equal(yield* filled(memory, installation, workspace), true);

        const name = workspaceDriveName(workspace.workspaceId);
        const { commands } = memory.state;
        assert.deepEqual([...memory.state.drives.keys()], [name]);
        assert.deepEqual(commands.filter(isSync).map(folderOf).toSorted(), [
          "acme/ledger",
          "acme/relay",
        ]);
        assert.deepEqual(
          commands
            .filter(isInstall)
            .map((each) => each.ask.cwd)
            .toSorted(),
          [`${PATH.WORKSPACE}/acme/ledger`, `${PATH.WORKSPACE}/acme/relay`],
        );
        assert.deepEqual(memory.state.deleted, [name]);
      }),
  );

  it.effect("a repository that fails is passed by and the others are still filled", () =>
    Effect.gen(function* () {
      const installation = installationOf(7202, ["relay", "ledger"]);
      const workspace = yield* connected(installation);
      const memory = fixture("acme/ledger");

      assert.equal(yield* filled(memory, installation, workspace), true);

      const { commands } = memory.state;
      assert.deepEqual(
        commands.filter(isInstall).map((each) => each.ask.cwd),
        [`${PATH.WORKSPACE}/acme/relay`],
      );
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
        assert.deepEqual(ran.filter(isSync).map(folderOf), ["acme/relay"]);
        assert.deepEqual(
          ran.filter(isPrune).map((each) => each.ask.env?.[VARIABLE.KEEP]),
          ["acme/relay"],
        );
        // Relay's checkout stood and no lockfile moved, so nothing is installed again.
        assert.deepEqual(ran.filter(isInstall), []);
      }),
  );
});
