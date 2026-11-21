/**
 * workspace-machines.ts -- the machines one workspace owns' live read bound, to a member of it: its one statement, the tables it reads, the topic that wakes it, and who it admits.
 *
 * Every machine the workspace owns and was not removed, each with its id,
 * name, platform and architecture, who connected it, the networks its
 * agents may reach, where its setup stands, whether its host program has
 * called in, whether its beat went past fresh, and, while its box has yet to
 * collect its secret, when the pairing that made it lapses
 * (`WORKSPACE_MACHINES_READ`), and none at all once the reader is no
 * longer a member of the workspace, so a subscription stays bound to the
 * rule its endpoint checked. Note that a lapsed pairing is the reader's to
 * judge, since a live statement reads no clock, as the hosts read leaves it
 * (`hosts.ts`). The secret's hash is never selected, since what a
 * statement selects is what leaves.
 * Note that a box collecting its secret wakes nothing here, since its
 * pairing notifies the account that approved it, but its first register,
 * which follows at once, does.
 *
 * A workspace the reader is not in is answered as not found. It is woken on
 * the workspace's topic by a machine of it approved, registered, renamed,
 * removed, its setup moving, or its going away or coming back
 * (`deviceSync`), and by a membership moving (`memberSync`).
 */

import { queryBuilder } from "@repo/database/core/query";
import { workspaceReachableBy } from "@repo/database/models/workspace-store";
import { device, hostPairing } from "@repo/database/schemas";
import { TOPIC } from "@repo/database/sync/notification";
import { deviceSync, hostPairingSync, memberSync } from "@repo/database/sync/tables";
import { WORKSPACE_MACHINES_READ } from "@repo/features/workspace-machine-live";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { answeredWorkspace } from "../../accounts/workspace-access.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

/** When the pairing that names the machine lapses; null where none does, as once its box collected its secret. */
const pairingLapsesAt: SQL<Date | null> = sql`(select ${hostPairing.expiresAt} from ${hostPairing} where ${eq(hostPairing.deviceId, device.id)} limit 1)`;

/** Whether the machine's host program has registered since it joined. */
const calledIn: SQL<boolean> = sql<boolean>`${device.home} is not null`;

/** Whether the scheduled sweep found the machine's beat past fresh since it last beat (`markAwayDevices`). */
const away: SQL<boolean> = sql<boolean>`${device.awayAt} is not null`;

/** The networks its agents may reach, which a workspace's machine always names. */
const network: SQL<string> = sql<string>`${device.network}`;

export const workspaceMachinesRead = bindLiveRead(WORKSPACE_MACHINES_READ, {
  reads: [deviceSync, hostPairingSync, memberSync],
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => ({
    machines: liveRowsStatement(
      WORKSPACE_MACHINES_READ.parts.machines,
      {
        columns: {
          id: device.id,
          name: device.name,
          platform: device.platform,
          arch: device.arch,
          connectedBy: device.connectedBy,
          network,
          setup: device.setup,
          calledIn,
          away,
        },
        instants: { pairingLapsesAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(device)
          .where(
            and(
              eq(device.organizationId, workspaceId),
              isNull(device.removedAt),
              workspaceReachableBy(userId, workspaceId),
            ),
          ),
    ),
  }),
  admit: ({ userId, workspaceId }) => Effect.asVoid(answeredWorkspace(userId, workspaceId)),
});
