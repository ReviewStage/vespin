import { pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

/**
 * attachment-blob-tombstone.ts -- an object in the Blob store whose attachment is gone, waiting for the sweep to delete it.
 *
 * An `AFTER DELETE` trigger on `attachment` writes one row for each pathname
 * a deleted row named (`blob_key`, `phone_blob_key`), however the row went:
 * its own delete or any owner's cascade, its workspace's through Better Auth
 * among them. The trigger lives in the migration that made this table
 * (`20261126003436_attachment_blob_keys`), since Drizzle declares no trigger. The
 * attachment is unreachable once its row is gone; the scheduled sweep
 * deletes the objects its tombstones name and then the tombstones
 * (`packages/service/src/storage/attachment-blob-purge.ts`), so they leave
 * the store within about a minute. A pathname is tombstoned once: a key is
 * an attachment's id, which no later row takes again.
 */
export const attachmentBlobTombstone = pgTable("attachment_blob_tombstone", {
  /** The object's pathname in the store, as the attachment's row named it. */
  key: text("key").primaryKey(),
  /** When its attachment was deleted. */
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});
