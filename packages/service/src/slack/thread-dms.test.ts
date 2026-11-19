import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { linkSlackInstallation } from "@repo/database/models/slack-installation-store";
import { organization, user } from "@repo/database/schemas/auth";
import { inboxMessage } from "@repo/database/schemas/inbox-message";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { INBOX_ASK, INBOX_ASK_STATUS, INBOX_REPLY } from "@repo/features/inbox-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { answerInboxAsk, postInboxThread } from "../inbox/inbox-store.js";
import { SlackBot, type SlackWebApi, slackBotOver } from "./slack-bot.js";
import { rewriteThreadDm } from "./thread-dms.js";

/**
 * A press on a DM the bot wrote about a thread before it stopped writing
 * them, over a real store and a fake Slack: a press on the title DM, once
 * its ask settled, draws the title alone again rather than the reply.
 *
 * Synthetic accounts, workspaces, and Slack ids throughout.
 */

/** One Web API call the fake Slack was handed. */
interface SlackCall {
  readonly method: string;
  readonly args: Readonly<Record<string, string>>;
}

/** A Slack that takes every call it is handed and writes it down. */
function fakeSlack(calls: SlackCall[]): SlackWebApi {
  return (method, args) => {
    calls.push({ method, args });

    return Effect.succeed({ ok: true });
  };
}

/** An account, with one agent on a task nobody is assigned, in a workspace whose bot is connected. */
const openConnectedAgent = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  const email = `${userId}@app.test`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email });
  const task = yield* startTask(userId, { name: "Teammate invitations" });

  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    descriptionSnapshot: "# Teammate invitations\n",
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });

  assert.ok(Option.isSome(started));
  const organizationId = task.workspaceId;
  yield* linkSlackInstallation({ organizationId, teamId: "T0001", teamName: "Team", userId });

  const [workspace] = yield* db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId));

  assert.ok(workspace !== undefined);
  const agent = { userId, taskId: task.id, agentId: started.value.agent.id };

  return { agent, organizationId, email, slug: workspace.slug };
});

/** The blocks a call carried, as Slack reads them. */
const blocksOf = (call: SlackCall | undefined) => JSON.parse(call?.args.blocks ?? "[]");

it.layer(getTestDB())("a thread's old Slack DM", (it) => {
  it.effect(
    "a press on the title DM after its ask settled draws the title again, not a reply",
    () => {
      const calls: SlackCall[] = [];

      return Effect.gen(function* () {
        const { agent, slug } = yield* openConnectedAgent;

        const ask = {
          key: "invite-expiry",
          title: "How long should an invitation last?",
          body: "A week?",
          ask: { type: INBOX_ASK.DECIDE, options: [{ label: "A week" }, { label: "A month" }] },
          needsReply: true,
        };

        const item = Result.getOrThrow(yield* postInboxThread(agent, ask));
        const message = item.thread?.find((each) => each.ask?.status === INBOX_ASK_STATUS.OPEN);
        assert.ok(message !== undefined);
        // The ask's reply DM under its title DM, as the bot wrote them before it stopped writing them.
        const title = { channel: "D0001", ts: "1700000000.000101" };
        yield* (yield* Database)
          .update(inboxMessage)
          .set({
            slackDm: {
              channel: "D0001",
              ts: "1700000000.000102",
              to: agent.userId,
              thread: title.ts,
            },
          })
          .where(eq(inboxMessage.id, message.id));
        yield* answerInboxAsk(agent.userId, item.id, {
          answers: { ask: message.id, reply: INBOX_REPLY.CHOSE, choices: ["A week"] },
          text: "",
          clientKey: randomUUID(),
        });
        // The same press again, as Slack sends one twice, from the title DM rather than the reply.
        const before = calls.length;
        yield* rewriteThreadDm(title, item.id, message, "You chose A week");

        const [redrawn, ...more] = calls
          .slice(before)
          .filter((call) => call.method === "chat.update");

        assert.deepEqual(more, []);
        assert.equal(redrawn?.args.ts, title.ts);
        assert.deepEqual(blocksOf(redrawn), [
          {
            type: "header",
            text: { type: "plain_text", text: "📥 How long should an invitation last?" },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open in Vespin" },
                url: `https://vespin.dev/${slug}/inbox/${item.id}`,
              },
            ],
          },
        ]);
      }).pipe(Effect.provideService(SlackBot, slackBotOver(fakeSlack(calls))));
    },
  );
});
