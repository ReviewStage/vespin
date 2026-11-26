/**
 * attachment-blob-paths.ts -- the one place an attachment's object name in the Blob store is spelled.
 *
 * An attachment's bytes stand at `attachments/<attachment id>`, and the copy
 * a phone plays of a video it cannot play itself (an MP4 beside a WebM) at
 * `attachments/<attachment id>/phone`. The id is the `attachment` row's UUID,
 * so a name is never a person's words and never collides across rows. Every
 * reader, writer, and sweep names an object through `attachmentBlobPath`,
 * never by a string of its own, so the layout can move in one place.
 */

import { isWireUuid } from "@repo/features";

/** The folder every attachment's objects stand under. */
const ATTACHMENTS_FOLDER = "attachments";

/** Which of an attachment's objects is meant: its own bytes, or the copy a phone plays. */
export const ATTACHMENT_BLOB_VARIANT = {
  ORIGINAL: "original",
  PHONE: "phone",
} as const;

export type AttachmentBlobVariant =
  (typeof ATTACHMENT_BLOB_VARIANT)[keyof typeof ATTACHMENT_BLOB_VARIANT];

/** The last segment a variant adds after the id, or none for the attachment's own bytes. */
const VARIANT_SEGMENT = {
  [ATTACHMENT_BLOB_VARIANT.ORIGINAL]: undefined,
  [ATTACHMENT_BLOB_VARIANT.PHONE]: "phone",
} as const satisfies Record<AttachmentBlobVariant, string | undefined>;

/**
 * The pathname of one of an attachment's objects. Note that we refuse an id
 * that is no UUID, because a slash or a dot segment in it would name another
 * attachment's object or one outside the folder.
 */
export function attachmentBlobPath(
  attachmentId: string,
  variant: AttachmentBlobVariant = ATTACHMENT_BLOB_VARIANT.ORIGINAL,
): string {
  if (!isWireUuid(attachmentId)) {
    throw new Error("attachmentBlobPath: an attachment id must be a lowercase UUID.");
  }

  const segment = VARIANT_SEGMENT[variant];

  return segment === undefined
    ? [ATTACHMENTS_FOLDER, attachmentId].join("/")
    : [ATTACHMENTS_FOLDER, attachmentId, segment].join("/");
}
