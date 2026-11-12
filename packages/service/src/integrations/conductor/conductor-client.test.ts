import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "@effect/vitest";
import {
  type JsonValue,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@repo/wire/testing";
import { Effect, Redacted } from "effect";
import {
  CONDUCTOR_READ_FAILURE,
  ConductorReadFailed,
  listConductorChats,
  listConductorProjects,
  listConductorWorkspaces,
  readConductorIdentity,
  readConductorMessages,
} from "./conductor-client.js";

/**
 * Conductor's reads as the import makes them, against responses written by
 * hand from the API's documented shapes and the live API test of Nov 12,
 * 2026, scrubbed to synthetic names: each read sends the key as its bearer,
 * walks every page, and answers the fields the import uses; `/me` drops the
 * key it echoes; and a refusal or an answer of another shape fails with its
 * reason and nothing of the key.
 */

const KEY_TEXT = "synthetic-conductor-key";
const KEY = Redacted.make(KEY_TEXT);

function fixture(name: string): JsonValue {
  // SAFETY: the fixture is JSON written for this test.
  return JSON.parse(
    readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"),
  ) as JsonValue;
}

/** A fake Conductor answering each path from the table, by the request's offset where the table holds pages. */
function conductor(pages: Record<string, readonly JsonValue[]>) {
  return recordingHttpClient((request: RecordedRequest) => {
    const answer = pages[request.pathname]?.[Number(request.searchParams.get("offset") ?? 0)];

    return answer === undefined ? jsonResponse({ error: "not found" }, 404) : jsonResponse(answer);
  });
}

it.effect("the key's identity is read without the key /me echoes back", () =>
  Effect.gen(function* () {
    const api = conductor({ "/me": [fixture("me")] });
    const identity = yield* readConductorIdentity(KEY).pipe(Effect.provide(api.layer));

    assert.deepEqual(identity, {
      userId: "user-synthetic-1",
      organizationId: "org-synthetic",
      organizationName: "Synthetic Org",
      authMethod: "api-key",
    });
    assert.equal(api.requests[0]?.authorization, `Bearer ${KEY_TEXT}`);
  }),
);

it.effect("projects are read with their remotes", () =>
  Effect.gen(function* () {
    const api = conductor({ "/v0/projects": [fixture("projects")] });
    const projects = yield* listConductorProjects(KEY).pipe(Effect.provide(api.layer));

    assert.deepEqual(projects, [
      {
        id: "project-synthetic",
        name: "synthetic-app",
        gitRemote: "https://github.com/synthetic/synthetic-app.git",
      },
    ]);
  }),
);

it.effect("workspaces are walked page by page, archived included, until one says no more", () =>
  Effect.gen(function* () {
    // Pages keyed by the offset each is asked at: the second starts after the first's two.
    const answers: JsonValue[] = [];
    answers[0] = fixture("workspaces-page-1");
    answers[2] = fixture("workspaces-page-2");
    const api = conductor({ "/v0/workspaces": answers });
    const workspaces = yield* listConductorWorkspaces(KEY).pipe(Effect.provide(api.layer));

    assert.deepEqual(
      workspaces.map(({ id, state, creatorName }) => ({ id, state, creatorName })),
      [
        { id: "workspace-one", state: "archived", creatorName: "Sam Example" },
        { id: "workspace-two", state: "sleeping", creatorName: "Alex Example" },
        { id: "workspace-three", state: "ready", creatorName: "Sam Example" },
      ],
    );
    assert.deepEqual(
      api.requests.map((request) => request.searchParams.get("includeArchived")),
      ["true", "true"],
    );
  }),
);

it.effect("a workspace's chats are read, archived included, with when each was archived", () =>
  Effect.gen(function* () {
    const api = conductor({ "/v0/workspaces/workspace-one/sessions": [fixture("sessions")] });
    const chats = yield* listConductorChats(KEY, "workspace-one").pipe(Effect.provide(api.layer));

    assert.deepEqual(
      chats.map(({ id, archivedAt }) => ({ id, archivedAt })),
      [
        { id: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50", archivedAt: undefined },
        { id: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e51", archivedAt: "2026-10-02T10:00:00.000Z" },
      ],
    );
    assert.equal(api.requests[0]?.searchParams.get("includeArchived"), "true");
  }),
);

it.effect(
  "a chat's messages are walked until a page comes back empty, whole, without kinds the import does not read",
  () =>
    Effect.gen(function* () {
      const path = "/v0/sessions/6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50/messages";
      const answers: JsonValue[] = [];
      answers[0] = fixture("messages-page-1");
      answers[3] = fixture("messages-page-2");
      answers[4] = { data: [], offset: 4, hasMore: true };

      const api = conductor({ [path]: answers });

      const messages = yield* readConductorMessages(
        KEY,
        "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
      ).pipe(Effect.provide(api.layer));

      assert.deepEqual(
        messages.map(({ id, type }) => ({ id, type })),
        [
          { id: "2b0e0f00-0000-4000-8000-000000000001", type: "userMessage" },
          { id: "2b0e0f00-0000-4000-8000-000000000002", type: "agent" },
          { id: "2b0e0f00-0000-4000-8000-000000000004", type: "agent" },
        ],
      );
      assert.deepEqual(messages[0]?.content, {
        message: "Please fix the flaky check.",
        config: { harness: "claude", model: "opus" },
      });
      assert.deepEqual(messages[2]?.content, {
        rawPayload: {
          event: {
            type: "item.completed",
            item: { type: "agentMessage", id: "item_1", text: "Fixed it." },
          },
          thread_id: "thread-synthetic",
        },
      });
      assert.equal(api.requests.length, 3);
    }),
);

it.effect.each([
  { name: "a refused key", status: 401, body: {}, reason: CONDUCTOR_READ_FAILURE.BAD_KEY },
  { name: "a rate limit", status: 429, body: {}, reason: CONDUCTOR_READ_FAILURE.RATE_LIMITED },
  { name: "a server error", status: 500, body: {}, reason: CONDUCTOR_READ_FAILURE.UNAVAILABLE },
  {
    name: "an answer of another shape",
    status: 200,
    body: { data: [{ id: "workspace-one" }], hasMore: false },
    reason: CONDUCTOR_READ_FAILURE.UNREADABLE,
  },
])("$name fails the read with its reason and nothing of the key", ({ status, body, reason }) =>
  Effect.gen(function* () {
    const api = recordingHttpClient(() => jsonResponse(body, status));

    const failure = yield* listConductorWorkspaces(KEY).pipe(
      Effect.flip,
      Effect.provide(api.layer),
    );

    assert.ok(failure instanceof ConductorReadFailed);
    assert.equal(failure.reason, reason);
    assert.ok(!JSON.stringify(failure).includes(KEY_TEXT));
    assert.ok(!String(failure).includes(KEY_TEXT));
  }),
);
