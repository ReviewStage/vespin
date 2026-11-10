/**
 * agent-approval.ts -- each tool call a coding agent's runner held for a member's answer, from its ask to how it was settled.
 *
 * A Claude Code agent whose permission mode asks (`agent.permission_mode`)
 * has its runner hold a call and post the ask (`APPROVAL_REQUESTED`), which
 * lands here as a pending row under the turn that was running, named by
 * the CLI's own id for it (`request_id`), unique within the agent's
 * conversation. It is settled once: by a member's answer, which the
 * service writes to the runner as an `approval` line; by the runner's own
 * word of how it was settled (`APPROVAL_RESOLVED`, which also stamps
 * `confirmed_at`), a message sent while it waited, a Stop's withdrawal, or
 * the launch's end among it; or by its turn's end, which expires every ask the turn left pending
 * (`models/agent-approvals.ts`). A settled row stays, so a late answer is
 * refused with how it stands, and goes with its turn, its agent, and its
 * conversation, however that conversation is removed.
 *
 * What the card draws is one value (`ask`): the call's input as the runner
 * cut it (`APPROVAL_INPUT`), cut again to the service's own bound, with the
 * tool and the CLI's words for the ask. All of it is the agent's transcript
 * content, a command or a file's contents among it, read under the rule its
 * transcript is, and never written to a trace, a counted event, or a log.
 */

import type {
  AgentPendingApproval,
  ApprovalSettledBy,
  ApprovalStatus,
} from "@repo/features/agent-approval-wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";
import { conversations, turns } from "./storage.js";

export const agentApproval = pgTable(
  "agent_approval",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The coding agent whose runner held the call. */
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The agent's own conversation, whose transcript holds the call. */
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The turn that was running as the call was held, whose end expires it. */
    turnId: uuid("turn_id")
      .notNull()
      .references((): AnyPgColumn => turns.id, { onDelete: "cascade" }),
    /** The CLI's id for the ask, which an `approval` line names. */
    requestId: text("request_id").notNull(),
    /** The call's `tool_use` id, which its part in the transcript carries. */
    toolUseId: text("tool_use_id").notNull(),
    /**
     * What the card draws of the ask, in the wire's own shape
     * (`AgentPendingApproval`): its id and its call's, the subagent that made
     * it, the tool, the CLI's words for it, the call's input as its runner
     * cut it, and when it was asked. Kept whole as one value, as
     * `agent_pull_request` keeps its pull request, so the task list's live
     * read carries it as it stands, calling no function Realtime refuses.
     */
    ask: jsonb("ask").$type<AgentPendingApproval>().notNull(),
    /** Where the ask stands (`APPROVAL_STATUS`). */
    status: text("status").$type<ApprovalStatus>().notNull(),
    /** What settled it (`APPROVAL_SETTLED_BY`); null while it is pending. */
    settledBy: text("settled_by").$type<ApprovalSettledBy>(),
    /** The member whose answer settled it; null for any other settling, while it is pending, and once their account is gone. */
    decidedByUserId: text("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    /** When it was settled; null while it is pending. */
    settledAt: timestamptz("settled_at"),
    /**
     * When the runner's word of how it was settled landed; null until then.
     * A member's answer settles the row as their claim before its line
     * reaches the runner, and only a claim the runner has not confirmed may
     * be handed back where that line was not written.
     */
    confirmedAt: timestamptz("confirmed_at"),
  },
  (table) => [
    // An ask lands once however often its runner posts it, by the CLI's id within the conversation.
    uniqueIndex("agent_approval_request").on(table.conversationId, table.requestId),
    // The task list reads each agent's pending asks, and a turn's end expires its own.
    index("agent_approval_pending")
      .on(table.agentId, table.createdAt)
      .where(sql`${table.settledAt} is null`),
    index("agent_approval_turn_pending").on(table.turnId).where(sql`${table.settledAt} is null`),
  ],
);
