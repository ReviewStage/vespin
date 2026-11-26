import { LEGACY_APP_WORD, type WireBoundaryInput } from "@repo/wire";
import type { ProviderMetadata } from "ai";
import { Schema as EffectSchema, Option } from "effect";
import { AUDIO_TYPE, type AudioType } from "./audio-signature.js";
import { INBOX_IMAGE_TYPE } from "./inbox-wire.js";
import { MP4_TYPE, WEBM_TYPE } from "./video-signature.js";

/**
 * conversation-picture-wire.ts -- a picture a transcript names: how a tool's stored output or a line's image names one the service kept beside the conversation, and why one was not kept.
 *
 * A tool may answer a model with a picture, as an integration's MCP tool
 * answers an image block. The model sees the picture where the agent's
 * harness hands it over; the record keeps it once, as a row beside the conversation
 * (`attachment`), and the stored output names that row in the
 * picture's place, never the bytes, which would otherwise ride every read,
 * journal amend, and long poll of the transcript. A picture the service did
 * not keep is named by why, with its size, so a reader can say so. An image
 * a coding agent is handed on a line is kept the same way, and its file part
 * in the row names the row under the provider key below
 * (`keptPictureIdOf`).
 *
 * The bounds are the policy, held here alone so moving one is one edit:
 * the byte bound is also the check on the table's column, so moving it is
 * that edit and the migration `pnpm db:generate` writes for it.
 */

/**
 * The most a conversation keeps of the pictures its tools answered. A
 * picture is bounded under the 4.5 MB a Vercel function may answer, since
 * its read serves the bytes whole; a conversation is bounded by bytes
 * rather than by count, as the tools a developer already uses bound theirs
 * by storage, so an agent that shows many small screenshots is never cut
 * off before one that shows a few large ones.
 */
export const CONVERSATION_PICTURE_BOUNDS = {
  /** The most bytes one picture is kept at, as the tool answered it; a larger one is named, not kept. */
  MAX_BYTES: 4_000_000,
  /** The most bytes of pictures one conversation keeps; a picture past them is named, not kept. */
  MAX_BYTES_PER_CONVERSATION: 200_000_000,
  /** The most pictures one `show_media` call shows, as one set. */
  MAX_PER_CALL: 20,
} as const;

/** Why a picture a tool answered was not kept. */
export const PICTURE_OMISSION = {
  /** Its bytes were over `MAX_BYTES`. */
  TOO_LARGE: "too-large",
  /** Keeping it would take the conversation past `MAX_BYTES_PER_CONVERSATION`. */
  LIMIT: "limit",
  /** Its bytes are no PNG, JPEG, or WebP whose header states its size. */
  UNSUPPORTED: "unsupported",
} as const;

export type PictureOmission = (typeof PICTURE_OMISSION)[keyof typeof PICTURE_OMISSION];

/**
 * What a transcript's picture may be: one of the three pictures, a
 * recording an agent made of what it did, a WebM of its browser or an H.264
 * MP4 of an app on the developer's Mac, or a sound clip it made, one of the
 * audio types Chromium decodes (`audio-signature.ts`), each shown as a
 * picture is and kept under the same bounds, which the transcript plays
 * where it would draw a picture. Note that a sound clip is named here before
 * the service keeps one, because a client released before it could read
 * one would draw it as a picture that never loads.
 */
export const CONVERSATION_MEDIA_TYPE = {
  ...INBOX_IMAGE_TYPE,
  WEBM: WEBM_TYPE,
  MP4: MP4_TYPE,
  ...AUDIO_TYPE,
} as const;

/** The recordings a transcript plays, by the media type each is kept under. */
const VIDEO_TYPES: ReadonlySet<string> = new Set([
  CONVERSATION_MEDIA_TYPE.WEBM,
  CONVERSATION_MEDIA_TYPE.MP4,
]);

/** The sound clips a transcript plays, by the media type each is kept under. */
const AUDIO_TYPES: ReadonlySet<string> = new Set(Object.values(AUDIO_TYPE));

export type ConversationMediaType =
  (typeof CONVERSATION_MEDIA_TYPE)[keyof typeof CONVERSATION_MEDIA_TYPE];

/** A transcript picture's media type as the wire carries it. */
export const conversationMediaTypeSchema = EffectSchema.Literals(
  Object.values(CONVERSATION_MEDIA_TYPE),
);

/** Whether a transcript's picture is a video, played rather than drawn. */
export function isVideoType(
  mediaType: string,
): mediaType is typeof CONVERSATION_MEDIA_TYPE.WEBM | typeof CONVERSATION_MEDIA_TYPE.MP4 {
  return VIDEO_TYPES.has(mediaType);
}

/**
 * Whether a transcript's or a thread's media is played rather than drawn, a
 * recording or a sound clip, which is never handed to a model as an image.
 */
export function isPlayedType(
  mediaType: string,
): mediaType is
  | typeof CONVERSATION_MEDIA_TYPE.WEBM
  | typeof CONVERSATION_MEDIA_TYPE.MP4
  | AudioType {
  return isVideoType(mediaType) || isAudioType(mediaType);
}

/** Whether a transcript's or a thread's media is a sound clip, played rather than drawn, and never handed to a model. */
export function isAudioType(mediaType: string): mediaType is AudioType {
  return AUDIO_TYPES.has(mediaType);
}

/** A kept picture as a stored output names it: the row, the type its bytes were sniffed to be, its size in pixels (zero by zero for a sound clip, which has none), and its size in bytes. */
export const keptPictureSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  mediaType: conversationMediaTypeSchema,
  width: EffectSchema.Number,
  height: EffectSchema.Number,
  byteCount: EffectSchema.Number,
});

export type KeptPicture = typeof keptPictureSchema.Type;

/**
 * The provider key an image file part of a coding agent's line names what
 * was kept of its picture under, which no provider reads
 * (`packages/database/src/models/attached-file-parts.ts`).
 */
export const KEPT_IMAGE_PROVIDER_KEY = "app";

/**
 * A settled tool part's `resultProviderMetadata` with the pictures its
 * answer carried, which the agent's runner kept beside the transcript apart
 * from its events, named under the same key beside what it already names
 * there (an out-of-memory mark, `out-of-memory-wire.ts`). Note that the
 * answer's own text keeps its stand-in for each, so a client built before
 * them reads the part as it always did.
 */
export function withKeptPictures(
  metadata: ProviderMetadata | undefined,
  pictures: readonly KeptPicture[],
): ProviderMetadata {
  return {
    ...metadata,
    [KEPT_IMAGE_PROVIDER_KEY]: {
      ...metadata?.[KEPT_IMAGE_PROVIDER_KEY],
      pictures: pictures.map((picture) => ({ ...picture })),
    },
  };
}

/** What an image file part names of its picture under that key: the attachment it was kept as, or why it was not kept. */
const keptImageSchema = EffectSchema.Union([
  EffectSchema.Struct({ attachmentId: EffectSchema.String }),
  EffectSchema.Struct({ omitted: EffectSchema.Literals(Object.values(PICTURE_OMISSION)) }),
]);

/**
 * An image file part's provider metadata, naming what was kept of its
 * picture. Note that a part kept before the app was named `app` names it
 * under `luke`, which is still read (a legacy read) and never written.
 */
const keptImageMetadataSchema = EffectSchema.Union([
  EffectSchema.Struct({ [KEPT_IMAGE_PROVIDER_KEY]: keptImageSchema }),
  EffectSchema.Struct({ [LEGACY_APP_WORD]: keptImageSchema }),
]);

const readKeptImageMetadata = EffectSchema.decodeUnknownOption(keptImageMetadataSchema);

/** What an image file part's provider metadata names of its picture, under today's key or the legacy one; none where it names none. */
export function keptImageMetadataOf(
  providerMetadata: WireBoundaryInput,
): typeof keptImageSchema.Type | undefined {
  const read = Option.getOrUndefined(readKeptImageMetadata(providerMetadata));

  if (read === undefined) return undefined;

  return KEPT_IMAGE_PROVIDER_KEY in read ? read[KEPT_IMAGE_PROVIDER_KEY] : read[LEGACY_APP_WORD];
}

/** The id of the picture an image file part's provider metadata names it kept as; none where it names none. */
export function keptPictureIdOf(providerMetadata: WireBoundaryInput): string | undefined {
  const kept = keptImageMetadataOf(providerMetadata);

  return kept !== undefined && "attachmentId" in kept ? kept.attachmentId : undefined;
}
