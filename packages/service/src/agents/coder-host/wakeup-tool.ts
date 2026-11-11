/**
 * wakeup-tool.ts -- `schedule_wakeup`: a coding agent's booking of a wakeup for later, on either harness.
 *
 * An agent waiting on something slow, its pull request's checks most of
 * all, books a prompt and a delay, ends its turn, and the scheduled sweep
 * hands the prompt back as a line of the agent's own once the delay has run
 * (`../../maintenance/wakeup-sweep.ts`), which opens its next turn. Note
 * that Claude Code's CLI is denied its own `ScheduleWakeup`
 * (`@repo/agent-runner`'s `CLAUDE_CODE_TOOLS`), because the runner would
 * hold the CLI, and so its sandbox, up for the whole wait, where this one
 * lets the sandbox stop once the turn has ended. A message that reaches
 * the agent first, GitHub's that every check finished among them, opens a
 * turn as any message does, so the wakeup pre-empts nothing and is canceled
 * then with `stop`. One booking stands per agent: booking again replaces
 * it, and `stop` cancels it (`@repo/database/models/agent-wakeups`). The
 * delay is held to the same bounds Claude Code holds its own to, a minute
 * through an hour, and the instant booked is answered so the agent reads
 * what it got.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { bookAgentWakeup, cancelAgentWakeup } from "@repo/database/models/agent-wakeups";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Clock, Effect, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "../../core.js";
import { type AgentCall, agentToolRejected, callerAgent, orStoreRefusal } from "../agent-tools.js";

/** The bounds a booked delay is held to, in seconds: Claude Code's own for `ScheduleWakeup`. */
export const WAKEUP_DELAY = {
  MIN_SECONDS: 60,
  MAX_SECONDS: 3_600,
} as const;

/** The most characters a wakeup's prompt may spell. */
const WAKEUP_PROMPT_CHARS = 4_000;

/** A second, in milliseconds. */
const SECOND_MS = 1_000;

/** Why `schedule_wakeup` booked nothing, in words the model can act on. */
const WAKEUP_REFUSAL = {
  UNREADABLE:
    "Not booked: pass delaySeconds and a prompt, or stop: true to cancel the wakeup you booked; nothing else is read.",
  NO_DELAY: "Not booked: pass delaySeconds, how long from now to wake up.",
  NO_PROMPT: "Not booked: pass a prompt, what to do once the wakeup fires.",
  TOO_LONG: (length: number) =>
    `Not booked: the prompt is ${length} characters, over the ${WAKEUP_PROMPT_CHARS} one may spell; cut it to fit.`,
  NOT_AGENT: "Not booked: only a coding agent books a wakeup.",
} as const;

const SCHEDULE_WAKEUP_INPUT = Schema.Struct({
  delaySeconds: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      `Seconds from now to wake up, held to ${WAKEUP_DELAY.MIN_SECONDS} through ${WAKEUP_DELAY.MAX_SECONDS}. Required unless stop is true.`,
    ),
  ),
  prompt: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(WAKEUP_PROMPT_CHARS)),
      "What to do once it fires, as the first line of your next turn, such as `Read the checks on pull request #<number>`. Required unless stop is true.",
    ),
  ),
  stop: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true to cancel the wakeup you booked, such as once what you waited on reached you first; nothing else is read then.",
    ),
  ),
});

const readInput = Schema.decodeUnknownResult(SCHEDULE_WAKEUP_INPUT);

/** `schedule_wakeup` as a coding agent is offered it: its name, its words, and its input. */
export const SCHEDULE_WAKEUP_TOOL = {
  name: AGENT_TOOL.SCHEDULE_WAKEUP,
  description:
    "Book a wakeup for later: end your turn once you have booked it, and when the delay has run " +
    "the prompt reaches you as a line of your own, which starts your next turn. Use it to wait on " +
    "something slow, such as your pull request's checks, rather than polling or sleeping in your " +
    `shell, which holds your sandbox up. The delay is held to ${WAKEUP_DELAY.MIN_SECONDS} through ` +
    `${WAKEUP_DELAY.MAX_SECONDS} seconds; wait longer by booking again when it fires. One wakeup ` +
    "stands at a time: booking again replaces it, and stop: true cancels it. A message that reaches " +
    "you first, such as GitHub's that every check finished, starts a turn on its own, so cancel the " +
    "wakeup then. Answers `accepted` with the instant booked and the delay as held, or with no " +
    "wakeup once canceled, or `rejected` and why.",
  inputSchema: SCHEDULE_WAKEUP_INPUT,
} as const;

/** What a call may ask: a booking, or a cancel. */
const WAKEUP_ASK = {
  BOOK: "book",
  STOP: "stop",
} as const;

/** What a call asks: a booking of a delay and a prompt, or a cancel. */
type WakeupAsk =
  | {
      readonly kind: typeof WAKEUP_ASK.BOOK;
      readonly delaySeconds: number;
      readonly prompt: string;
    }
  | { readonly kind: typeof WAKEUP_ASK.STOP };

/** The call's input read, each refusal naming the one thing wrong. */
function readAsk(input: UnparsedWireValue): Result.Result<WakeupAsk, string> {
  const read = readInput(input);
  if (Result.isFailure(read)) {
    const prompt = isRecord(input) ? input.prompt : undefined;
    return Result.fail(
      typeof prompt === "string" && prompt.trim().length > WAKEUP_PROMPT_CHARS
        ? WAKEUP_REFUSAL.TOO_LONG(prompt.trim().length)
        : WAKEUP_REFUSAL.UNREADABLE,
    );
  }
  const { delaySeconds, prompt, stop } = read.success;
  if (stop === true) return Result.succeed({ kind: WAKEUP_ASK.STOP });
  if (delaySeconds === undefined) return Result.fail(WAKEUP_REFUSAL.NO_DELAY);
  if (prompt === undefined) return Result.fail(WAKEUP_REFUSAL.NO_PROMPT);
  return Result.succeed({ kind: WAKEUP_ASK.BOOK, delaySeconds, prompt });
}

/** The delay as it is held: inside the bounds, whatever was asked. */
function heldDelay(delaySeconds: number): number {
  return Math.min(WAKEUP_DELAY.MAX_SECONDS, Math.max(WAKEUP_DELAY.MIN_SECONDS, delaySeconds));
}

/** One booking for the agent: its wakeup replaced by one due the held delay from now, answering the instant and the delay held. */
const booked = (agent: Agent, delaySeconds: number, prompt: string) =>
  Effect.gen(function* () {
    const held = heldDelay(delaySeconds);
    const now = yield* Clock.currentTimeMillis;
    const at = new Date(now + held * SECOND_MS);
    yield* bookAgentWakeup(agent.id, { at, prompt });
    const answer: WireRecord = {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      wakeup: { at: at.toISOString(), delaySeconds: held },
    };
    return answer;
  });

/** One call of `schedule_wakeup`: the calling agent's wakeup booked or canceled, or why neither was. */
export function runScheduleWakeup(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readAsk(input);
  if (Result.isFailure(asked)) return Effect.succeed(agentToolRejected(asked.failure));
  const agent = callerAgent(call.caller);
  if (agent === undefined) return Effect.succeed(agentToolRejected(WAKEUP_REFUSAL.NOT_AGENT));
  const ask = asked.success;
  return orStoreRefusal(
    ask.kind === WAKEUP_ASK.STOP
      ? Effect.as(cancelAgentWakeup(agent.id), {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          wakeup: null,
        } satisfies WireRecord)
      : booked(agent, ask.delaySeconds, ask.prompt),
  );
}
