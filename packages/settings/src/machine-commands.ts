import {
  MACHINE_COMMAND_MODE,
  type MachineCommandMode,
  machineCommandModeSchema,
} from "@repo/features/machine-command-wire";
import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

/**
 * machine-commands.ts -- whether an agent's command runs on this Mac: never, after the developer allows it, or always.
 *
 * Settings stores the mode as an app setting (`schema.ts`), the host reads
 * it before each read for commands and as each claimed command is about to
 * run (`compose-machine-commands.ts`), and the prompt's Allow all commands writes it.
 */

/** What the setting is called, wherever its control stands. */
export const MACHINE_COMMANDS_LABEL = "Let agents run commands on this Mac";

/** Each mode as the setting's menu words it. */
export const MACHINE_COMMAND_MODE_LABEL = {
  [MACHINE_COMMAND_MODE.NEVER]: "Never",
  [MACHINE_COMMAND_MODE.ASK]: "Ask every time",
  [MACHINE_COMMAND_MODE.ALWAYS]: "Always allow",
} as const satisfies Record<MachineCommandMode, string>;

const readsMachineCommandMode = Schema.is(machineCommandModeSchema);

export function isMachineCommandMode(value: UnparsedWireValue): value is MachineCommandMode {
  return readsMachineCommandMode(value);
}
