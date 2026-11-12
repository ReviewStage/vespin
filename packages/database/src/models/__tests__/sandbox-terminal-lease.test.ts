import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  claimCredentialRenewal,
  credentialRenewedAt,
  releaseCredentialRenewal,
} from "../sandbox-terminal-lease.js";

/**
 * The renewal claim of the GitHub token at a coding agent's sandbox's
 * firewall, over a real dialect: it is claimed once while due, read back on
 * its own session, and goes with its conversation. Every conversation is
 * minted per test and every read is of its ids, since the claim is the
 * deployment's and not an account's.
 *
 * Synthetic accounts, conversations, and sessions throughout.
 */

const AT = Date.UTC(2026, 9, 14, 12);
const at = (minutes: number) => new Date(AT + minutes * 60_000);

/** A coding agent's conversation that ran in a session of its own. */
const openAgent = () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

    const [row] = yield* db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.AGENT, runtimeSessionId: `wrun_${randomUUID()}` })
      .returning({ id: conversations.id });

    assert.ok(row);

    return { userId, conversationId: row.id };
  });

it.layer(getTestDB())("the sandbox terminal credential claim", (it) => {
  it.effect("a claim goes with its conversation", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const { conversationId } = yield* openAgent();
      yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
      yield* db.delete(conversations).where(eq(conversations.id, conversationId));

      assert.deepEqual(yield* credentialRenewedAt(conversationId, "sbs_1"), Option.none());
    }),
  );

  it.effect(
    "the GitHub token's renewal is claimed once per conversation while due, so two windows mint one token",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();

        const first = yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
        const second = yield* claimCredentialRenewal(conversationId, "sbs_1", at(1), at(-49));
        const due = yield* claimCredentialRenewal(conversationId, "sbs_1", at(51), at(1));

        assert.deepEqual([first, second, due], [true, false, true]);
      }),
  );

  it.effect(
    "a renewal given back is claimed again at the next check, and a later claim is not given back",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
        yield* releaseCredentialRenewal(conversationId, "sbs_1", at(0));
        const retried = yield* claimCredentialRenewal(conversationId, "sbs_1", at(5), at(-45));
        yield* releaseCredentialRenewal(conversationId, "sbs_1", at(0));

        const stillClaimed = yield* claimCredentialRenewal(
          conversationId,
          "sbs_1",
          at(10),
          at(-40),
        );

        assert.equal(retried, true, "the failed claim was given back");
        assert.equal(stillClaimed, false, "a stale give-back leaves the later claim standing");
      }),
  );

  it.effect(
    "a resumed sandbox's new session claims its renewal at once, however lately the old one was renewed",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        yield* claimCredentialRenewal(conversationId, "sbs_before_stop", at(0), at(-50));

        const sameSession = yield* claimCredentialRenewal(
          conversationId,
          "sbs_before_stop",
          at(10),
          at(-40),
        );

        const resumed = yield* claimCredentialRenewal(
          conversationId,
          "sbs_resumed",
          at(10),
          at(-40),
        );

        const resumedAgain = yield* claimCredentialRenewal(
          conversationId,
          "sbs_resumed",
          at(11),
          at(-39),
        );

        assert.deepEqual([sameSession, resumed, resumedAgain], [false, true, false]);
      }),
  );

  it.effect("a give-back from another session at the same instant leaves the standing claim", () =>
    Effect.gen(function* () {
      const { conversationId } = yield* openAgent();
      yield* claimCredentialRenewal(conversationId, "sbs_resumed", at(0), at(-50));
      yield* releaseCredentialRenewal(conversationId, "sbs_before_stop", at(0));

      const claimedAgain = yield* claimCredentialRenewal(
        conversationId,
        "sbs_resumed",
        at(1),
        at(-49),
      );

      assert.equal(claimedAgain, false, "the resumed session's claim still stands");
    }),
  );

  it.effect(
    "the token's last renewal reads on its own session alone, and none once its claim is given back",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        const never = yield* credentialRenewedAt(conversationId, "sbs_1");
        yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
        const renewed = yield* credentialRenewedAt(conversationId, "sbs_1");
        const otherSession = yield* credentialRenewedAt(conversationId, "sbs_resumed");
        yield* releaseCredentialRenewal(conversationId, "sbs_1", at(0));
        const givenBack = yield* credentialRenewedAt(conversationId, "sbs_1");

        assert.deepEqual(
          [never, renewed, otherSession, givenBack],
          [Option.none(), Option.some(at(0)), Option.none(), Option.none()],
        );
      }),
  );
});
