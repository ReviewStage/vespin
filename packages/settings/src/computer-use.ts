import type { UnparsedWireValue } from "@repo/wire";
import { Option, Predicate, Schema } from "effect";

/**
 * computer-use.ts -- whether agents may see and use apps on this Mac, and the apps they may use without asking.
 *
 * Settings stores both as app settings of this Mac's own (`schema.ts`): the
 * switch, which the host reads as each action on an app arrives, and the
 * apps the developer answered Always allow for, by bundle id, as JSON, which
 * the prompt's Always allow writes (`compose-machine-commands.ts`).
 */

/** What the switch is called, wherever its control stands. */
export const COMPUTER_USE_LABEL = "Let agents use apps on this Mac";

/** What the switch says under its label. */
export const COMPUTER_USE_DETAIL =
  "They see and control the apps you allow, in the background, while you keep working. Each app is asked about the first time.";

const allowedAppsJson = Schema.fromJsonString(Schema.Array(Schema.String));

const decodeAllowedApps = Schema.decodeUnknownOption(allowedAppsJson);
const encodeAllowedApps = Schema.encodeSync(allowedAppsJson);

/** Whether a stored value is the apps' JSON. Note that the text is decoded, since `Schema.is` would read the array it decodes to. */
export function isComputerUseAppsJson(value: UnparsedWireValue): value is string {
  return Predicate.isString(value) && Option.isSome(decodeAllowedApps(value));
}

/** The apps the stored value allows, by bundle id; none where nothing is stored. */
export function computerUseAppsOf(stored: string | undefined): readonly string[] {
  return stored === undefined ? [] : Option.getOrElse(decodeAllowedApps(stored), () => []);
}

/** The stored value allowing the apps given, each once, in their order. */
export function computerUseAppsStored(apps: readonly string[]): string {
  return encodeAllowedApps([...new Set(apps)]);
}

/** The stored value with one more app allowed, each app once. */
export function computerUseAppsWith(stored: string | undefined, app: string): string {
  return encodeAllowedApps([...new Set([...computerUseAppsOf(stored), app])]);
}

/** The stored value with one app taken off. */
export function computerUseAppsWithout(stored: string | undefined, app: string): string {
  return encodeAllowedApps(computerUseAppsOf(stored).filter((allowed) => allowed !== app));
}
