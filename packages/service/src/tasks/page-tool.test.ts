import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { listPages, readPageVersion } from "@repo/database/models/task-pages";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { PAGE_SHOWER, type PageShower, taskPageOwner } from "@repo/features/page-wire";
import { unparsedWire, type WireBoundaryInput, type WireRecord } from "@repo/wire";
import { Effect, Option, Schema } from "effect";
import { ACTION_RESULT_STATUS } from "../core.js";
import {
  CODER_SHOW_PAGE_TOOL,
  type PageToolBinding,
  runShowPage,
  SHOW_PAGE_REFUSAL,
} from "./page-tool.js";

/**
 * `show_page`, every agent's one tool for a page, through its public
 * function against a real dialect: inline HTML makes a page the task lists,
 * a page named again takes its next version, a secret file is never read,
 * and another account's task takes no page.
 * Synthetic accounts, tasks, agents, and pages throughout.
 */

const CHECKOUT = "/vercel/sandbox/repository";

const FUNNEL = "<!doctype html><h1>Invite funnel</h1><script>document.title = 'é'</script>";

/** A coding agent of the account's, on the task named, as the agent showing a page. */
const openAgent = (userId: string, place: { taskId: string }) =>
  Effect.map(
    createAgent(userId, {
      taskId: place.taskId,
      descriptionSnapshot: null,
      prompt: null,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    }),
    (started) => Option.getOrThrow(started).agent.id,
  );

const openTask = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const agentId = yield* openAgent(userId, { taskId: task.id });
  return {
    userId,
    taskId: task.id,
    workspaceId: task.workspaceId,
    agent: { kind: PAGE_SHOWER.AGENT, agentId } satisfies PageShower,
  };
});

/** A sandbox holding the files given by absolute path, each read as one stream, recording every path asked for. */
function sandboxWith(files: Readonly<Record<string, string>>) {
  const reads: string[] = [];
  const sandbox: NonNullable<PageToolBinding["sandbox"]> = {
    checkout: CHECKOUT,
    door: () =>
      Promise.resolve({
        readFile: ({ path }: { path: string }) => {
          reads.push(path);
          const text = files[path];
          if (text === undefined) return Promise.resolve(null);
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(text));
                controller.close();
              },
            }),
          );
        },
      }),
  };
  return { sandbox, reads };
}

/** A call as an agent makes it, whose `show_page` takes `path` alone. */
const show = (binding: PageToolBinding, input: WireBoundaryInput, shownBy: PageShower) =>
  runShowPage(binding, unparsedWire(input), shownBy);

const readAccepted = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
    page: Schema.Struct({ id: Schema.String, version: Schema.Number }),
  }),
);

/** The page an accepted call answered, failing the test where it was refused. */
const shownPage = (answer: WireRecord) => readAccepted(answer).page;

const refused = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });

it.layer(getTestDB())("show_page", (it) => {
  it.effect(
    "a file makes a page, named again it takes the next version, each kept as shown by who showed it, and the answer carries the task it stands on, which its link is built from, and never the HTML",
    () =>
      Effect.gen(function* () {
        const { sandbox } = sandboxWith({
          [`${CHECKOUT}/funnel.html`]: FUNNEL,
          [`${CHECKOUT}/weekly.html`]: `${FUNNEL}<p>v2</p>`,
        });
        const task = { ...(yield* openTask), sandbox };
        const first = yield* show(
          task,
          { title: "Invite funnel", path: "funnel.html" },
          task.agent,
        );
        const page = shownPage(first);
        const agent: PageShower = {
          kind: PAGE_SHOWER.AGENT,
          agentId: yield* openAgent(task.userId, { taskId: task.taskId }),
        };
        const second = shownPage(
          yield* show(
            task,
            { title: "Invite funnel, by week", path: "weekly.html", page: page.id },
            agent,
          ),
        );

        assert.deepEqual(first, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          page: {
            id: page.id,
            version: 1,
            taskId: task.taskId,
          },
        });
        assert.deepEqual(second, { id: page.id, version: 2 });
        assert.deepEqual(
          (yield* listPages(task.userId, taskPageOwner(task.taskId))).map(
            ({ id, title, version, shownBy }) => ({
              id,
              title,
              version,
              shownBy,
            }),
          ),
          [{ id: page.id, title: "Invite funnel, by week", version: 2, shownBy: agent }],
        );
        const stored = Option.getOrThrow(
          yield* readPageVersion(task.userId, taskPageOwner(task.taskId), page.id, 1),
        );
        assert.deepEqual([stored.html, stored.shownBy], [FUNNEL, task.agent]);
      }),
  );

  it.effect("show_page reads a page from its path and takes no html", () =>
    Effect.gen(function* () {
      const task = yield* openTask;
      const { sandbox } = sandboxWith({ [`${CHECKOUT}/funnel.html`]: FUNNEL });
      const agent = { ...task, sandbox };

      const shown = shownPage(
        yield* show(agent, { title: "Funnel", path: "funnel.html" }, task.agent),
      );
      assert.equal(shown.version, 1);
      assert.deepEqual(
        yield* show(agent, { title: "Inline", html: FUNNEL }, task.agent),
        refused(SHOW_PAGE_REFUSAL.UNREADABLE_PATH),
      );
      assert.equal((yield* listPages(task.userId, taskPageOwner(task.taskId))).length, 1);
      assert.ok(!("html" in CODER_SHOW_PAGE_TOOL.inputSchema.fields));
    }),
  );

  it.effect("a secret file in the sandbox is never read into a page", () =>
    Effect.gen(function* () {
      const task = yield* openTask;
      const { sandbox, reads } = sandboxWith({ [`${CHECKOUT}/.env`]: "TOKEN=secret" });
      const agent = { ...task, sandbox };

      assert.deepEqual(
        yield* show(agent, { title: "Funnel", path: ".env" }, task.agent),
        refused(SHOW_PAGE_REFUSAL.SECRET),
      );
      assert.deepEqual(
        yield* show(agent, { title: "Funnel", path: "nested/../.env/." }, task.agent),
        refused(SHOW_PAGE_REFUSAL.SECRET),
      );
      assert.ok(!reads.includes(`${CHECKOUT}/.env`), "a secret file is never read");
      assert.deepEqual(yield* listPages(task.userId, taskPageOwner(task.taskId)), []);
    }),
  );

  it.effect("a plan another account owns takes no page", () =>
    Effect.gen(function* () {
      const task = yield* openTask;
      const other = yield* openTask;

      assert.deepEqual(
        yield* show(
          {
            userId: other.userId,
            taskId: task.taskId,
            sandbox: sandboxWith({ [`${CHECKOUT}/funnel.html`]: FUNNEL }).sandbox,
          },
          { title: "Funnel", path: "funnel.html" },
          other.agent,
        ),
        refused(SHOW_PAGE_REFUSAL.NO_TASK),
      );
      assert.deepEqual(yield* listPages(task.userId, taskPageOwner(task.taskId)), []);
    }),
  );
});
