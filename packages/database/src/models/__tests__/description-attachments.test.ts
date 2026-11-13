import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import {
  DESCRIPTION_ATTACHMENT_BOUNDS,
  DESCRIPTION_FILE_TYPE,
  type DescriptionFile,
} from "@repo/features/description-attachment-wire";
import {
  PICTURE_BOUNDS,
  PICTURE_MEDIA_TYPE,
  PICTURE_TYPE,
  type Picture,
} from "@repo/features/picture-wire";
import {
  MP4_TYPE,
  PLAYABLE_VIDEO_TYPE,
  type PlayableVideoType,
} from "@repo/features/video-signature";
import { mp4Bytes, paddedTo, pngBytes, webmBytes } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Effect, Exit, Option } from "effect";
import { Database } from "../../core/query.js";
import { attachment } from "../../schemas/attachment.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  DESCRIPTION_ATTACHMENT_KEEP,
  keepDescriptionAttachment,
  readDescriptionAttachment,
  readServedDescriptionAttachment,
} from "../description-attachments.js";
import { createTask, deleteTask } from "../task-store.js";

/**
 * A description's pictures over a real dialect: kept by a member, read by every
 * member of the plan's workspace and by nobody else, held to the description's
 * bound, a video among them to a video's bound and the description's count of
 * videos, and refused on a plan the account does not reach.
 *
 * Synthetic accounts and pictures throughout.
 */

/** A picture's bytes: a PNG's signature and a few more, which is all the store reads of them. */
const PICTURE: Picture = {
  contentType: PICTURE_TYPE.PNG,
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
};

/** A recording an agent made, as small as a WebM that states its size may be. */
const VIDEO: Picture = { contentType: PICTURE_MEDIA_TYPE.WEBM, bytes: webmBytes(1280, 800) };

/** The MP4 copy an agent's sandbox made of a recording: a file-type box's head, which is all the store holds of it. */
const MP4 = Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** A plan in a workspace the owner made and the teammate joined, and an account in neither. */
const openSharedTask = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });

  return { owner, teammate, outsider, taskId };
});

/** The id a keep answered, failing the test where it kept nothing. */
function keptId(kept: { readonly status: string; readonly id?: string }): string {
  assert.equal(kept.status, DESCRIPTION_ATTACHMENT_KEEP.KEPT);
  assert.ok(kept.id);

  return kept.id;
}

it.layer(getTestDB())("a description's pictures", (it) => {
  it.effect(
    "a picture a teammate pasted reads for every member of the plan's workspace, and as nothing for anyone else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;

        const id = keptId(yield* keepDescriptionAttachment(teammate, taskId, PICTURE));

        const read = yield* readDescriptionAttachment(owner, taskId, id);
        assert.ok(Option.isSome(read));
        assert.equal(read.value.contentType, PICTURE_TYPE.PNG);
        assert.deepEqual([...read.value.bytes], [...PICTURE.bytes]);
        assert.ok(Option.isNone(yield* readDescriptionAttachment(outsider, taskId, id)));
        assert.equal(
          (yield* keepDescriptionAttachment(outsider, taskId, PICTURE)).status,
          DESCRIPTION_ATTACHMENT_KEEP.NO_TASK,
        );
      }),
  );

  it.effect("a picture is read only under the description it was kept on", () =>
    Effect.gen(function* () {
      const first = yield* openSharedTask;
      const second = yield* openSharedTask;
      const id = keptId(yield* keepDescriptionAttachment(first.owner, first.taskId, PICTURE));

      assert.ok(Option.isNone(yield* readDescriptionAttachment(second.owner, second.taskId, id)));
    }),
  );

  it.effect(
    "a description keeps no more pictures than its bound, and one the account does not reach keeps none",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;

        for (let kept = 0; kept < DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION; kept += 1) {
          keptId(yield* keepDescriptionAttachment(owner, taskId, PICTURE));
        }

        assert.equal(
          (yield* keepDescriptionAttachment(owner, taskId, PICTURE)).status,
          DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY,
        );

        const other = yield* openSharedTask;
        assert.equal(
          (yield* keepDescriptionAttachment(owner, other.taskId, PICTURE)).status,
          DESCRIPTION_ATTACHMENT_KEEP.NO_TASK,
        );
      }),
  );

  it.effect.each([
    { contentType: PICTURE_MEDIA_TYPE.WEBM, bytes: webmBytes(1280, 800) },
    { contentType: PICTURE_MEDIA_TYPE.MP4, bytes: mp4Bytes(1206, 2622) },
  ] as const)(
    "a recording ($contentType) is kept as it was sent up to a video's bound, which a picture is not",
    (recording) =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;

        const video: Picture = {
          contentType: recording.contentType,
          bytes: paddedTo(recording.bytes, PICTURE_BOUNDS.MAX_VIDEO_BYTES),
        };

        const id = keptId(yield* keepDescriptionAttachment(owner, taskId, video));

        const read = yield* readDescriptionAttachment(teammate, taskId, id);
        assert.ok(Option.isSome(read));
        assert.equal(read.value.contentType, recording.contentType);
        assert.equal(read.value.bytes.length, PICTURE_BOUNDS.MAX_VIDEO_BYTES);

        const tooLong = {
          ...video,
          bytes: paddedTo(video.bytes, PICTURE_BOUNDS.MAX_VIDEO_BYTES + 1),
        };

        assert.ok(
          Exit.isFailure(yield* Effect.exit(keepDescriptionAttachment(owner, taskId, tooLong))),
        );

        const large: Picture = {
          contentType: PICTURE_TYPE.PNG,
          bytes: paddedTo(pngBytes(4000, 3000), PICTURE_BOUNDS.MAX_BYTES + 1),
        };

        assert.ok(
          Exit.isFailure(yield* Effect.exit(keepDescriptionAttachment(owner, taskId, large))),
        );
      }),
  );

  it.effect("a PDF is kept up to a PDF's bound, past a picture's, and read back as a PDF", () =>
    Effect.gen(function* () {
      const { owner, teammate, taskId } = yield* openSharedTask;
      const head = new TextEncoder().encode("%PDF-1.7\n");

      const pdf: DescriptionFile = {
        contentType: DESCRIPTION_FILE_TYPE.PDF,
        bytes: paddedTo(head, AGENT_BOUNDS.MAX_PDF_BYTES),
      };

      const id = keptId(yield* keepDescriptionAttachment(owner, taskId, pdf));

      const read = yield* readDescriptionAttachment(teammate, taskId, id);
      assert.ok(Option.isSome(read));
      assert.equal(read.value.contentType, DESCRIPTION_FILE_TYPE.PDF);
      assert.equal(read.value.bytes.length, AGENT_BOUNDS.MAX_PDF_BYTES);

      const tooLong = { ...pdf, bytes: paddedTo(head, AGENT_BOUNDS.MAX_PDF_BYTES + 1) };

      assert.ok(
        Exit.isFailure(yield* Effect.exit(keepDescriptionAttachment(owner, taskId, tooLong))),
      );
    }),
  );

  it.effect(
    "a description keeps no more videos than its bound of them, and pictures still beside them",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;

        for (
          let kept = 0;
          kept < DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION;
          kept += 1
        ) {
          keptId(yield* keepDescriptionAttachment(owner, taskId, VIDEO));
        }

        assert.equal(
          (yield* keepDescriptionAttachment(owner, taskId, VIDEO)).status,
          DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY_VIDEOS,
        );
        keptId(yield* keepDescriptionAttachment(owner, taskId, PICTURE));
      }),
  );

  it.effect(
    "a recording's MP4 copy is served to a member who plays MP4 and to nobody else, the WebM to one who plays WebM and in place of a copy never made, and goes with its plan",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;

        const id = keptId(
          yield* keepDescriptionAttachment(owner, taskId, { ...VIDEO, mp4Bytes: MP4 }),
        );

        const older = keptId(yield* keepDescriptionAttachment(owner, taskId, VIDEO));

        const served = (account: string, attachmentId: string, playable: PlayableVideoType) =>
          Effect.map(
            readServedDescriptionAttachment(account, taskId, attachmentId, playable),
            Option.getOrUndefined,
          );

        assert.deepEqual(yield* served(teammate, id, PLAYABLE_VIDEO_TYPE.MP4), {
          contentType: MP4_TYPE,
          bytes: MP4,
        });
        assert.deepEqual(yield* served(teammate, id, PLAYABLE_VIDEO_TYPE.WEBM), VIDEO);
        assert.deepEqual(yield* served(teammate, older, PLAYABLE_VIDEO_TYPE.MP4), VIDEO);
        assert.equal(yield* served(outsider, id, PLAYABLE_VIDEO_TYPE.MP4), undefined);

        assert.ok(yield* deleteTask(owner, taskId));
        const db = yield* Database;
        assert.deepEqual(
          yield* db.select({ id: attachment.id }).from(attachment).where(eq(attachment.id, id)),
          [],
        );
      }),
  );
});
