import { Schema as EffectSchema, Result } from "effect";
import { Base64 } from "effect/encoding";
import { AUDIO_TYPE, type AudioType, sniffAudioType } from "./audio-signature.js";
import { MAX_REQUEST_DATA_URL_BYTES } from "./request-body-limit.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * sound-clip-wire.ts -- the sounds an account keeps of its own, each a clip it names, which either of its two sounds may play: the types a clip may be, its bounds, the one reading of the `data:` URL it is sent as, and what adding, naming, removing, reading, and choosing one ask and answer.
 *
 * An account keeps as many sounds as it adds, each a clip
 * Settings sends as a `data:` URL of one of `SOUND_CLIP_TYPE`, labeled with
 * the type its own bytes were sniffed to be (`audio-signature.ts`), under a
 * name the member gives it; the service sniffs the bytes again, keeps them
 * with the name, and answers them to the account alone. Each of its two
 * sounds (`SOUND_CLIP_SLOT`) may be set to play one of them, which a
 * choice records. The file's own name is never sent; Settings only offers
 * it as the name to start from.
 *
 * A sound is named on the account's live read by its id, its name, and the
 * hex SHA-256 of its bytes (`account-preferences-live.ts`), so a client
 * holding one fetches it again only once that changed.
 */

/** The sounds a clip of the account's own may stand for, one clip each: an agent's finish, and something that needs the account. */
export const SOUND_CLIP_SLOT = {
  FINISH: "finish",
  ASK: "ask",
} as const;

export type SoundClipSlot = (typeof SOUND_CLIP_SLOT)[keyof typeof SOUND_CLIP_SLOT];

/** A clip's slot as the wire carries it. */
export const soundClipSlotSchema = EffectSchema.Literals(Object.values(SOUND_CLIP_SLOT));

/** The query a sound's read and removal name it under, since neither carries a body. */
export const SOUND_CLIP_QUERY = { ID: "id" } as const;

/** A sound's id as the wire carries it. */
export const soundIdSchema = wireUuidSchema;

/** The types a clip may be: sent as a `data:` URL of one, kept as its bytes, served under it. */
export const SOUND_CLIP_TYPE = AUDIO_TYPE;

export type SoundClipType = AudioType;

/** A clip's media type as the wire carries it. */
export const soundClipTypeSchema = EffectSchema.Literals(Object.values(SOUND_CLIP_TYPE));

export const SOUND_CLIP_BOUNDS = {
  /**
   * The most bytes a clip may hold, decoded: the most a request sent as
   * base64 can carry and its read answer, since base64 spells three bytes in
   * four characters and a Vercel function is sent and answers at most 4.5
   * MB, the bound a sent video is held to (`picture-wire.ts`). It is no
   * choice of ours: no bound is set on how long a clip plays, or how many an
   * account keeps.
   */
  MAX_BYTES: MAX_REQUEST_DATA_URL_BYTES,
  /** The most characters a sound's name holds, as other names are bounded. */
  MAX_NAME_CHARS: 64,
} as const;

/** A sound's name as the wire carries it: trimmed, and one to `MAX_NAME_CHARS` characters. */
export const soundNameSchema = EffectSchema.Trim.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(SOUND_CLIP_BOUNDS.MAX_NAME_CHARS),
);

/** A clip as a `data:` URL spells it: its media type, then its bytes in base64. */
const SOUND_CLIP_DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u;

const isSoundClipType = EffectSchema.is(soundClipTypeSchema);

/** A clip, as its bytes under its media type. */
export interface SoundClip {
  readonly contentType: SoundClipType;
  readonly bytes: Uint8Array;
}

/**
 * The clip a `data:` URL holds, where its type is one of `SOUND_CLIP_TYPE`
 * and its bytes' signature says that same type; nothing for any other
 * text. The one reading of a clip's URL, for the clip sent and the clip
 * kept.
 */
export function soundClipOfDataUrl(text: string): SoundClip | undefined {
  const [, contentType, base64] = SOUND_CLIP_DATA_URL.exec(text) ?? [];

  if (contentType === undefined || base64 === undefined || !isSoundClipType(contentType)) {
    return undefined;
  }

  const bytes = Base64.decode(base64);

  if (Result.isFailure(bytes) || sniffAudioType(bytes.success) !== contentType) return undefined;

  return { contentType, bytes: bytes.success };
}

/** A clip to keep, as the `data:` URL it is sent as: one `soundClipOfDataUrl` reads, within `SOUND_CLIP_BOUNDS.MAX_BYTES`. */
export const soundClipDataUrlSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((text: string) => {
    const clip = soundClipOfDataUrl(text);

    return clip !== undefined && clip.bytes.length <= SOUND_CLIP_BOUNDS.MAX_BYTES;
  }),
);

/** A sound the account keeps, as the live read and a write answer it: its id, its name, and the hash of its bytes. */
export const soundSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
  sha256: EffectSchema.String,
});

export type Sound = typeof soundSchema.Type;

/** A sound added to the account's own (POST): its name, its clip, and, where the press that added it was a sound's, the sound to play it as at once. */
export const soundAddRequestSchema = EffectSchema.Struct({
  name: soundNameSchema,
  clip: soundClipDataUrlSchema,
  slot: EffectSchema.optionalKey(soundClipSlotSchema),
});

export type SoundAddRequest = typeof soundAddRequestSchema.Type;

/** A sound added, as the service answers: the sound kept. */
export const soundAddAnswerSchema = EffectSchema.Struct({ sound: soundSchema });

export type SoundAddAnswer = typeof soundAddAnswerSchema.Type;

/** A sound of the account's renamed (PATCH). */
export const soundRenameRequestSchema = EffectSchema.Struct({
  id: soundIdSchema,
  name: soundNameSchema,
});

export type SoundRenameRequest = typeof soundRenameRequestSchema.Type;

/** A sound renamed or removed, as the service answers: the sound as it now stands, or null where the account keeps no such sound. */
export const soundStateSchema = EffectSchema.Struct({ sound: EffectSchema.NullOr(soundSchema) });

export type SoundState = typeof soundStateSchema.Type;

/** Which of the account's sounds one of its two sounds plays (PUT), or none to let it go. */
export const soundChoiceRequestSchema = EffectSchema.Struct({
  slot: soundClipSlotSchema,
  id: EffectSchema.NullOr(soundIdSchema),
});

export type SoundChoiceRequest = typeof soundChoiceRequestSchema.Type;

/** A choice as the service answers it: the sound the slot now plays, or null where none, a sound the account keeps no longer among it. */
export const soundChoiceAnswerSchema = EffectSchema.Struct({
  slot: soundClipSlotSchema,
  id: EffectSchema.NullOr(EffectSchema.String),
});

export type SoundChoiceAnswer = typeof soundChoiceAnswerSchema.Type;

/** A sound's clip as its read answers it (GET): its bytes in base64 under its type, with their SHA-256, or null where the account keeps no such sound. */
export const soundClipAnswerSchema = EffectSchema.Struct({
  clip: EffectSchema.NullOr(
    EffectSchema.Struct({
      contentType: soundClipTypeSchema,
      base64: EffectSchema.String,
      sha256: EffectSchema.String,
    }),
  ),
});

export type SoundClipAnswer = typeof soundClipAnswerSchema.Type;
