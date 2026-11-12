import type { DatabaseServices } from "@repo/database/core/query";
import { readDescriptionAttachment } from "@repo/database/models/description-attachments";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import { type DescriptionFile, isPdfFile } from "@repo/features/description-attachment-wire";
import { type InboxAttachmentRef, inboxAttachmentOf } from "@repo/features/inbox-attachment-link";
import { LINK_ORIGIN } from "@repo/features/link-home";
import {
  type PictureType,
  pictureMediaTypeSchema,
  pictureTypeSchema,
} from "@repo/features/picture-wire";
import { type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { logStoreFailure } from "../http/store-failure.js";
import { readInboxAttachment } from "../inbox/inbox-store.js";
import type { DescriptionDocumentBinding } from "./description-notes.js";

/**
 * picture-look.ts -- `look_at_picture`, a model's eyes on one of the description's pictures: the picture its text names, handed back as an image.
 *
 * A picture stands in a description's text as `![alt](<address> "caption")`
 * (`@repo/features/description-attachment-link`), so every model that reads the
 * description, the planning model's turn and a coding agent's brief alike, already
 * reads what each picture shows in its alt text and caption. Most never need
 * more, and a picture is a large cost in a model's context, so the picture
 * itself is not sent with the description: the model names one by its address when
 * the words are not enough.
 *
 * The picture is read as the account the turn runs as, through the plan's
 * membership gate (`readDescriptionAttachment`), and only under the description the call
 * is bound to: an address of another description, or of a picture that description does
 * not hold, is refused alike. A coding agent's door binds a call to the
 * plan its address names (`lookedTaskOf`), once that plan stands in the
 * agent's own workspace (`../agents/coder-host/agent-doors.ts`), so an
 * agent sees a picture in any description of its workspace, its own task's or
 * another's.
 *
 * A description may hold a video an agent recorded, which no model is handed in any
 * form: a look at one is refused, pointing the model at its alt text and
 * caption; so is a look at a PDF kept there, whose refusal names it a file
 * the model cannot open, and the MCP door hands on a look only of an image's type,
 * turning any other into that refusal (`lookNamedOnly`), so a video could
 * not reach a model even were it answered, as an image nor as its base64
 * spelled out.
 *
 * The result and its view name a picture and nothing of a description, so a
 * look at any other picture we keep answers in the same words.
 */

const PICTURE_LOOK = {
  /** The longest address a call may name; a picture's address is well under it. */
  MAX_ADDRESS_CHARS: 512,
} as const;

/** Why a call shows nothing, in words the model can act on. */
export const PICTURE_LOOK_REFUSAL = {
  UNREADABLE: "Not looked: name the picture by its address, copied from the text it stands in.",
  ELSEWHERE: "Not looked: that address is not a picture of your workspace that you may see.",
  NO_PICTURE: "Not looked: that description holds no such picture.",
  NO_THREAD_PICTURE: "Not looked: that thread holds no such picture.",
  VIDEO:
    "Not looked: that address is a video, which is never shown to a model. Its alt text and caption in the description's text say what it shows.",
  PDF: "Not looked: that address is a PDF kept in the description, a file you cannot open yet. Its name is the alt text of its ![name](address) line, under the heading it stands in; tell the member you could not read it rather than guess at what it holds.",
  UNAVAILABLE: "Not looked: the picture could not be read just now. The call may be made again.",
} as const;

export const PICTURE_LOOK_STATUS = {
  LOOKED: "looked",
  NOT_LOOKED: "not-looked",
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type PictureLookResult =
  | {
      readonly status: typeof PICTURE_LOOK_STATUS.LOOKED;
      readonly mediaType: PictureType;
      readonly image: string;
    }
  | { readonly status: typeof PICTURE_LOOK_STATUS.NOT_LOOKED; readonly reason: string };

/** A thread's picture's address, as its message writes it. */
const THREAD_ADDRESS = `${LINK_ORIGIN}/<workspace>/task/<task>/inbox/<thread>/files/<picture>`;

/** What a look's address and the tool's own words say, in a workspace with Task descriptions on, and off, where they name threads alone. */
const LOOK_WORDS = {
  on: {
    address: `The picture's address exactly as the description's or the thread's text writes it, inside its ![alt](address): ${LINK_ORIGIN}/<workspace>/task/<task>/files/<picture> in a description, or under /plan/ in place of /task/ for a picture written before the rename; ${THREAD_ADDRESS} in a thread's message.`,
    tool: "See one of the pictures in a description of your workspace, your own task's or another's, or in a message of a thread",
  },
  off: {
    address: `The picture's address exactly as the thread's text writes it, inside its ![alt](address): ${THREAD_ADDRESS}.`,
    tool: "See one of the pictures in a message of a thread",
  },
} as const;

/** The longest address a look takes, as every input of it bounds it. */
const ADDRESS = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(PICTURE_LOOK.MAX_ADDRESS_CHARS),
);

function lookInputOf(words: string) {
  return Schema.Struct({ address: describeWire(ADDRESS, words) });
}

const LOOK_INPUT = lookInputOf(LOOK_WORDS.on.address);

const THREAD_LOOK_INPUT = lookInputOf(LOOK_WORDS.off.address);

// Note that either input reads one way, since they differ in their words alone.
const readInput = readEither(LOOK_INPUT);

/** The tool's words, opening as the workspace's experiments word them. */
function lookWordsOf(opening: string): string {
  return (
    `${opening} ${AGENT_TOOL.READ_THREAD} reads, such as a screenshot or a mockup, by the address its text writes it at. ` +
    'Every picture is written as ![alt text](address "caption"), and its alt text and caption ' +
    "already say what it shows: look only when they do not tell you enough for what you are " +
    "doing. Answers the picture, or `not-looked` and why."
  );
}

/** The tool as a coding agent is offered it where its workspace has Task descriptions on: its name, its words, and its input schema. */
export const LOOK_AT_PICTURE_TOOL = {
  name: AGENT_TOOL.LOOK_AT_PICTURE,
  description: lookWordsOf(LOOK_WORDS.on.tool),
  inputSchema: LOOK_INPUT,
} as const;

/** The tool in the words of the agent's workspace's experiments: a thread's pictures alone where Task descriptions are off. */
export function lookAtPictureToolOf(on: { readonly descriptionsOn: boolean }) {
  if (on.descriptionsOn) return LOOK_AT_PICTURE_TOOL;

  return {
    name: AGENT_TOOL.LOOK_AT_PICTURE,
    description: lookWordsOf(LOOK_WORDS.off.tool),
    inputSchema: THREAD_LOOK_INPUT,
  } as const;
}

/** The plan a call's address names, whose picture it looks at; nothing where the call names no picture's address. */
export function lookedTaskOf(input: UnparsedWireValue): string | undefined {
  const read = readInput(input);

  return Result.isSuccess(read)
    ? descriptionAttachmentOf(read.success.address.trim())?.taskId
    : undefined;
}

/** The thread's picture a call's address names; nothing where it names no thread's picture. */
export function lookedThreadPictureOf(input: UnparsedWireValue): InboxAttachmentRef | undefined {
  const read = readInput(input);

  return Result.isSuccess(read) ? inboxAttachmentOf(read.success.address.trim()) : undefined;
}

/** A call that showed nothing, and why. */
export function pictureNotLooked(reason: string): PictureLookResult {
  return { status: PICTURE_LOOK_STATUS.NOT_LOOKED, reason };
}

const isImageType = Schema.is(pictureTypeSchema);

/** Whether a kept file is a picture, an image or a video, rather than any other file a message carried. */
const isPictureMediaType = Schema.is(pictureMediaTypeSchema);

/** A picture as a look answers it: an image's type and its bytes in base64, or the refusal of a video or a PDF, whose bytes go nowhere. */
function looked(picture: DescriptionFile): PictureLookResult {
  if (isPdfFile(picture)) return pictureNotLooked(PICTURE_LOOK_REFUSAL.PDF);

  if (!isImageType(picture.contentType)) {
    return pictureNotLooked(PICTURE_LOOK_REFUSAL.VIDEO);
  }

  return {
    status: PICTURE_LOOK_STATUS.LOOKED,
    mediaType: picture.contentType,
    image: Base64.encode(picture.bytes),
  };
}

/**
 * One call of `look_at_picture`: the picture the address names, where it is
 * an image of the description the call is bound to that the account reads;
 * `not-looked` and why otherwise, a video among them.
 */
export function runLookAtPicture(
  description: DescriptionDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  const read = readInput(input);

  if (Result.isFailure(read))
    return Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE));
  const named = descriptionAttachmentOf(read.success.address.trim());

  if (named === undefined || named.taskId !== description.taskId) {
    return Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE));
  }

  return readDescriptionAttachment(description.userId, description.taskId, named.attachmentId).pipe(
    Effect.map((picture) =>
      Option.isNone(picture)
        ? pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_PICTURE)
        : looked(picture.value),
    ),
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNAVAILABLE))),
  );
}

/**
 * One look at a thread's picture: the picture of the message the reference
 * names, where it is an image of a thread the account may read; `not-looked`
 * and why otherwise, a video among them, and a file that is no picture.
 * Note that the thread's workspace is its caller's to hold to the agent's.
 */
export function runLookAtThreadPicture(
  userId: string,
  named: InboxAttachmentRef,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  return readInboxAttachment(userId, named.itemId, named.attachmentId).pipe(
    Effect.map((file) => {
      if (Option.isNone(file)) return pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_THREAD_PICTURE);
      const { contentType, bytes } = file.value;

      if (isImageType(contentType)) return looked({ contentType, bytes });

      return isPictureMediaType(contentType)
        ? pictureNotLooked(PICTURE_LOOK_REFUSAL.VIDEO)
        : pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_THREAD_PICTURE);
    }),
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNAVAILABLE))),
  );
}

/** A look that answered a picture, as the store's view reads one: by its status alone, so nothing of a picture is kept whatever else it carries. */
const LookedSchema = Schema.Struct({ status: Schema.Literal(PICTURE_LOOK_STATUS.LOOKED) });

const isLookedStatus = Schema.is(LookedSchema);

/** A look's picture, as the model's view reads one: an image's type alone. */
const isLooked = Schema.is(
  Schema.Struct({ ...LookedSchema.fields, mediaType: pictureTypeSchema, image: Schema.String }),
);

/**
 * A result that is no image's look, as a model may be handed it: a look
 * answering anything but an image becomes the video's refusal, so what
 * else it carries never reaches a model as text, and any other result
 * stands as it is.
 */
export function lookNamedOnly(output: UnparsedWireValue): UnparsedWireValue {
  return isLookedStatus(output) && !isLooked(output)
    ? unparsedWire(pictureNotLooked(PICTURE_LOOK_REFUSAL.VIDEO))
    : output;
}
