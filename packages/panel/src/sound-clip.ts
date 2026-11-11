import type { AccountSounds } from "@repo/features/account-preferences-live";
import { sniffAudioType } from "@repo/features/audio-signature";
import {
  SOUND_CLIP_BOUNDS,
  SOUND_CLIP_SLOT,
  type Sound,
  type SoundClipSlot,
} from "@repo/features/sound-clip-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { setCustomSoundClip, soundClipSeconds } from "@repo/ui/completion-sound";
import { COMPLETION_SOUND, type CustomCompletionSound } from "@repo/wire/app-settings";
import { useQuery } from "@tanstack/react-query";
import { Result } from "effect";
import { Base64 } from "effect/encoding";
import { useEffect } from "react";
import { useAccountPreferences } from "./account-choices.js";
import { askAct } from "./act.js";
import { appStateQuery, selectAppSettingsView } from "./use-app-state.js";

/**
 * sound-clip.ts -- the sounds the account keeps of its own: the one each of its two sounds plays loaded into the player wherever a chime plays, one read back to play from Settings, and a picked file read into one for Settings to add.
 *
 * The desktop's panel window and the web's tab each mount `App`, which
 * holds `useSoundClipLoaded`, and each plays through the one player module
 * (`@repo/ui/completion-sound`) the tab's notices play through too, so the
 * clip loaded here is the one either plays. A sound's clip is fetched only
 * while one of the account's two sounds is set to it, and again only once
 * the hash the account's live read carries moved, so a sound added,
 * chosen, or removed on another device reaches this one. A file is read
 * here before it travels: its type by its own bytes, its size, and whether
 * Web Audio decodes it, each refused with a sentence that names the file;
 * no bound is set on how long it plays. The file's name is offered as the
 * sound's name to start from, and is never sent as itself.
 */

/** Why a picked file did not become a sound of the account's own, in the words said under its row. */
const CLIP_REFUSAL = {
  KIND: (name: string) => `${name} isn't a WAV, MP3, M4A, or Ogg file.`,
  TOO_LARGE: (name: string) =>
    `${name} is over ${String(SOUND_CLIP_BOUNDS.MAX_BYTES / 1_000_000)} MB, too large to add.`,
  UNREADABLE: (name: string) => `${name} could not be played.`,
} as const;

/** A file's name without its extension, cut to a sound's name bound, as the name a sound added from it starts from. */
export function soundNameOfFile(file: File): string {
  const stem = file.name.replace(/\.[^.]+$/u, "").trim();
  return (stem === "" ? file.name : stem).slice(0, SOUND_CLIP_BOUNDS.MAX_NAME_CHARS);
}

/** The picker's `accept`: the clip's types and their usual extensions, since a browser names an M4A's type several ways. */
export const CLIP_ACCEPT =
  "audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/ogg,.wav,.mp3,.m4a,.aac,.ogg,.oga";

/** A picked file read into a clip: the `data:` URL to keep and its bytes, or why it cannot be one. */
export type ClipRead =
  | { readonly clip: string; readonly bytes: Uint8Array }
  | { readonly refusal: string };

/** The sound each of the account's clips plays as, so a slot's clip reaches the player under that sound. */
export const CLIP_SOUND_OF_SLOT = {
  [SOUND_CLIP_SLOT.FINISH]: COMPLETION_SOUND.CUSTOM,
  [SOUND_CLIP_SLOT.ASK]: COMPLETION_SOUND.CUSTOM_ASK,
} as const satisfies Record<SoundClipSlot, CustomCompletionSound>;

/** The hash of the clip the player holds for each of the account's two sounds, so a hash the live read answers again fetches nothing. */
const loaded = new Map<SoundClipSlot, string>();

/** The hash each of the account's two sounds was last asked to load, so a fetch that answers after a newer ask hands the player nothing. */
const wanted = new Map<SoundClipSlot, string>();

/**
 * A picked file read as a sound of the account's own: its type sniffed from
 * its own bytes, within the bytes a request can carry, and decoded by Web
 * Audio, which proves the window can play it.
 */
export async function clipOfFile(file: File): Promise<ClipRead> {
  // Note that a file past the bound is refused by its size alone, so it is never read whole only to be refused.
  if (file.size > SOUND_CLIP_BOUNDS.MAX_BYTES)
    return { refusal: CLIP_REFUSAL.TOO_LARGE(file.name) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffAudioType(bytes);
  if (type === undefined) return { refusal: CLIP_REFUSAL.KIND(file.name) };
  if ((await soundClipSeconds(bytes)) === undefined) {
    return { refusal: CLIP_REFUSAL.UNREADABLE(file.name) };
  }
  return { clip: `data:${type};base64,${Base64.encode(bytes)}`, bytes };
}

/** The clip one of the account's two sounds now plays, handed to the player at once under its hash, so the live read's move fetches nothing. */
export function clipLoaded(slot: SoundClipSlot, sha256: string, bytes: Uint8Array): Promise<void> {
  loaded.set(slot, sha256);
  wanted.set(slot, sha256);
  return setCustomSoundClip(CLIP_SOUND_OF_SLOT[slot], bytes);
}

/** One of the account's two sounds' clips let go from the player, as it plays none. */
function clipLetGo(slot: SoundClipSlot): Promise<void> {
  loaded.delete(slot);
  wanted.delete(slot);
  return setCustomSoundClip(CLIP_SOUND_OF_SLOT[slot], undefined);
}

/** One of the account's own sounds' bytes, read through the host; none where it keeps no such sound or the read fails. */
export async function soundBytes(
  id: string,
): Promise<{ readonly sha256: string; readonly bytes: Uint8Array } | undefined> {
  const answer = await askAct(ACT_KIND.SOUND_READ, { id }).catch(() => undefined);
  if (answer === undefined || "failure" in answer || answer.clip === null) return undefined;
  const bytes = Base64.decode(answer.clip.base64);
  return Result.isFailure(bytes) ? undefined : { sha256: answer.clip.sha256, bytes: bytes.success };
}

/**
 * Fetches the sound one of the account's two sounds plays and hands it to
 * the player, where it is still the one `sha256` names and still the one
 * last asked for. Note that a fetch that fails, or answers other bytes,
 * lets go of the clip the player held for an earlier sound, so the slot
 * plays Chime rather than a sound no longer chosen; it is fetched again
 * once the live read moves or the window opens anew.
 */
async function loadClip(slot: SoundClipSlot, id: string, sha256: string): Promise<void> {
  wanted.set(slot, sha256);
  const read = await soundBytes(id);
  if (wanted.get(slot) !== sha256) return;
  if (read === undefined || read.sha256 !== sha256) {
    if (loaded.has(slot)) await clipLetGo(slot);
    return;
  }
  await clipLoaded(slot, sha256, read.bytes);
}

/** Whether an agent's finish plays one of the account's own sounds. */
const selectFinishClipChosen = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.completionSound === COMPLETION_SOUND.CUSTOM;

/** Whether something that needs the account plays one of its own sounds. */
const selectAskClipChosen = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.askSound === COMPLETION_SOUND.CUSTOM_ASK;

/** Keeps the player holding the sound one of the account's two sounds plays while that sound is set to its own, fetched again only once its hash moved; let go once it plays none. */
function useClipLoaded(
  slot: SoundClipSlot,
  chosen: boolean,
  sound: Sound | undefined,
  read: boolean,
) {
  const id = sound?.id;
  const sha256 = sound?.sha256;
  useEffect(() => {
    if (!read) return;
    if (id === undefined || sha256 === undefined) {
      if (loaded.has(slot)) clipLetGo(slot).catch(() => undefined);
      else wanted.delete(slot);
      return;
    }
    // Note that a slot set back to a built-in sound forgets the fetch still out, so it never lands as the slot is set to its own again.
    if (!chosen) wanted.delete(slot);
    else if (sha256 !== loaded.get(slot)) loadClip(slot, id, sha256).catch(() => undefined);
  }, [slot, read, id, sha256, chosen]);
}

/** The sound of the account's own one of its two sounds plays, as its live read holds them; none where it plays none. */
export function chosenSound(
  sounds: AccountSounds | undefined,
  slot: SoundClipSlot,
): Sound | undefined {
  const id = sounds?.choices[slot];
  return id === undefined ? undefined : sounds?.list.find((sound) => sound.id === id);
}

/** Keeps the player holding the sound each of the account's two sounds plays while it is set to its own, wherever a chime plays. */
export function useSoundClipLoaded(): void {
  const preferences = useAccountPreferences().data;
  const finish = useQuery({ ...appStateQuery, select: selectFinishClipChosen }).data === true;
  const ask = useQuery({ ...appStateQuery, select: selectAskClipChosen }).data === true;
  const read = preferences !== undefined;
  const sounds = preferences?.sounds;
  useClipLoaded(SOUND_CLIP_SLOT.FINISH, finish, chosenSound(sounds, SOUND_CLIP_SLOT.FINISH), read);
  useClipLoaded(SOUND_CLIP_SLOT.ASK, ask, chosenSound(sounds, SOUND_CLIP_SLOT.ASK), read);
}
