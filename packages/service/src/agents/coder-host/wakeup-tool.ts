/**
 * wakeup-tool.ts -- `schedule_wakeup`: a coding agent's booking of a wakeup for later, on either harness.
 *
 * An agent waiting on something slow, its pull request's checks most of
 * all, books a prompt and a delay, ends its turn, and a queue message
 * delayed until then hands the prompt back as a line of the agent's own
 * (`agent-wakeups.ts`), which opens its next turn. A booking the queue did
 * not take is deleted and refused, so the agent books again rather than
 * waiting on a wakeup that never comes. Note
 * that Claude Code's CLI is denied its own `ScheduleWakeup`
 * (`@repo/agent-runner`'s `CLAUDE_CODE_TOOLS`), because the runner would
 * hold the CLI, and so its sandbox, up for the whole wait, where this one
 * lets the sandbox stop once the turn has ended. A message that reaches
 * the agent first, GitHub's that every check finished among them, opens a
 * turn as any message does, so the wakeup pre-empts nothing and is canceled
 * then with `stop: true`. Each call names its choice in `stop`, required:
 * `false` books and needs a delay and a prompt, and `true` cancels and
 * takes no other field. One booking stands per agent: booking again
 * replaces it, and a cancel drops it (`@repo/database/models/agent-wakeups`). The
 * delay is held to a minute through 7 days less an hour, the longest a
 * queue message is kept less the hour it is kept past due, and the instant
 * booked is answered so the agent reads what it got. Note that a call
 * written in the words of Claude Code's own `ScheduleWakeup`, its delay
 * under `seconds`, `delay_seconds`, or `minutes`, or its prompt under
 * `reason`, is refused with the described key it meant, so one retry books it.
 */

import type { Agent } from "@repo/database/models/agent-store";
import {
  bookAgentWakeup,
  cancelAgentWakeup,
  deleteAgentWakeup,
} from "@repo/database/models/agent-wakeups";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Clock, Duration, Effect, Predicate, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "../../core.js";
import { type AgentCall, agentToolRejected, callerAgent, orStoreRefusal } from "../agent-tools.js";
import { AGENT_WAKEUP } from "./agent-wakeup-bounds.js";
import { type AgentWakeupServices, AgentWakeups } from "./agent-wakeups.js";

/** The bounds a booked delay is held to, in seconds: a minute, through the longest the queue keeps a message less the time a wakeup is kept past due, 7 days less an hour. */
export const WAKEUP_DELAY = {
  MIN_SECONDS: 60,
  MAX_SECONDS: Duration.toSeconds(
    Duration.subtract(AGENT_WAKEUP.RETAINED_LONGEST, AGENT_WAKEUP.RETAINED_PAST_DUE),
  ),
} as const;

/** The most characters a wakeup's prompt may spell. */
const WAKEUP_PROMPT_CHARS = 4_000;

/** A second, in milliseconds. */
const SECOND_MS = 1_000;

/** What a call asks to do, in the words the refusals use. */
const ASK_WORDS =
  "pass stop: false with delaySeconds and prompt to book a wakeup, or stop: true and nothing else to cancel the one you booked";

/** Why `schedule_wakeup` booked nothing, in words the model can act on. */
const WAKEUP_REFUSAL = {
  NO_STOP: `Not booked: stop is required, true or false; ${ASK_WORDS}.`,
  NO_DELAY:
    "Not booked: stop: false needs delaySeconds, a whole number of seconds from now to wake up.",
  BAD_DELAY: "Not booked: delaySeconds must be a whole number of seconds, 1 or more.",
  NO_PROMPT: "Not booked: stop: false needs prompt, what to do once the wakeup fires.",
  BAD_PROMPT: "Not booked: prompt must be words, not empty.",
  TOO_LONG: (length: number) =>
    `Not booked: the prompt is ${length} characters, over the ${WAKEUP_PROMPT_CHARS} one may spell; cut it to fit.`,
  STOP_TAKES_NOTHING: (keys: readonly string[]) =>
    `Not canceled: stop: true takes no ${keys.join(" or ")}; leave ${keys.length > 1 ? "them" : "it"} out to cancel, or pass stop: false to book.`,
  UNKNOWN: (key: string) => `Not booked: schedule_wakeup takes no ${key}; ${ASK_WORDS}.`,
  NOT_AGENT: "Not booked: only a coding agent books a wakeup.",
  NOT_PUBLISHED: "Not booked: the wakeup could not be scheduled just now; book it again.",
  RENAMED: (key: string, described: string) =>
    `Not booked: schedule_wakeup takes no ${key}; pass ${described}.`,
} as const;

const delayValue = describeWire(
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  `Seconds from now to wake up, held to ${WAKEUP_DELAY.MIN_SECONDS} through ${WAKEUP_DELAY.MAX_SECONDS}, a minute through 7 days less an hour. Required when stop is false; refused when stop is true.`,
);

const promptValue = describeWire(
  Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(WAKEUP_PROMPT_CHARS)),
  "What to do once it fires, as the first line of your next turn, such as `Read the checks on pull request #<number>`. Required when stop is false; refused when stop is true.",
);

/**
 * The tool's input. Note that it stays one flat object, because a tool's
 * input must be an object at its top, and because the panel, released
 * desktops' among them, reads `stop` and `delaySeconds` off a stored call;
 * `stop` is the required choice between a booking and a cancel, and
 * `readAsk` holds which fields each takes.
 */
const SCHEDULE_WAKEUP_INPUT = Schema.Struct({
  stop: describeWire(
    Schema.Boolean,
    "false to book a wakeup, with delaySeconds and prompt; true to cancel the wakeup you booked, such as once what you waited on reached you first, with no other field.",
  ),
  delaySeconds: Schema.optionalKey(delayValue),
  prompt: Schema.optionalKey(promptValue),
});

const readDelay = Schema.decodeUnknownResult(delayValue);
const readPrompt = Schema.decodeUnknownResult(promptValue);

/** The fields a booking takes, which a cancel refuses. */
const BOOKING_KEYS = ["delaySeconds", "prompt"] as const;

/** Every key the input takes. */
const INPUT_KEYS: ReadonlySet<string> = new Set(["stop", ...BOOKING_KEYS]);

/** The keys Claude Code's own `ScheduleWakeup` taught its agents, each with the described input it means. */
const CLAUDE_CODE_KEYS = [
  { key: "delay_seconds", described: "the delay as delaySeconds, a whole number of seconds" },
  { key: "seconds", described: "the delay as delaySeconds, a whole number of seconds" },
  { key: "minutes", described: "the delay as delaySeconds, a whole number of seconds" },
  { key: "reason", described: "what to do once the wakeup fires as prompt" },
] as const;

/** `schedule_wakeup` as a coding agent is offered it: its name, its words, and its input. */
export const SCHEDULE_WAKEUP_TOOL = {
  name: AGENT_TOOL.SCHEDULE_WAKEUP,
  description:
    "Book a wakeup for later with stop: false, a delay, and a prompt: end your turn once you have " +
    "booked it, and when the delay has run the prompt reaches you as a line of your own, which " +
    "starts your next turn. Use it to wait on something slow, such as your pull request's checks, " +
    "rather than polling or sleeping in your shell, which holds your sandbox up. The delay is held " +
    `to ${WAKEUP_DELAY.MIN_SECONDS} through ${WAKEUP_DELAY.MAX_SECONDS} seconds, a minute through ` +
    "7 days less an hour; wait longer by booking again when it fires. One wakeup stands at a time: " +
    "booking again replaces it, and stop: true, with no other field, cancels it. A message that " +
    "reaches you first, such as GitHub's that every check finished, starts a turn on its own, so " +
    "cancel the wakeup then.",
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

/** A booking's delay and prompt read, each refusal naming the field that is missing or wrong. */
function readBooking(
  delaySeconds: UnparsedWireValue,
  promptAsked: UnparsedWireValue,
): Result.Result<WakeupAsk, string> {
  if (delaySeconds === undefined) return Result.fail(WAKEUP_REFUSAL.NO_DELAY);
  const delay = readDelay(delaySeconds);

  if (Result.isFailure(delay)) return Result.fail(WAKEUP_REFUSAL.BAD_DELAY);

  if (promptAsked === undefined) return Result.fail(WAKEUP_REFUSAL.NO_PROMPT);
  const prompt = readPrompt(promptAsked);

  if (Result.isSuccess(prompt)) {
    return Result.succeed({
      kind: WAKEUP_ASK.BOOK,
      delaySeconds: delay.success,
      prompt: prompt.success,
    });
  }

  const length = Predicate.isString(promptAsked) ? promptAsked.trim().length : 0;

  return Result.fail(
    length > WAKEUP_PROMPT_CHARS ? WAKEUP_REFUSAL.TOO_LONG(length) : WAKEUP_REFUSAL.BAD_PROMPT,
  );
}

/** The call's input read, strictly by its choice: a cancel takes nothing but stop: true, and a booking needs its delay and prompt; each refusal names the one field wrong. */
function readAsk(input: UnparsedWireValue): Result.Result<WakeupAsk, string> {
  if (!isRecord(input)) return Result.fail(WAKEUP_REFUSAL.NO_STOP);
  const renamed = CLAUDE_CODE_KEYS.find(({ key }) => input[key] !== undefined);

  if (renamed !== undefined) {
    return Result.fail(WAKEUP_REFUSAL.RENAMED(renamed.key, renamed.described));
  }

  const unknown = Object.keys(input).find((key) => !INPUT_KEYS.has(key));

  if (unknown !== undefined) return Result.fail(WAKEUP_REFUSAL.UNKNOWN(unknown));

  if (!Predicate.isBoolean(input.stop)) return Result.fail(WAKEUP_REFUSAL.NO_STOP);

  if (!input.stop) return readBooking(input.delaySeconds, input.prompt);
  const named = BOOKING_KEYS.filter((key) => input[key] !== undefined);

  return named.length === 0
    ? Result.succeed({ kind: WAKEUP_ASK.STOP })
    : Result.fail(WAKEUP_REFUSAL.STOP_TAKES_NOTHING(named));
}

/** The delay as it is held: inside the bounds, whatever was asked. */
function heldDelay(delaySeconds: number): number {
  return Math.min(WAKEUP_DELAY.MAX_SECONDS, Math.max(WAKEUP_DELAY.MIN_SECONDS, delaySeconds));
}

/** One booking for the agent: its wakeup replaced by one due the held delay from now and published to come then, answering the instant and the delay held, or deleted and refused where the queue did not take it. */
const booked = (agent: Agent, delaySeconds: number, prompt: string) =>
  Effect.gen(function* () {
    const held = heldDelay(delaySeconds);
    const now = yield* Clock.currentTimeMillis;
    const at = new Date(now + held * SECOND_MS);
    const wakeupId = yield* bookAgentWakeup(agent.id, { at, prompt });
    const wakeups = yield* AgentWakeups;

    const published = yield* Effect.result(
      wakeups.publish({ wakeupId, delay: Duration.seconds(held) }),
    );

    if (Result.isFailure(published)) {
      yield* Effect.logWarning(`a wakeup was not published: ${published.failure.reason}`);
      yield* deleteAgentWakeup(wakeupId);

      return agentToolRejected(WAKEUP_REFUSAL.NOT_PUBLISHED);
    }

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
): Effect.Effect<WireRecord, never, AgentWakeupServices> {
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
