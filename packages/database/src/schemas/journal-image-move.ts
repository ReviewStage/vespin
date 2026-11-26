import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

/**
 * journal-image-move.ts -- the one-off move of the images a developer's lines kept as `data:` URLs in the journal into Blob-backed conversation pictures: the rows still to move, and a log of each part rewritten.
 *
 * Lines written before a kept image was named by id (#4603) keep each image
 * as a file part over a `data:` URL, its bytes in `messages.parts`. The
 * migration that made these tables queued every such row once
 * (`20261126012658_journal_image_move`), so the sweep's move
 * (`packages/service/src/storage/journal-image-move.ts`) reads this small
 * queue rather than the journal: it keeps each image as a picture of the
 * row's conversation whose bytes stand in the Blob store, rewrites its part
 * to the kept shape (`attached-file-parts.ts`), and drops the row from the
 * queue. A row whose image cannot be kept stays, naming why, and is not
 * taken again. Both tables go with the move, in a later migration.
 */

/** Why a row's image cannot be kept as a conversation's picture. */
export const JOURNAL_IMAGE_MOVE_FAILURE = {
  /** Its bytes are over the most a conversation's picture is kept at. */
  TOO_LARGE: "too-large",
  /** Its bytes are no PNG, JPEG, or WebP whose header states its size, or no base64 at all. */
  UNSUPPORTED: "unsupported",
} as const;

export type JournalImageMoveFailure =
  (typeof JOURNAL_IMAGE_MOVE_FAILURE)[keyof typeof JOURNAL_IMAGE_MOVE_FAILURE];

/** A row of the journal that still holds an image as a `data:` URL, waiting for the sweep to move it. */
export const journalImageMove = pgTable("journal_image_move", {
  /** The journal's row. Note that it names no foreign key, because adding one to `messages` would hold off every write to the journal until the migration committed; the move passes over a row since deleted. */
  messageId: uuid("message_id").primaryKey(),
  /** Why one of its images cannot be kept as a conversation's picture, which keeps the row from being taken again; null while it waits. */
  failure: text("failure").$type<JournalImageMoveFailure>(),
});

/**
 * One part the move rewrote: which row and which of its parts, and the
 * picture it now names, so any rewrite can be traced back. It names no URL
 * and no bytes, and no foreign key, so it outlives a row deleted since.
 */
export const journalImageRewrite = pgTable(
  "journal_image_rewrite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The journal's row whose part was rewritten. */
    messageId: uuid("message_id").notNull(),
    /** The part's place among the row's parts, from zero. */
    partIndex: integer("part_index").notNull(),
    /** The conversation's picture the part now names. */
    attachmentId: uuid("attachment_id").notNull(),
    rewrittenAt: timestamptz("rewritten_at").notNull(),
  },
  (table) => [index("journal_image_rewrite_message").on(table.messageId)],
);
