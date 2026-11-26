/**
 * attachment-bodies.ts -- an attachment's bytes as a test reads them, and a kept row moved into the Blob store as a later writer would keep it.
 */

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database, type QueryError } from "../core/query.js";
import { ATTACHMENT_BODY, type AttachmentBody } from "../models/attachment-body.js";
import { attachment } from "../schemas/attachment.js";

/** The bytes of a body kept in its row; a test that expected them inline fails on a stored one. */
export function inlineBytesOf(body: AttachmentBody): Uint8Array {
  if (body.kind !== ATTACHMENT_BODY.INLINE) {
    throw new Error("inlineBytesOf: the attachment's bytes stand in the Blob store.");
  }

  return body.bytes;
}

/**
 * The kept row's bytes moved out of it to the pathnames given, its copy for
 * a phone among them where `phoneBlobKey` names one, leaving the counts it
 * was kept with; the test puts the bytes in its own store.
 */
export function storeAttachmentInBlob(
  attachmentId: string,
  keys: { readonly blobKey: string; readonly phoneBlobKey?: string | undefined },
): Effect.Effect<void, QueryError, Database> {
  return Effect.asVoid(
    Database.use((db) =>
      db
        .update(attachment)
        .set({
          bytes: null,
          blobKey: keys.blobKey,
          mp4Bytes: null,
          phoneBlobKey: keys.phoneBlobKey ?? null,
        })
        .where(eq(attachment.id, attachmentId)),
    ),
  );
}
