/**
 * agent-approvals.ts -- the asks a coding agent's runner held for a member's answer: landed as the runner posts them, settled once, and read by the members who see the agent.
 *
 * The runner's side, an ask landing, its own word of how one was settled,
 * and a turn's end expiring what it left pending, is the service's and
 * reads no account, as the agent's transcript writes read none: it names
 * the agent by its conversation, and lands under the conversation's lock,
 * in the transaction its events are applied in. A member's side reads
 * through the rule a whole agent is read by (`agentVisibleTo`), so an ask of
 * an agent the member does not see, another workspace's among them, reads
 * as none at all; whether the member may answer it, which an agent on its
 * starter's own token or Mac keeps to the starter, is the service's to
 * decide from the agent beside it.
 *
 * An ask is settled once, a compare-and-set on its standing pending, so of
 * two answers racing one lands. A member's answer claims the ask that way
 * before its line is written to the runner, so the runner hears only the
 * answer the row records, and the claim is handed back where the line could
 * not be written (`releaseApprovalClaim`). The one exception is the runner's word of a
 * member's answer, which is what the agent heard: where two members'
 * answers crossed on their way to it, the runner took the first to reach
 * it, so its word stands over whatever answer the row recorded; and where
 * its word lands before the member's own settle, that settle still records
 * the member as who decided, the runner's answer standing.
 */

import { randomUUID } from "node:crypto";
import {
  type AgentPendingApproval,
  APPROVAL_SETTLED_BY,
  APPROVAL_STATUS,
  type ApprovalSettledBy,
  type ApprovalStatus,
  agentPendingApprovalSchema,
} from "@repo/features/agent-approval-wire";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentApproval } from "../schemas/agent-approval.js";
import { InstantColumnSchema } from "./columns.js";
import { agentVisibleTo } from "./workspace-store.js";

type ApprovalEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const STATUSES = Object.values(APPROVAL_STATUS);

const SETTLED_BY = Object.values(APPROVAL_SETTLED_BY);

/** One ask as its row keeps it. */
const ApprovalRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  conversationId: Schema.String,
  turnId: Schema.String,
  requestId: Schema.String,
  toolUseId: Schema.String,
  ask: agentPendingApprovalSchema,
  status: Schema.Literals(STATUSES),
  settledBy: Schema.NullOr(Schema.Literals(SETTLED_BY)),
  decidedByUserId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  settledAt: Schema.NullOr(InstantColumnSchema),
});

export type AgentApprovalRow = typeof ApprovalRowSchema.Type;

/** An ask as the runner posted it, under the turn that was running: the agent by its conversation, and what the card draws. */
export interface ApprovalAsked {
  readonly conversationId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly toolUseId: string;
  readonly subagentId: string | null;
  readonly toolName: string;
  readonly title: string;
  readonly description: string | null;
  readonly input: AgentPendingApproval["input"];
  readonly at: Date;
}

const approvalColumns = {
  id: agentApproval.id,
  agentId: agentApproval.agentId,
  conversationId: agentApproval.conversationId,
  turnId: agentApproval.turnId,
  requestId: agentApproval.requestId,
  toolUseId: agentApproval.toolUseId,
  ask: agentApproval.ask,
  status: agentApproval.status,
  settledBy: agentApproval.settledBy,
  decidedByUserId: agentApproval.decidedByUserId,
  createdAt: agentApproval.createdAt,
  settledAt: agentApproval.settledAt,
};

const IdSchema = Schema.Struct({ id: Schema.String });

/** That the ask still waits on an answer. */
const pending = isNull(agentApproval.settledAt);

const findAgentOfConversation = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: IdSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(eq(agentTable.conversationId, conversationId)),
    ),
});

const insertAsked = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    agentId: Schema.String,
    conversationId: Schema.String,
    turnId: Schema.String,
    requestId: Schema.String,
    toolUseId: Schema.String,
    ask: agentPendingApprovalSchema,
    at: Schema.Date,
  }),
  Result: IdSchema,
  execute: ({ at, ...asked }) =>
    Database.use((db) =>
      db
        .insert(agentApproval)
        .values({ ...asked, status: APPROVAL_STATUS.PENDING, createdAt: at })
        // A runner posting its batch again lands nothing twice.
        .onConflictDoNothing({ target: [agentApproval.conversationId, agentApproval.requestId] })
        .returning({ id: agentApproval.id }),
    ),
});

const settleByRunner = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    requestId: Schema.String,
    status: Schema.Literals(STATUSES),
    settledBy: Schema.Literals(SETTLED_BY),
    at: Schema.Date,
  }),
  Result: IdSchema,
  execute: ({ conversationId, requestId, status, settledBy, at }) =>
    Database.use((db) =>
      db
        .update(agentApproval)
        .set({
          status,
          settledBy,
          // A member's answer already recorded keeps the instant it landed at.
          settledAt: sql`coalesce(${agentApproval.settledAt}, ${at}::timestamptz)`,
        })
        .where(
          and(
            eq(agentApproval.conversationId, conversationId),
            eq(agentApproval.requestId, requestId),
            // Pending, or settled by a member's answer, which the runner's word of the answer it took stands over.
            or(pending, eq(agentApproval.settledBy, APPROVAL_SETTLED_BY.MEMBER)),
          ),
        )
        .returning({ id: agentApproval.id }),
    ),
});

const expireOfTurn = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String, at: Schema.Date }),
  Result: IdSchema,
  execute: ({ conversationId, turnId, at }) =>
    Database.use((db) =>
      db
        .update(agentApproval)
        .set({
          status: APPROVAL_STATUS.EXPIRED,
          settledBy: APPROVAL_SETTLED_BY.ENDED,
          settledAt: at,
        })
        .where(
          and(
            eq(agentApproval.turnId, turnId),
            eq(agentApproval.conversationId, conversationId),
            pending,
          ),
        )
        .returning({ id: agentApproval.id }),
    ),
});

const findReached = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    approvalId: Schema.optionalKey(Schema.String),
    pendingOnly: Schema.Boolean,
  }),
  Result: ApprovalRowSchema,
  execute: ({ userId, agentId, approvalId, pendingOnly }) =>
    Database.use((db) =>
      db
        .select(approvalColumns)
        .from(agentApproval)
        .innerJoin(agentTable, eq(agentTable.id, agentApproval.agentId))
        .where(
          and(
            eq(agentApproval.agentId, agentId),
            approvalId === undefined ? undefined : eq(agentApproval.id, approvalId),
            pendingOnly ? pending : undefined,
            agentVisibleTo(userId),
          ),
        )
        .orderBy(asc(agentApproval.createdAt), asc(agentApproval.id)),
    ),
});

const settleByMember = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    approvalId: Schema.String,
    userId: Schema.String,
    status: Schema.Literals(STATUSES),
    at: Schema.Date,
  }),
  Result: ApprovalRowSchema,
  execute: ({ agentId, approvalId, userId, status, at }) =>
    Database.use((db) =>
      db
        .update(agentApproval)
        .set({
          // A row the runner already settled as a member's answer keeps what the runner took.
          status: sql`case when ${pending} then ${status} else ${agentApproval.status} end`,
          settledBy: APPROVAL_SETTLED_BY.MEMBER,
          decidedByUserId: userId,
          settledAt: sql`coalesce(${agentApproval.settledAt}, ${at}::timestamptz)`,
        })
        .where(
          and(
            eq(agentApproval.id, approvalId),
            eq(agentApproval.agentId, agentId),
            // Pending, or settled by the runner's word of a member's answer that no member's settle has recorded yet.
            or(
              pending,
              and(
                eq(agentApproval.settledBy, APPROVAL_SETTLED_BY.MEMBER),
                isNull(agentApproval.decidedByUserId),
              ),
            ),
            sql`exists (select 1 from ${agentTable} where ${agentTable.id} = ${agentApproval.agentId} and ${agentVisibleTo(userId)})`,
          ),
        )
        .returning(approvalColumns),
    ),
});

/** That the ask is the member's own claim: settled by their answer, before the runner's word of it. */
function claimedBy(userId: string) {
  return and(
    eq(agentApproval.settledBy, APPROVAL_SETTLED_BY.MEMBER),
    eq(agentApproval.decidedByUserId, userId),
  );
}

const reopenClaim = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    approvalId: Schema.String,
    userId: Schema.String,
  }),
  Result: ApprovalRowSchema,
  execute: ({ agentId, approvalId, userId }) =>
    Database.use((db) =>
      db
        .update(agentApproval)
        .set({
          status: APPROVAL_STATUS.PENDING,
          settledBy: null,
          decidedByUserId: null,
          settledAt: null,
        })
        .where(
          and(
            eq(agentApproval.id, approvalId),
            eq(agentApproval.agentId, agentId),
            claimedBy(userId),
          ),
        )
        .returning(approvalColumns),
    ),
});

const expireClaim = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    approvalId: Schema.String,
    userId: Schema.String,
    at: Schema.Date,
  }),
  Result: ApprovalRowSchema,
  execute: ({ agentId, approvalId, userId, at }) =>
    Database.use((db) =>
      db
        .update(agentApproval)
        .set({
          status: APPROVAL_STATUS.EXPIRED,
          settledBy: APPROVAL_SETTLED_BY.ENDED,
          decidedByUserId: null,
          settledAt: at,
        })
        .where(
          and(
            eq(agentApproval.id, approvalId),
            eq(agentApproval.agentId, agentId),
            claimedBy(userId),
          ),
        )
        .returning(approvalColumns),
    ),
});

/**
 * Lands an ask the runner of the agent whose conversation is named posted,
 * pending, under the turn named; answers whether this call landed it, which
 * one posted again, or of a conversation no agent holds, does not.
 */
export function recordApprovalAsked(asked: ApprovalAsked): ApprovalEffect<boolean> {
  return Effect.gen(function* () {
    const agents = yield* findAgentOfConversation({ conversationId: asked.conversationId });
    const agent = agents[0];
    if (agent === undefined) return false;
    const id = randomUUID();
    const landed = yield* insertAsked({
      id,
      agentId: agent.id,
      conversationId: asked.conversationId,
      turnId: asked.turnId,
      requestId: asked.requestId,
      toolUseId: asked.toolUseId,
      ask: {
        id,
        toolUseId: asked.toolUseId,
        ...(asked.subagentId === null ? undefined : { subagentId: asked.subagentId }),
        toolName: asked.toolName,
        title: asked.title,
        ...(asked.description === null ? undefined : { description: asked.description }),
        input: asked.input,
        askedAt: asked.at.getTime(),
      },
      at: asked.at,
    });
    return landed.length > 0;
  });
}

/**
 * Settles the ask the CLI's id names as its runner said it was: pending, or
 * answered by a member, whose answer the runner's word stands over; one
 * settled any other way stands. Answers whether this call wrote it.
 */
export function settleApprovalByRunner(settled: {
  readonly conversationId: string;
  readonly requestId: string;
  readonly status: ApprovalStatus;
  readonly settledBy: ApprovalSettledBy;
  readonly at: Date;
}): ApprovalEffect<boolean> {
  return Effect.map(settleByRunner(settled), (written) => written.length > 0);
}

/** Expires every ask the turn named left pending, as it ends; answers how many. */
export function expireTurnApprovals(
  conversationId: string,
  turnId: string,
  at: Date,
): ApprovalEffect<number> {
  return Effect.map(expireOfTurn({ conversationId, turnId, at }), (expired) => expired.length);
}

/** The asks of the agent named still waiting, the oldest first, where the member sees the agent; none otherwise. */
export function listPendingApprovals(
  userId: string,
  agentId: string,
): ApprovalEffect<readonly AgentApprovalRow[]> {
  return findReached({ userId, agentId, pendingOnly: true });
}

/** One ask of the agent named, however it stands, where the member sees the agent; none otherwise. */
export function readApproval(
  userId: string,
  agentId: string,
  approvalId: string,
): ApprovalEffect<Option.Option<AgentApprovalRow>> {
  return Effect.map(findReached({ userId, agentId, approvalId, pendingOnly: false }), (rows) =>
    Option.fromNullishOr(rows[0]),
  );
}

/**
 * Settles a pending ask of the agent named as the member's answer says,
 * recording them as who decided, where they see the agent, or records them
 * on one the runner settled as a member's answer before this settle landed;
 * answers the ask as it then stands, or none where it no longer waits or
 * they do not see it.
 */
export function answerApproval(answer: {
  readonly userId: string;
  readonly agentId: string;
  readonly approvalId: string;
  readonly status: ApprovalStatus;
  readonly at: Date;
}): ApprovalEffect<Option.Option<AgentApprovalRow>> {
  return Effect.map(settleByMember(answer), (rows) => Option.fromNullishOr(rows[0]));
}

/**
 * Hands back a member's claim of an ask whose answer never reached the
 * runner: pending again where the runner could not be reached just now, so
 * another answer may take it, or expired where no runner holds the ask at
 * all. Only the member's own claim is touched; answers the ask as it then
 * stands, or none where it is no longer their claim.
 */
export function releaseApprovalClaim(release: {
  readonly agentId: string;
  readonly approvalId: string;
  readonly userId: string;
  readonly to: typeof APPROVAL_STATUS.PENDING | typeof APPROVAL_STATUS.EXPIRED;
  readonly at: Date;
}): ApprovalEffect<Option.Option<AgentApprovalRow>> {
  const { to, at, ...claim } = release;
  const released =
    to === APPROVAL_STATUS.PENDING ? reopenClaim(claim) : expireClaim({ ...claim, at });
  return Effect.map(released, (rows) => Option.fromNullishOr(rows[0]));
}
