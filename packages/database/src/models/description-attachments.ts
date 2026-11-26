import { randomUUID } from "node:crypto";
import {
  DESCRIPTION_ATTACHMENT_BOUNDS,
  type DescriptionFile,
  descriptionFileTypeSchema,
} from "@repo/features/description-attachment-wire";
import {
  MP4_TYPE,
  PLAYABLE_VIDEO_TYPE,
  type PlayableVideoType,
  playableVideoTypeSchema,
} from "@repo/features/video-signature";
import { and, eq, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { attachment, ownedByTaskAlone, servedColumns } from "../schemas/attachment.js";
import { task } from "../schemas/task.js";
import {
  type AttachmentBody,
  attachmentBodyFields,
  attachmentBodyOf,
  phoneBodyFields,
  phoneBodyOf,
} from "./attachment-body.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * description-attachments.ts -- a description's pictures and files: keep one and read one.
 *
 * A picture, a video an agent recorded, or a PDF is kept under the plan row's own
 * lock, so the count it is held to cannot be crossed by a second
 * upload. Every read names the account beside the
 * plan and gates on its membership of the plan's workspace, so a member
 * reads a picture a teammate pasted and a plan of a workspace the account is
 * not in reads as no plan, exactly as in `task-store.ts`. A picture stays
 * until its task is deleted, which cascades to it, whether or not a save
 * named it.
 */

/** What keeping a picture came to: kept under its new id, refused for the description's count of pictures, or no plan to keep it on. */
export const DESCRIPTION_ATTACHMENT_KEEP = {
  KEPT: "kept",
  TOO_MANY: "too-many",
  NO_TASK: "no-plan",
} as const;

export type DescriptionAttachmentKeep =
  | { readonly status: typeof DESCRIPTION_ATTACHMENT_KEEP.KEPT; readonly id: string }
  | { readonly status: typeof DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY }
  | { readonly status: typeof DESCRIPTION_ATTACHMENT_KEEP.NO_TASK };

/** A description's pictures among every attachment: the ones its task owns alone. */
const descriptionPicture = ownedByTaskAlone(attachment);

/** The media type of each file the description keeps, by its id. */
const findFileTypes = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, contentType: Schema.String }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ id: attachment.id, contentType: attachment.contentType })
        .from(attachment)
        .where(and(eq(attachment.taskId, taskId), descriptionPicture)),
    ),
});

/** The plan's id and workspace under its row's lock, where the account reaches it; nothing otherwise. */
const lockOpenTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, organizationId: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, organizationId: task.organizationId })
        .from(task)
        .where(reachableTask(userId, taskId))
        .for("update"),
    ),
});

/** How many pictures the description holds. */
const countPictures = SqlSchema.findOne({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ count: Schema.Number }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(attachment)
        .where(and(eq(attachment.taskId, taskId), descriptionPicture)),
    ),
});

const insertPicture = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    taskId: Schema.String,
    organizationId: Schema.String,
    userId: Schema.String,
    contentType: descriptionFileTypeSchema,
    byteCount: Schema.Number,
    bytes: Schema.Uint8Array,
    mp4Bytes: Schema.NullOr(Schema.Uint8Array),
    createdAt: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(attachment)
        .values({ ...row, phoneByteCount: row.mp4Bytes === null ? null : row.mp4Bytes.byteLength }),
    ),
});

/** Which picture of which plan an account reads. */
const PictureAskSchema = Schema.Struct({
  userId: Schema.String,
  taskId: Schema.String,
  attachmentId: Schema.String,
});

/** The plan's picture, where the account reaches the plan, served as the reader plays a video. */
function pictureQuery(
  { userId, taskId, attachmentId }: typeof PictureAskSchema.Type,
  playable: PlayableVideoType,
) {
  return Database.use((db) =>
    db
      .select(servedColumns(playable))
      .from(attachment)
      .innerJoin(task, eq(task.id, attachment.taskId))
      .where(
        and(
          eq(attachment.taskId, taskId),
          eq(attachment.id, attachmentId),
          descriptionPicture,
          taskReachableBy(userId),
        ),
      ),
  );
}

const findPicture = SqlSchema.findOneOption({
  Request: PictureAskSchema,
  Result: Schema.Struct({ contentType: descriptionFileTypeSchema, ...attachmentBodyFields }),
  execute: (ask) => pictureQuery(ask, PLAYABLE_VIDEO_TYPE.WEBM),
});

const findServedPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...PictureAskSchema.fields, playable: playableVideoTypeSchema }),
  Result: Schema.Struct({
    contentType: Schema.Union([descriptionFileTypeSchema, Schema.Literal(MP4_TYPE)]),
    ...attachmentBodyFields,
  }),
  execute: ({ playable, ...ask }) => pictureQuery(ask, playable),
});

/** A description's file as a copy of it is made: its type, where its bytes stand, and where a recording's or a clip's copy for a phone stands, where one is kept. */
export interface CopiedDescriptionFile {
  readonly contentType: DescriptionFile["contentType"];
  readonly body: AttachmentBody;
  readonly phone: AttachmentBody | undefined;
}

const CopiedDescriptionFileSchema = Schema.Struct({
  contentType: descriptionFileTypeSchema,
  ...attachmentBodyFields,
  ...phoneBodyFields,
});

/** A description's file as a read answers it: its type, and where its bytes stand. */
export interface StoredDescriptionFile {
  readonly contentType: DescriptionFile["contentType"];
  readonly body: AttachmentBody;
}

const findWorkspacePicture = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...PictureAskSchema.fields, organizationId: Schema.String }),
  Result: CopiedDescriptionFileSchema,
  execute: ({ userId, taskId, attachmentId, organizationId }) =>
    Database.use((db) =>
      db
        .select({
          contentType: attachment.contentType,
          bytes: attachment.bytes,
          blobKey: attachment.blobKey,
          mp4Bytes: attachment.mp4Bytes,
          phoneBlobKey: attachment.phoneBlobKey,
        })
        .from(attachment)
        .innerJoin(task, eq(task.id, attachment.taskId))
        .where(
          and(
            eq(attachment.taskId, taskId),
            eq(attachment.id, attachmentId),
            eq(task.organizationId, organizationId),
            descriptionPicture,
            taskReachableBy(userId),
          ),
        ),
    ),
});

/** A picture, video, or PDF to keep on the description, a recording with the MP4 its sandbox made of it, which no count weighs. */
export type DescriptionAttachmentToKeep = DescriptionFile & {
  readonly mp4Bytes?: Uint8Array | undefined;
};

/**
 * Keeps one picture, video, or PDF on the description, uploaded by the account, under a
 * new id, a PDF or a video counted among its pictures; refused where the description
 * already holds its bound of pictures, and nothing where the account reaches no
 * such plan.
 */
export function keepDescriptionAttachment(
  userId: string,
  taskId: string,
  picture: DescriptionAttachmentToKeep,
): TaskStoreEffect<DescriptionAttachmentKeep> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockOpenTask({ userId, taskId });

        if (Option.isNone(locked)) return { status: DESCRIPTION_ATTACHMENT_KEEP.NO_TASK } as const;

        // A count that returned no row is the database breaking its own contract, not an outcome.
        const { count } = yield* countPictures({ taskId }).pipe(
          Effect.catchTag("NoSuchElementError", Effect.die),
        );

        if (count >= DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION) {
          return { status: DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY } as const;
        }

        const id = randomUUID();
        yield* insertPicture({
          id,
          taskId,
          organizationId: locked.value.organizationId,
          userId,
          contentType: picture.contentType,
          byteCount: picture.bytes.length,
          bytes: picture.bytes,
          mp4Bytes: picture.mp4Bytes ?? null,
          createdAt: yield* DateTime.nowAsDate,
        });

        return { status: DESCRIPTION_ATTACHMENT_KEEP.KEPT, id } as const;
      }),
    ),
  );
}

/**
 * The media type of each picture, video, or file the plan's description
 * keeps, by its id, so a reader draws each by its kind before its bytes
 * arrive. Note that the task is the one a read of it already reached, so no
 * account is named here.
 */
export function readDescriptionFileTypes(
  taskId: string,
): TaskStoreEffect<Readonly<Record<string, string>>> {
  return Effect.map(findFileTypes({ taskId }), (rows) =>
    Object.fromEntries(rows.map((row) => [row.id, row.contentType])),
  );
}

/** One picture, video, or PDF of the description, its type and where its bytes stand; nothing where the account reaches no such plan or the description no such file. */
export function readDescriptionAttachment(
  userId: string,
  taskId: string,
  attachmentId: string,
): TaskStoreEffect<Option.Option<StoredDescriptionFile>> {
  return Effect.map(
    findPicture({ userId, taskId, attachmentId }),
    Option.map(({ contentType, ...row }) => ({ contentType, body: attachmentBodyOf(row) })),
  );
}

/** One file of the description as `readDescriptionAttachment` reads it, with a recording's or a clip's copy for a phone where one is kept, as a copy of it is made elsewhere: only where the task stands in the workspace given. */
export function readWorkspaceDescriptionAttachment(
  reader: { readonly userId: string; readonly organizationId: string },
  ref: { readonly taskId: string; readonly attachmentId: string },
): TaskStoreEffect<Option.Option<CopiedDescriptionFile>> {
  return Effect.map(
    findWorkspacePicture({ ...reader, ...ref }),
    Option.map((row) => ({
      contentType: row.contentType,
      body: attachmentBodyOf(row),
      phone: phoneBodyOf(row),
    })),
  );
}

/** One picture or video of the description as `readDescriptionAttachment` reads it, served to a reader that plays the video given: a recording's MP4 copy where it plays MP4 and one is kept, and its WebM otherwise. */
export function readServedDescriptionAttachment(
  userId: string,
  taskId: string,
  attachmentId: string,
  playable: PlayableVideoType,
): TaskStoreEffect<Option.Option<{ readonly contentType: string; readonly body: AttachmentBody }>> {
  return Effect.map(
    findServedPicture({ userId, taskId, attachmentId, playable }),
    Option.map(({ contentType, ...row }) => ({ contentType, body: attachmentBodyOf(row) })),
  );
}
