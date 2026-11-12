import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { writePage } from "@repo/database/models/task-pages";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { PAGE_OWNER, PAGE_SHOWER, taskPagesAnswerSchema } from "@repo/features/page-wire";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { type Context, Effect, Option, Result } from "effect";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { agentPagesProcedures } from "./agent-pages-procedures.js";

/**
 * The pages a released desktop still asks an agent for, answered by the
 * hosted oRPC router the way the web route answers them, over a real
 * dialect: every page stands on a task, so a member of the agent's workspace
 * lists none and reads no version, even of a page the agent showed on its
 * task, and a path that names no UUID, or a version that is no whole
 * number, is refused.
 *
 * Synthetic accounts, bearers, workspaces, agents, and pages throughout.
 */

const ORIGIN = "https://app.test";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
  );

  return id;
});

const answer = (bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    // SAFETY: the procedures yield the database and the clock alone, which the test's own context holds.
    const services = (yield* Effect.context<never>()) as Context.Context<WebServices>;

    const handle = hostedFetch({
      agentPages: agentPagesProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }),
    });

    const response = yield* Effect.promise(() => handle(request, services));
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;

    return { status: response.status, body } satisfies Answer;
  });

const get = (userId: string, path: string) =>
  new Request(new URL(path, ORIGIN), { headers: { authorization: `Bearer ${userId}` } });

const pagesPath = (agentId: string) => `/api/agents/${agentId}/pages`;

const versionPath = (agentId: string, pageId: string, version: string) =>
  `${pagesPath(agentId)}/${pageId}/versions/${version}`;

function readOk<S extends Parameters<typeof readEither>[0]>(schema: S, answered: Answer) {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(schema)(unparsedWire(answered.body));

  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);

  return read.success;
}

it.layer(getTestDB())("an agent's own pages over HTTP", (it) => {
  it.effect(
    "a member lists none of an agent's pages and reads no version, even of one it showed on its task",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* joinWorkspace(workspace, teammate);
        const taskId = (yield* createTask(starter, { organizationId: workspace })).id;

        const started = yield* createAgent(starter, {
          taskId,
          descriptionSnapshot: null,
          prompt: "Chart the funnel",
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });

        const agentId = Option.getOrThrow(started).agent.id;

        const chart = Option.getOrThrow(
          yield* writePage(
            starter,
            { kind: PAGE_OWNER.TASK, taskId },
            { title: "Funnel", html: "<h1>One</h1>" },
            { kind: PAGE_SHOWER.AGENT, agentId },
          ),
        );

        const bearers = new Map([starter, teammate].map((id) => [`Bearer ${id}`, id] as const));
        const ask = (userId: string, path: string) => answer(bearers, get(userId, path));

        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };

        assert.deepEqual(readOk(taskPagesAnswerSchema, yield* ask(teammate, pagesPath(agentId))), {
          pages: [],
        });
        assert.deepEqual(yield* ask(teammate, versionPath(agentId, chart.id, "1")), notFound);
        assert.deepEqual(yield* ask(teammate, versionPath("not-a-uuid", chart.id, "1")), notFound);
        assert.equal(
          (yield* ask(teammate, versionPath(agentId, chart.id, "zero"))).status,
          HOSTED_HTTP_STATUS.BAD_REQUEST,
        );
      }),
  );
});
