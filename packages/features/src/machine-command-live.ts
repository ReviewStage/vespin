/**
 * machine-command-live.ts -- the commands the account's agents queued for its Mac, as the Mac follows them over the service's held poll: the read declared, and the commands as the Mac claims them.
 *
 * The service answers one statement, the commands of the kinds the Mac runs
 * that no Mac of the account has claimed yet. The Mac claims each it hears
 * of (`machine-command-wire.ts`), on the service's clock, so a command left
 * waiting too long is refused there.
 */

import { Schema } from "effect";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import {
  MACHINE_COMMAND_KIND,
  type MachineCommand,
  machineCommandOfStored,
} from "./machine-command-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber } from "./service-wire.js";

/**
 * The commands of the kinds a Mac runs that no Mac of the account has
 * claimed yet, of those the device it joined as may claim (`device`), or
 * those queued for no device where it names none: one part, each the command of its kind, and when it was
 * queued in epoch milliseconds, the earliest queued first, so the Mac
 * claims them in the order they were asked for. The kinds are the read's
 * query as the Mac spells them (`machineCommandKindsQuery`). Note that a column
 * its kind leaves null is read past, as every key a struct does not name is.
 */
export const MACHINE_COMMANDS_READ = liveRead({
  name: "macCommands",
  path: HOSTED_SERVICE_PATH.LIVE_MACHINE_COMMANDS,
  params: {
    [LIVE_USER_QUERY]: LIVE_PARAM.USER,
    kinds: LIVE_PARAM.OPTIONAL_TEXT,
    device: LIVE_PARAM.OPTIONAL_ID,
  },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    commands: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        kind: Schema.Literals(Object.values(MACHINE_COMMAND_KIND)),
        command: Schema.String,
        timeoutSeconds: Schema.Number,
        queuedAt: countedNumber,
      }),
      key: "id",
      order: [
        ["queuedAt", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
  },
});

export type MachineCommandsLiveAnswer = LiveReadAnswer<typeof MACHINE_COMMANDS_READ>;

/** The unclaimed commands, the earliest queued first, so the Mac claims them in the order they were asked for. */
export function machineCommandsOfLiveRows(
  rows: typeof MACHINE_COMMANDS_READ.rows.Type,
): readonly MachineCommand[] {
  return orderedLiveRows(MACHINE_COMMANDS_READ.parts.commands, rows.commands).flatMap((row) => {
    const command = machineCommandOfStored(row);

    return command === undefined ? [] : [command];
  });
}
