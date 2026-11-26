/**
 * journal-image-rows.ts -- a developer's line whose journal row keeps the parts given, queued for the journal image move as the migration that made the queue queued every such row.
 */

import { randomUUID } from "node:crypto";
import { MESSAGE_ROLE } from "@repo/wire";
import type { UIMessage } from "ai";
import { Effect } from "effect";
import { Database, type QueryError } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { journalImageMove } from "../schemas/journal-image-move.js";
import { conversations, messages } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";

/** The next sequence a queued line takes, unique across every conversation a test opens. */
let nextSeq = 1;

/** A queued line: its row, and the conversation and account its pictures are kept for. */
export interface QueuedJournalLine {
  readonly messageId: string;
  readonly conversationId: string;
  readonly userId: string;
}

/** An image file part over a `data:` URL of the bytes given, as a line kept one before kept images were named by id. */
export function inlineImagePart(
  bytes: Uint8Array,
  mediaType: string,
  filename: string,
): UIMessage["parts"][number] {
  return {
    type: "file",
    mediaType,
    filename,
    url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

/** Writes a line of the parts given in a conversation of its own, or in `into`'s, and queues it for the move. */
export function queueJournalLine(
  parts: UIMessage["parts"],
  into?: Omit<QueuedJournalLine, "messageId">,
): Effect.Effect<QueuedJournalLine, QueryError, Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    let owner = into;

    if (owner === undefined) {
      const userId = `user-${randomUUID()}`;
      yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

      const [conversation] = yield* db
        .insert(conversations)
        .values({ userId, kind: CONVERSATION_KIND.AGENT })
        .returning({ id: conversations.id });

      if (conversation === undefined) throw new Error("queueJournalLine: no conversation.");
      owner = { userId, conversationId: conversation.id };
    }

    const now = new Date();

    const [line] = yield* db
      .insert(messages)
      .values({
        ...owner,
        seq: nextSeq++,
        clientId: randomUUID(),
        role: MESSAGE_ROLE.USER,
        parts: [...parts],
        placedAt: now,
        createdAt: now,
      })
      .returning({ id: messages.id });

    if (line === undefined) throw new Error("queueJournalLine: no line.");
    yield* db.insert(journalImageMove).values({ messageId: line.id });

    return { ...owner, messageId: line.id };
  });
}
