import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { CONDUCTOR_IMPORT_STATUS } from "@repo/features/conductor-import-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import type { WireValue } from "@repo/wire";
import type { JsonValue } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { fakeGitHub } from "../../testing/github-app-fake.js";
import {
  ConductorImportQueue,
  type ConductorImportQueueService,
  conductorImportProgress,
  consumeImportMessage,
  runConductorImport,
} from "./conductor-import.js";

/**
 * An import from Conductor run twice over a real store and a fake Conductor:
 * the first makes the archived workspace's task Done and writes its chat as
 * an agent, and the second, as a member running it again would, makes
 * nothing twice. Each publish is delivered by hand, in order, as the queue
 * would. Synthetic accounts, ids, key, and transcript throughout.
 */

const KEY = Redacted.make("synthetic-conductor-key");

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(`1:${Buffer.alloc(32, 9).toString("base64")}`),
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

const WORKSPACE = {
  id: "cw-1",
  name: "Fix the flaky check",
  number: 7,
  state: "archived",
  repoUrl: null,
  creatorName: "Someone Else",
  createdAt: "2026-10-01T08:00:00.000Z",
  deepLink: "conductor://workspace/cw-1",
};

const CHAT = { id: "cc-1", name: "First chat", archivedAt: null };

const MESSAGES = [
  {
    id: "m-1",
    type: "userMessage",
    receivedAt: "2026-10-01T09:00:00.000Z",
    content: { message: "Please fix the flaky check.", config: { harness: "claude" } },
  },
  {
    id: "m-2",
    type: "agent",
    receivedAt: "2026-10-01T09:00:05.000Z",
    content: {
      rawPayload: {
        type: "assistant",
        parent_tool_use_id: null,
        message: { id: "msg-1", role: "assistant", content: [{ type: "text", text: "Done." }] },
      },
    },
  },
];

/** A fake Conductor answering each path with one page of what it lists. */
const CONDUCTOR = new Map<string, JsonValue>([
  ["/v0/workspaces", { data: [WORKSPACE], hasMore: false }],
  ["/v0/workspaces/cw-1/sessions", { data: [CHAT], hasMore: false }],
  ["/v0/sessions/cc-1/messages", { data: MESSAGES, hasMore: false }],
]);

/** Conductor answering over the one client, which no request to GitHub reaches with no repository named. */
const conductor = fakeGitHub(({ url }) => {
  const answer = CONDUCTOR.get(new URL(url).pathname);

  return Response.json(answer ?? { error: "not found" }, {
    status: answer === undefined ? 404 : 200,
  });
});

const SERVICES = Layer.mergeAll(
  conductor.layer,
  Layer.succeed(HostedEnvironment, ENVIRONMENT),
  modelCatalogOf([
    {
      id: "anthropic/claude-opus-5.5",
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high"],
    },
  ]),
);

/** A run, with every message it and its deliveries publish delivered in turn, as the queue would deliver them. */
const runDelivered = (userId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const published: WireValue[] = [];

    const queue: ConductorImportQueueService = {
      publish: (message) => Effect.sync(() => void published.push(message)),
    };

    const delivered = Effect.provideService(ConductorImportQueue, queue);
    const answer = yield* delivered(runConductorImport(userId, workspaceId, KEY));

    for (let next = published.shift(); next !== undefined; next = published.shift()) {
      yield* delivered(consumeImportMessage(next, 1));
    }

    return answer;
  });

it.layer(Layer.merge(getTestDB(), SERVICES))("an import from Conductor", (it) => {
  it.effect(
    "a run makes the archived workspace's task Done with its chat as an agent, and a second run makes neither again",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const userId = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: userId, name: "Test User", email: `${userId}@app.test` });
        const workspaceId = yield* openWorkspace(userId);

        const first = yield* runDelivered(userId, workspaceId);
        assert.ok("runId" in first);
        const firstRun = (yield* conductorImportProgress(userId, workspaceId)).run;

        assert.deepEqual(
          firstRun?.items.map((item) => [item.conductorId, item.status, item.failure]),
          [
            ["cc-1", CONDUCTOR_IMPORT_STATUS.IMPORTED, null],
            ["cw-1", CONDUCTOR_IMPORT_STATUS.IMPORTED, null],
          ],
        );

        const [agent, ...others] = yield* db
          .select({ taskId: agentTable.taskId })
          .from(agentTable)
          .where(eq(agentTable.userId, userId));

        assert.ok(agent !== undefined);
        assert.equal(others.length, 0);
        const task = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        assert.equal(task.task.status, TASK_STATUS.DONE);
        assert.equal(task.task.name, "Fix the flaky check");

        yield* runDelivered(userId, workspaceId);
        const second = (yield* conductorImportProgress(userId, workspaceId)).run;

        assert.deepEqual(
          second?.items.map((item) => [item.conductorId, item.status]),
          [
            ["cc-1", CONDUCTOR_IMPORT_STATUS.SKIPPED],
            ["cw-1", CONDUCTOR_IMPORT_STATUS.SKIPPED],
          ],
        );
        assert.equal(second?.ended, true);

        const after = yield* db
          .select({ id: agentTable.id })
          .from(agentTable)
          .where(eq(agentTable.userId, userId));

        assert.equal(after.length, 1);
      }),
  );
});
