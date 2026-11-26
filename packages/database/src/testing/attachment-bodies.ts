/**
 * attachment-bodies.ts -- an attachment's bytes as a test reads them, a stored body as a test hands one to a writer, and a kept row moved into the Blob store.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database, type QueryError } from "../core/query.js";
import {
  ATTACHMENT_BODY,
  type AttachmentBody,
  type StoredAttachment,
} from "../models/attachment-body.js";
import { attachment } from "../schemas/attachment.js";

/** The bytes of a body kept in its row; a test that expected them inline fails on a stored one. */
export function inlineBytesOf(body: AttachmentBody): Uint8Array {
  if (body.kind !== ATTACHMENT_BODY.INLINE) {
    throw new Error("inlineBytesOf: the attachment's bytes stand in the Blob store.");
  }

  return body.bytes;
}

/** The key of a body kept in the Blob store; a test that expected it stored fails on an inline one. */
export function blobKeyOf(body: AttachmentBody): string {
  if (body.kind !== ATTACHMENT_BODY.STORED) {
    throw new Error("blobKeyOf: the attachment's bytes stand in its row.");
  }

  return body.blobKey;
}

/**
 * A body as a writer is handed it, as though uploaded under a fresh id at the
 * pathname a real upload names (`attachments/<id>`): counted at `byteCount`,
 * with a copy for a phone counted at `phoneByteCount` where one is given.
 * Nothing is put anywhere, since a database writer reads only the counts and
 * keys.
 */
export function storedAttachmentOf(byteCount: number, phoneByteCount?: number): StoredAttachment {
  const id = randomUUID();
  const blobKey = `attachments/${id}`;

  return phoneByteCount === undefined
    ? { id, blobKey, byteCount }
    : { id, blobKey, byteCount, phone: { blobKey: `${blobKey}/phone`, byteCount: phoneByteCount } };
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
