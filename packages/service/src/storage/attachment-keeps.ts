/**
 * attachment-keeps.ts -- bytes the service holds kept as a conversation's picture or a description's file: put in the Blob store, then written as the row, the upload tombstoned where no row took it.
 *
 * A picture or a file whose bytes the service already holds (a screenshot
 * the browser answered over its bridge, a Mac's window, a member's upload,
 * a copy of a kept file) is put in the store under a fresh id and then
 * written as the row that names it (`attachment-uploads.ts`). A write that
 * keeps no row of it (the transcript full, the same picture kept already,
 * the plan out of reach, a failure) leaves its upload tombstoned for the
 * sweep. A picture is hashed here, because the conversation keeps one row of
 * the same bytes.
 */

import { createHash } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  keepConversationPictures,
  type PictureToKeep,
} from "@repo/database/models/conversation-pictures";
import {
  type DescriptionAttachmentKeep,
  keepDescriptionAttachment,
} from "@repo/database/models/description-attachments";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import type { ConversationMediaType, KeptPicture } from "@repo/features/conversation-picture-wire";
import type { DescriptionFile } from "@repo/features/description-attachment-wire";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import {
  type AttachmentUploads,
  phoneCopyType,
  putAttachment,
  withAttachmentUploads,
} from "./attachment-uploads.js";
import type { BlobStoreFailure } from "./blob-store.js";

/** A picture, or a video shown as one, whose bytes the service holds: its bytes, their type and size, and a recording's copy for a phone where one was made. */
export interface PictureBytes {
  readonly bytes: Uint8Array;
  readonly contentType: ConversationMediaType;
  readonly width: number;
  readonly height: number;
  readonly mp4Bytes?: Uint8Array | undefined;
}

/** A description's file whose bytes the service holds, with a recording's or a clip's copy for a phone where its sandbox made one. */
export type DescriptionFileBytes = DescriptionFile & {
  readonly mp4Bytes?: Uint8Array | undefined;
};

/** The hex SHA-256 of the bytes, which a conversation keeps one picture of. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The copy for a phone of bytes of the type, as an upload takes it; none where none was made. */
function phoneOf(contentType: string, mp4Bytes: Uint8Array | undefined) {
  const copyType = phoneCopyType(contentType);

  return mp4Bytes === undefined || copyType === undefined
    ? undefined
    : { bytes: mp4Bytes, contentType: copyType };
}

/** The picture put in the Blob store and handed in as a conversation keeps one. */
function pictureToKeep(
  picture: PictureBytes,
): Effect.Effect<PictureToKeep, BlobStoreFailure, AttachmentUploads> {
  return Effect.map(
    putAttachment(
      picture.bytes,
      picture.contentType,
      phoneOf(picture.contentType, picture.mp4Bytes),
    ),
    (stored) => ({
      stored,
      sha256: sha256Hex(picture.bytes),
      contentType: picture.contentType,
      width: picture.width,
      height: picture.height,
    }),
  );
}

/**
 * Pictures kept beside the conversation in one transaction, as
 * `keepConversationPictures` keeps a set, each already in the store and
 * written by the uploads standing around the call.
 */
export function keepStoredPictures(
  target: ConversationTarget,
  pictures: readonly PictureToKeep[],
): Effect.Effect<Option.Option<readonly KeptPicture[]>, TaskStoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(keepConversationPictures(target, pictures)),
  );
}

/**
 * A set of pictures whose bytes the service holds kept beside the
 * conversation: each put in the store, then written in one transaction;
 * nothing where the transcript has room for only part of the set.
 */
export function keepPictureBytes(
  target: ConversationTarget,
  pictures: readonly PictureBytes[],
): Effect.Effect<
  Option.Option<readonly KeptPicture[]>,
  TaskStoreFailure | BlobStoreFailure,
  DatabaseServices
> {
  return withAttachmentUploads(
    Effect.flatMap(Effect.forEach(pictures, pictureToKeep), (toKeep) =>
      keepStoredPictures(target, toKeep),
    ),
  );
}

/** One picture whose bytes the service holds kept beside the conversation, as `keepPictureBytes` keeps a set of one. */
export function keepPictureBytesOne(
  target: ConversationTarget,
  picture: PictureBytes,
): Effect.Effect<
  Option.Option<KeptPicture>,
  TaskStoreFailure | BlobStoreFailure,
  DatabaseServices
> {
  return Effect.map(
    keepPictureBytes(target, [picture]),
    Option.flatMap(([one]) => Option.fromNullishOr(one)),
  );
}

/**
 * A file whose bytes the service holds kept on the description: put in the
 * store, then written as `keepDescriptionAttachment` writes one, under the
 * id it was stored under.
 */
export function keepDescriptionFileBytes(
  userId: string,
  taskId: string,
  file: DescriptionFileBytes,
): Effect.Effect<DescriptionAttachmentKeep, TaskStoreFailure | BlobStoreFailure, DatabaseServices> {
  return withAttachmentUploads(
    Effect.flatMap(
      putAttachment(file.bytes, file.contentType, phoneOf(file.contentType, file.mp4Bytes)),
      (stored) =>
        keepDescriptionAttachment(userId, taskId, { contentType: file.contentType, stored }),
    ),
  );
}
