/**
 * workspace-machines.ts -- the machines one workspace owns' live read bound, as a released build's Settings › Machines follows it: no machine, to a member of the workspace.
 *
 * No machine is connected to a workspace, yet a desktop from v0.41.0 to
 * v0.42.0 and an iPhone build at `HOSTED_API_VERSION` 7 to 10 still follow
 * the read (`WORKSPACE_MACHINES_READ`), so it stands to answer them: its one
 * statement takes no row of the devices, each column one of theirs or, for
 * one they no longer hold, a constant of the type the row declares, and a workspace the reader is not in is answered as not found,
 * as before. It is woken on the workspace's topic by a member's device or
 * a membership moving (`deviceSync`, `memberSync`), which changes nothing
 * it answers. It goes once the floor
 * reaches 11, from which no build follows it (`@repo/features/client-identity`).
 */

import { queryBuilder } from "@repo/database/core/query";
import { device } from "@repo/database/schemas";
import { TOPIC } from "@repo/database/sync/notification";
import { deviceSync, memberSync } from "@repo/database/sync/tables";
import { WORKSPACE_MACHINES_READ } from "@repo/features/workspace-machine-live";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { answeredWorkspace } from "../../accounts/workspace-access.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

export const workspaceMachinesRead = bindLiveRead(WORKSPACE_MACHINES_READ, {
  reads: [deviceSync, memberSync],
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: () => ({
    machines: liveRowsStatement(
      WORKSPACE_MACHINES_READ.parts.machines,
      {
        columns: {
          id: device.id,
          name: device.name,
          platform: device.platform,
          arch: device.arch,
          connectedBy: sql<string | null>`null::text`,
          network: sql<string>`''`,
          setup: sql<string | null>`null::text`,
          calledIn: sql<boolean>`false`,
          away: sql<boolean>`false`,
        },
        instants: { pairingLapsesAt: sql<Date | null>`null::timestamptz` },
      },
      // Note that no workspace owns a machine, so the statement takes no row.
      (selection) => queryBuilder.select(selection).from(device).where(sql`false`),
    ),
  }),
  admit: ({ userId, workspaceId }) => Effect.asVoid(answeredWorkspace(userId, workspaceId)),
});
