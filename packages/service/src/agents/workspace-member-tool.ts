/**
 * workspace-member-tool.ts -- `list_workspace_members`: the members of a coding agent's workspace, each by the mention link a call names a person by.
 *
 * It reads the workspace as the member MCP tool of the same name does,
 * through the one members read (`../accounts/workspace-operations.ts`), as
 * the member who started the agent. Each member is answered with their
 * mention link under the workspace's step (`written-mentions.ts`), the
 * words `inbox_post`'s `to` and a task's `assignee` take as written, so a
 * call names a person from what this answered. Their email is left out,
 * since no call names a person by it; nor are members who left, since no
 * call may name them.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { MENTION_KIND } from "@repo/features/mention-link";
import type { WireRecord } from "@repo/wire";
import { Effect, Option, Schema } from "effect";
import { workspaceMembersRead } from "../accounts/workspace-operations.js";
import { ACTION_RESULT_STATUS, type UnparsedWireValue } from "../core.js";
import {
  type AgentReadCall,
  agentToolRejected,
  callerUserId,
  callerWorkspace,
  orStoreRefusal,
} from "./agent-tools.js";
import { workspaceStepOf, writtenMention } from "./written-mentions.js";

/** Why the members were not listed, in words the model can act on. */
const WORKSPACE_MEMBERS_REFUSAL = {
  NO_WORKSPACE:
    "Not listed: the member you work for is no longer a member of your workspace, so its " +
    "members are not read for them.",
  UNREAD: "Not listed: the members could not be read just now. The call may be made again.",
} as const;

const LIST_WORKSPACE_MEMBERS_INPUT = Schema.Struct({});

/** `list_workspace_members` as a coding agent is offered it. */
export const LIST_WORKSPACE_MEMBERS_TOOL = {
  name: AGENT_TOOL.LIST_WORKSPACE_MEMBERS,
  description:
    "List the members of your workspace, owners first, then admins, then members: each with " +
    "their account id (`userId`), name, role (owner, admin, or member), and `mention`, their " +
    `mention link, which ${AGENT_TOOL.POST_THREAD}'s \`to\` and a task's \`assignee\` take as ` +
    "it is written. Answers `accepted` with them, or `rejected` and why.",
  inputSchema: LIST_WORKSPACE_MEMBERS_INPUT,
} as const;

/** `list_workspace_members`: the caller's workspace's members, read as the member the agent acts for. */
export function runListWorkspaceMembers(
  call: AgentReadCall,
  _input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const { caller } = call;
  const userId = callerUserId(caller);

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);

      if (Option.isNone(workspace)) {
        return agentToolRejected(WORKSPACE_MEMBERS_REFUSAL.NO_WORKSPACE);
      }

      const step = yield* workspaceStepOf(userId, workspace.value);

      return yield* workspaceMembersRead(userId, workspace.value).pipe(
        Effect.map(
          ({ members }): WireRecord => ({
            status: ACTION_RESULT_STATUS.ACCEPTED,
            members: members.map((member) => ({
              userId: member.userId,
              name: member.name,
              role: member.role,
              mention: writtenMention(
                { kind: MENTION_KIND.PERSON, userId: member.userId },
                member.name,
                step,
              ),
            })),
          }),
        ),
        // Note that the caller's membership was read above, so a refusal here is the store's.
        Effect.catch(() => Effect.succeed(agentToolRejected(WORKSPACE_MEMBERS_REFUSAL.UNREAD))),
      );
    }),
  );
}
