/**
 * description-comment-writes.ts -- a description's comment thread started or acted on with the files a comment carries put in the Blob store first.
 *
 * A comment's files travel as base64 (`AgentAttachment`); each is put in the
 * store under a fresh id before the thread's write
 * (`@repo/database/models/description-comments`), which takes them stored
 * and writes their rows in the same transaction as the comment. A write that
 * keeps no row of an upload (a refusal, a retry under a key taken, a
 * failure) leaves it tombstoned for the sweep (`attachment-uploads.ts`).
 * Every caller that writes a comment, a member's, an agent's, or the
 * assistant's, writes it here.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  actOnDescriptionCommentThread as actStored,
  type DescriptionCommentOutcome,
  type DescriptionCommentWriterRef,
  type StoredCommentFile,
  startDescriptionCommentThread as startStored,
} from "@repo/database/models/description-comments";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import type { AgentAttachment } from "@repo/features/agent-wire";
import type {
  DescriptionCommentActionRequest,
  DescriptionCommentAskRequest,
  DescriptionCommentStart,
} from "@repo/features/description-comment-wire";
import { Effect } from "effect";
import {
  type AttachmentUploads,
  putAttachment,
  withAttachmentUploads,
} from "../storage/attachment-uploads.js";
import type { BlobStoreFailure } from "../storage/blob-store.js";

type CommentWriteEffect = Effect.Effect<
  DescriptionCommentOutcome,
  TaskStoreFailure | BlobStoreFailure,
  DatabaseServices
>;

/** Each file put in the store under a fresh id, as a comment's write takes it. */
function storedFiles(
  files: readonly AgentAttachment[],
): Effect.Effect<readonly StoredCommentFile[], BlobStoreFailure, AttachmentUploads> {
  return Effect.forEach(files, (file) =>
    Effect.map(
      putAttachment(new Uint8Array(Buffer.from(file.data, "base64")), file.mediaType),
      (stored) => ({ name: file.name, mediaType: file.mediaType, stored }),
    ),
  );
}

/**
 * The request with its files put in the store, every other field as it
 * came. Note that a request that carries none is handed an empty list, which
 * every write reads as carrying none, an edit's as leaving the comment's
 * files as they stand in their order.
 */
function withStoredFiles<Request extends object>(
  request: Request,
  attachments: readonly AgentAttachment[] | undefined,
) {
  return Effect.map(storedFiles(attachments ?? []), (stored) => ({
    ...request,
    attachments: stored,
  }));
}

/** A thread started on the description, as `startDescriptionCommentThread` in the database starts one, its first comment's files put in the store first. */
export function startDescriptionCommentThread(
  writer: DescriptionCommentWriterRef,
  taskId: string,
  request: DescriptionCommentStart,
): CommentWriteEffect {
  return withAttachmentUploads(
    Effect.flatMap(withStoredFiles(request, request.attachments), (stored) =>
      startStored(writer, taskId, stored),
    ),
  );
}

/** What a writer does to a thread, as `actOnDescriptionCommentThread` in the database does it, a reply's or an edit's files put in the store first. */
export function actOnDescriptionCommentThread(
  writer: DescriptionCommentWriterRef,
  taskId: string,
  threadId: string,
  request: DescriptionCommentActionRequest | DescriptionCommentAskRequest,
): CommentWriteEffect {
  return withAttachmentUploads(
    Effect.flatMap(
      withStoredFiles(request, "attachments" in request ? request.attachments : undefined),
      (stored) => actStored(writer, taskId, threadId, stored),
    ),
  );
}
