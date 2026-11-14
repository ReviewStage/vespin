/**
 * machines.ts -- the account's machines' live read bound: its one statement, the table it reads, and the topic that wakes it.
 *
 * Every machine of the account's not removed, each with its id, name,
 * platform, machine and model, where its host reported them, whether it
 * runs agents as a host, whether its app listens for commands now, whether
 * it is the member's default machine (`isDefaultMachine`), and its own
 * settings for agents' commands and apps (`MACHINES_READ`). A machine
 * runs agents as a host where it holds a version, as the hosts read lists
 * it (`hostsRead`). Its app listens where it joined, which keeps its
 * command mode, and is not marked away from its commands: its join marks it
 * away, its first listen clears the mark, and the scheduled sweep marks it
 * again once it stops (`markCommandsAwayDevices`). Note that the listeners'
 * rows, which every listen rewrites, are never read here, since nothing
 * captures them; the mark is what moves.
 *
 * It is woken on the account's topic by a machine joining, renamed,
 * removed, its settings changed on it or from anywhere, or its app coming
 * or going (`deviceSync`). The secret's hash is never selected, since what
 * a statement selects is what leaves.
 */

import { queryBuilder } from "@repo/database/core/query";
import { isDefaultMachine } from "@repo/database/models/device-store";
import { device } from "@repo/database/schemas";
import { TOPIC } from "@repo/database/sync/notification";
import { deviceSync } from "@repo/database/sync/tables";
import { MACHINES_READ } from "@repo/features/machine-live";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

/** Whether the machine runs agents as a host, as the hosts read lists one. */
const host: SQL<boolean> = sql<boolean>`${device.version} is not null`;

/** Whether the machine's app joined and is not marked away from its commands. */
const listening: SQL<boolean> = sql<boolean>`(${device.commandMode} is not null and ${device.commandsAwayAt} is null)`;

/** The apps the machine always allows, as its row keeps them. */
const alwaysAllowedApps: SQL<readonly string[] | null> = sql<
  readonly string[] | null
>`${device.alwaysAllowedApps}`;

export const machinesRead = bindLiveRead(MACHINES_READ, {
  reads: [deviceSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) => ({
    machines: liveRowsStatement(
      MACHINES_READ.parts.machines,
      {
        columns: {
          id: device.id,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          host,
          listening,
          commandMode: device.commandMode,
          computerUse: device.computerUse,
          alwaysAllowedApps,
          isDefault: isDefaultMachine,
        },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(device)
          .where(and(eq(device.userId, userId), isNull(device.removedAt))),
    ),
  }),
});
