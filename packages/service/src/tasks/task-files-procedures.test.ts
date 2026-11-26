import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writePage } from "@repo/database/models/task-pages";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openTaskAgent, startTask } from "@repo/database/testing";
import { PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import { type Context, Effect, Layer, Option } from "effect";
import {
  recordingProductAnalytics,
  SERVER_AGENT_TOOL,
  SERVER_EVENT,
} from "../events/server-events.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { memoryBlobStore } from "../testing/blob-store-fake.js";
import { taskFilesProcedures } from "./task-files-procedures.js";

/**
 * A picture added to a description through the plan files procedures, over a real
 * dialect: the member who adds one is counted as having added a file to the
 * description, in the plan's workspace, and one who may not write the description is
 * refused and counted for nothing. A page read by its id alone answers its
 * newest version, under its own task alone.
 *
 * Synthetic accounts, bearers, workspaces, and tasks throughout.
 */

const ORIGIN = "https://app.test";

/** The eight bytes every PNG begins with, as the `data:` URL the Mac sends a picture as. */
const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** What the procedures counted, across the file; a test reads its own account's. */
const ANALYTICS = recordingProductAnalytics();

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
  );

  return id;
});

/** A request handled by the plan files procedures under the account's bearer. */
const handleAs = (userId: string, path: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    // SAFETY: the procedures yield the database, the clock and the analytics alone, which the test's own context holds.
    const services = (yield* Effect.context<never>().pipe(
      Effect.provide(ANALYTICS.layer),
    )) as Context.Context<WebServices>;

    const handle = hostedFetch({
      taskFiles: taskFilesProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
      }),
    });

    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${userId}`);

    return yield* Effect.promise(() =>
      handle(new Request(new URL(path, ORIGIN), { ...init, headers }), services),
    );
  });

/** A picture sent to the description under the account's bearer, as its status. */
const keepAs = (userId: string, taskId: string) =>
  Effect.map(
    handleAs(userId, `/api/tasks/${taskId}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ picture: PNG }),
    }),
    (response) => response.status,
  );

/** A page read by its id alone under a task, as its status and the version and HTML it answered. */
const readNewestAs = (userId: string, taskId: string, pageId: string) =>
  Effect.gen(function* () {
    const response = yield* handleAs(userId, `/api/tasks/${taskId}/pages/${pageId}`);

    if (response.status !== HOSTED_HTTP_STATUS.OK) return { status: response.status };

    // SAFETY: an answer that is OK is the procedure's output, a page version with its HTML.
    const body = (yield* Effect.promise(() => response.json())) as {
      readonly page: { readonly version: number; readonly html: string };
    };

    return { status: response.status, version: body.page.version, html: body.page.html };
  });

it.layer(Layer.merge(getTestDB(), memoryBlobStore().layer))("the plan files route", (it) => {
  it.effect(
    "a picture added to a description is counted under the member in the plan's workspace, and one refused is not",
    () =>
      Effect.gen(function* () {
        const [starter, outsider] = [yield* openAccount, yield* openAccount];
        const task = yield* startTask(starter, { name: "Teammate invitations" });

        const refused = yield* keepAs(outsider, task.id);
        const kept = yield* keepAs(starter, task.id);

        assert.equal(refused, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(kept, HOSTED_HTTP_STATUS.CREATED);

        const countedFor = (userId: string) =>
          ANALYTICS.recorded
            .filter(
              (event) => event.userId === userId && event.name === SERVER_EVENT.AGENT_TOOL_OPEN,
            )
            .map((event) => ({ workspaceId: event.workspaceId, ...event.properties }));

        assert.deepEqual(countedFor(starter), [
          { workspaceId: task.workspaceId, tool: SERVER_AGENT_TOOL.ADD_TO_DESCRIPTION },
        ]);
        assert.deepEqual(countedFor(outsider), []);
      }),
  );

  it.effect(
    "a page read by its id alone answers its newest version, and not under another task or to an outsider",
    () =>
      Effect.gen(function* () {
        const [starter, outsider] = [yield* openAccount, yield* openAccount];
        const task = yield* startTask(starter, { name: "Teammate invitations" });
        const other = yield* startTask(starter, { name: "Billing" });
        const agentId = yield* openTaskAgent(starter, task.workspaceId, task.id);
        const owner = taskPageOwner(task.id);
        const shownBy = { kind: PAGE_SHOWER.AGENT, agentId } as const;

        const first = Option.getOrThrow(
          yield* writePage(starter, owner, { title: "Invites", html: "<h1>One</h1>" }, shownBy),
        );

        yield* writePage(
          starter,
          owner,
          { pageId: first.id, title: "Invites", html: "<h1>Two</h1>" },
          shownBy,
        );

        assert.deepEqual(yield* readNewestAs(starter, task.id, first.id), {
          status: HOSTED_HTTP_STATUS.OK,
          version: 2,
          html: "<h1>Two</h1>",
        });
        assert.deepEqual(yield* readNewestAs(starter, other.id, first.id), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
        });
        assert.deepEqual(yield* readNewestAs(outsider, task.id, first.id), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
        });
      }),
  );
});
