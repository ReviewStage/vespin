/**
 * machine-asks.ts -- the asks the account's machines hold for its answer, as a live read bound: its one statement, the table it reads, and the topic that wakes it.
 *
 * Every ask a machine of the account's posted and has not taken down, each
 * with its machine and agent, what it asks, when it was asked and when its
 * window closes, and the answer that stands on it (`MACHINE_ASKS_READ`).
 * The statement reads the account's own rows alone, so no account reads
 * another's asks, a teammate's included. It is woken on the account's topic
 * by an ask posted, answered, or taken down (`machineCommandAskSync`), and
 * a held poll looks at it every second, since a machine waits on its answer.
 */

import { queryBuilder } from "@repo/database/core/query";
import { machineCommandAsk } from "@repo/database/schemas";
import { TOPIC } from "@repo/database/sync/notification";
import { machineCommandAskSync } from "@repo/database/sync/tables";
import { MACHINE_ASKS_READ } from "@repo/features/machine-ask-live";
import { eq } from "drizzle-orm";
import { bindLiveRead, liveRowsStatement, WATCHED_LOOK } from "../live-read-binding.js";

export const machineAsksRead = bindLiveRead(MACHINE_ASKS_READ, {
  reads: [machineCommandAskSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) => ({
    asks: liveRowsStatement(
      MACHINE_ASKS_READ.parts.asks,
      {
        columns: {
          id: machineCommandAsk.id,
          deviceId: machineCommandAsk.deviceId,
          agentId: machineCommandAsk.agentId,
          kind: machineCommandAsk.kind,
          command: machineCommandAsk.command,
          appName: machineCommandAsk.appName,
          appBundleId: machineCommandAsk.appBundleId,
          appIconPng: machineCommandAsk.appIconPng,
          decision: machineCommandAsk.decision,
          note: machineCommandAsk.note,
        },
        instants: { askedAt: machineCommandAsk.askedAt, expiresAt: machineCommandAsk.expiresAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(machineCommandAsk)
          .where(eq(machineCommandAsk.userId, userId)),
    ),
  }),
  look: WATCHED_LOOK,
});
