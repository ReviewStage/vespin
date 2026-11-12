import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { REPLY_BUTTON_ACTION } from "@repo/features/reply-button-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import {
  getTestDB,
  joinWorkspace,
  openAgentOnOwnTask,
  openWorkspace,
} from "../../testing/index.js";
import {
  claimReplyButtonPress,
  makeReplyButton,
  readReplyButton,
  releaseReplyButtonPress,
  settleReplyButtonPress,
} from "../reply-buttons.js";

/**
 * The buttons coding agents put in their replies, over a real dialect: a
 * press is claimed by one member, refused to any other, and run again only
 * by its own presser until it lands, and never once landed, the agent it
 * reached deleted or not; a refused attempt releases only its own claim,
 * never its presser's retry's; and a button is read
 * and claimed only by a member of its workspace. Synthetic accounts and
 * briefs throughout.
 */

const NOW = new Date("2026-11-10T12:00:00Z");
const LATER = new Date("2026-11-10T12:05:00Z");

/** Past the longest a function of the service runs, so a press claimed at `NOW` and never landed is gone. */
const LAPSED = new Date("2026-11-10T12:16:00Z");

const START = {
  kind: REPLY_BUTTON_ACTION.START,
  prompt: "Send the invite email through the mail provider.",
} as const;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** The press as the button's reader sees it. */
const pressOf = (userId: string, buttonId: string) =>
  Effect.map(readReplyButton(userId, buttonId), (read) => {
    const { pressedBy, reachedAgentId, landedAt } = Option.getOrThrow(read);

    return landedAt === null
      ? { pressedBy, reachedAgentId }
      : { pressedBy, reachedAgentId, landedAt };
  });

it.layer(getTestDB())("a reply button", (it) => {
  it.effect(
    "is pressed once: by its first presser, again only by them, until it lands for good",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const agentId = yield* openAgentOnOwnTask(owner, workspace);
        const reached = yield* openAgentOnOwnTask(owner, workspace);
        const buttonId = yield* makeReplyButton(agentId, "Wire up the invite email", START, NOW);

        // A press refused is released, so anyone may press it again.
        const refused = yield* claimReplyButtonPress(buttonId, teammate, NOW);
        assert.ok(refused !== undefined);
        yield* releaseReplyButtonPress(buttonId, refused);
        assert.deepEqual(yield* pressOf(owner, buttonId), {
          pressedBy: null,
          reachedAgentId: null,
        });

        // The presser's retry claims again, and their first attempt refused releases nothing of it.
        const first = yield* claimReplyButtonPress(buttonId, owner, NOW);
        assert.equal(yield* claimReplyButtonPress(buttonId, teammate, NOW), undefined);
        const retry = yield* claimReplyButtonPress(buttonId, owner, NOW);
        assert.ok(first !== undefined && retry !== undefined);
        yield* releaseReplyButtonPress(buttonId, first);
        assert.equal(yield* claimReplyButtonPress(buttonId, teammate, NOW), undefined);
        yield* settleReplyButtonPress(buttonId, owner, reached, NOW);
        // A late settle of the same press, and its release, change nothing of how it landed.
        yield* settleReplyButtonPress(buttonId, owner, agentId, LATER);
        yield* releaseReplyButtonPress(buttonId, retry);
        assert.deepEqual(yield* pressOf(teammate, buttonId), {
          pressedBy: owner,
          reachedAgentId: reached,
          landedAt: NOW,
        });
        // A landed press stays landed once the agent it reached is gone.
        yield* (yield* Database).delete(agentTable).where(eq(agentTable.id, reached));
        assert.equal(yield* claimReplyButtonPress(buttonId, owner, NOW), undefined);
      }),
  );

  it.effect(
    "keeps the landing of its presser's earlier attempt after a later attempt of theirs was refused and released",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const agentId = yield* openAgentOnOwnTask(owner, workspace);
        const reached = yield* openAgentOnOwnTask(owner, workspace);
        const buttonId = yield* makeReplyButton(agentId, "Wire up the invite email", START, NOW);

        const earlier = yield* claimReplyButtonPress(buttonId, owner, NOW);
        const later = yield* claimReplyButtonPress(buttonId, owner, NOW);
        assert.ok(earlier !== undefined && later !== undefined);
        yield* releaseReplyButtonPress(buttonId, later);
        yield* settleReplyButtonPress(buttonId, owner, reached, NOW);

        assert.deepEqual(yield* pressOf(owner, buttonId), {
          pressedBy: owner,
          reachedAgentId: reached,
          landedAt: NOW,
        });
      }),
  );

  it.effect(
    "is pressed by another member once a press claimed long ago never landed nor was released, and by its own presser no more",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const agentId = yield* openAgentOnOwnTask(owner, workspace);
        const reached = yield* openAgentOnOwnTask(owner, workspace);
        const buttonId = yield* makeReplyButton(agentId, "Wire up the invite email", START, NOW);

        // The owner's press is cut off after it claimed, so it is neither settled nor released.
        assert.ok((yield* claimReplyButtonPress(buttonId, owner, NOW)) !== undefined);
        assert.equal(yield* claimReplyButtonPress(buttonId, teammate, LATER), undefined);
        assert.ok((yield* claimReplyButtonPress(buttonId, teammate, LAPSED)) !== undefined);
        assert.equal(yield* claimReplyButtonPress(buttonId, owner, LAPSED), undefined);
        yield* settleReplyButtonPress(buttonId, teammate, reached, LAPSED);
        assert.deepEqual(yield* pressOf(owner, buttonId), {
          pressedBy: teammate,
          reachedAgentId: reached,
          landedAt: LAPSED,
        });
      }),
  );

  it.effect("is read and pressed by a member of its workspace, and by no one outside it", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const stranger = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      yield* openWorkspace(stranger);
      const agentId = yield* openAgentOnOwnTask(owner, workspace);
      const buttonId = yield* makeReplyButton(agentId, "Wire up the invite email", START, NOW);

      const read = Option.getOrThrow(yield* readReplyButton(owner, buttonId));
      assert.deepEqual(
        { agentId: read.agentId, label: read.label, action: read.action },
        { agentId, label: "Wire up the invite email", action: START },
      );
      assert.equal(Option.isNone(yield* readReplyButton(stranger, buttonId)), true);
      assert.equal(yield* claimReplyButtonPress(buttonId, stranger, NOW), undefined);
    }),
  );
});
