import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { SOUND_CLIP_SLOT, SOUND_CLIP_TYPE } from "@repo/features/sound-clip-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { accountSoundChoice } from "../../schemas/account-sound.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  addSound,
  chooseSound,
  readSoundClip,
  removeSound,
  renameSound,
} from "../account-sounds.js";

/**
 * An account's own sounds over a real dialect: a sound is added under its
 * name and chosen for one of its two sounds, renamed, and removed with
 * every choice of it, and no account reads, renames, removes, or chooses
 * another's. Synthetic accounts and bytes throughout.
 */

const { FINISH, ASK } = SOUND_CLIP_SLOT;

/** The bytes a WAV opens with, padded with a mark that tells two clips apart. */
const clipOf = (mark: number) => ({
  contentType: SOUND_CLIP_TYPE.WAV,
  bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, mark]),
});

/** The SHA-256 of `clipOf(1)`'s bytes, worked out with `sha256sum`. */
const FIRST_SHA256 = "f7e8295fba8642d67d4f80d3e3d64e833693adf8c0ccb638cc6abcbb0e86b674";

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }
  return { owner, other };
});

/** The sound each of the account's two sounds plays, as its choices stand. */
const choicesOf = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({ slot: accountSoundChoice.slot, soundId: accountSoundChoice.soundId })
      .from(accountSoundChoice)
      .where(eq(accountSoundChoice.userId, userId));
    return Object.fromEntries(rows.map((row) => [row.slot, row.soundId]));
  });

it.layer(getTestDB())("the account sounds store", (it) => {
  it.effect(
    "a sound is added under its name and chosen, renamed, and removed with its choices",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;

        const glass = yield* addSound(owner, "Glass", clipOf(1), FINISH);
        assert.deepEqual(
          { name: glass.name, sha256: glass.sha256 },
          { name: "Glass", sha256: FIRST_SHA256 },
        );
        const knock = yield* addSound(owner, "Knock", clipOf(2));
        assert.equal(yield* chooseSound(owner, ASK, knock.id), knock.id);
        assert.deepEqual(yield* choicesOf(owner), { [FINISH]: glass.id, [ASK]: knock.id });

        const renamed = yield* renameSound(owner, glass.id, "Bell");
        assert.equal(Option.getOrUndefined(renamed)?.name, "Bell");

        yield* removeSound(owner, glass.id);
        assert.ok(Option.isNone(yield* readSoundClip(owner, glass.id)));
        assert.deepEqual(yield* choicesOf(owner), { [ASK]: knock.id });
        const kept = yield* readSoundClip(owner, knock.id);
        assert.deepEqual(Option.getOrUndefined(kept)?.bytes, clipOf(2).bytes);
      }),
  );

  it.effect("one account cannot read, rename, remove, or choose another's sound", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const sound = yield* addSound(owner, "Glass", clipOf(1));

      assert.ok(Option.isNone(yield* readSoundClip(other, sound.id)));
      assert.ok(Option.isNone(yield* renameSound(other, sound.id, "Taken")));
      assert.equal(yield* chooseSound(other, FINISH, sound.id), null);
      yield* removeSound(other, sound.id);

      assert.deepEqual(yield* choicesOf(other), {});
      const kept = yield* readSoundClip(owner, sound.id);
      assert.ok(Option.isSome(kept));
    }),
  );
});
