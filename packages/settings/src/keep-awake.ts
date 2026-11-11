import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

/**
 * keep-awake.ts -- whether this Mac's host keeps the Mac from idle-sleeping: never, while an agent of it runs, or for as long as the Mac is plugged in.
 *
 * Settings stores the choice as an app setting (`schema.ts`), the app hands
 * it to This Mac's host in the host's own state (`keep-awake-record.ts`), and
 * the host holds the Mac awake by it (`daemon/host-keep-awake.ts`). A host
 * no app hands a choice, a Mac added with the install command, keeps the
 * default.
 */

// Note that the order is the menu's, from least awake to most.
export const KEEP_AWAKE = {
  /** The Mac sleeps on its own settings. */
  NEVER: "never",
  /** The Mac stays awake while any agent of its host runs, and sleeps on its own settings otherwise. */
  WORKING: "working",
  /** The Mac stays awake whenever it is plugged in, and on battery only while an agent runs. */
  PLUGGED_IN: "pluggedIn",
} as const;

export type KeepAwake = (typeof KEEP_AWAKE)[keyof typeof KEEP_AWAKE];

export const KEEP_AWAKE_LIST: readonly KeepAwake[] = Object.values(KEEP_AWAKE);

/** What a Mac keeps where nothing chose otherwise. */
export const KEEP_AWAKE_DEFAULT: KeepAwake = KEEP_AWAKE.WORKING;

/** What the setting is called. */
export const KEEP_AWAKE_LABEL = "Keep this Mac awake";

/** Each choice as the setting's menu words it. */
export const KEEP_AWAKE_OPTION_LABEL = {
  [KEEP_AWAKE.NEVER]: "Never",
  [KEEP_AWAKE.WORKING]: "While agents work",
  [KEEP_AWAKE.PLUGGED_IN]: "While plugged in",
} as const satisfies Record<KeepAwake, string>;

/** The line under the row's name for each choice, where one says what the name does not. */
export const KEEP_AWAKE_DETAIL = {
  [KEEP_AWAKE.NEVER]: undefined,
  [KEEP_AWAKE.WORKING]: "Closing the lid still puts it to sleep.",
  [KEEP_AWAKE.PLUGGED_IN]: "Even with no agents running. On battery, only while they work.",
} as const satisfies Record<KeepAwake, string | undefined>;

const readsKeepAwake = Schema.is(Schema.Literals(KEEP_AWAKE_LIST));

export function isKeepAwake(value: UnparsedWireValue): value is KeepAwake {
  return readsKeepAwake(value);
}
