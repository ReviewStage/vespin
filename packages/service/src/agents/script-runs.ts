/**
 * script-runs.ts -- how a workspace's cloud setup script ran in an agent's sandbox, recorded as that script's last run for Settings › Cloud setup.
 *
 * The sandbox's setup (`machine/sandbox-machine.ts`'s `setUp`) records the
 * install script's run and the repository's setup script's, and an archive
 * (`archive-script.ts`) the archive script's where it exited, each with when
 * it started, how it exited, and the agent whose sandbox it ran in; never what it printed,
 * which stays in the sandbox's setup log. A record is a courtesy no setup or
 * archive waits on: one that could not be written is logged and let go.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { recordScriptRun } from "@repo/database/models/workspace-sandbox-script-run-store";
import {
  CLOUD_SETUP_SCRIPT,
  type CloudSetupScript,
} from "@repo/features/workspace-sandbox-setup-wire";
import { Effect } from "effect";

/** The script's run in the agent's sandbox, started at `ranAt` and exited `exitCode`, recorded as its last; the install script's under no repository. */
export const scriptRanIn = (
  agent: Pick<Agent, "id" | "organizationId" | "repository">,
  script: CloudSetupScript,
  exitCode: number,
  ranAt: Date,
): Effect.Effect<void, never, DatabaseServices> =>
  recordScriptRun({
    organizationId: agent.organizationId,
    script,
    repository: script === CLOUD_SETUP_SCRIPT.INSTALL ? null : agent.repository,
    agentId: agent.id,
    exitCode,
    ranAt,
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(`A cloud setup script's run was not recorded: ${failure._tag}`),
    ),
  );
