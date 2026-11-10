/**
 * agent-approval-wire.ts -- how a coding agent's tool calls are answered: its permission mode, and the asks a mode that asks holds for a member, as the service keeps them and a member answers them.
 *
 * A Claude Code agent runs every tool call unasked (`FULL_ACCESS`, the
 * default and every agent's from before modes), asks a member before a file
 * edit or a shell command (`ASK`), or leaves each call to the CLI's own
 * classifier, which asks where it cannot decide (`AUTO`). A Codex agent runs
 * on full access alone. A change of mode reaches the agent from its next
 * turn (`PERMISSION_MODE_APPLIES`): a turn under way runs on the mode it
 * started with.
 *
 * An ask is a tool call the agent's runner holds until it is answered. The
 * service keeps one row for each, pending until a member answers it, a
 * message sent while it waited denies it, a Stop withdraws it, or its turn
 * ends, which expires it. A member who controls the agent answers a pending
 * one (`POST /api/agents/{id}/approvals/{approval}`): allow, allow every call
 * like it for as long as the agent's runner runs, or deny, with words that
 * tell the agent why. One already settled is refused with how it stands
 * (`approval-settled`), and nothing reaches the agent.
 *
 * The agent's summary carries its mode and its pending asks
 * (`agentPendingApprovalSchema`), each with the call's input as its runner cut
 * it, which may hold a command or a file's contents and is read under the
 * rule its transcript is.
 */

import { WireValueSchema } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { trimmedText } from "./text-schema.js";

/** How an agent's tool calls are answered: all unasked, a file edit or a shell command asked first, or each left to the CLI's classifier, which asks where it cannot decide. */
export const AGENT_PERMISSION_MODE = {
  FULL_ACCESS: "full_access",
  ASK: "ask",
  AUTO: "auto",
} as const;

export type AgentPermissionMode =
  (typeof AGENT_PERMISSION_MODE)[keyof typeof AGENT_PERMISSION_MODE];

export const agentPermissionModeSchema = EffectSchema.Literals(
  Object.values(AGENT_PERMISSION_MODE),
);

/**
 * When a change of mode reaches the agent: from its next turn, since a
 * runner reads its mode as it launches. A turn under way, and a message that
 * steers it, run on the mode it started with; an idle runner is launched
 * again on the new one as the next message reaches it.
 */
export const PERMISSION_MODE_APPLIES = {
  NEXT_TURN: "next_turn",
} as const;

export type PermissionModeApplies =
  (typeof PERMISSION_MODE_APPLIES)[keyof typeof PERMISSION_MODE_APPLIES];

export const permissionModeAppliesSchema = EffectSchema.Literals(
  Object.values(PERMISSION_MODE_APPLIES),
);

/**
 * Changing an agent's permission mode (PATCH), which reaches it from its
 * next turn. Only for a member who controls the agent, and a mode that asks
 * only for a Claude Code agent: a Codex agent is refused as not permitted.
 */
export const agentPermissionModeRequestSchema = EffectSchema.Struct({
  permissionMode: agentPermissionModeSchema,
});

export type AgentPermissionModeRequest = typeof agentPermissionModeRequestSchema.Type;

/**
 * Where an ask stands: waiting on a member; allowed once, or for every call
 * like it while the agent's runner runs; denied, by a member's answer or a
 * message sent while it waited; or expired, its turn having ended, a Stop
 * having withdrawn it, or its runner having gone before anyone answered.
 */
export const APPROVAL_STATUS = {
  PENDING: "pending",
  ALLOWED: "allowed",
  ALLOWED_FOR_AGENT: "allowed_for_agent",
  DENIED: "denied",
  EXPIRED: "expired",
} as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

export const approvalStatusSchema = EffectSchema.Literals(Object.values(APPROVAL_STATUS));

/**
 * What settled an ask: a member's answer, a message the member sent while
 * it waited, which denied it with the message's words, a Stop that withdrew
 * it, or its turn's or runner's end.
 */
export const APPROVAL_SETTLED_BY = {
  MEMBER: "member",
  MESSAGE: "message",
  STOP: "stop",
  ENDED: "ended",
} as const;

export type ApprovalSettledBy = (typeof APPROVAL_SETTLED_BY)[keyof typeof APPROVAL_SETTLED_BY];

/** A member's answer to an ask: allow the call, allow it and every call like it while the agent's runner runs, or deny it. */
export const APPROVAL_ANSWER = {
  ALLOW: "allow",
  ALLOW_FOR_AGENT: "allow_for_agent",
  DENY: "deny",
} as const;

export type ApprovalAnswer = (typeof APPROVAL_ANSWER)[keyof typeof APPROVAL_ANSWER];

export const approvalAnswerSchema = EffectSchema.Literals(Object.values(APPROVAL_ANSWER));

/** Where an ask stands once an answer settles it. */
export const APPROVAL_STATUS_OF_ANSWER = {
  [APPROVAL_ANSWER.ALLOW]: APPROVAL_STATUS.ALLOWED,
  [APPROVAL_ANSWER.ALLOW_FOR_AGENT]: APPROVAL_STATUS.ALLOWED_FOR_AGENT,
  [APPROVAL_ANSWER.DENY]: APPROVAL_STATUS.DENIED,
} as const satisfies Record<ApprovalAnswer, ApprovalStatus>;

/** The bounds of an ask as the service keeps it and a member answers it. */
export const APPROVAL_BOUNDS = {
  /** The most characters of a title or a description kept, which the card draws. */
  MAX_TEXT_CHARS: 2_000,
  /** The most bytes of a call's input kept as JSON; one past it is kept as an empty input, since the call stands whole in the transcript. */
  MAX_INPUT_BYTES: 64_000,
  /** The most characters of the words a denial tells the agent. */
  MAX_MESSAGE_CHARS: 4_000,
} as const;

/**
 * Answering an ask (POST): allow, allow for the agent, or deny, and, with a
 * denial alone, the words that tell the agent why.
 */
export const approvalAnswerRequestSchema = EffectSchema.Struct({
  answer: approvalAnswerSchema,
  message: EffectSchema.optionalKey(trimmedText(APPROVAL_BOUNDS.MAX_MESSAGE_CHARS)),
}).check(
  EffectSchema.makeFilter(
    ({ answer, message }) => message === undefined || answer === APPROVAL_ANSWER.DENY,
  ),
);

export type ApprovalAnswerRequest = typeof approvalAnswerRequestSchema.Type;

/**
 * A tool call an agent's runner holds for a member's answer, as the agent's
 * summary carries it while it waits: its own id, which an answer names; the
 * call's id in the transcript (`toolUseId`), so the card stands on the call;
 * the subagent's id that made it, absent for the agent's own; the tool's
 * name; the CLI's sentence for the ask and its subtitle where it gave one;
 * the call's input as its runner cut it; and when it was asked, in epoch
 * milliseconds.
 */
export const agentPendingApprovalSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  toolUseId: EffectSchema.String,
  subagentId: EffectSchema.optionalKey(EffectSchema.String),
  toolName: EffectSchema.String,
  title: EffectSchema.String,
  description: EffectSchema.optionalKey(EffectSchema.String),
  input: EffectSchema.Record(EffectSchema.String, WireValueSchema),
  askedAt: countedNumber,
});

export type AgentPendingApproval = typeof agentPendingApprovalSchema.Type;

/** An answer taken: the ask as it then stands, its status the answer's. */
export const approvalAnswerAnswerSchema = EffectSchema.Struct({
  approval: EffectSchema.Struct({ id: wireUuidSchema, status: approvalStatusSchema }),
});

export type ApprovalAnswerAnswer = typeof approvalAnswerAnswerSchema.Type;

/** What a refused answer carries beside its slug (`approval-settled`): how the ask stands, which the refusal's words name. */
export const approvalSettledDataSchema = EffectSchema.Struct({
  approvalStatus: EffectSchema.optionalKey(approvalStatusSchema),
});
