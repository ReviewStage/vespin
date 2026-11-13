/**
 * machine-commands.ts -- the account's unclaimed Mac commands' live read bound: its one statement, the table it reads, the topic that wakes it, and how often a held poll looks.
 *
 * The account's commands of the kinds the Mac's query names that no Mac has
 * claimed yet, of those the device it names may claim, read as its held read always read them
 * (`machineCommandKindsRead`), each with the instant it was queued in epoch
 * milliseconds (`MACHINE_COMMANDS_READ`). Note that it names no claim window,
 * because a live read measures nothing from the clock: the claim
 * (`claimMachineCommand`) keeps the window, on the service's clock.
 *
 * It is woken by a command queued, claimed, settled, or taken back, each of
 * which names the account, and a held poll looks at it every second, since
 * a Mac waits on what it hears.
 */

import { queryBuilder } from "@repo/database/core/query";
import { machineCommand } from "@repo/database/schemas/machine-command";
import { TOPIC } from "@repo/database/sync/notification";
import { machineCommandSync } from "@repo/database/sync/tables";
import { MACHINE_COMMANDS_READ } from "@repo/features/machine-command-live";
import { machineCommandKindsRead } from "@repo/features/machine-command-wire";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { bindLiveRead, columnAs, liveRowsStatement, WATCHED_LOOK } from "../live-read-binding.js";

export const machineCommandsRead = bindLiveRead(MACHINE_COMMANDS_READ, {
  reads: [machineCommandSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, kinds, device }) => ({
    commands: liveRowsStatement(
      MACHINE_COMMANDS_READ.parts.commands,
      {
        ordered: false,
        columns: {
          id: machineCommand.id,
          kind: machineCommand.kind,
          // SAFETY: a shell command, the one kind a Mac reads, always holds its text, which the column alone does not say; it is selected as the column, so the statement names it as it always did.
          command: columnAs<string>(machineCommand.command),
          timeoutSeconds: machineCommand.timeoutSeconds,
        },
        instants: { queuedAt: machineCommand.queuedAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(machineCommand)
          .where(
            and(
              eq(machineCommand.userId, userId),
              // Note that a Mac that joined as a device hears what was queued for it or for none, and one naming none only the latter, as its claim takes them.
              device === ""
                ? isNull(machineCommand.deviceId)
                : or(isNull(machineCommand.deviceId), eq(machineCommand.deviceId, device)),
              inArray(machineCommand.kind, machineCommandKindsRead(kinds)),
              isNull(machineCommand.claimedAt),
            ),
          ),
    ),
  }),
  look: WATCHED_LOOK,
});
