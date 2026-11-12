/**
 * end-turn-tool.ts -- `end_turn`, a coding agent's last call of a turn in a workspace with Done and follow-ups on: the summary its developer reads as the turn's reply, and the follow-ups it offers them.
 *
 * The call stores nothing of its own: its input stays in the transcript as
 * every call's does, where the panel reads the turn's last one, draws its
 * summary as the reply and its follow-ups in the bar over the agent's box,
 * and where the report to a starter and the reply in Slack read its summary
 * as the turn's final words (`starter-report.ts`'s `lastSaid`). So this door
 * only holds the input to its bounds and refuses what is not one.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "../../core.js";
import { type AgentCall, agentToolRejected, callerAgent } from "../agent-tools.js";

/** The bounds a turn's end is held to: the summary's characters, how many follow-ups, and each one's characters. */
export const END_TURN_BOUNDS = {
  SUMMARY_CHARS: 2_000,
  FOLLOW_UPS: 3,
  FOLLOW_UP_CHARS: 120,
} as const;

/** Why `end_turn` was refused, in words the model can act on. */
const END_TURN_REFUSAL = {
  UNREADABLE: "Not taken: pass summary, and followUps if any came up; nothing else is read.",
  TOO_LONG: (length: number) =>
    `Not taken: the summary is ${length} characters, over the ${END_TURN_BOUNDS.SUMMARY_CHARS} it may spell; cut it to a few short bullets.`,
  TOO_MANY: `Not taken: offer at most ${END_TURN_BOUNDS.FOLLOW_UPS} follow-ups, the ones that matter most.`,
  FOLLOW_UP_TOO_LONG: `Not taken: each follow-up is at most ${END_TURN_BOUNDS.FOLLOW_UP_CHARS} characters; word it as one short message.`,
  NOT_AGENT: "Not taken: only a coding agent ends a turn.",
} as const;

const FOLLOW_UP = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(END_TURN_BOUNDS.FOLLOW_UP_CHARS),
);

const END_TURN_INPUT = Schema.Struct({
  summary: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(END_TURN_BOUNDS.SUMMARY_CHARS)),
    "What you did this turn, as the developer will read it in place of your last message: 2 to 5 short Markdown bullets, each one line, with links where they help, and what you need from them if anything.",
  ),
  followUps: Schema.optionalKey(
    describeWire(
      Schema.Array(FOLLOW_UP).check(Schema.isMaxLength(END_TURN_BOUNDS.FOLLOW_UPS)),
      `Up to ${END_TURN_BOUNDS.FOLLOW_UPS} next steps that really came up this turn, each worded as the message the developer would send you to start it, such as "Show pending invitations on the Members page", at most ${END_TURN_BOUNDS.FOLLOW_UP_CHARS} characters. Leave it out when nothing came up; never invent work.`,
    ),
  ),
});

const readInput = Schema.decodeUnknownResult(END_TURN_INPUT);

/** `end_turn` as a coding agent in a workspace with Done and follow-ups on is offered it: its name, its words, and its input. */
export const END_TURN_TOOL = {
  name: AGENT_TOOL.END_TURN,
  description:
    "End your turn: call this last, once your work for this turn is done or you are waiting on the " +
    "developer, and write nothing after it. Your summary is what the developer reads as your reply, " +
    "so put in it what your last message would have said, briefly. Your follow-ups stand under it as " +
    "a list they tick and send to you with their own words. Ask what you need of them with your " +
    "threads as before; a turn that waits on an answer offers no follow-ups. Calling it again in the " +
    "same turn replaces the last call. Answers `accepted`, or `rejected` and why.",
  inputSchema: END_TURN_INPUT,
} as const;

/** The call's input read, each refusal naming the one thing wrong. */
function readEnd(input: UnparsedWireValue): Result.Result<void, string> {
  if (Result.isSuccess(readInput(input))) return Result.succeed(undefined);
  const { summary, followUps } = isRecord(input) ? input : {};

  if (typeof summary === "string" && summary.trim().length > END_TURN_BOUNDS.SUMMARY_CHARS) {
    return Result.fail(END_TURN_REFUSAL.TOO_LONG(summary.trim().length));
  }

  if (Array.isArray(followUps) && followUps.length > END_TURN_BOUNDS.FOLLOW_UPS) {
    return Result.fail(END_TURN_REFUSAL.TOO_MANY);
  }

  const overlong = Array.isArray(followUps)
    ? followUps.some(
        (each) => typeof each === "string" && each.trim().length > END_TURN_BOUNDS.FOLLOW_UP_CHARS,
      )
    : false;

  return Result.fail(overlong ? END_TURN_REFUSAL.FOLLOW_UP_TOO_LONG : END_TURN_REFUSAL.UNREADABLE);
}

/** One call of `end_turn`: taken where its input holds to its bounds and a coding agent calls it, refused with why otherwise. */
export function runEndTurn(call: AgentCall, input: UnparsedWireValue): Effect.Effect<WireRecord> {
  const read = readEnd(input);

  if (Result.isFailure(read)) return Effect.succeed(agentToolRejected(read.failure));

  if (callerAgent(call.caller) === undefined) {
    return Effect.succeed(agentToolRejected(END_TURN_REFUSAL.NOT_AGENT));
  }

  const answer: WireRecord = { status: ACTION_RESULT_STATUS.ACCEPTED };

  return Effect.succeed(answer);
}
