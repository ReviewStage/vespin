import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INBOX_IMAGE_TYPE } from "@repo/features/inbox-wire";
import { pngBytes } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { attachment } from "../../schemas/attachment.js";
import { journalImageMove } from "../../schemas/journal-image-move.js";
import { messages } from "../../schemas/storage.js";
import { getTestDB, inlineImagePart, queueJournalLine } from "../../testing/index.js";
import {
  JOURNAL_IMAGE_SETTLED,
  type JournalImageRow,
  readJournalImageRow,
  settleJournalImageRow,
} from "../journal-image-moves.js";

/**
 * journal-image-moves.test.ts -- a queued line is rewritten only as it was read: one changed since writes nothing and stays queued, and one gone leaves the queue.
 *
 * The move's whole path, over a store, is `packages/service/src/storage/journal-image-move.test.ts`'s.
 * Synthetic accounts and pictures throughout.
 */

const partsOf = (messageId: string) =>
  Effect.map(
    Database.use((db) =>
      db.select({ parts: messages.parts }).from(messages).where(eq(messages.id, messageId)),
    ),
    ([row]) => row?.parts,
  );

const isQueued = (messageId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ messageId: journalImageMove.messageId })
        .from(journalImageMove)
        .where(eq(journalImageMove.messageId, messageId)),
    ),
    (rows) => rows.length === 1,
  );

/** The row's one image settled as a picture stored under a fresh id. */
const settleAsStored = (row: JournalImageRow) => {
  const id = randomUUID();

  return settleJournalImageRow(
    row,
    row.images.map((image) => ({
      ...image,
      picture: {
        id,
        blobKey: `attachments/${id}`,
        sha256: randomUUID(),
        contentType: INBOX_IMAGE_TYPE.PNG,
        width: 64,
        height: 64,
        byteCount: 33,
      },
    })),
  );
};

it.layer(getTestDB())("a queued line's settle", (it) => {
  it.effect("a line changed since it was read is written nothing and stays queued", () =>
    Effect.gen(function* () {
      const db = yield* Database;

      const line = yield* queueJournalLine([
        inlineImagePart(pngBytes(64, 64, 1), INBOX_IMAGE_TYPE.PNG, "first.png"),
      ]);

      const read = yield* readJournalImageRow(line.messageId);
      assert.ok(Option.isSome(read) && read.value.images.length === 1);

      const changed = [inlineImagePart(pngBytes(64, 64, 2), INBOX_IMAGE_TYPE.PNG, "first.png")];
      yield* db.update(messages).set({ parts: changed }).where(eq(messages.id, line.messageId));

      const settled = yield* settleAsStored(read.value);

      assert.deepEqual(settled, { settled: JOURNAL_IMAGE_SETTLED.CHANGED, rewritten: 0 });
      assert.deepEqual(yield* partsOf(line.messageId), changed);
      assert.equal(yield* isQueued(line.messageId), true);

      const pictures = yield* db
        .select({ id: attachment.id })
        .from(attachment)
        .where(eq(attachment.conversationId, line.conversationId));

      assert.deepEqual(pictures, []);
    }),
  );

  it.effect("a line gone since it was read leaves the queue", () =>
    Effect.gen(function* () {
      const line = yield* queueJournalLine([
        inlineImagePart(pngBytes(64, 64, 3), INBOX_IMAGE_TYPE.PNG, "gone.png"),
      ]);

      const read = yield* readJournalImageRow(line.messageId);
      assert.ok(Option.isSome(read));
      yield* Database.use((db) => db.delete(messages).where(eq(messages.id, line.messageId)));

      const settled = yield* settleAsStored(read.value);

      assert.deepEqual(settled, { settled: JOURNAL_IMAGE_SETTLED.GONE, rewritten: 0 });
      assert.equal(yield* isQueued(line.messageId), false);
    }),
  );
});
