/**
 * completion-sound.ts -- the ids of the sounds an agent's finish or an ask can chime, their groups, and the words each is shown under.
 *
 * The ids live in the wire package because three sides name the same set:
 * `@repo/ui` synthesizes each one, the account stores the one chosen for a
 * finish and the one chosen for an ask, and Settings lists them. A stored id is never renamed, since an account
 * remembers it by this spelling.
 */

/** The sounds, in the order Settings and the catalog list them. */
export const COMPLETION_SOUND = {
  CHIME: "chime",
  DONE: "done",
  KNOCK: "knock",
  QUESTION: "question",
  PING: "ping",
  MARIMBA: "marimba",
  POP: "pop",
  BELL: "bell",
  GLASS: "glass",
  DROPLET: "droplet",
  SOFT: "soft",
  DOORBELL: "doorbell",
  COIN: "coin",
  LEVEL_UP: "level-up",
  TRAIN_HORN: "train-horn",
  QUACK: "quack",
  TYPEWRITER: "typewriter",
} as const;

export type CompletionSound = (typeof COMPLETION_SOUND)[keyof typeof COMPLETION_SOUND];

/** Every sound, in listing order. */
export const COMPLETION_SOUNDS: readonly CompletionSound[] = Object.values(COMPLETION_SOUND);

/** The two groups Settings lists the sounds under, quiet ones first. */
export const COMPLETION_SOUND_GROUP = {
  SIMPLE: "simple",
  PLAYFUL: "playful",
} as const;

export type CompletionSoundGroup =
  (typeof COMPLETION_SOUND_GROUP)[keyof typeof COMPLETION_SOUND_GROUP];

/** The group's heading. */
export const COMPLETION_SOUND_GROUP_LABEL = {
  [COMPLETION_SOUND_GROUP.SIMPLE]: "Simple",
  [COMPLETION_SOUND_GROUP.PLAYFUL]: "Playful",
} as const satisfies Record<CompletionSoundGroup, string>;

/** The group each sound is listed under. */
export const COMPLETION_SOUND_GROUP_OF = {
  [COMPLETION_SOUND.CHIME]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.DONE]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.KNOCK]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.QUESTION]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.PING]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.MARIMBA]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.POP]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.BELL]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.GLASS]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.DROPLET]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.SOFT]: COMPLETION_SOUND_GROUP.SIMPLE,
  [COMPLETION_SOUND.DOORBELL]: COMPLETION_SOUND_GROUP.PLAYFUL,
  [COMPLETION_SOUND.COIN]: COMPLETION_SOUND_GROUP.PLAYFUL,
  [COMPLETION_SOUND.LEVEL_UP]: COMPLETION_SOUND_GROUP.PLAYFUL,
  [COMPLETION_SOUND.TRAIN_HORN]: COMPLETION_SOUND_GROUP.PLAYFUL,
  [COMPLETION_SOUND.QUACK]: COMPLETION_SOUND_GROUP.PLAYFUL,
  [COMPLETION_SOUND.TYPEWRITER]: COMPLETION_SOUND_GROUP.PLAYFUL,
} as const satisfies Record<CompletionSound, CompletionSoundGroup>;

/** The name a sound is shown under. */
export const COMPLETION_SOUND_LABEL = {
  [COMPLETION_SOUND.CHIME]: "Chime",
  [COMPLETION_SOUND.DONE]: "Done",
  [COMPLETION_SOUND.KNOCK]: "Knock",
  [COMPLETION_SOUND.QUESTION]: "Question",
  [COMPLETION_SOUND.PING]: "Ping",
  [COMPLETION_SOUND.MARIMBA]: "Marimba",
  [COMPLETION_SOUND.POP]: "Pop",
  [COMPLETION_SOUND.BELL]: "Bell",
  [COMPLETION_SOUND.GLASS]: "Glass",
  [COMPLETION_SOUND.DROPLET]: "Droplet",
  [COMPLETION_SOUND.SOFT]: "Soft",
  [COMPLETION_SOUND.DOORBELL]: "Doorbell",
  [COMPLETION_SOUND.COIN]: "Coin",
  [COMPLETION_SOUND.LEVEL_UP]: "Level up",
  [COMPLETION_SOUND.TRAIN_HORN]: "Train horn",
  [COMPLETION_SOUND.QUACK]: "Quack",
  [COMPLETION_SOUND.TYPEWRITER]: "Typewriter",
} as const satisfies Record<CompletionSound, string>;
