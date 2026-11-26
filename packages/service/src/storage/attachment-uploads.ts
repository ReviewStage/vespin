/**
 * attachment-uploads.ts -- a new attachment's bytes put in the Blob store before its row is written, and every upload no row came to take tombstoned once the write is done.
 *
 * Every new `attachment` row keeps its bytes in the store, never in the row:
 * its writer uploads them first, under a fresh id the row is then written
 * with (`attachments/<id>`, and `attachments/<id>/phone` for a copy for a
 * phone), and hands the database the stored body
 * (`@repo/database/models/attachment-body`'s `StoredAttachment`). A write
 * may still keep no row of an upload: it failed or rolled back, it was
 * refused (a full budget, a plan out of reach), a retry answered what an
 * earlier take wrote, or a conversation already keeps the same picture.
 * So every upload is made inside `withAttachmentUploads`, which records each
 * one and, however the write ends, tombstones the objects of every upload
 * whose row does not stand (`tombstoneUnwrittenUploads`), which the
 * scheduled sweep deletes within about a minute. Note that it must wrap the
 * write's whole transaction, never run inside one, because the read of
 * which rows stand would see the write's own row before a rollback took it
 * away; it refuses to run inside one.
 *
 * Bytes the service already holds go in by `putAttachment`; bytes an agent's
 * sandbox uploads itself by a presigned URL are recorded by
 * `recordAttachmentUpload` before the URL is handed out, so an upload that
 * lands after its call failed is tombstoned too.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type AttachmentUpload,
  tombstoneUnwrittenUploads,
} from "@repo/database/models/attachment-blob-tombstones";
import type { StoredAttachment, StoredPhoneCopy } from "@repo/database/models/attachment-body";
import { AUDIO_TYPE } from "@repo/features/audio-signature";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import {
  MP4_TYPE,
  mp4IsSoundOnly,
  PHONE_VIDEO_BOUNDS,
  streamableMp4,
} from "@repo/features/video-signature";
import { Context, Effect, Option, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { ATTACHMENT_BLOB_VARIANT, attachmentBlobPath } from "./attachment-blob-paths.js";
import { BlobStore, type BlobStoreFailure, type PresignedUpload } from "./blob-store.js";

/**
 * How long a presigned upload a sandbox is handed takes an upload: what one
 * upload of a file within today's bounds needs, and no more, since the agent
 * can read it.
 */
export const SANDBOX_UPLOAD_SECONDS = 120;

/** How many times a failed tombstone write is tried again before the uploads are left to stand, logged. */
const SETTLE_RETRIES = 2;

/** An upload's id and the pathnames it reserved, its own recorded before it is written. */
export interface ReservedUpload {
  readonly id: string;
  readonly blobKey: string;
  readonly phoneBlobKey: string;
  /**
   * Records the copy for a phone's pathname with the write's uploads, run
   * just before a copy may be written there. Note that it is recorded only
   * then, because a pathname only reserved holds no object, and its
   * tombstone would stand beside a row that names no copy until the row goes.
   */
  readonly recordPhone: Effect.Effect<void>;
}

/** The uploads one write made, which it settles as it ends. */
interface AttachmentUploadsValues {
  readonly record: (upload: AttachmentUpload) => Effect.Effect<void>;
}

/** The uploads of the write standing around the call, which `withAttachmentUploads` provides. */
export class AttachmentUploads extends Context.Service<
  AttachmentUploads,
  AttachmentUploadsValues
>()("AttachmentUploads") {}

/** Bytes to upload beside an attachment's own as the copy a phone plays. */
export interface PhoneCopyBytes {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** The type a copy for a phone of a file of the type is kept as: an MP4 of a WebM, an M4A of an Ogg; none for any other. */
export function phoneCopyType(contentType: string): string | undefined {
  if (contentType === CONVERSATION_MEDIA_TYPE.WEBM) return MP4_TYPE;

  return contentType === CONVERSATION_MEDIA_TYPE.OGG ? AUDIO_TYPE.M4A : undefined;
}

/**
 * A fresh id and the pathnames its objects stand at, its own recorded with
 * the write standing around the call, so whatever lands there is tombstoned
 * unless a row comes to take the id; the copy for a phone's is recorded by
 * `recordPhone` only where one may be written.
 */
export const reserveAttachmentUpload: Effect.Effect<ReservedUpload, never, AttachmentUploads> =
  Effect.gen(function* () {
    const id = crypto.randomUUID();

    const blobKey = attachmentBlobPath(id);
    const phoneBlobKey = attachmentBlobPath(id, ATTACHMENT_BLOB_VARIANT.PHONE);
    const uploads = yield* AttachmentUploads;
    yield* uploads.record({ id, keys: [blobKey] });

    return { id, blobKey, phoneBlobKey, recordPhone: uploads.record({ id, keys: [phoneBlobKey] }) };
  });

/**
 * The bytes put in the store under a fresh id, with a copy for a phone
 * beside them where one is given, answered as the stored body a writer
 * takes; the upload is recorded before anything is put.
 */
export function putAttachment(
  bytes: Uint8Array,
  contentType: string,
  phone?: PhoneCopyBytes,
): Effect.Effect<StoredAttachment, BlobStoreFailure, AttachmentUploads> {
  return Effect.gen(function* () {
    const reserved = yield* reserveAttachmentUpload;
    const store = yield* BlobStore;
    yield* store.put(reserved.blobKey, bytes, contentType);

    if (phone === undefined) {
      return { id: reserved.id, blobKey: reserved.blobKey, byteCount: bytes.byteLength };
    }

    yield* reserved.recordPhone;
    yield* store.put(reserved.phoneBlobKey, phone.bytes, phone.contentType);

    return {
      id: reserved.id,
      blobKey: reserved.blobKey,
      byteCount: bytes.byteLength,
      phone: { blobKey: reserved.phoneBlobKey, byteCount: phone.bytes.byteLength },
    };
  });
}

/**
 * What an upload by a presigned URL left at the pathname: its bytes, where
 * the store holds an object there of the type the URL was presigned for and
 * within its bound; nothing otherwise. Note that the object is read back
 * whole, because a row is written from what the store holds rather than from
 * what the uploader said it sent, and today's bounds keep it small.
 */
export function readBackUpload(
  pathname: string,
  terms: { readonly contentType: string; readonly maxBytes: number },
): Effect.Effect<Option.Option<Uint8Array>, BlobStoreFailure> {
  return Effect.gen(function* () {
    const store = yield* BlobStore;
    const found = yield* store.head(pathname);

    if (
      Option.isNone(found) ||
      found.value.contentType !== terms.contentType ||
      found.value.size > terms.maxBytes
    ) {
      return Option.none();
    }

    const bytes = yield* store.get(pathname);

    return Option.filter(bytes, (read) => read.byteLength <= terms.maxBytes);
  });
}

/** Whether bytes are a copy for a phone of the type: a streamable MP4 of a recording, or an M4A of sound alone, within its bound. */
function isPhoneCopy(copyType: string, bytes: Uint8Array): boolean {
  if (bytes.byteLength > PHONE_VIDEO_BOUNDS.MAX_BYTES) return false;

  return copyType === MP4_TYPE ? streamableMp4(bytes) : mp4IsSoundOnly(bytes);
}

/**
 * The copy for a phone a sandbox makes and uploads itself, at the pathname,
 * by one URL presigned for the copy's type and bound, then read back and
 * checked; nothing where it made none or what landed is no such copy, which
 * is deleted then, since the row that keeps the file will name no copy.
 */
export function storeSandboxPhoneCopy(
  copyType: string,
  reserved: ReservedUpload,
  made: (upload: PresignedUpload) => Effect.Effect<boolean, unknown>,
): Effect.Effect<StoredPhoneCopy | undefined, BlobStoreFailure> {
  return Effect.gen(function* () {
    const store = yield* BlobStore;
    const pathname = reserved.phoneBlobKey;
    // Note that the pathname is recorded before the URL is handed out, so a copy that lands after the call failed is tombstoned too.
    yield* reserved.recordPhone;

    const presigned = yield* store.presignPut(pathname, {
      contentType: copyType,
      maxBytes: PHONE_VIDEO_BOUNDS.MAX_BYTES,
      validForSeconds: SANDBOX_UPLOAD_SECONDS,
    });

    const uploaded = yield* made(presigned).pipe(Effect.orElseSucceed(() => false));

    const landed = uploaded
      ? yield* readBackUpload(pathname, {
          contentType: copyType,
          maxBytes: PHONE_VIDEO_BOUNDS.MAX_BYTES,
        })
      : Option.none<Uint8Array>();

    if (Option.isSome(landed) && isPhoneCopy(copyType, landed.value)) {
      return { blobKey: pathname, byteCount: landed.value.byteLength };
    }

    yield* store.delete([pathname]);

    return undefined;
  });
}

/** The uploads tombstoned where no row took them, tried again a few times; a failure past them is logged and leaves the objects standing. */
function settle(
  uploads: readonly AttachmentUpload[],
): Effect.Effect<void, never, DatabaseServices> {
  return tombstoneUnwrittenUploads(uploads).pipe(
    Effect.retry(Schedule.recurs(SETTLE_RETRIES)),
    Effect.catch((failure) =>
      Effect.logError(`Attachment uploads left unsettled: ${failure._tag}`),
    ),
  );
}

/**
 * Asserts the call stands in no transaction, where a settle would read the
 * write's own uncommitted rows as standing.
 */
const outsideTransaction: Effect.Effect<void, never, SqlClient.SqlClient> = Effect.gen(
  function* () {
    const client = yield* SqlClient.SqlClient;
    const open = yield* Effect.serviceOption(client.transactionService);

    if (Option.isSome(open)) {
      return yield* Effect.die(
        new Error("withAttachmentUploads: wrap the write's transaction, never run inside one."),
      );
    }
  },
);

/**
 * Runs the write with its uploads recorded, and settles them however it
 * ends: every upload whose row does not stand is tombstoned. A write already
 * inside another's uploads joins them, and the outer one settles.
 */
export function withAttachmentUploads<A, E, R>(
  write: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, AttachmentUploads> | DatabaseServices> {
  return Effect.gen(function* () {
    const standing = yield* Effect.serviceOption(AttachmentUploads);

    if (Option.isSome(standing)) {
      return yield* Effect.provideService(write, AttachmentUploads, standing.value);
    }

    yield* outsideTransaction;
    const made: AttachmentUpload[] = [];

    const uploads: AttachmentUploadsValues = {
      record: (upload) => Effect.sync(() => void made.push(upload)),
    };

    return yield* Effect.provideService(write, AttachmentUploads, uploads).pipe(
      Effect.ensuring(Effect.suspend(() => settle(made))),
    );
  });
}
