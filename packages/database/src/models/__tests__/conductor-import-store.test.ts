import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  CONDUCTOR_IMPORT_FAILURE,
  CONDUCTOR_IMPORT_KIND,
  CONDUCTOR_IMPORT_STATUS,
} from "@repo/features/conductor-import-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  beginConductorImportRun,
  queueConductorImportItems,
  readConductorImportRun,
  readConductorImports,
  readNewestConductorImportRun,
  recordConductorImport,
  settleConductorImportItem,
  sweepConductorImportRuns,
} from "../conductor-import-store.js";

/**
 * What a workspace imported from Conductor and each run of an import, over
 * a real dialect: a workspace reads only its own imports, a member reads
 * only their own runs, and a run's key leaves once nothing of it is queued.
 * Synthetic accounts, workspaces, ids, and a stand-in for a sealed key.
 */

const AT = new Date("2026-11-12T12:00:00Z");
const DAY_LATER = new Date("2026-11-13T12:00:00Z");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

  return { userId, workspace: yield* openWorkspace(userId) };
});

const begin = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    const id = randomUUID();

    yield* beginConductorImportRun({
      id,
      organizationId,
      userId,
      sealedKey: "sealed-stand-in",
      startedAt: AT,
      keyExpiresAt: DAY_LATER,
    });

    return id;
  });

it.layer(getTestDB())("the Conductor import store", (it) => {
  it.effect("a workspace reads only the Conductor ids it imported itself", () =>
    Effect.gen(function* () {
      const mine = yield* openAccount;
      const theirs = yield* openAccount;

      yield* recordConductorImport(
        mine.workspace,
        { conductorId: "ws-1", kind: CONDUCTOR_IMPORT_KIND.WORKSPACE, taskId: null, agentId: null },
        AT,
      );

      assert.deepEqual(
        [...(yield* readConductorImports(mine.workspace, ["ws-1", "ws-2"])).keys()],
        ["ws-1"],
      );
      assert.equal((yield* readConductorImports(theirs.workspace, ["ws-1"])).size, 0);
    }),
  );

  it.effect("a member reads only their own newest run, never another member's", () =>
    Effect.gen(function* () {
      const mine = yield* openAccount;
      const other = yield* openAccount;
      const runId = yield* begin(mine.workspace, mine.userId);

      const read = yield* readNewestConductorImportRun(mine.userId, mine.workspace);
      assert.equal(Option.getOrThrow(read).run.id, runId);
      assert.ok(Option.isNone(yield* readNewestConductorImportRun(other.userId, mine.workspace)));
    }),
  );

  it.effect("a run's key is cleared once its last queued item settles, and not before", () =>
    Effect.gen(function* () {
      const { userId, workspace } = yield* openAccount;
      const runId = yield* begin(workspace, userId);

      yield* queueConductorImportItems(
        runId,
        [
          {
            conductorId: "ws-1",
            kind: CONDUCTOR_IMPORT_KIND.WORKSPACE,
            workspaceConductorId: "ws-1",
            name: "One",
          },
          {
            conductorId: "chat-1",
            kind: CONDUCTOR_IMPORT_KIND.CHAT,
            workspaceConductorId: "ws-1",
            name: "Chat",
          },
        ],
        AT,
      );

      const imported = { status: CONDUCTOR_IMPORT_STATUS.IMPORTED, failure: null } as const;
      assert.equal(yield* settleConductorImportItem(runId, "ws-1", imported, AT), false);
      assert.notEqual(Option.getOrThrow(yield* readConductorImportRun(runId)).sealedKey, null);

      const failed = {
        status: CONDUCTOR_IMPORT_STATUS.FAILED,
        failure: CONDUCTOR_IMPORT_FAILURE.CHAT_NOT_WRITTEN,
      } as const;

      assert.equal(yield* settleConductorImportItem(runId, "chat-1", failed, AT), true);
      assert.equal(Option.getOrThrow(yield* readConductorImportRun(runId)).sealedKey, null);
    }),
  );

  it.effect("the sweep clears a key past its day, and deletes a run begun before the bound", () =>
    Effect.gen(function* () {
      const { userId, workspace } = yield* openAccount;
      const runId = yield* begin(workspace, userId);

      yield* queueConductorImportItems(
        runId,
        [
          {
            conductorId: "ws-1",
            kind: CONDUCTOR_IMPORT_KIND.WORKSPACE,
            workspaceConductorId: "ws-1",
            name: null,
          },
        ],
        AT,
      );

      yield* sweepConductorImportRuns(DAY_LATER, AT);
      assert.equal(Option.getOrThrow(yield* readConductorImportRun(runId)).sealedKey, null);

      yield* sweepConductorImportRuns(DAY_LATER, DAY_LATER);
      assert.ok(Option.isNone(yield* readConductorImportRun(runId)));
    }),
  );
});
