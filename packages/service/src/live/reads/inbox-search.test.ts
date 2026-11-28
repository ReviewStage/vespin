import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
  startTask,
} from "@repo/database/testing";
import { CLIENT_PLATFORM, clientHeaders } from "@repo/features/client-identity";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { INBOX_SEARCH_READ, inboxOfLiveRows } from "@repo/features/inbox-live";
import {
  INBOX_ASK,
  INBOX_FIELD,
  INBOX_REPLY,
  type InboxAnswers,
  type InboxItem,
} from "@repo/features/inbox-wire";
import { LIVE_USER_QUERY } from "@repo/features/live-wire";
import { Duration, Effect, Layer, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { TASKLESS_LIVE } from "../../agents/taskless-reads.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  answerInboxAsk,
  closeInboxItem,
  INBOX_ASK_ANSWER,
  type InboxAgent,
  postInboxThread,
  replyInboxItem,
} from "../../inbox/inbox-store.js";
import { hostedAnswer } from "../../testing/hosted-route.js";
import { liveProcedures } from "../live-procedures.js";

/**
 * The Inbox search read, asked of the live procedures as the web route asks
 * them, against a real dialect: an item is found by its title, its thread's words, or its
 * holder's name, every word somewhere, of any age, and never one the
 * account does not reach.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );

  return userId;
});

/** An agent the account starts on the task, or on no task in the workspace, as the inbox store's posts name it. */
const openAgent = (
  userId: string,
  on: { readonly taskId: string } | { readonly taskId: null; readonly workspaceId: string },
  githubAccess: (typeof GITHUB_ACCESS)[keyof typeof GITHUB_ACCESS] = GITHUB_ACCESS.APP,
) =>
  Effect.gen(function* () {
    const started = yield* createAgent(userId, {
      ...on,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: on.taskId === null ? null : "acme/relay",
      githubAccess,
      descriptionSnapshot: null,
      prompt: "Keep an eye on the release.",
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });

    const agent: InboxAgent = {
      userId,
      taskId: on.taskId,
      agentId: Option.getOrThrow(started).agent.id,
    };

    return agent;
  });

/** A post as the agent's tool hands one to the store. */
type InboxThreadPost = Parameters<typeof postInboxThread>[1];

/** The agent's thread posted under the key, its title and first message as given, asking the developer to do something by hand, the item's id. */
const post = (agent: InboxAgent, key: string, title: string, body: string) =>
  Effect.map(
    postInboxThread(agent, {
      key,
      title,
      body,
      ask: { type: INBOX_ASK.DO, steps: [] },
      needsReply: false,
    }),
    (posted) => Result.getOrThrow(posted).id,
  );

/** A search as a build asks it: one that names itself reads items on no task, one that names nothing does not. */
type Asker = (typeof TASKLESS_LIVE)[keyof typeof TASKLESS_LIVE];

/** The search asked of the live procedures as the web route asks them, as the account, by the build `asker` names: the answer's status and its body. */
const ask = (userId: string, query: string, asker: Asker = TASKLESS_LIVE.LEFT_OUT) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
    );

    const procedures = liveProcedures({
      resolveUserId: (incoming) =>
        Effect.succeed(
          Option.fromNullishOr(incoming.headers.get("authorization")?.slice("Bearer ".length)),
        ),
      workspaces: yield* fakeWorkspaceSeams,
    });

    const url = new URL(INBOX_SEARCH_READ.path, "https://app.test");
    url.searchParams.set("query", query);
    url.searchParams.set(LIVE_USER_QUERY, userId);

    const built =
      asker === TASKLESS_LIVE.CARRIED
        ? clientHeaders({ platform: CLIENT_PLATFORM.DESKTOP, version: "1.0.0" })
        : {};

    const response = yield* hostedAnswer(
      { live: procedures },
      services,
      new Request(url, { headers: { ...built, authorization: `Bearer ${userId}` } }),
    );

    return { status: response.status, text: yield* Effect.promise(() => response.text()) };
  });

/** What a search delivers to the account, decoded as a client decodes it: the items it draws, the tasks, and the agents, each by id. */
const searchedBy = (...asked: Parameters<typeof ask>) =>
  Effect.gen(function* () {
    const answered = yield* ask(...asked);
    assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);

    const { queries } = Schema.decodeUnknownSync(INBOX_SEARCH_READ.answer)(
      JSON.parse(answered.text),
    );

    const rows = Schema.decodeUnknownSync(INBOX_SEARCH_READ.rows)({
      stamps: queries.stamps.rows,
      items: queries.items.rows,
      messages: queries.messages.rows,
      files: queries.files.rows,
      tasks: queries.tasks.rows,
      agents: queries.agents.rows,
    });

    const items = inboxOfLiveRows(rows);
    assert.deepEqual(
      rows.stamps.map((stamp) => stamp.id).toSorted(),
      items.map((item) => item.id).toSorted(),
      "every hit comes stamped and whole",
    );

    return {
      items: items.map((item) => item.id).toSorted(),
      tasks: rows.tasks.map((row) => row.id).toSorted(),
      agents: rows.agents.map((row) => row.id).toSorted(),
    };
  });

/** The items a search delivers to the account, by id. */
const foundBy = (...asked: Parameters<typeof ask>) =>
  Effect.map(searchedBy(...asked), ({ items }) => items);

it.layer(getTestDB())("the Inbox search read", (it) => {
  it.effect(
    "finds an item by its title, its thread, or its task's name, every word somewhere and whatever its case, however long ago it settled, and its words only as themselves",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const agent = yield* openAgent(userId, { taskId: task.id });

        const settled = yield* post(
          agent,
          "old",
          "Rotate the signing key",
          "Before the 2.0 release.",
        );

        assert.ok(Option.isSome(yield* closeInboxItem(agent, "old", "Done another way")));
        // Well past the thirty days the account's items carry a settled one for.
        yield* TestClock.adjust(Duration.days(90));
        const titled = yield* post(agent, "titled", "Cut the RELEASE?", "The branch is green.");
        const replied = yield* post(agent, "replied", "Main is protected", "Pushes need review.");
        yield* replyInboxItem(agent, "replied", "Also for the release branch.");
        const other = yield* post(agent, "other", "Discount at 100%", "Off for a day.");

        assert.deepEqual(yield* foundBy(userId, "release"), [settled, titled, replied].toSorted());
        assert.deepEqual(
          yield* foundBy(userId, "invitations PROTECTED"),
          [replied],
          "one word in the task's name, the other in the title",
        );
        assert.deepEqual(yield* foundBy(userId, "release missing"), []);
        assert.deepEqual(yield* foundBy(userId, "   "), []);
        assert.deepEqual(yield* foundBy(userId, "100%"), [other]);
        assert.deepEqual(yield* foundBy(userId, "1_0"), [], "an underscore is no wildcard");

        // A query past the bound is refused, and the refusal's words name nothing of it.
        const long = yield* ask(userId, "release ".repeat(30));
        assert.equal(long.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        assert.ok(!long.text.includes("release"));
      }),
  );

  it.effect(
    "finds an item by its ask's options, steps, and fields, and by its answer's choices and values, but never by a key or a type of their jsonb",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const task = yield* startTask(userId, { name: "Staging" });
        const agent = yield* openAgent(userId, { taskId: task.id });

        const asked = (key: string, ask: InboxThreadPost["ask"]) =>
          Effect.map(
            postInboxThread(agent, { key, title: "Over to you", body: "See below.", ask }),
            Result.getOrThrow,
          );

        const decided = yield* asked("decide", {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Lighthouse", detail: "Near the harbor" }, { label: "Meadow" }],
        });

        const done = yield* asked("do", {
          type: INBOX_ASK.DO,
          steps: ["Rotate the gizmo key"],
        });

        const form = yield* asked("form", {
          type: INBOX_ASK.ANSWER,
          fields: [
            { type: INBOX_FIELD.SELECT, label: "Widget color", options: ["Teal", "Mauve"] },
            { type: INBOX_FIELD.TEXT, label: "Codename" },
            { type: INBOX_FIELD.NUMBER, label: "Replicas" },
            { type: INBOX_FIELD.BOOLEAN, label: "Paged" },
          ],
        });

        const answer = (item: InboxItem, answers: Omit<InboxAnswers, "ask">) =>
          Effect.map(
            answerInboxAsk(userId, item.id, {
              answers: { ...answers, ask: item.thread?.[0]?.id ?? "" },
              text: "",
              clientKey: randomUUID(),
            }),
            (answered) => assert.equal(Option.getOrThrow(answered).outcome, INBOX_ASK_ANSWER.TAKEN),
          );

        yield* answer(decided, { reply: INBOX_REPLY.CHOSE, choices: ["Meadow"] });
        yield* answer(form, {
          reply: INBOX_REPLY.SUBMITTED,
          values: [
            { label: "Codename", value: 'Bluebird "Jay"' },
            { label: "Replicas", value: 7 },
            { label: "Paged", value: true },
          ],
        });

        assert.deepEqual(yield* foundBy(userId, "lighthouse"), [decided.id], "an option's label");
        assert.deepEqual(yield* foundBy(userId, "harbor"), [decided.id], "an option's detail");
        assert.deepEqual(yield* foundBy(userId, "gizmo"), [done.id], "a step");
        assert.deepEqual(yield* foundBy(userId, "widget"), [form.id], "a field's label");
        assert.deepEqual(yield* foundBy(userId, "mauve"), [form.id], "a select's option");
        assert.deepEqual(yield* foundBy(userId, "bluebird"), [form.id], "a value");
        assert.deepEqual(
          yield* foundBy(userId, '"jay"'),
          [form.id],
          "a value's quote, which the jsonb's text writes escaped",
        );
        assert.deepEqual(yield* foundBy(userId, "7"), [form.id], "a number's value");
        assert.deepEqual(yield* foundBy(userId, "yes"), [form.id], "a boolean's value");
        assert.deepEqual(
          yield* foundBy(userId, "meadow"),
          [decided.id],
          "a choice, which an option of the ask names too",
        );
        assert.deepEqual(yield* foundBy(userId, "label"), [], "a key");
        assert.deepEqual(yield* foundBy(userId, "decide"), [], "an ask's type");
        assert.deepEqual(yield* foundBy(userId, "submitted"), [], "an answer's reply");
      }),
  );

  it.effect(
    "finds an item on no task by its agent's name, and answers that agent, only for a build that reads one",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const workspaceId = yield* openWorkspace(userId);
        const agent = yield* openAgent(userId, { taskId: null, workspaceId });
        const posted = yield* post(agent, "watch", "Cut the release?", "The branch is green.");

        // The agent has no title, so it is shown by its model, `claude opus 5.5`.
        assert.deepEqual(yield* searchedBy(userId, "opus", TASKLESS_LIVE.CARRIED), {
          items: [posted],
          tasks: [],
          agents: [agent.agentId],
        });
        assert.deepEqual(yield* searchedBy(userId, "opus"), { items: [], tasks: [], agents: [] });
      }),
  );

  it.effect(
    "finds no item a teammate cannot see, nor one of a workspace the account is not in, and answers no holder the account cannot see",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);

        const shared = yield* startTask(owner, {
          name: "Teammate invitations",
          repository: "acme/relay",
          githubAccess: GITHUB_ACCESS.APP,
        });

        yield* joinWorkspace(shared.workspaceId, teammate);

        const poster = yield* openAgent(owner, { taskId: shared.id });
        const seen = yield* post(poster, "seen", "Cut the release?", "The branch is green.");
        // An agent of the shared task on the owner's own token, which the teammate does not see beside the task.
        const tokened = yield* openAgent(owner, { taskId: shared.id }, GITHUB_ACCESS.TOKEN);

        // On the owner's own token, which the teammate keeps none to read through.
        const hidden = yield* startTask(owner, {
          name: "Billing",
          repository: "acme/relay",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });

        const hiddenAgent = yield* openAgent(owner, { taskId: hidden.id }, GITHUB_ACCESS.TOKEN);

        const unseen = yield* post(
          hiddenAgent,
          "unseen",
          "Release the invoices",
          "They wait on a review.",
        );

        assert.deepEqual(yield* searchedBy(owner, "release"), {
          items: [seen, unseen].toSorted(),
          tasks: [shared.id, hidden.id].toSorted(),
          agents: [poster.agentId, tokened.agentId, hiddenAgent.agentId].toSorted(),
        });
        assert.deepEqual(yield* searchedBy(teammate, "release"), {
          items: [seen],
          tasks: [shared.id],
          agents: [poster.agentId],
        });
        assert.deepEqual(yield* foundBy(outsider, "release", TASKLESS_LIVE.CARRIED), []);
      }),
  );
});
