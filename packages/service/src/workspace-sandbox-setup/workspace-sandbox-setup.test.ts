/**
 * workspace-sandbox-setup.test.ts -- an edit of one run action, as every door makes it: it edits the repository's list as it stands, one action at a time, makes one action alone the default, and is refused to anyone but the workspace's owners and admins.
 *
 * Synthetic accounts, workspaces, repositories, and commands throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@repo/database/testing";
import type { WorkspaceSandboxSetupAnswer } from "@repo/features/workspace-sandbox-setup-wire";
import { Effect, Result } from "effect";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { editRunAction, readSandboxSetup, saveRunActions } from "./workspace-sandbox-setup.js";

const RELAY = "acme/relay";

/** The repository's actions in an answer, each as its label and whether it is the default. */
function actionsOf(setup: WorkspaceSandboxSetupAnswer) {
  const list =
    setup.runActions?.find((one) => one.repository.toLowerCase() === RELAY)?.actions ?? [];
  return list.map((action) => ({
    id: action.id,
    label: action.label,
    isDefault: action.isDefault === true,
  }));
}

/** A new account, answering its id. */
const signedUp = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) => db.insert(user).values({ id, name: id, email: `${id}@app.test` }));
  return id;
});

/** A workspace its owner made, with the repository's run actions saved under the labels given. */
const openWithActions = (labels: readonly string[]) =>
  Effect.gen(function* () {
    const owner = yield* signedUp;
    const workspaceId = yield* openWorkspace(owner);
    const saved = yield* saveRunActions(
      owner,
      workspaceId,
      RELAY,
      labels.map((label) => ({ label, command: `pnpm ${label.toLowerCase()}` })),
    );
    const ids = actionsOf(saved).map(({ id }) => id);
    /** The id of the action saved at the place. */
    const idAt = (place: number) => {
      const id = ids[place];
      assert.ok(id !== undefined, `an action stands at ${place}`);
      return id;
    };
    return { owner, workspaceId, idAt };
  });

it.layer(getTestDB())("an edit of one run action", (it) => {
  it.effect(
    "changes the action it names in the list as it stands, keeping its id, its place, and every action saved since the editor read it",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId, idAt } = yield* openWithActions(["Dev", "Test"]);
        const admin = yield* signedUp;
        yield* joinWorkspace(workspaceId, admin, WORKSPACE_ROLE.ADMIN);
        // The editor read the list before a teammate added an action to it.
        const read = yield* readSandboxSetup(admin, workspaceId);
        assert.equal(actionsOf(read).length, 2);
        yield* saveRunActions(owner, workspaceId, RELAY, [
          { id: idAt(0), label: "Dev", command: "pnpm dev" },
          { id: idAt(1), label: "Test", command: "pnpm test" },
          { label: "Lint", command: "pnpm lint" },
        ]);

        const edited = yield* editRunAction(admin, workspaceId, {
          workspaceId,
          repository: "Acme/Relay",
          actionId: idAt(0),
          label: "Dev server",
        });

        assert.deepEqual(
          actionsOf(edited).map(({ id, label }) => [id === idAt(0), label]),
          [
            [true, "Dev server"],
            [false, "Test"],
            [false, "Lint"],
          ],
        );
      }),
  );

  it.effect("made the default, makes no other action the default", () =>
    Effect.gen(function* () {
      const { owner, workspaceId, idAt } = yield* openWithActions(["Dev", "Test"]);
      yield* editRunAction(owner, workspaceId, {
        workspaceId,
        repository: RELAY,
        actionId: idAt(0),
        isDefault: true,
      });

      const edited = yield* editRunAction(owner, workspaceId, {
        workspaceId,
        repository: RELAY,
        actionId: idAt(1),
        isDefault: true,
      });

      assert.deepEqual(
        actionsOf(edited).map(({ label, isDefault }) => [label, isDefault]),
        [
          ["Dev", false],
          ["Test", true],
        ],
      );
    }),
  );

  it.effect("adds an action at the place named, moves one, and removes one", () =>
    Effect.gen(function* () {
      const { owner, workspaceId, idAt } = yield* openWithActions(["Dev", "Test"]);
      const edit = { workspaceId, repository: RELAY };
      yield* editRunAction(owner, workspaceId, {
        ...edit,
        label: "Lint",
        command: "pnpm lint",
        position: 0,
      });
      yield* editRunAction(owner, workspaceId, { ...edit, actionId: idAt(1), position: 0 });
      const edited = yield* editRunAction(owner, workspaceId, {
        ...edit,
        actionId: idAt(0),
        remove: true,
      });

      assert.deepEqual(
        actionsOf(edited).map(({ label }) => label),
        ["Test", "Lint"],
      );
    }),
  );

  it.effect(
    "is refused to a plain member, to an account in another workspace, for an id the repository has none of, and for an add that names no command or passes the most a repository keeps",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId, idAt } = yield* openWithActions(
          Array.from({ length: 20 }, (_, index) => `Action ${index}`),
        );
        const member = yield* signedUp;
        yield* joinWorkspace(workspaceId, member, WORKSPACE_ROLE.MEMBER);
        const elsewhere = yield* openWithActions(["Theirs"]);
        const change = { workspaceId, repository: RELAY, actionId: idAt(0), label: "Renamed" };

        const refusals = yield* Effect.forEach(
          [
            editRunAction(member, workspaceId, change),
            // The owner of another workspace reaches neither this workspace nor, through their own, its action.
            editRunAction(elsewhere.owner, workspaceId, change),
            editRunAction(elsewhere.owner, elsewhere.workspaceId, {
              ...change,
              workspaceId: elsewhere.workspaceId,
            }),
            editRunAction(owner, workspaceId, { ...change, actionId: elsewhere.idAt(0) }),
            editRunAction(owner, workspaceId, { workspaceId, repository: RELAY, label: "Lint" }),
            editRunAction(owner, workspaceId, {
              workspaceId,
              repository: RELAY,
              label: "Lint",
              command: "pnpm lint",
            }),
          ],
          (edit) => Effect.result(edit),
        );

        assert.deepEqual(
          refusals.map((answer) => (Result.isFailure(answer) ? answer.failure : "edited")),
          [
            HOSTED_REFUSAL.NOT_PERMITTED,
            HOSTED_REFUSAL.NOT_FOUND,
            HOSTED_REFUSAL.NOT_FOUND,
            HOSTED_REFUSAL.NOT_FOUND,
            HOSTED_REFUSAL.INVALID_REQUEST,
            HOSTED_REFUSAL.INVALID_REQUEST,
          ],
        );
        const standing = actionsOf(yield* readSandboxSetup(owner, workspaceId));
        assert.equal(standing.length, 20);
        assert.equal(standing[0]?.label, "Action 0");
        assert.deepEqual(
          actionsOf(yield* readSandboxSetup(elsewhere.owner, elsewhere.workspaceId)).map(
            ({ label }) => label,
          ),
          ["Theirs"],
        );
      }),
  );
});
