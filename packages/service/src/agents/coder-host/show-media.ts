import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { keepConversationPictures } from "@repo/database/models/conversation-pictures";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { asPictureList } from "@repo/features/agent-pictures-model";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  CONVERSATION_PICTURE_BOUNDS,
  isPlayedType,
  type KeptPicture,
} from "@repo/features/conversation-picture-wire";
import { INBOX_BOUNDS } from "@repo/features/inbox-wire";
import { measuredMedia, sniffMediaType } from "@repo/features/media-signature";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { type InboxSandboxDoor, phoneCopyOfSandbox, readSandboxImage } from "./inbox-image.js";
import { writeManagerSaid } from "./manager-chat-row.js";

/**
 * show-media.ts -- a coding agent or its worker shows the developer pictures, recordings, and sound clips from its sandbox, kept beside its transcript as one set.
 *
 * The agent names each file by its path and says in a line what it shows;
 * the service reads each through the same door the agent's file tools reach
 * the sandbox by (`inbox-image.ts`), each held to its type's bound, a
 * still to a thread's so that it may be posted as shown, and to the three
 * types, a recording the agent made of what it did, a WebM or an H.264
 * MP4, which the transcript plays in a picture's place, or a sound clip it
 * made, a WAV, an MP3, an M4A, an AAC stream, or an Ogg, which the
 * transcript plays as sound. A WebM is kept with an MP4 of it made in the
 * sandbox for a phone, and an Ogg with an AAC M4A of it, since a phone plays
 * neither. Each is measured, its type settled from all of its bytes (an
 * MP4 that holds sound and no video is an M4A clip), and kept beside the
 * transcript the call is written to (`conversation-pictures.ts`), the
 * agent's own or its worker's. The answer names each kept file by id,
 * never by its bytes, so the record carries an id, and the developer's
 * window draws the set from it. The model is answered in words and ids
 * alone: it made the files, and reads one back with `read_file` when it
 * wants to look. A clip is for the developer to hear, since no model hears
 * sound. A call is shown whole or not at all: the first file refused
 * refuses the call in one sentence the model can act on, naming the path,
 * before anything is kept, and a set the transcript has room for only part
 * of keeps none of it. A set a Manager shows in its own transcript is also
 * written to its chat as a row of no words before the call answers
 * (`manager-chat-row.ts`), and the answer names that row's id.
 */

/** Why a call showed nothing, in the words the model reads; a sentence ending in a colon is followed by the path. */
export const SHOW_MEDIA_REFUSAL = {
  UNREADABLE: `Not shown: give images as a list of 1 to ${CONVERSATION_PICTURE_BOUNDS.MAX_PER_CALL} items, each a path in your sandbox and a caption of one line of at most ${INBOX_BOUNDS.MAX_ALT_CHARS} characters.`,
  NO_FILE: "Not shown: no such file in your sandbox:",
  NOT_IMAGE:
    "Not shown: that file is not a PNG, JPEG, or WebP image whose header states its size, a WebM or H.264 MP4 video whose video track states its size, or a WAV, MP3, M4A, AAC, or Ogg sound clip:",
  TOO_LARGE: `Not shown: a picture is kept up to ${INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000} MB, and a video or a sound clip up to ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB. Take a picture smaller, such as the viewport only, or as a JPEG; record a video or a sound clip shorter or smaller, such as a clip as an M4A or an MP3; and show it again:`,
  UNREADABLE_FILE: "Not shown: that file could not be read from your sandbox:",
  FULL: `Not shown: this transcript already keeps ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION / 1_000_000} MB of pictures, recordings, and sound clips, as many as it may.`,
  UNAVAILABLE: "Not shown: the files could not be kept just now. The call may be made again.",
} as const;

const SHOW_MEDIA_INPUT = Schema.Struct({
  images: describeWire(
    Schema.Array(
      Schema.Struct({
        path: describeWire(
          Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(INBOX_BOUNDS.MAX_PATH_CHARS)),
          "The file in your sandbox, relative to the checkout or absolute: a PNG, JPEG, or WebP picture, a WebM or MP4 video, or a WAV, MP3, M4A, AAC, or Ogg sound clip.",
        ),
        caption: describeWire(
          Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(INBOX_BOUNDS.MAX_ALT_CHARS)),
          "What the file shows, or a clip holds, in one line: its caption under it and its words for a reader who cannot see or hear it.",
        ),
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(CONVERSATION_PICTURE_BOUNDS.MAX_PER_CALL)),
    "The files to show, in the order they are read; several shown in one call stand together as one set.",
  ),
});

export const SHOW_MEDIA_TOOL = {
  name: AGENT_TOOL.SHOW_MEDIA,
  description:
    "Show the developer pictures, recordings, and sound clips from your sandbox in your transcript: " +
    "pictures after a change to anything they can see, such as screenshots of a UI you changed, taken first with the installed " +
    "`playwright screenshot <url> <file>`, each named by its path with a one-line caption saying " +
    "what it shows. Show the pictures " +
    "that belong together in one call, as one set: before and after, or each screen a change touches. " +
    "A flow, such as clicking through a form, is shown as a WebM recording, such as Playwright's `page.screencast.start({ path })` once the page has drawn, which the transcript plays. " +
    "A sound clip you made, such as a voice or a sound effect, is shown the same way, for the developer to hear: " +
    "no model hears sound, so its caption says what it holds. " +
    `Each is a PNG, JPEG, or WebP of at most ${INBOX_BOUNDS.MAX_IMAGE_BYTES / 1_000_000} MB, or a WebM or MP4 video or a WAV, MP3, M4A, AAC, or Ogg sound clip of at most ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB. ` +
    "Never show a picture of a secret. A Markdown image in your reply shows nothing; this is the one " +
    "way to show a picture, a recording, or a sound clip in your transcript. " +
    `It answers each file's id, which ${AGENT_TOOL.POST_THREAD} draws in place of a path, so another agent of your workspace you hand the id to may draw it in its own thread.`,
  inputSchema: SHOW_MEDIA_INPUT,
} as const;

/** A call that showed nothing, and why. */
function showMediaRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The Manager whose chat a set it shows stands in, and the key its call runs under, which keys the set's row. */
export interface ShowMediaChat {
  readonly manager: Agent;
  readonly clientKey: Effect.Effect<string, StoreFailure, DatabaseServices>;
}

/** Where one call's files are read from and kept: the transcript it is written to, the sandbox it names files in, and the chat the set stands in, where a Manager shows it. */
export interface ShowMediaBinding {
  readonly target: ConversationTarget;
  readonly sandbox: InboxSandboxDoor;
  readonly chat?: ShowMediaChat | undefined;
}

/** One file read and measured, ready to keep, with a recording's MP4 or an Ogg clip's M4A where its sandbox made one. */
interface ReadPicture {
  readonly bytes: Uint8Array;
  readonly contentType: KeptPicture["mediaType"];
  readonly width: number;
  readonly height: number;
  readonly mp4Bytes?: Uint8Array | undefined;
}

/** The file at the path, read, held to the bound, and measured, a WebM or an Ogg with its copy for a phone made beside it; or the sentence refusing it. */
function readPicture(
  binding: ShowMediaBinding,
  path: string,
): Effect.Effect<Result.Result<ReadPicture, string>> {
  return Effect.flatMap(measuredPicture(binding, path), (read) =>
    Result.isFailure(read)
      ? Effect.succeed<Result.Result<ReadPicture, string>>(read)
      : Effect.map(
          phoneCopyOfSandbox(binding.sandbox, path, read.success.contentType),
          (mp4Bytes) => Result.succeed({ ...read.success, mp4Bytes }),
        ),
  );
}

/** The file at the path, read, held to its type's bound, and measured, its type settled from all of its bytes; or the sentence refusing it. */
function measuredPicture(
  binding: ShowMediaBinding,
  path: string,
): Effect.Effect<Result.Result<ReadPicture, string>> {
  return Effect.map(
    readSandboxImage(binding.sandbox, path, {
      maxBytes: CONVERSATION_PICTURE_BOUNDS.MAX_BYTES,
      sniff: sniffMediaType,
      refusals: {
        NO_FILE: SHOW_MEDIA_REFUSAL.NO_FILE,
        NOT_IMAGE: SHOW_MEDIA_REFUSAL.NOT_IMAGE,
        TOO_LARGE: SHOW_MEDIA_REFUSAL.TOO_LARGE,
        UNREADABLE: SHOW_MEDIA_REFUSAL.UNREADABLE_FILE,
      },
    }),
    Result.flatMap((file) => {
      const measured = measuredMedia(file.bytes, file.contentType);

      if (measured === undefined) return Result.fail(`${SHOW_MEDIA_REFUSAL.NOT_IMAGE} ${path}`);

      // Note that a still is held to a thread's bound, because one shown here is posted as it is.
      if (
        !isPlayedType(measured.contentType) &&
        file.bytes.byteLength > INBOX_BOUNDS.MAX_IMAGE_BYTES
      ) {
        return Result.fail(`${SHOW_MEDIA_REFUSAL.TOO_LARGE} ${path}`);
      }

      return Result.succeed({ bytes: file.bytes, ...measured });
    }),
  );
}

/**
 * Every picture kept, in order, in one transaction; nothing where the
 * transcript has room for only part of the set. Note that the set is kept
 * in one transaction, because its budget is read before its rows are
 * written.
 */
function keepAll(
  target: ConversationTarget,
  pictures: readonly ReadPicture[],
): Effect.Effect<Option.Option<readonly KeptPicture[]>, TaskStoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(keepConversationPictures(target, pictures)),
  );
}

/**
 * One `show_media` call: every file read before any is kept, so a refused
 * file shows nothing; then each kept beside the transcript in the order
 * given, the same bytes answered as the row already kept. A store that
 * fails answers that the call may be made again, as a page's does.
 */
export function runShowMedia(
  binding: ShowMediaBinding,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const read = readEither(SHOW_MEDIA_INPUT)(asPictureList(input));

    if (Result.isFailure(read)) return showMediaRejected(SHOW_MEDIA_REFUSAL.UNREADABLE);
    const pictures: ReadPicture[] = [];

    for (const image of read.success.images) {
      const picture = yield* readPicture(binding, image.path);

      if (Result.isFailure(picture)) return showMediaRejected(picture.failure);
      pictures.push(picture.success);
    }

    const kept = yield* keepAll(binding.target, pictures);

    if (Option.isNone(kept)) return showMediaRejected(SHOW_MEDIA_REFUSAL.FULL);

    const answer = {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      pictures: kept.value.map((each) => ({ ...each })),
    };

    if (binding.chat === undefined) return answer;

    // Note that a Manager's set stands in its chat as a row of no words, written before the call answers.
    const written = yield* writeManagerSaid(binding.chat.manager, {
      clientKey: yield* binding.chat.clientKey,
      text: "",
      attachments: kept.value.map((each, index) => {
        const caption = read.success.images[index]?.caption;

        return caption === undefined
          ? { id: each.id, mediaType: each.mediaType }
          : { id: each.id, mediaType: each.mediaType, caption };
      }),
    });

    if (Option.isNone(written)) return showMediaRejected(SHOW_MEDIA_REFUSAL.UNAVAILABLE);

    return { ...answer, message_id: written.value };
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(showMediaRejected(SHOW_MEDIA_REFUSAL.UNAVAILABLE))),
  );
}
