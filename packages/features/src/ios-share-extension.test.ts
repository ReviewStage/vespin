import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@repo/wire/testing";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { AGENT_STATUS } from "./agent-wire.js";
import { CLIENT_PLATFORM } from "./client-identity.js";
import { inboxPushOfRequest, inboxPushResponseOf } from "./inbox-push-wire.js";
import {
  keptShare,
  type ShareStartedNotice,
  sendShare,
  sharedField,
  shareStartedNotice,
} from "./ios-share-extension.js";
import { SHARE_NEW_TASK_ID } from "./ios-share-page-model.js";
import { shareSendsOf } from "./ios-share-send.js";
import { SHARE_DESTINATION_KIND, type ShareDestination } from "./ios-share-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * ios-share-extension.test.ts -- the share extension lays what was shared
 * into the field as the app's page does, sends each place ticked under the
 * token it read, sends nothing without one, and notifies the task a share
 * made so a tap opens it. Synthetic ids throughout.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "3c9e1d2a-6b7f-4e8a-9c0d-1e2f3a4b5c6d";
const TOKEN = "token-share-1";

const SERVICE = {
  origin: "https://vespin.test",
  client: { platform: CLIENT_PLATFORM.IOS, version: "0.1.0" },
};

const ROWS: readonly ShareDestination[] = [
  { kind: SHARE_DESTINATION_KIND.AGENT, id: "a-fix", name: "Refresh fix", task: "Refresh", at: 1 },
];

const TASK = {
  id: TASK_ID,
  workspaceId: "workspace-acme",
  name: "Swift concurrency",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_100_000,
  repository: null,
  description: { body: "", assumptions: [] },
};

const AGENT = {
  id: AGENT_ID,
  taskId: TASK_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1_800_000_300_000,
  status: AGENT_STATUS.STARTING,
  turnId: null,
};

/** The writes a share of "Read this" makes to the places ticked. */
function sendsTo(to: readonly string[]) {
  return shareSendsOf({
    to,
    rows: ROWS,
    text: "Read this",
    attachments: [],
    keyOf: (place) => `key-${place}`,
    newTask: { taskId: TASK_ID, workspaceId: "workspace-acme", repository: undefined },
  });
}

/** Where a tap on the notification opens the app, read as the app's tap handler reads a local notification. */
function tapped(payload: ShareStartedNotice["payload"]) {
  const push = inboxPushOfRequest({ content: { data: payload } });

  return inboxPushResponseOf(push, { actionId: "expo.modules.notifications.actions.DEFAULT" });
}

test("what was shared lands in the field: its words, the link as a pill unless the words hold it, then each picture", () => {
  const field = sharedField({
    texts: ["Can we adopt this?", " Can we adopt this? "],
    links: ["https://www.swift.org/migration/"],
    title: "Migration guide",
    pictures: ["/tmp/shared-1.jpg", "/tmp/shared-2.jpg"],
  });

  expect(field.words).toBe(
    "Can we adopt this?\n\n[@Migration guide](https://www.swift.org/migration/)\n\n[Picture 1] [Picture 2] ",
  );
  expect(field.pictures).toEqual([
    { name: "Picture 1", file: "/tmp/shared-1.jpg" },
    { name: "Picture 2", file: "/tmp/shared-2.jpg" },
  ]);
  expect(
    sharedField({
      texts: ["See https://example.com"],
      links: ["https://example.com"],
      title: undefined,
      pictures: [],
    }).words,
  ).toBe("See https://example.com ");
});

test("a share kept after a picture was taken off names the rest as the app will reopen them, each marker still on its picture", () => {
  const pictures = [
    { name: "Picture 1", file: "file:///tmp/a.jpg" },
    { name: "Picture 2", file: "file:///tmp/b.jpg" },
    { name: "Picture 3", file: "file:///tmp/c.jpg" },
  ];

  expect(keptShare("Compare [Picture 2] with [Picture 3] ", pictures)).toEqual({
    words: "Compare [Picture 1] with [Picture 2] ",
    pictures: [
      { name: "Picture 1", file: "file:///tmp/b.jpg" },
      { name: "Picture 2", file: "file:///tmp/c.jpg" },
    ],
  });
});

it.effect(
  "a share that made a task notifies it, opening its agent, or the task where its agent was refused",
  () =>
    Effect.gen(function* () {
      let starts = 0;

      const api = fakeCloudApi({
        "POST /api/tasks": {
          answer: () => {
            starts += 1;

            return starts === 1
              ? { task: TASK, agent: AGENT }
              : { task: TASK, agentRefusal: { error: HOSTED_API_ERROR.INVALID_REQUEST } };
          },
          status: 201,
        },
      });

      const went = yield* Effect.provide(
        sendShare(sendsTo([SHARE_NEW_TASK_ID]), TOKEN, SERVICE),
        api.layer,
      );

      const refused = yield* Effect.provide(
        sendShare(sendsTo([SHARE_NEW_TASK_ID]), TOKEN, SERVICE),
        api.layer,
      );

      expect(api.credentials()).toEqual([TOKEN, TOKEN]);
      expect(went.failed).toEqual([]);
      expect(refused.failed).toEqual([SHARE_NEW_TASK_ID]);
      assert.ok(went.started !== undefined && refused.started !== undefined);
      expect(tapped(shareStartedNotice(went.started).payload)).toEqual({
        route: `/tasks/agent/${AGENT_ID}`,
      });
      expect(tapped(shareStartedNotice(refused.started).payload)).toEqual({
        route: `/tasks/${TASK_ID}`,
      });
    }),
);

it.effect("a place whose write the service refused stays to send again", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/tasks": { answer: () => ({ task: TASK, agent: AGENT }), status: 201 },
      "POST /api/agents/a-fix/messages": {
        answer: () => ({}),
        status: HTTP_STATUS.SERVER_ERROR,
      },
    });

    const sent = yield* Effect.provide(
      sendShare(sendsTo(["a-fix", SHARE_NEW_TASK_ID]), TOKEN, SERVICE),
      api.layer,
    );

    expect(sent.failed).toEqual(["a-fix"]);
  }),
);

it.effect("with no token a share sends nothing and every place stays to send again", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});

    const sent = yield* Effect.provide(
      sendShare(sendsTo(["a-fix", SHARE_NEW_TASK_ID]), undefined, SERVICE),
      api.layer,
    );

    expect(sent).toEqual({ failed: ["a-fix", SHARE_NEW_TASK_ID], started: undefined });
    expect(api.requests()).toEqual([]);
  }),
);
