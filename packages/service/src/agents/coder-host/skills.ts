/**
 * skills.ts -- the installed skills a coding agent's session is handed: the ones its member installed, its repository's left to the checkout.
 *
 * The launch writes them for the harness (`nativeSkills`,
 * `runner-sessions.ts`); the repository's own skills are left to the
 * checkout, where Claude Code and Codex find them, so none is read from
 * GitHub as the agent starts. The member is the agent's starter, whose
 * conversation it is, and for an automation's agent the automation's owner,
 * who starts it; the workspace is its own, read as that member as the agent
 * reads itself (`ownAgentWorkspace`), so its skills stay while that member
 * no longer sees its task.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { Effect } from "effect";
import { ownAgentWorkspace } from "../../github/workspace-repository.js";
import { type AgentSkill, installedSkills, mergedSkills } from "../agent-runtime/skills.js";

/**
 * The installed skills a native harness is handed (`runner-sessions.ts`):
 * the workspace's, then the member's personal ones, a name offered once by
 * the earliest. The repository's own skills are none of these: the harness
 * finds them in the checkout itself, so nothing of them is read here.
 */
export function nativeSkills(
  target: ConversationTarget,
  agent: Agent,
): Effect.Effect<readonly AgentSkill[], never, DatabaseServices> {
  return Effect.map(installedSkills(target, ownAgentWorkspace(target.userId, agent)), (installed) =>
    mergedSkills([installed]),
  );
}
