/**
 * approvals.ts -- a launch's asks: each tool call its harness asks about, in a launch whose mode asks (`PERMISSION_MODE`), posted, held for the member's answer, and settled once, whoever settles it.
 *
 * Claude Code asks through the SDK's `canUseTool`, and Codex through
 * app-server's approval requests (`codex.ts`), each awaiting our answer with
 * no deadline of its own. Each ask is posted as APPROVAL_REQUESTED and
 * waits, by its `requestId`, until one of four settles it: the member's
 * `approval` line, a message the member sends meanwhile, which denies it
 * with the message's words, the harness withdrawing it (the SDK's signal
 * aborted as on a stop's interrupt, or app-server settling it itself), or
 * the launch's end. Whichever comes first takes the ask out of the waiting,
 * posts APPROVAL_RESOLVED, and answers the call in its harness's terms; the
 * rest find it gone, so each ask is answered and resolved exactly once.
 */

import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import { Deferred, Effect, Predicate, Ref, Stream } from "effect";
import type { EventSink } from "./events.js";
import {
  APPROVAL_BY,
  APPROVAL_DECISION,
  APPROVAL_INPUT,
  type ApprovalBy,
  type ApprovalDecision,
  type ContentBlock,
  RUNNER_EVENT,
  type RunnerApprovalRequested,
} from "./protocol.js";

/** What the agent is told of a call denied with no words of the member's. */
const DENIED = "The member denied this.";

/** What settles one waiting ask: its call answered in its harness's terms for the decision, what made it, and the member's words. */
type Settle = (
  decision: ApprovalDecision,
  by: ApprovalBy,
  message: string | undefined,
) => Effect.Effect<void>;

type Waiting = ReadonlyMap<string, Settle>;

/** A launch's asks waiting on the member, by their `requestId`, and where their events go. */
export interface Approvals {
  readonly sink: EventSink;
  readonly waiting: Ref.Ref<Waiting>;
}

/** What the SDK hands `canUseTool` beside the call. */
type AskOptions = Parameters<CanUseTool>[2];

/** A call's input as its ask is posted: each string and list in it cut to `APPROVAL_INPUT`'s bounds. */
export function cutInput(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, cut(value)]));
}

function cut(value: unknown): unknown {
  if (Predicate.isString(value)) {
    return value.length > APPROVAL_INPUT.TEXT_MAX
      ? `${value.slice(0, APPROVAL_INPUT.TEXT_MAX)}…`
      : value;
  }
  if (Array.isArray(value)) return value.slice(0, APPROVAL_INPUT.ITEMS_MAX).map(cut);
  return Predicate.isObject(value) ? cutInput(value) : value;
}

/** The ask as the service is told of it. */
function requested(
  toolName: string,
  input: Record<string, unknown>,
  options: AskOptions,
): RunnerApprovalRequested {
  return {
    type: RUNNER_EVENT.APPROVAL_REQUESTED,
    requestId: options.requestId,
    toolUseId: options.toolUseID,
    ...(options.agentID === undefined ? undefined : { agentId: options.agentID }),
    toolName,
    title: options.title ?? toolName,
    ...(options.description === undefined ? undefined : { description: options.description }),
    input: cutInput(input),
  };
}

/**
 * The SDK's answer to the call for the member's decision. Note that a call
 * allowed for the agent keeps each rule the CLI suggested in the session
 * alone, whatever destination it named, because one written to the
 * checkout's settings would outlive the agent and could be committed.
 */
function answerOf(
  input: Record<string, unknown>,
  suggestions: readonly PermissionUpdate[],
  decision: ApprovalDecision,
  message: string | undefined,
): PermissionResult {
  switch (decision) {
    case APPROVAL_DECISION.ALLOW:
      return { behavior: "allow", updatedInput: input };
    case APPROVAL_DECISION.ALLOW_FOR_AGENT:
      return {
        behavior: "allow",
        updatedInput: input,
        updatedPermissions: suggestions.map((rule) => ({ ...rule, destination: "session" })),
      };
    case APPROVAL_DECISION.DENY:
      return { behavior: "deny", message: message ?? DENIED };
  }
}

/** Settles once the signal aborts: at once where it already has. */
function abortOf(signal: AbortSignal): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void);
    const aborted = () => resume(Effect.void);
    signal.addEventListener("abort", aborted, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", aborted));
  });
}

/** The launch's asks, none waiting yet. */
export const openApprovals = Effect.fn("agent-runner/openApprovals")(function* (sink: EventSink) {
  const waiting = yield* Ref.make<Waiting>(new Map());
  return { sink, waiting } satisfies Approvals;
});

/**
 * Settles the ask `requestId` where it still waits: its APPROVAL_RESOLVED
 * posted, then its call answered as `decision` says, `message` telling the
 * agent why where it is denied. Answers whether it waited. Note that the ask
 * leaves the waiting in the step that finds it, so a second settler finds
 * it gone and posts nothing, and that the settling cannot be interrupted, so
 * an ask taken out of the waiting is always answered: a launch's end
 * interrupts the line that may be settling one.
 */
export const settleAsk = Effect.fn("agent-runner/settleAsk")(function* (
  approvals: Approvals,
  requestId: string,
  decision: ApprovalDecision,
  by: ApprovalBy,
  message?: string,
) {
  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const settle = yield* Ref.modify(
        approvals.waiting,
        (waiting): readonly [Settle | undefined, Waiting] => {
          const found = waiting.get(requestId);
          if (found === undefined) return [undefined, waiting];
          const left = new Map(waiting);
          left.delete(requestId);
          return [found, left];
        },
      );
      if (settle === undefined) return false;
      const resolved = { type: RUNNER_EVENT.APPROVAL_RESOLVED, requestId, decision, by } as const;
      yield* approvals.sink.emit(resolved);
      yield* settle(decision, by, message);
      return true;
    }),
  );
});

/** Denies every ask still waiting, as `by` says, `message` telling the agent why where one is given. */
export const denyWaiting = Effect.fn("agent-runner/denyWaiting")(function* (
  approvals: Approvals,
  by: ApprovalBy,
  message?: string,
) {
  for (const requestId of (yield* Ref.get(approvals.waiting)).keys()) {
    yield* settleAsk(approvals, requestId, APPROVAL_DECISION.DENY, by, message);
  }
});

/** Denies every ask still waiting for a message the member sent meanwhile, with its text as the reason, or the default where it has none. */
export const denyForMessage = Effect.fn("agent-runner/denyForMessage")(function* (
  approvals: Approvals,
  content: readonly ContentBlock[],
) {
  const words = content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();
  yield* denyWaiting(approvals, APPROVAL_BY.MESSAGE, words === "" ? undefined : words);
});

/**
 * One ask, posted and held until something settles it: answers the call as
 * `answer` puts the settling in the harness's terms. Where the harness can
 * withdraw it (`withdrawn`), that denies it, unless something settled it first.
 */
export function holdAsk<A>(
  approvals: Approvals,
  requested: RunnerApprovalRequested,
  answer: (decision: ApprovalDecision, by: ApprovalBy, message: string | undefined) => A,
  withdrawn?: Effect.Effect<void>,
): Effect.Effect<A> {
  return Effect.gen(function* () {
    const { requestId } = requested;
    const answered = yield* Deferred.make<A>();
    const settle: Settle = (decision, by, message) =>
      Deferred.succeed(answered, answer(decision, by, message)).pipe(Effect.asVoid);
    yield* Ref.update(approvals.waiting, (waiting) => new Map(waiting).set(requestId, settle));
    yield* approvals.sink.emit(requested);
    if (withdrawn !== undefined) {
      const gone = yield* Effect.raceFirst(
        Effect.as(Deferred.await(answered), false),
        Effect.as(withdrawn, true),
      );
      if (gone) yield* settleAsk(approvals, requestId, APPROVAL_DECISION.DENY, APPROVAL_BY.ABORTED);
    }
    return yield* Deferred.await(answered);
  });
}

/** One call the CLI asked about: posted, held until something settles it, and answered as it was settled. */
const ask = Effect.fn("agent-runner/ask")(function* (
  approvals: Approvals,
  toolName: string,
  input: Record<string, unknown>,
  options: AskOptions,
) {
  const suggestions = options.suggestions ?? [];
  return yield* holdAsk(
    approvals,
    requested(toolName, input, options),
    (decision, _by, message) => answerOf(input, suggestions, decision, message),
    // The CLI withdrawing the ask denies it.
    abortOf(options.signal),
  );
});

/**
 * The SDK's `canUseTool` over the launch's asks. Note that the SDK awaits a
 * promise, so each ask runs as a stream of its one answer, as the launch's
 * prompts run as a stream the SDK reads; one that ended with no answer,
 * which an ask's never does, denies the call.
 */
export function canUseToolOf(approvals: Approvals): CanUseTool {
  return async (toolName, input, options) => {
    const answers = Stream.toAsyncIterable(
      Stream.fromEffect(ask(approvals, toolName, input, options)),
    );
    for await (const answer of answers) return answer;
    return { behavior: "deny", message: DENIED };
  };
}
