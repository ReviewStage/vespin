import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readConductorImportRun } from "@repo/database/models/conductor-import-store";
import { readTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import {
  CONDUCTOR_IMPORT_FAILURE,
  CONDUCTOR_IMPORT_STATUS,
} from "@repo/features/conductor-import-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import type { WireValue } from "@repo/wire";
import type { JsonValue } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  fakeGitHub,
  githubReaching,
  type InstallationFixture,
  memberRepositoryJson,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import {
  ConductorImportQueue,
  type ConductorImportQueueService,
  type ConductorImportServices,
  cancelConductorImport,
  checkConductorImport,
  conductorImportProgress,
  consumeImportMessage,
  runConductorImport,
} from "./conductor-import.js";

/**
 * An import from Conductor run twice over a real store and a fake Conductor:
 * the first makes the archived workspace's task Done and writes its chat as
 * an agent, and the second, as a member running it again would, makes
 * nothing twice. Each publish is delivered by hand, in order, as the queue
 * would. A repository GitHub renamed since Conductor kept its remote is
 * reached, and its task made, under its name now. Synthetic accounts, ids,
 * key, and transcript throughout.
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
  // Note that the workspace is listed twice, as a page that shifted under the walk would list it.
  ["/v0/workspaces", { data: [WORKSPACE, WORKSPACE], hasMore: false }],
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

/** A run, with every message it and its deliveries publish delivered in turn, as the queue would deliver them, after what `before` does with the run. */
const runDelivered = (
  userId: string,
  workspaceId: string,
  before: (runId: string) => Effect.Effect<unknown, unknown, ConductorImportServices> = () =>
    Effect.void,
) =>
  Effect.gen(function* () {
    const published: WireValue[] = [];

    const queue: ConductorImportQueueService = {
      publish: (message) => Effect.sync(() => void published.push(message)),
    };

    const delivered = Effect.provideService(ConductorImportQueue, queue);
    const answer = yield* delivered(runConductorImport(userId, workspaceId, KEY));

    if ("runId" in answer) yield* before(answer.runId);

    for (let next = published.shift(); next !== undefined; next = published.shift()) {
      yield* delivered(consumeImportMessage(next));
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
        assert.equal(first.workspaces, 1);
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
        assert.equal(
          firstRun?.items.find((item) => item.conductorId === "cw-1")?.taskId,
          agent.taskId,
        );

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

  it.effect(
    "a repository GitHub renamed is reached under its name now, by the check and the run alike, and one GitHub never answers stays unreached",
    () => {
      const relay: InstallationFixture = {
        id: 71,
        login: "octo-org",
        repositories: [{ owner: "octo-org", name: "relay" }],
      };

      const formerly = `octo-org/relay-before-${randomUUID().slice(0, 8)}`;

      const renamed = {
        ...WORKSPACE,
        id: "cw-renamed",
        state: "ready",
        repoUrl: `git@github.com:${formerly}.git`,
      };

      const gone = { ...WORKSPACE, id: "cw-gone", repoUrl: "https://github.com/octo-org/gone" };

      const listing = new Map<string, JsonValue>([
        ["/v0/workspaces", { data: [renamed, gone], hasMore: false }],
        ["/v0/workspaces/cw-renamed/sessions", { data: [], hasMore: false }],
        ["/v0/workspaces/cw-gone/sessions", { data: [], hasMore: false }],
      ]);

      // Note that GitHub answers the old name with the repository under its name now, and the one gone not at all.
      const fake = githubReaching([relay], undefined, undefined, ({ url }) => {
        const { hostname, pathname } = new URL(url);

        if (hostname === "api.conductor.build") return Response.json(listing.get(pathname));

        return pathname === `/repos/${formerly}`
          ? Response.json(memberRepositoryJson({ owner: "octo-org", name: "relay" }, false))
          : undefined;
      });

      return Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const workspaceId = yield* openWorkspace(userId);
        yield* connectWorkspaceGitHub(workspaceId, relay);

        const checked = yield* checkConductorImport(userId, workspaceId, KEY);
        assert.deepEqual(checked, { workspaces: 2, unreachedRepositories: ["octo-org/gone"] });

        yield* runDelivered(userId, workspaceId);
        const run = (yield* conductorImportProgress(userId, workspaceId)).run;
        const made = run?.items.find((item) => item.conductorId === "cw-renamed");

        assert.equal(
          run?.items.find((item) => item.conductorId === "cw-gone")?.failure,
          CONDUCTOR_IMPORT_FAILURE.REPOSITORY_UNREACHED,
        );
        assert.ok(made?.taskId != null);
        assert.equal(
          Option.getOrThrow(yield* readTask(userId, made.taskId)).task.repository,
          "octo-org/relay",
        );
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect(
    "a run canceled before its deliveries come deletes its key at once, and its queued workspace comes over as nothing",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const userId = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: userId, name: "Test User", email: `${userId}@app.test` });
        const workspaceId = yield* openWorkspace(userId);

        const answer = yield* runDelivered(userId, workspaceId, (runId) =>
          Effect.gen(function* () {
            yield* cancelConductorImport(userId, workspaceId, runId);
            const run = Option.getOrThrow(yield* readConductorImportRun(runId));
            assert.equal(run.sealedKey, null);
          }),
        );

        assert.ok("runId" in answer);
        const run = (yield* conductorImportProgress(userId, workspaceId)).run;

        assert.deepEqual(
          { canceled: run?.canceled, ended: run?.ended },
          { canceled: true, ended: true },
        );
        assert.deepEqual(
          run?.items.map((item) => [item.conductorId, item.status]),
          [["cw-1", CONDUCTOR_IMPORT_STATUS.CANCELED]],
        );

        const agents = yield* db
          .select({ id: agentTable.id })
          .from(agentTable)
          .where(eq(agentTable.userId, userId));

        assert.equal(agents.length, 0);
      }),
  );
});
