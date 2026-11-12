/**
 * sounds-procedures.ts -- the sounds an account keeps of its own: one's clip read back, one added under its name, renamed, and removed, and one chosen for either of its two sounds.
 *
 * Each resolves the caller before it touches a row, and every row it
 * touches is the caller's own, so no account reads, renames, removes, or
 * chooses another's sound: one of another account's answers as one that is
 * not there. An add reads the clip off its `data:` URL as the wire does
 * (`@repo/features/sound-clip-wire`), its type sniffed from its bytes, and
 * refuses one that does not read as invalid. No bound is set on how many
 * sounds an account keeps or how long one plays; a clip is held only to the
 * bytes a request can carry. Nothing of a sound, its bytes, its name, or
 * its hash, is counted, traced, or logged here.
 */

import {
  addSound,
  chooseSound,
  readSoundClip,
  removeSound,
  renameSound,
} from "@repo/database/models/account-sounds";
import { SOUND_CLIP_QUERY, soundClipOfDataUrl } from "@repo/features/sound-clip-wire";
import { Effect, Option } from "effect";
import { Base64 } from "effect/encoding";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

/** What the sounds' procedures reach beyond the store: who the bearer is. */
export interface SoundsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** What a removal answers: the sound is no longer kept. */
const GONE = { sound: null } as const;

export function soundsProcedures(seams: SoundsProcedureSeams) {
  const signedIn = hosted.account.use(accountMiddleware(seams.resolveUserId));

  return {
    sound: signedIn.sound.effect(function* ({ context, input }) {
      const kept = yield* hostedStoreOrUnavailable(
        readSoundClip(context.userId, input[SOUND_CLIP_QUERY.ID]),
      );

      return {
        clip: Option.match(kept, {
          onNone: () => null,
          onSome: ({ contentType, bytes, sha256 }) => ({
            contentType,
            base64: Base64.encode(bytes),
            sha256,
          }),
        }),
      };
    }),

    addSound: signedIn.addSound.effect(function* ({ context, input }) {
      const clip = soundClipOfDataUrl(input.clip);

      if (clip === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

      const sound = yield* hostedStoreOrUnavailable(
        addSound(context.userId, input.name, clip, input.slot),
      );

      return { sound };
    }),

    renameSound: signedIn.renameSound.effect(function* ({ context, input }) {
      const sound = yield* hostedStoreOrUnavailable(
        renameSound(context.userId, input.id, input.name),
      );

      return { sound: Option.getOrNull(sound) };
    }),

    removeSound: signedIn.removeSound.effect(function* ({ context, input }) {
      yield* hostedStoreOrUnavailable(
        removeSound(context.userId, input.query[SOUND_CLIP_QUERY.ID]),
      );

      return GONE;
    }),

    chooseSound: signedIn.chooseSound.effect(function* ({ context, input }) {
      const id = yield* hostedStoreOrUnavailable(chooseSound(context.userId, input.slot, input.id));

      return { slot: input.slot, id };
    }),
  };
}
