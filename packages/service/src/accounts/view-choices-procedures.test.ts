import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, leaveWorkspace, openWorkspace } from "@repo/database/testing";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { VIEW_CHOICES_READ } from "@repo/features/view-choice-live";
import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { MANAGER_SORT } from "@repo/features/workspace-managers-model";
import { HTTP_METHOD, type WireRecord } from "@repo/wire";
import { Clock, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { viewChoicesRead } from "../live/reads/view-choices.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { viewChoicesProcedures } from "./view-choices-procedures.js";

/**
 * The account's view choices as its devices write them and follow them
 * live, over a real dialect: a choice is kept only as its key declares it,
 * a value its key holds in the place its key is kept; a workspace the
 * account is not in keeps nothing; and each account's live read carries its
 * own choices alone, none of a workspace it has since left.
 *
 * Synthetic accounts and workspaces throughout.
 */

const ORIGIN = "https://app.test";
const KEY = VIEW_CHOICE_KEY.MANAGER_SORT;

/** A workspace's owner and one more member, and an account outside it, each behind a bearer. */
const openTeam = Effect.gen(function* () {
  const db = yield* Database;

  const [owner, teammate, outsider] = [
    `user-${randomUUID()}`,
    `user-${randomUUID()}`,
    `user-${randomUUID()}`,
  ];

  for (const id of [owner, teammate, outsider]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, teammate);

  return { owner, teammate, outsider, workspaceId };
});

const procedures = viewChoicesProcedures({
  resolveUserId: (incoming) =>
    Effect.succeed(
      Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
    ),
});

/** The status a write of `body` by `userId` is answered with. */
const write = (userId: string, choice: WireRecord) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;

    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );

    const request = new Request(new URL(HOSTED_SERVICE_PATH.ACCOUNT_VIEW_CHOICES, ORIGIN), {
      method: HTTP_METHOD.PUT,
      headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
      body: JSON.stringify({ id: randomUUID(), ...choice }),
    });

    const response = yield* hostedAnswer({ account: procedures }, services, request);

    return response.status;
  });

/** The account's choices as a device following them live decodes them, as `workspace → value`, the account's own under `account`. */
const liveChoicesOf = (userId: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(viewChoicesRead.statements({ userId }));
    const sqlClient = yield* SqlClient.SqlClient;
    const rows = yield* sqlClient.unsafe(statements.choices.sql, [...statements.choices.params]);

    const { choices } = yield* Schema.decodeUnknownEffect(VIEW_CHOICES_READ.rows)({
      choices: rows,
    });

    return Object.fromEntries(choices.map((row) => [row.workspaceId ?? "account", row.value]));
  });

it.layer(getTestDB())("the account's view choices", (it) => {
  it.effect("are kept only as their key declares them, in a workspace the account is in", () =>
    Effect.gen(function* () {
      const { owner, outsider, workspaceId } = yield* openTeam;
      const OK = HOSTED_HTTP_STATUS.OK;
      const INVALID = HOSTED_HTTP_STATUS.BAD_REQUEST;

      assert.equal(yield* write(owner, { key: KEY, workspaceId, value: MANAGER_SORT.NAME }), OK);
      assert.equal(yield* write(owner, { key: KEY, workspaceId, value: "by mood" }), INVALID);
      // A workspace's choice names its workspace, so one sent for the account is not one.
      assert.equal(
        yield* write(owner, { key: KEY, workspaceId: null, value: MANAGER_SORT.NAME }),
        INVALID,
      );
      assert.equal(
        yield* write(outsider, { key: KEY, workspaceId, value: MANAGER_SORT.CREATED }),
        HOSTED_HTTP_STATUS.NOT_FOUND,
      );
      assert.deepEqual(yield* liveChoicesOf(owner), { [workspaceId]: MANAGER_SORT.NAME });
      assert.deepEqual(yield* liveChoicesOf(outsider), {});

      assert.equal(yield* write(owner, { key: KEY, workspaceId, value: null }), OK);
      assert.deepEqual(yield* liveChoicesOf(owner), {});
    }),
  );

  it.effect("are read live by their own account alone, none of a workspace it left", () =>
    Effect.gen(function* () {
      const { owner, teammate, workspaceId } = yield* openTeam;
      yield* write(owner, { key: KEY, workspaceId, value: MANAGER_SORT.NAME });
      yield* write(teammate, { key: KEY, workspaceId, value: MANAGER_SORT.CREATED });

      assert.deepEqual(yield* liveChoicesOf(owner), { [workspaceId]: MANAGER_SORT.NAME });
      assert.deepEqual(yield* liveChoicesOf(teammate), { [workspaceId]: MANAGER_SORT.CREATED });

      yield* leaveWorkspace(workspaceId, teammate);
      assert.deepEqual(yield* liveChoicesOf(teammate), {});
    }),
  );
});
