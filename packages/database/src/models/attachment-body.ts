/**
 * attachment-body.ts -- where an attachment's bytes stand as a read answers them: inline in its row, or in the Blob store under a key.
 *
 * A row keeps its bytes in `bytes` or names their pathname in the
 * deployment's private Blob store in `blob_key`, exactly one of the two
 * (`attachment_storage`), and a copy for a phone beside them the same way
 * (`mp4_bytes` or `phone_blob_key`). A read selects both columns of a pair
 * and answers which one stands, so its caller loads the bytes from the
 * store, or redirects a reader to them, only where it needs them, and a
 * stored row's bytes never travel through the database at all.
 */

import { Schema } from "effect";

/** Where a body stands: in the row, or in the Blob store. */
export const ATTACHMENT_BODY = {
  INLINE: "inline",
  STORED: "stored",
} as const;

/** One of an attachment's bodies, its own bytes or its copy for a phone, where it stands. */
export type AttachmentBody =
  | { readonly kind: typeof ATTACHMENT_BODY.INLINE; readonly bytes: Uint8Array }
  | { readonly kind: typeof ATTACHMENT_BODY.STORED; readonly blobKey: string };

/** The pair of columns a body is read from, as a read's result schema names them. */
export const attachmentBodyFields = {
  bytes: Schema.NullOr(Schema.Uint8Array),
  blobKey: Schema.NullOr(Schema.String),
} as const;

/** The pair of columns a copy for a phone is read from, as a read's result schema names them. */
export const phoneBodyFields = {
  mp4Bytes: Schema.NullOr(Schema.Uint8Array),
  phoneBlobKey: Schema.NullOr(Schema.String),
} as const;

/**
 * The body a row's pair of columns names. Note that we assert one stands,
 * because `attachment_storage` refuses a row that keeps neither, so a read
 * that answers neither is the database breaking its own contract.
 */
export function attachmentBodyOf(row: {
  readonly bytes: Uint8Array | null;
  readonly blobKey: string | null;
}): AttachmentBody {
  if (row.blobKey !== null) return { kind: ATTACHMENT_BODY.STORED, blobKey: row.blobKey };

  if (row.bytes === null) {
    throw new Error("attachmentBodyOf: an attachment row keeps its bytes inline or stored.");
  }

  return { kind: ATTACHMENT_BODY.INLINE, bytes: row.bytes };
}

/** The copy for a phone a row's pair of columns names, or none where it keeps none. */
export function phoneBodyOf(row: {
  readonly mp4Bytes: Uint8Array | null;
  readonly phoneBlobKey: string | null;
}): AttachmentBody | undefined {
  if (row.phoneBlobKey !== null) return { kind: ATTACHMENT_BODY.STORED, blobKey: row.phoneBlobKey };

  return row.mp4Bytes === null ? undefined : { kind: ATTACHMENT_BODY.INLINE, bytes: row.mp4Bytes };
}
