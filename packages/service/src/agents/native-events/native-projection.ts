import { nativeTurnId, reasoningItemId } from "@repo/database/models/ids";
import { CLAUDE_CODE_UNRECORDED_TOOL } from "@repo/features/agent-tools";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { type WireValue, WireValueSchema } from "@repo/wire";
import { USAGE_LIMIT_AGENT } from "@repo/wire/ui-messages";
import { Option, Schema } from "effect";
import {
  addModelUsage,
  finishedSentencesOf,
  RUN_EVENT,
  RUN_STATUS,
  type RunEvent,
  type RunEventBody,
  type RunStatus,
  type RunUsage,
  sessionKey,
  TURN_FAILURE,
  type TurnFailure,
} from "../../core.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import { CODER_REFUSAL } from "../coder-host/bounds.js";
import { SESSION_TURN, SESSION_TURN_KIND } from "../sessions/agent-sessions.js";
import {
  NATIVE_ENDING,
  NATIVE_MOMENT,
  type NativeContextUsage,
  type NativeMoment,
  PLAN_STATUS,
  type PlanStatus,
} from "./native-moments.js";

/**
 * native-projection.ts -- a native harness's moments folded into the store writer's events.
 *
 * A coding agent on a native harness runs one turn per launch of its runner:
 * the turn opens at the first sign of work (the line we handed it, the
 * harness's start, or its first words) and ends with the launch, so a model
 * turn that ends with background work or a wakeup still to come leaves the
 * agent's turn running. Inside it each model call
 * is a step; its words are told the writer a finished sentence at a time
 * while they form, and whole once the step is over; each call stands in the
 * record before its answer and settles with it; reasoning joins under an id
 * minted from the step. The turn's journal is the record of its work, and
 * the writer closes it with the turn's end, keeping a coding agent's words,
 * so no answer is rebuilt from what the projection held. The usage of each
 * model turn is summed onto the turn and settled with it, on the model the
 * agent ran on. What the projection holds between the runner's batches is
 * this file's `NativeProjection`, small whatever the run's length: the turn,
 * its step, the step's words so far, and the calls it holds by name.
 *
 * The projection is pure: it answers the state it moved to and the writes,
 * in order, that the route makes under the conversation's lock
 * (`runner-events-app.ts`), so a test reads what a stream amounts to
 * without a database.
 */

/** The harness's own tools a call of which the record leaves out without reporting it. */
const UNRECORDED_TOOLS: ReadonlySet<string> = new Set(Object.values(CLAUDE_CODE_UNRECORDED_TOOL));

/** How a turn may find the credential that paid refused: a key or sign-in not accepted, or a plan not eligible. */
const REFUSED_STATUSES: ReadonlySet<PlanStatus> = new Set([
  PLAN_STATUS.INVALID,
  PLAN_STATUS.INELIGIBLE,
]);

/** A step's words: those it completed, those still forming, and how much of them the writer was told. */
const DraftSchema = Schema.Struct({
  completed: Schema.String,
  forming: Schema.String,
  told: Schema.Number,
});
type Draft = typeof DraftSchema.Type;

const EMPTY_DRAFT: Draft = { completed: "", forming: "", told: 0 };

const StepSchema = Schema.Struct({
  /** The harness's own id for the model call's answer, where it named one. */
  key: Schema.optionalKey(Schema.String),
  /** Whether the step takes more of its call's answer; a closed step's next words open another. */
  open: Schema.Boolean,
  draft: DraftSchema,
  /** How many reasoning summaries the step told, which numbers the next one's id. */
  reasoning: Schema.Number,
});
type Step = typeof StepSchema.Type;

const UsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  reasoningTokens: Schema.Number,
  cacheWriteTokens: Schema.optionalKey(Schema.Number),
});

/** A call whose subagent runs on in the background, and its input as it stood when it answered, which it settles with. */
const SubagentSchema = Schema.Struct({
  callId: Schema.String,
  input: Schema.optionalKey(WireValueSchema),
  /** Whether its call has settled, so a later word of the same subagent settles nothing twice. */
  settled: Schema.optionalKey(Schema.Boolean),
});

const TurnSchema = Schema.Struct({
  /** The store's id for the turn. */
  id: Schema.String,
  /** When the turn opened, in epoch milliseconds; absent on a turn kept from before it was recorded. */
  openedAt: Schema.optionalKey(Schema.Number),
  /** The number of the last event told the writer for the turn, which numbers its next. */
  told: Schema.Number,
  /** How many steps the turn has opened. */
  steps: Schema.Number,
  step: Schema.optionalKey(StepSchema),
  /** The calls the turn holds, by id, under the name each is stored under. */
  calls: Schema.Record(Schema.String, Schema.String),
  /**
   * The calls it holds that are still unanswered, by id, each with when it
   * started in epoch milliseconds; absent on a turn kept from before it was
   * recorded, whose open calls are not known (`turnProgressed`).
   */
  running: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  /** Whether the harness ended its model turn with background work still in flight, and waits on it (`NATIVE_MOMENT.WAITING`) with no step opened since. */
  waiting: Schema.optionalKey(Schema.Boolean),
  /** The calls whose subagents run on in the background, by the key their end is named by (`NATIVE_MOMENT.SUBAGENT_RUNNING`). */
  subagents: Schema.optionalKey(Schema.Record(Schema.String, SubagentSchema)),
  usage: Schema.optionalKey(UsageSchema),
  /** Why the newest model turn failed, where it did. */
  failure: Schema.optionalKey(Schema.String),
  /** Whether the newest model turn failed as the model refused it. */
  refusal: Schema.optionalKey(Schema.Boolean),
  /** The model's refusal of the model turn under way, said ahead of its result, which it fails (`NATIVE_MOMENT.REFUSED`). */
  refusing: Schema.optionalKey(Schema.String),
  /** The compaction the model turn under way could not make, said ahead of its result, and why that turn failed where it did. */
  compactionFailed: Schema.optionalKey(Schema.String),
  /** Whether the plan's limit refused the turn, a failure its user expects. */
  limited: Schema.optionalKey(Schema.Boolean),
  /** Whether the provider refused the credential that paid, such as a key expired or a plan signed out. */
  refused: Schema.optionalKey(Schema.Boolean),
  /** Whether the turn's launch ended on the plan's limit and the turn waits, still open, for a launch on the next payer to go on with it (`NATIVE_WRITE.RETRY`). */
  retrying: Schema.optionalKey(Schema.Boolean),
  /** The MCP servers mentioned to the agent that this turn took as it started, which its calls are handed whatever the switches say. */
  servers: Schema.optionalKey(Schema.Array(Schema.String)),
});
type Turn = typeof TurnSchema.Type;

/** What the projection keeps between batches. */
const NativeProjectionSchema = Schema.Struct({
  turn: Schema.optionalKey(TurnSchema),
  /** The harness's own session id as last recorded. */
  session: Schema.optionalKey(Schema.String),
  /** The plan's limit as it last refused the harness, kept until it lifts. */
  rateLimit: Schema.optionalKey(Schema.String),
  /** When that limit resets, in epoch milliseconds, where the harness said. */
  rateLimitResetsAt: Schema.optionalKey(Schema.Number),
  /** The running total a harness that reports one (Codex) last reported, which the next report is metered against. */
  metered: Schema.optionalKey(UsageSchema),
  /** When a batch last touched the runner's sandbox (`runner-events-app.ts`), in epoch milliseconds. */
  keptAliveAt: Schema.optionalKey(Schema.Number),
  /** Whether the launch went warm at its turn's IDLE with no turn since, so a failure it ends on is no turn's. */
  warm: Schema.optionalKey(Schema.Boolean),
});
export type NativeProjection = typeof NativeProjectionSchema.Type;

const EMPTY_PROJECTION: NativeProjection = {};

const readProjection = Schema.decodeUnknownOption(NativeProjectionSchema);

/** The projection a conversation kept, or the empty one before its first save or for state no longer read. */
export function heldProjection(saved: WireValue | null): NativeProjection {
  return Option.getOrElse(readProjection(saved), () => EMPTY_PROJECTION);
}

/** The projection with the servers the turn under way took as it started, where that turn is the one named. */
export function withTurnServers(
  state: NativeProjection,
  turnId: string,
  servers: readonly string[],
): NativeProjection {
  const turn = state.turn;
  if (turn === undefined || turn.id !== turnId || servers.length === 0) return state;
  return { ...state, turn: { ...turn, servers: [...servers] } };
}

/** The servers the turn under way took as it started; none where no turn is under way. */
export function turnServersOf(state: NativeProjection): readonly string[] {
  return state.turn?.servers ?? [];
}

/** A write the projection asks of the store, in the order it must land. */
export const NATIVE_WRITE = {
  /** Queue the turn's row, ahead of its start. */
  ENQUEUE: "enqueue",
  /** Hand the writer one event of the turn. */
  EVENT: "event",
  /** Take the awaiting line written under the client id into the turn. */
  TAKE_LINE: "take_line",
  /** Record the harness's session id on the conversation. */
  SESSION: "session",
  /** Record that the store's copy of the session's transcript holds a gap, so it is never resumed. */
  TRANSCRIPT_BROKEN: "transcript_broken",
  /** Record that the harness folded its context. */
  COMPACTED: "compacted",
  /** Record how a turn found the plan that pays for the agent, on its row. */
  PLAN_STATUS: "plan_status",
  /** Record what the newest model call read on the agent's row, which its context ring reads. */
  CONTEXT: "context",
  /** Say a turn's failure in the log, and as an issue where its user did not expect it. */
  FAILED: "failed",
  /** Launch the agent again on the next payer, to go on with the turn its plan's limit cut short. */
  RETRY: "retry",
  /** Hold the turn its plan's limit cut short open until the soonest limit resets, for the minute sweep to go on with it then, where no payer has room now. */
  WAIT: "wait",
} as const;

export type NativeWrite =
  | { readonly kind: typeof NATIVE_WRITE.ENQUEUE; readonly turnId: string }
  | { readonly kind: typeof NATIVE_WRITE.EVENT; readonly event: RunEvent }
  | {
      readonly kind: typeof NATIVE_WRITE.TAKE_LINE;
      readonly turnId: string;
      readonly clientId: string;
    }
  | { readonly kind: typeof NATIVE_WRITE.SESSION; readonly sessionId: string }
  | { readonly kind: typeof NATIVE_WRITE.TRANSCRIPT_BROKEN; readonly sessionId: string }
  | { readonly kind: typeof NATIVE_WRITE.COMPACTED }
  | { readonly kind: typeof NATIVE_WRITE.CONTEXT; readonly usage: NativeContextUsage }
  | {
      readonly kind: typeof NATIVE_WRITE.FAILED;
      readonly turnId: string;
      readonly failure: TurnFailure;
      readonly detail: string;
      /** Whether the turn failed as its user expects, on the plan's limit, which opens no issue. */
      readonly expected: boolean;
      /** Whether the provider refused the credential that paid, which opens no issue where the credential is the starter's own. */
      readonly refused: boolean;
    }
  | { readonly kind: typeof NATIVE_WRITE.RETRY; readonly turnId: string }
  | { readonly kind: typeof NATIVE_WRITE.WAIT; readonly turnId: string; readonly until: number }
  | {
      readonly kind: typeof NATIVE_WRITE.PLAN_STATUS;
      readonly status: PlanStatus;
      /** When a reached limit resets, in epoch milliseconds, where the harness said. */
      readonly resetsAt?: number;
      /** When the turn that found it opened, so a credential saved since is not judged by it. */
      readonly turnOpenedAt?: number;
    };

/** What one event is projected under: its conversation and number, the instant, the launch posting it, the turn its line queued, the model the agent runs on, and which tools the record holds. */
export interface NativeProjectionContext {
  readonly conversationId: string;
  readonly sequence: number;
  readonly now: number;
  /** The launch of the runner posting the event (`agent.runner_launch`), which every turn it starts or ends runs under. */
  readonly attempt: number;
  /** The conversation's turn queued for a line no runner took yet, which the next turn opened is, rather than one minted; none where none is queued. */
  readonly queuedTurnId: string | undefined;
  readonly model: string | undefined;
  /** Whether the starter's own API key pays for the agent, so a refusal of it is theirs to replace in Settings. */
  readonly ownKey: boolean;
  /** Whether another payer has room for a turn the plan's limit cuts short, which then waits for a launch on it rather than failing (`NATIVE_WRITE.RETRY`). */
  readonly retryLimited?: boolean;
  /** Where no other payer has room, when the soonest limit among the starter's other subscriptions resets, which a turn the plan's limit cuts short may wait for rather than fail (`NATIVE_WRITE.WAIT`). */
  readonly resetsBeside?: number | undefined;
  /** Whether the stored tool set holds a call of this name; a call of any other is left out, its answer with it. */
  readonly registered: (name: string) => boolean;
  /** Where a moment the record leaves out is said. */
  readonly report: (message: string) => void;
}

/** The projection as one event moves it, and the writes it asks for. */
export interface Projected {
  readonly state: NativeProjection;
  readonly writes: readonly NativeWrite[];
}

/** Two runs of words as a reply reads them: on lines of their own. */
function joinedWords(head: string, tail: string): string {
  return head.length === 0 ? tail : `${head}\n${tail}`;
}

/** A draft's words a listener may be told while it still forms: through its last finished sentence, or whole where nothing forms. */
function tellable(draft: Draft): string {
  return draft.forming.length === 0
    ? draft.completed
    : finishedSentencesOf(joinedWords(draft.completed, draft.forming));
}

/** The turn with every subagent its call waited on marked settled, as the call is. */
function withSettledSubagents(turn: Turn, callId: string): Turn {
  const held = turn.subagents;
  if (held === undefined) return turn;
  const subagents = Object.fromEntries(
    Object.entries(held).map(([key, subagent]) => [
      key,
      subagent.callId === callId ? { ...subagent, settled: true } : subagent,
    ]),
  );
  return { ...turn, subagents };
}

/** The turn with the call answered: no longer running, and any background subagent under it settled. */
function withSettledCall(turn: Turn, callId: string): Turn {
  const settled = withSettledSubagents(turn, callId);
  if (settled.running === undefined) return settled;
  const { [callId]: _answered, ...running } = settled.running;
  return { ...settled, running };
}

/** Everything one event's moments do, gathered as they are folded. */
class Fold {
  state: NativeProjection;
  readonly writes: NativeWrite[] = [];
  readonly #context: NativeProjectionContext;

  constructor(state: NativeProjection, context: NativeProjectionContext) {
    this.state = state;
    this.#context = context;
  }

  #setTurn(turn: Turn | undefined): void {
    const { turn: _held, ...rest } = this.state;
    this.state = turn === undefined ? rest : { ...rest, turn };
  }

  /** Tells the writer one event of the turn, numbered after the last. */
  #tell(turn: Turn, body: RunEventBody): Turn {
    const told = turn.told + 1;
    this.writes.push({
      kind: NATIVE_WRITE.EVENT,
      event: {
        ...body,
        conversationId: sessionKey(this.#context.conversationId),
        turnId: turn.id,
        sequence: told,
      },
    });
    return { ...turn, told };
  }

  /**
   * The turn under way, opened here where none is: the turn its line
   * queued, where one stands queued, or else one by the event's own number,
   * as a turn the harness opened itself is, on a wakeup or background work
   * ending.
   */
  turn(): Turn {
    const held = this.state.turn;
    if (held !== undefined) return held;
    const { warm: _warm, ...cold } = this.state;
    this.state = cold;
    const id =
      this.#context.queuedTurnId ??
      nativeTurnId(this.#context.conversationId, this.#context.sequence);
    this.writes.push({ kind: NATIVE_WRITE.ENQUEUE, turnId: id });
    const { origin, trigger } = SESSION_TURN_KIND[SESSION_TURN.TYPED];
    const opened = this.#tell(
      { id, told: 0, steps: 0, calls: {}, running: {}, openedAt: this.#context.now },
      {
        kind: RUN_EVENT.TURN_STARTED,
        origin,
        trigger,
        at: this.#context.now,
        attempt: this.#context.attempt,
      },
    );
    this.#setTurn(opened);
    return opened;
  }

  /** The step's words through what may be told now, or whole where `whole`, where the writer was told less. */
  #drafted(turn: Turn, step: Step, whole: boolean): Turn {
    const { completed, forming } = step.draft;
    const text =
      whole && forming.length > 0 ? joinedWords(completed, forming) : tellable(step.draft);
    if (text.length <= step.draft.told) return { ...turn, step };
    const told = this.#tell(turn, {
      kind: RUN_EVENT.TEXT_DRAFTED,
      step: turn.steps,
      text,
    });
    return { ...told, step: { ...step, draft: { ...step.draft, told: text.length } } };
  }

  /** The step's words told whole, and the step closed. */
  #closed(turn: Turn): Turn {
    const step = turn.step;
    if (step === undefined) return turn;
    const told = this.#drafted(turn, step, true);
    return { ...told, step: { ...(told.step ?? step), open: false } };
  }

  /** The step the next part belongs to: the one open, where it is the same model call's, or a new one. */
  #step(key: string | undefined): Turn {
    const turn = this.turn();
    const step = turn.step;
    if (step?.open === true && (key === undefined || step.key === undefined || step.key === key)) {
      if (key === undefined || step.key !== undefined) return turn;
      const keyed = { ...turn, step: { ...step, key } };
      this.#setTurn(keyed);
      return keyed;
    }
    // A step opened is the harness at work again, so whatever it waited on is behind it.
    const { waiting: _waiting, ...closed } = this.#closed(turn);
    const steps = closed.steps + 1;
    const opened = this.#tell({ ...closed, steps }, { kind: RUN_EVENT.STEP_STARTED, step: steps });
    const fresh = { open: true, draft: EMPTY_DRAFT, reasoning: 0 };
    const next: Turn = { ...opened, step: key === undefined ? fresh : { ...fresh, key } };
    this.#setTurn(next);
    return next;
  }

  /** The step's words grown, and told where another sentence finished. */
  #words(grow: (draft: Draft) => Draft): void {
    const turn = this.#step(undefined);
    const step = turn.step;
    if (step === undefined) return;
    this.#setTurn(this.#drafted(turn, { ...step, draft: grow(step.draft) }, false));
  }

  #reasoning(text: string): void {
    const turn = this.#step(undefined);
    const step = turn.step;
    if (step === undefined) return;
    const id = reasoningItemId(this.#context.conversationId, turn.id, turn.steps, step.reasoning);
    const told = this.#tell(turn, {
      kind: RUN_EVENT.REASONING_COMPLETED,
      summary: text,
      item: { id, summary: text },
    });
    this.#setTurn({ ...told, step: { ...step, reasoning: step.reasoning + 1 } });
  }

  #toolStarted(moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.TOOL_STARTED }>): void {
    if (!this.#context.registered(moment.name)) {
      // Note that a call of the harness's own unrecorded tools is left out without a word,
      // because every launch makes them and none is work a record could miss.
      if (!UNRECORDED_TOOLS.has(moment.name)) {
        this.#context.report(`A call to ${moment.name} names no stored tool and is not recorded.`);
      }
      return;
    }
    const turn = this.#step(undefined);
    if (turn.calls[moment.callId] !== undefined) return;
    const told = this.#tell(turn, {
      kind: RUN_EVENT.TOOL_CALL_STARTED,
      callId: moment.callId,
      name: moment.name,
      input: moment.input,
    });
    const held = { ...told, calls: { ...told.calls, [moment.callId]: moment.name } };
    // Note that a turn kept from before its open calls were recorded stays unknown, since a call it opened then is not in them.
    this.#setTurn(
      told.running === undefined
        ? held
        : { ...held, running: { ...told.running, [moment.callId]: this.#context.now } },
    );
  }

  #toolSettled(moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.TOOL_SETTLED }>): void {
    const turn = this.state.turn;
    const name = turn?.calls[moment.callId];
    if (turn === undefined || name === undefined) return;
    this.#setTurn(
      this.#tell(withSettledCall(turn, moment.callId), {
        kind: RUN_EVENT.TOOL_CALL_SETTLED,
        callId: moment.callId,
        name,
        settlement: moment.settlement,
        ...(moment.input !== undefined ? { input: moment.input } : undefined),
      }),
    );
  }

  /** A subagent call kept open while its subagent runs, where the turn holds the call. */
  #subagentRunning(
    moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.SUBAGENT_RUNNING }>,
  ): void {
    const turn = this.state.turn;
    if (turn?.calls[moment.callId] === undefined) return;
    if (turn.subagents?.[moment.key]?.settled === true) return;
    const { callId, input } = moment;
    const subagent = input === undefined ? { callId } : { callId, input };
    this.#setTurn({ ...turn, subagents: { ...turn.subagents, [moment.key]: subagent } });
  }

  /** A background subagent's end, settling the call it runs under; nothing for a key no held call waits on, such as a foreground subagent's, which its answer settled, or one whose call already settled. */
  #subagentEnded(
    moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.SUBAGENT_ENDED }>,
  ): void {
    const turn = this.state.turn;
    const subagent = turn?.subagents?.[moment.key];
    if (turn === undefined || subagent === undefined || subagent.settled === true) return;
    const { callId, input } = subagent;
    this.#toolSettled({
      kind: NATIVE_MOMENT.TOOL_SETTLED,
      callId,
      settlement: moment.settlement,
      ...(input === undefined ? undefined : { input }),
    });
  }

  /**
   * The turn a launch's end settles: the one under way, or, where the launch
   * failed before its first, the turn its line queued, opened for the end so
   * why it failed is kept, and whether it was opened for the end. None for
   * any other end that finds no turn, nor for a warm launch's, whose turn
   * already ended at its IDLE. Note that a launch that fails with no turn
   * under way and none queued, as a warm runner a newer launch cut off does,
   * fails no turn but is said in the log, since no message of the developer's
   * waited on it.
   */
  #endedTurn(
    moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.ENDED }>,
  ): { readonly turn: Turn; readonly openedForEnd: boolean } | undefined {
    const held = this.state.turn;
    if (held !== undefined) return { turn: held, openedForEnd: false };
    if (moment.launchFailed !== true || this.state.warm === true) return undefined;
    if (this.#context.queuedTurnId === undefined) {
      this.#context.report(`A launch with no turn under way ended: ${moment.detail ?? "failed"}`);
      return undefined;
    }
    return { turn: this.turn(), openedForEnd: true };
  }

  /**
   * The turn's end: its words told whole, then its status, cost, and why it
   * failed, where it did. Note that a launch that failed before it took any
   * line, as one whose line reads were refused does, fails its turn as its
   * runner lost rather than as a model call, since no model ran.
   */
  #ended(moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.ENDED }>): void {
    const ended = this.#endedTurn(moment);
    // Note that a limit is the launch's, let go at its end whether or not a turn ends with it:
    // the next launch is refused again or it is not.
    const { warm: _warm, rateLimit, rateLimitResetsAt, ...cold } = this.state;
    this.state = moment.warm === true ? { ...cold, warm: true } : cold;
    if (ended === undefined) return;
    let turn = this.#closed(ended.turn);
    if (this.#retried(turn, ended.openedForEnd, moment.ending, rateLimitResetsAt)) return;
    if (turn.limited === true && moment.ending !== NATIVE_ENDING.STOPPED) {
      turn = this.#limitNotice(turn, null);
    }
    // Note that a refusal its launch ended on before the model turn's result still fails the turn.
    const status = statusOf(moment.ending, turn.failure ?? turn.refusing);
    const failed = status === RUN_STATUS.FAILED;
    const refusal = turn.refusal === true || turn.refusing !== undefined;
    const failure = ended.openedForEnd
      ? TURN_FAILURE.RUNNER_LOST
      : refusal
        ? TURN_FAILURE.REFUSAL
        : TURN_FAILURE.MODEL;
    // Note that a refusal of the starter's own key leads with the coder's word for it, so the window reads the failure as a key to replace rather than a model call failed.
    const ownKeyRefused =
      turn.refused === true && this.#context.ownKey ? CODER_REFUSAL.ACCOUNT_KEY_REFUSED : undefined;
    const detail = [
      ownKeyRefused,
      moment.detail,
      turn.compactionFailed,
      turn.refusing,
      turn.failure,
      rateLimit,
    ]
      .filter((word) => word !== undefined)
      .join("; ");
    const model = this.#context.model;
    this.#tell(turn, {
      kind: RUN_EVENT.TURN_ENDED,
      status,
      ...(failed ? { failure } : undefined),
      ...(failed && detail.length > 0 ? { failureDetail: detail } : undefined),
      ...(turn.usage !== undefined ? { usage: turn.usage } : undefined),
      ...(turn.usage !== undefined && model !== undefined
        ? { usageByModel: [{ model, ...turn.usage }] }
        : undefined),
      responseIds: [],
      at: this.#context.now,
      attempt: this.#context.attempt,
    });
    if (failed) {
      this.writes.push({
        kind: NATIVE_WRITE.FAILED,
        turnId: turn.id,
        failure,
        detail,
        // Note that the model's refusal is its own decision, no fault of ours, so it opens no issue.
        expected: turn.limited === true || rateLimit !== undefined || refusal,
        refused: turn.refused === true,
      });
    }
    this.#setTurn(undefined);
  }

  #limitNotice(turn: Turn, resetsAt: number | null): Turn {
    const provider =
      this.#context.model === undefined
        ? undefined
        : providerModelOf(this.#context.model)?.provider;
    return this.#tell(turn, {
      kind: RUN_EVENT.USAGE_LIMIT_REACHED,
      notice: {
        agent:
          provider === MODEL_PROVIDER.OPENAI ? USAGE_LIMIT_AGENT.CODEX : USAGE_LIMIT_AGENT.CLAUDE,
        resetsAt,
      },
    });
  }

  /**
   * Whether the turn, its plan's limit having cut it short, is kept open for
   * a launch on the next payer rather than ended: where another payer has
   * room (`retryLimited`), launched at once; else where a limit names its
   * reset, the one this launch ended on (`resetsAt`) or another
   * subscription's (`resetsBeside`), held until the soonest of them for the
   * minute sweep to launch then; and only where the launch ended on its own
   * rather than on a Stop. The turn ends nothing and says no failure, so the
   * conversation reads it as still under way; what its model turn failed
   * with is let go, and the launch that goes on with it takes it as its own
   * (`runner-events-app.ts`'s `supersededDropped`). A limit no reset is
   * known of fails the turn, as before.
   */
  #retried(
    turn: Turn,
    openedForEnd: boolean,
    ending: (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING],
    resetsAt: number | undefined,
  ): boolean {
    if (turn.limited !== true || openedForEnd || ending === NATIVE_ENDING.STOPPED) return false;
    const retry = this.#context.retryLimited === true;
    const resets = [resetsAt, this.#context.resetsBeside].filter((at) => at !== undefined);
    const until = retry || resets.length === 0 ? undefined : Math.min(...resets);
    if (!retry && until === undefined) return false;
    if (until !== undefined) turn = this.#limitNotice(turn, until);
    const {
      failure: _failure,
      refusal: _refusal,
      refusing: _refusing,
      compactionFailed: _compaction,
      limited: _limited,
      waiting: _waiting,
      ...kept
    } = turn;
    this.#setTurn({ ...kept, retrying: true });
    this.writes.push(
      until === undefined
        ? { kind: NATIVE_WRITE.RETRY, turnId: turn.id }
        : { kind: NATIVE_WRITE.WAIT, turnId: turn.id, until },
    );
    return true;
  }

  #usage(usage: RunUsage): void {
    const turn = this.turn();
    this.#setTurn({ ...turn, usage: addModelUsage(turn.usage, usage) });
  }

  /** A running total metered: the turn under way takes what it grew by; with no turn under way it is only noted, so it is not metered again. */
  #usageTotal(total: RunUsage): void {
    const grown = usageGrowth(this.state.metered, total);
    this.state = { ...this.state, metered: total };
    const turn = this.state.turn;
    if (turn === undefined || grown === undefined) return;
    this.#setTurn({ ...turn, usage: addModelUsage(turn.usage, grown) });
  }

  #result(failure: string | undefined): void {
    this.#setTurn(settledModelTurn(this.#closed(this.turn()), failure));
  }

  fold(moment: NativeMoment): void {
    switch (moment.kind) {
      case NATIVE_MOMENT.LINE_ACCEPTED: {
        // Note that a turn kept open on its plan's limit is under way again once a launch takes its line.
        const { retrying, ...turn } = this.turn();
        if (retrying !== undefined) this.#setTurn(turn);
        this.writes.push({
          kind: NATIVE_WRITE.TAKE_LINE,
          turnId: turn.id,
          clientId: moment.clientId,
        });
        return;
      }
      case NATIVE_MOMENT.SESSION:
        if (this.state.session === moment.sessionId) return;
        this.state = { ...this.state, session: moment.sessionId };
        this.writes.push({ kind: NATIVE_WRITE.SESSION, sessionId: moment.sessionId });
        return;
      case NATIVE_MOMENT.TRANSCRIPT_BROKEN:
        this.writes.push({ kind: NATIVE_WRITE.TRANSCRIPT_BROKEN, sessionId: moment.sessionId });
        return;
      case NATIVE_MOMENT.ACTIVE:
        this.turn();
        return;
      case NATIVE_MOMENT.STEP:
        this.#step(moment.key);
        return;
      case NATIVE_MOMENT.STEP_CLOSED: {
        const turn = this.state.turn;
        if (turn !== undefined) this.#setTurn(this.#closed(turn));
        return;
      }
      case NATIVE_MOMENT.TEXT_DELTA:
        this.#words((draft) => ({ ...draft, forming: draft.forming + moment.text }));
        return;
      case NATIVE_MOMENT.TEXT:
        this.#words((draft) => ({
          ...draft,
          completed: joinedWords(draft.completed, moment.text),
          forming: "",
        }));
        return;
      case NATIVE_MOMENT.REASONING:
        this.#reasoning(moment.text);
        return;
      case NATIVE_MOMENT.TOOL_STARTED:
        this.#toolStarted(moment);
        return;
      case NATIVE_MOMENT.TOOL_SETTLED:
        this.#toolSettled(moment);
        return;
      case NATIVE_MOMENT.SUBAGENT_RUNNING:
        this.#subagentRunning(moment);
        return;
      case NATIVE_MOMENT.SUBAGENT_ENDED:
        this.#subagentEnded(moment);
        return;
      case NATIVE_MOMENT.USAGE:
        this.#usage(moment.usage);
        return;
      case NATIVE_MOMENT.USAGE_TOTAL:
        this.#usageTotal(moment.total);
        return;
      case NATIVE_MOMENT.CONTEXT:
        // Note that a call that read nothing, as an error the CLI makes up does, leaves the last one standing.
        if (moment.usage.inputTokens > 0) {
          this.writes.push({ kind: NATIVE_WRITE.CONTEXT, usage: moment.usage });
        }
        return;
      case NATIVE_MOMENT.RESULT:
        this.#result(moment.failure);
        return;
      case NATIVE_MOMENT.REFUSED: {
        const turn = this.turn();
        this.#setTurn({ ...turn, refusing: moment.detail });
        return;
      }
      case NATIVE_MOMENT.COMPACTED:
        this.writes.push({ kind: NATIVE_WRITE.COMPACTED });
        return;
      case NATIVE_MOMENT.COMPACTION_FAILED: {
        this.#context.report(moment.detail);
        const turn = this.state.turn;
        if (turn !== undefined) this.#setTurn({ ...turn, compactionFailed: moment.detail });
        return;
      }
      case NATIVE_MOMENT.NOTED:
        this.#context.report(moment.said);
        return;
      case NATIVE_MOMENT.RATE_LIMIT: {
        const { rateLimit: _held, rateLimitResetsAt: _resets, ...rest } = this.state;
        this.state = moment.refused
          ? {
              ...rest,
              rateLimit: moment.detail,
              ...(moment.resetsAt !== undefined
                ? { rateLimitResetsAt: moment.resetsAt }
                : undefined),
            }
          : rest;
        return;
      }
      case NATIVE_MOMENT.PLAN: {
        // Note that a reached limit resets when the limit the harness last reported says.
        const resetsAt =
          moment.status === PLAN_STATUS.LIMIT_REACHED ? this.state.rateLimitResetsAt : undefined;
        const turnOpenedAt = this.state.turn?.openedAt;
        const turn = this.state.turn;
        if (turn !== undefined && moment.status === PLAN_STATUS.LIMIT_REACHED) {
          this.#setTurn({ ...turn, limited: true });
        } else if (turn !== undefined && moment.status === PLAN_STATUS.VERIFIED) {
          const { limited: _limited, ...verified } = turn;
          this.#setTurn(verified);
        } else if (turn !== undefined && REFUSED_STATUSES.has(moment.status)) {
          this.#setTurn({ ...turn, refused: true });
        }
        this.writes.push({
          kind: NATIVE_WRITE.PLAN_STATUS,
          status: moment.status,
          ...(resetsAt !== undefined ? { resetsAt } : undefined),
          ...(turnOpenedAt !== undefined ? { turnOpenedAt } : undefined),
        });
        return;
      }
      case NATIVE_MOMENT.WAITING: {
        // Note that a waiting turn is still under way: its words are told whole and nothing ends.
        const turn = this.state.turn;
        if (turn !== undefined) this.#setTurn({ ...this.#closed(turn), waiting: true });
        return;
      }
      case NATIVE_MOMENT.ENDED:
        this.#ended(moment);
        return;
    }
  }
}

type Usage = typeof UsageSchema.Type;

/**
 * What a running total grew by since the one before: all of it where none
 * was metered or where it is smaller (a new thread counts from nothing), and
 * nothing where it did not grow.
 */
function usageGrowth(before: Usage | undefined, total: Usage): RunUsage | undefined {
  const grown = {
    inputTokens: total.inputTokens - (before?.inputTokens ?? 0),
    outputTokens: total.outputTokens - (before?.outputTokens ?? 0),
    cachedInputTokens: total.cachedInputTokens - (before?.cachedInputTokens ?? 0),
    reasoningTokens: total.reasoningTokens - (before?.reasoningTokens ?? 0),
    cacheWriteTokens: (total.cacheWriteTokens ?? 0) - (before?.cacheWriteTokens ?? 0),
  };
  const counts = Object.values(grown);
  if (counts.some((count) => count < 0)) return total;
  return counts.some((count) => count > 0) ? grown : undefined;
}

/**
 * The turn as one of its model turns ends, failed where `failure` says why:
 * the model's refusal said ahead of the result fails it whatever the result
 * says, and a compaction it could not make leads why it failed, where it
 * did. What the model turn before it failed with is let go, as the newest
 * model turn is the one the turn's end reads.
 */
function settledModelTurn(turn: Turn, failure: string | undefined): Turn {
  const { failure: _held, refusal: _was, refusing, compactionFailed, ...rest } = turn;
  if (refusing === undefined && failure === undefined) return rest;
  const words = [compactionFailed, refusing, failure].filter((word) => word !== undefined);
  return {
    ...rest,
    failure: words.join("; "),
    ...(refusing === undefined ? undefined : { refusal: true }),
  };
}

/** The turn's status by how its launch ended: done, unless its last model turn failed; stopped is canceled. */
function statusOf(
  ending: (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING],
  failure: string | undefined,
): RunStatus {
  switch (ending) {
    case NATIVE_ENDING.DONE:
      return failure === undefined ? RUN_STATUS.SUCCEEDED : RUN_STATUS.FAILED;
    case NATIVE_ENDING.STOPPED:
      return RUN_STATUS.CANCELED;
    case NATIVE_ENDING.FAILED:
      return RUN_STATUS.FAILED;
  }
}

/**
 * Whether a batch of the runner's, applying `applied` events and leaving the
 * projection at `state`, is its turn's progress: what pushes the turn's lease
 * on (`@repo/database`'s `turn-state.ts`), which is the turn's progress
 * deadline. Any event is progress: a step's words streaming, a call or its
 * answer, a subagent's inner work, the turn's end. A heartbeat alone, a batch
 * with no events, proves only that the runner lives, so it is progress only
 * where the turn is expected to be silent: it holds a call still unanswered,
 * since a harness says nothing while a command runs and only answers once it
 * ends, or it waits on background work after its model turn ended. Note that a
 * turn kept from before its open calls were recorded has its heartbeats taken
 * as progress, as every heartbeat was, because a call it opened then may
 * still run; and with no turn under way there is no lease to push.
 */
export function turnProgressed(applied: number, state: NativeProjection): boolean {
  if (applied > 0) return true;
  const turn = state.turn;
  if (turn === undefined) return false;
  if (turn.running === undefined || turn.waiting === true) return true;
  return Object.keys(turn.running).length > 0;
}

/** One event's moments folded into the projection: the state it moves to, and the writes it asks for, in order. */
export function projectMoments(
  state: NativeProjection,
  moments: readonly NativeMoment[],
  context: NativeProjectionContext,
): Projected {
  const fold = new Fold(state, context);
  for (const moment of moments) fold.fold(moment);
  return { state: fold.state, writes: fold.writes };
}
