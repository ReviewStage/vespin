import {
  MAC_COMMAND_MODE,
  type MacCommandMode,
  macCommandModeSchema,
} from "@repo/features/mac-command-wire";
import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

/**
 * mac-commands.ts -- whether an agent's command runs on this Mac: never, after the developer allows it, or always.
 *
 * Settings stores the mode as an app setting (`schema.ts`), the host reads
 * it before each read for commands and as each claimed command is about to
 * run (`compose-mac-commands.ts`), and the prompt's Allow all commands writes it.
 */

/** What the setting is called, wherever its control stands. */
export const MAC_COMMANDS_LABEL = "Let agents run commands on this Mac";

/** Each mode as the setting's menu words it. */
export const MAC_COMMAND_MODE_LABEL = {
  [MAC_COMMAND_MODE.NEVER]: "Never",
  [MAC_COMMAND_MODE.ASK]: "Ask every time",
  [MAC_COMMAND_MODE.ALWAYS]: "Always allow",
} as const satisfies Record<MacCommandMode, string>;

const readsMacCommandMode = Schema.is(macCommandModeSchema);

export function isMacCommandMode(value: UnparsedWireValue): value is MacCommandMode {
  return readsMacCommandMode(value);
}
