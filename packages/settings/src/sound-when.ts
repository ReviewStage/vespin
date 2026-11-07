/**
 * sound-when.ts -- when a completion sound plays as an agent finishes: never, only while the app is in the background, or always.
 *
 * Which sound plays is the account's own choice beside this one, named by
 * `@repo/wire/app-settings`'s `COMPLETION_SOUND`.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

export const SOUND_WHEN = {
  /** No sound plays. */
  OFF: "off",
  /** A sound plays only while no window of the app is in front. */
  BACKGROUND: "background",
  /** A sound plays whether or not a window of the app is in front. */
  ALWAYS: "always",
} as const;

export type SoundWhen = (typeof SOUND_WHEN)[keyof typeof SOUND_WHEN];

export const SOUND_WHEN_LIST: readonly SoundWhen[] = Object.values(SOUND_WHEN);

/** How each choice reads on its control. */
export const SOUND_WHEN_LABEL = {
  [SOUND_WHEN.OFF]: "Off",
  [SOUND_WHEN.BACKGROUND]: `When ${PRODUCT_NAME} is in the background`,
  [SOUND_WHEN.ALWAYS]: "Always",
} as const satisfies Record<SoundWhen, string>;

const readsSoundWhen = Schema.is(Schema.Literals(SOUND_WHEN_LIST));

/** Guards a choice arriving from storage or IPC. */
export function isSoundWhen(value: UnparsedWireValue): value is SoundWhen {
  return readsSoundWhen(value);
}
