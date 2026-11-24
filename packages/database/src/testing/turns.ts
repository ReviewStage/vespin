import { randomUUID } from "node:crypto";
import { MESSAGE_CHANNEL, MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { Effect } from "effect";
import { Database } from "../core/query.js";
import { messages, turns } from "../schemas/storage.js";
import { MESSAGE_SENDER } from "../storage-vocabulary.js";

/**
 * turns.ts -- a running turn of a test's conversation and the lines it took, written beneath the store.
 *
 * A test about who asked for a turn writes the turn as the relay leaves it
 * while it runs: started after every earlier turn the test wrote, with the
 * developer's lines it took, in the order given, each from the sender given.
 */

/** What sent one of the developer's lines: a member by their account, or an automation's run by its name. */
export type TestLineSender = { readonly member: string } | { readonly automation: string };

/** How many turns and lines were written so far, so each starts and sits after the last. */
let written = 0;

/** A running turn of the conversation, started after every earlier one, that took one line from each sender given, in order; its id. */
export const openRunningTurn = (
  target: { readonly userId: string; readonly conversationId: string },
  senders: readonly TestLineSender[],
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    written += 1;
    const startedAt = new Date(written * 1_000);

    const [turn] = yield* db
      .insert(turns)
      .values({
        ...target,
        origin: TURN_ORIGIN.TYPED,
        status: TURN_STATUS.RUNNING,
        queuedAt: startedAt,
        startedAt,
      })
      .returning({ id: turns.id });

    if (turn === undefined) return yield* Effect.die("the turn was not written");

    for (const sender of senders) {
      written += 1;

      yield* db.insert(messages).values({
        ...target,
        seq: written,
        turnId: turn.id,
        clientId: randomUUID(),
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Look over what changed today." }],
        metadata: { channel: MESSAGE_CHANNEL.TYPED },
        placedAt: startedAt,
        finishedAt: startedAt,
        ...("member" in sender
          ? { sender: MESSAGE_SENDER.MEMBER, senderUserId: sender.member }
          : { sender: MESSAGE_SENDER.AUTOMATION, senderName: sender.automation }),
      });
    }

    return turn.id;
  });
