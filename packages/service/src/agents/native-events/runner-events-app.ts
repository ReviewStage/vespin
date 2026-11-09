import { RUNNER_END, RUNNER_EVENT, type RunnerEnd } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import { RUNNER_LOST_DETAIL, settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import {
  type Agent,
  readAgentOfConversation,
  readAgentRouting,
  recordAgentCompaction,
  recordAgentNativeSession,
  recordAgentStep,
  recordNativeHanded,
  takeAgentMentionedServers,
} from "@repo/database/models/agent-store";
import { markSessionBroken } from "@repo/database/models/claude-session-entries";
import {
  type NativeProjectionRow,
  withNativeProjection,
} from "@repo/database/models/native-projection-store";
import { setPlanStatus } from "@repo/database/models/provider-key-store";
import { acceptRunnerLine } from "@repo/database/models/runner-line-store";
import { progressTurns, queuedTurnOf, supersededTurnsOf } from "@repo/database/models/turn-state";
import {
  type ConversationTarget,
  type QueuedAgentTurn,
  QueuedTurnListener,
  type SettledAgentTurn,
  SettledTurnListener,
  type StoreWriter,
  storeWriter,
} from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";
import { AGENT_PAYER, type AgentPayer } from "@repo/features/agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
} from "@repo/features/provider-key-wire";
import { SANDBOX_IDLE, SANDBOX_TOUCH_EVERY, type Sandbox, touchSandbox } from "@repo/sandbox";
import { HTTP_METHOD, isRecord, type WireValue, WireValueSchema } from "@repo/wire";
import {
  Cause,
  Clock,
  Data,
  Duration,
  Effect,
  ErrorReporter,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  type Scope,
} from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { RUN_EVENT, type RunEvent, TURN_FAILURE, TURN_ORIGIN } from "../../core.js";
import { afterResponse } from "../../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  HOSTED_REFUSAL_STATUS,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../../http/http-effect.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { reopenTaskForWork, settleTaskAfterTurn } from "../../tasks/task-finish.js";
import { agentSandboxName } from "../agent-sandbox-open.js";
import { RUNNER_ENDED, runnerEnded, runnerIdled } from "../coder-host/runner-sessions.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { TURN_PUBLISH, TurnQueue } from "../coder-host/turn-delivery.js";
import { compactNativeTurnHanded } from "../coder-host/turn-message.js";
import {
  admitRunnerBearer,
  presentedBearer,
  presentedLaunch,
  runnerTokenDigest,
} from "../workspace-mcp/bearer.js";
import { claudeCodeMoments } from "./claude-code-moments.js";
import { codexMoments } from "./codex-moments.js";
import type { NativeHeld, NativeMoment } from "./native-moments.js";
import {
  heldProjection,
  NATIVE_WRITE,
  type NativeProjection,
  type NativeWrite,
  projectMoments,
  turnProgressed,
  withTurnServers,
} from "./native-projection.js";
import { redactKeepingPlanCodes } from "./runner-moments.js";

/**
 * runner-events-app.ts -- where a native harness's runner posts its events, which land in the agent's transcript.
 *
 * The runner (`@repo/agent-runner`) posts every message its harness emits,
 * numbered in order, in batches, under the bearer it was launched with, and
 * posts a batch again until we take it. A bearer no standing coding
 * agent's conversation holds, a retired one's among them, is refused before
 * the body is read (`../workspace-mcp/bearer.ts`), as is a post naming a
 * launch other than the one its bearer was recorded as, read again under
 * the lock, so a runner a newer launch replaced applies nothing, even under
 * the bearer its sandbox's firewall now swaps in. The batch is read as moments
 * by the reader of the harness the conversation runs on
 * (`claude-code-moments.ts`, `codex-moments.ts`), folded into the store
 * writer's events
 * (`native-projection.ts`), and written under the conversation's lock in
 * one transaction with the number of the last event applied, so an event
 * already applied is passed over: a batch posted again, or two posts
 * racing, write nothing twice. A write the writer refuses is said in the
 * log and passed over, since the runner
 * posting the batch again would be refused again. The answer names the last
 * event applied, which a relaunch numbers its events after. A post while a
 * turn runs touches the runner's sandbox (`@repo/sandbox`'s `touch`), at
 * most every `SANDBOX_TOUCH_EVERY`, stamped in the projection under the same
 * lock, unless it ends the launch, whose runner uses the sandbox no more; a
 * warm runner with no turn touches nothing, so it cannot keep its own sandbox up.
 * A batch with no events is the runner's heartbeat (`@repo/agent-runner`'s
 * `RUNNER_HEARTBEAT`), posted every minute whatever its harness says, as it
 * may say nothing for an hour while a background command runs; it applies
 * nothing but that. The running turn's progress deadline
 * (`@repo/database/models/turn-state`), which the minute sweep fails it by
 * once it passes, is pushed on only by the turn's progress short of the
 * launch's end (`native-projection.ts`'s `turnProgressed`): any event, or a
 * heartbeat while the turn holds a call still unanswered or waits on
 * background work, so a runner alive with its harness stuck lapses too.
 *
 * Every turn the batch moves runs under the launch its bearer was recorded
 * as (`agent.runner_launch`), read under the lock: a turn the runner opens
 * is the one its line queued, where one stands queued, started under that
 * launch, and a turn still running under an older launch, whose runner this
 * one replaced, is failed as its runner lost before anything else is
 * applied, so its end, which is not coming, waits on no deadline.
 *
 * The route also keeps what
 * the newest model call read on the agent's row for its context ring, the
 * batch's last such reading alone, and once a batch has started or ended a
 * turn, asks for the agent's title where none stands yet
 * (`../coder-host/title.ts`), which names its untitled task with it, once
 * the answer has left (`../../http/after-response.ts`), so the runner never
 * waits on the title model. A turn the batch failed is said in the log once
 * its row is written, by the ids it is found by and its redacted detail,
 * and reported as an issue unless the plan's limit failed it, which its user
 * expects.
 */

/** The path a runner posts its events to. */
export const RUNNER_EVENTS_PATH = "/api/agents/runner-events";

/** The most a batch may hold: the runner's 256 events, a tool's whole answer among them, under the platform's own bound. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The bytes a token stands for in a step's estimate. */
const BYTES_PER_TOKEN = 4;

const RunnerEventBatchSchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      sequence: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      message: WireValueSchema,
    }),
  ),
});
type RunnerEventBatch = typeof RunnerEventBatchSchema.Type;

const readBatch = Schema.decodeUnknownOption(RunnerEventBatchSchema);

/** What a NUL in a runner's event is kept as, since no Postgres text or jsonb value holds one. */
const NUL_KEPT_AS = "\uFFFD";

/** A value with every NUL in its strings, keys included, kept as the replacement character. */
function withoutNul(value: WireValue): WireValue {
  if (Predicate.isString(value)) return value.replaceAll("\u0000", NUL_KEPT_AS);
  if (Array.isArray(value)) return value.map(withoutNul);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      key.replaceAll("\u0000", NUL_KEPT_AS),
      withoutNul(each),
    ]),
  );
}

/**
 * A batch as the store can keep it. Note that a NUL a command printed is
 * replaced rather than refused, because the store refuses it on every post of
 * the batch, which the runner posts again for as long as it runs, so every
 * event behind it would never land and its turn would stand frozen.
 */
function storable(batch: RunnerEventBatch): RunnerEventBatch {
  return {
    events: batch.events.map(({ sequence, message }) => ({
      sequence,
      message: withoutNul(message),
    })),
  };
}

/**
 * The tokens of a value's JSON as a step's estimate tells them: its bytes
 * over four, rounded up, the rule the retired runtime's steps were estimated by.
 */
function estimatedTokens(json: string): number {
  return Math.ceil(new TextEncoder().encode(json).byteLength / BYTES_PER_TOKEN);
}

/**
 * How a harness's messages are read: one message, as its runner posted it,
 * as the moments of the run, with what the projection holds as it is read.
 */
type NativeReader = (message: WireValue, held: NativeHeld) => readonly NativeMoment[];

/** What the batch is applied for: the conversation, its agent, and what that agent runs on. */
interface Applying {
  readonly target: ConversationTarget;
  readonly agentId: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly writer: StoreWriter;
  readonly read: NativeReader;
  /** Who pays for the agent, as recorded as it started; none for an agent from before payers. */
  readonly payer: AgentPayer | undefined;
  /** The description or prompt the agent was handed first, whose share of its context the ring estimates. */
  readonly brief: string;
}

/** The row each plan is kept in, which a turn's word on the plan is written to; a key's payer has none. */
const PLAN_ROW: Partial<
  Record<AgentPayer, { readonly provider: ProviderKeyProvider; readonly kind: ProviderKeyKind }>
> = {
  [AGENT_PAYER.CLAUDE_SUBSCRIPTION]: {
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  },
  [AGENT_PAYER.CHATGPT_SUBSCRIPTION]: {
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  },
};

/** The API key row of the agent's model's provider, which pays for an agent on its starter's key. */
function apiKeyRowOf(
  model: string,
): { readonly provider: ProviderKeyProvider; readonly kind: ProviderKeyKind } | undefined {
  const provider = providerModelOf(model)?.provider;
  return provider === undefined ? undefined : { provider, kind: PROVIDER_KEY_KIND.API_KEY };
}

/** What one post applied: how many events, and the number of the last event the conversation has applied. */
interface Applied {
  readonly applied: number;
  readonly sequence: number | null;
}

/** A run whose sandbox a batch touches: the conversation, and the session its sandbox is named for. */
export interface RunnerAlive {
  readonly target: ConversationTarget;
  readonly sessionId: string | undefined;
}

/** A launch's end the batch applied: the conversation, the session it ran under, the number of its END event, why it ended where the END said, and the launch its post named, where it named one. */
export interface RunnerEnded {
  readonly target: ConversationTarget;
  readonly sessionId: string | undefined;
  readonly sequence: number;
  readonly reason?: RunnerEnd | undefined;
  readonly launch?: number | undefined;
}

/** What the route reads a batch with and tells of a launch's end. */
export interface RunnerEventsOptions<R = never> {
  /** How every conversation's messages are read; by the harness each conversation runs on where left out. */
  readonly read?: NativeReader;
  /**
   * Told once a batch that holds a launch's END has landed, after its
   * transaction: the sandbox's own lifecycle (P08's `runnerEnded`), which
   * stops nothing for a launch since replaced. Nothing where left out.
   */
  readonly ended?: (ended: RunnerEnded) => Effect.Effect<void, never, DatabaseServices | Sandbox>;
  /**
   * Told once a batch that holds a launch's IDLE, and no END after it, has
   * landed, after its transaction: the device's warm runner retired at once
   * where its device waits to update (`sandboxAtRunnerIdle`). Nothing where
   * left out.
   */
  readonly idled?: (idled: RunnerEnded) => Effect.Effect<void, never, DatabaseServices | Sandbox>;
  /**
   * Told once a batch due a touch has landed, after its transaction: the
   * run's sandbox touched (`sandboxTouched`). Nothing where left out.
   */
  readonly alive?: (alive: RunnerAlive) => Effect.Effect<void, never, DatabaseServices | Sandbox>;
  /**
   * Told once a batch that started or ended a turn has landed, after its
   * transaction: the agent's title asked for where none stands
   * (`titleNativeAgent`). Nothing where left out.
   */
  readonly title?: (
    target: ConversationTarget,
    agent: Agent,
  ) => Effect.Effect<void, never, DatabaseServices | R>;
}

/**
 * A run's sandbox touched as a batch of its runner's events lands
 * (`@repo/sandbox`'s `touchSandbox`), which logs a touch the sandbox did not
 * confirm, since the next due batch, a minute on, touches it again.
 */
export function sandboxTouched(alive: RunnerAlive): Effect.Effect<void, never, Sandbox> {
  const { sessionId } = alive;
  if (sessionId === undefined) return Effect.void;
  return touchSandbox(agentSandboxName(sessionId));
}

/**
 * A launch's end as the sandbox hears it (`../coder-host/runner-sessions.ts`'s
 * `runnerEnded`), once the ended runner's last post has its answer, so that
 * post never waits on the runner lease: where a message the launch never
 * took waits, its queued turn is published again for a launch of its own
 * (`../coder-host/turn-delivery.ts`). The sandbox is left to its own idle
 * stop. A read that fails is said in the log and passed over, since the
 * events it ended are already kept.
 */
export function sandboxAtRunnerEnd(
  ended: RunnerEnded,
): Effect.Effect<void, never, DatabaseServices | Sandbox> {
  const { sessionId } = ended;
  if (sessionId === undefined) return Effect.void;
  return afterResponse(
    "a launch's end",
    runnerEnded({
      target: ended.target,
      sessionId,
      sequence: ended.sequence,
      reason: ended.reason,
      launch: ended.launch,
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.flatMap((left) =>
        left === RUNNER_ENDED.LINES_WAITING ? waitingRepublished(ended) : Effect.void,
      ),
      Effect.catch((failure) =>
        Effect.logWarning(`runner-events: a launch's end was not handed on: ${failure._tag}`),
      ),
    ),
  );
}

/**
 * The turn an ended launch's waiting lines await, where it stands queued,
 * published again for its delivery to launch a runner for them. Note that it
 * is published as an event of its own, not under the turn's id, because
 * Queues would drop it as the turn's first publish, whose delivery found the
 * ended runner up.
 */
const waitingRepublished = (ended: RunnerEnded) =>
  Effect.gen(function* () {
    const { userId, conversationId } = ended.target;
    const queued = yield* queuedTurnOf(conversationId);
    if (Option.isNone(queued)) return;
    const queue = yield* TurnQueue;
    yield* queue.publish({ userId, conversationId, turnId: queued.value }, TURN_PUBLISH.UNKEYED);
  });

/**
 * A launch's IDLE as the device hears it: the warm runner retired at once
 * where its device waits to switch release
 * (`../coder-host/runner-sessions.ts`'s `runnerIdled`); it otherwise stays
 * warm, and ends itself past the window. A sandbox's runner is launched to
 * end at its turn's end, so it posts no IDLE. A retire that fails is said in
 * the log and passed over, because the host retires its own warm runners
 * while it waits to update.
 */
export function sandboxAtRunnerIdle(
  idled: RunnerEnded,
): Effect.Effect<void, never, DatabaseServices | Sandbox> {
  const { sessionId } = idled;
  if (sessionId === undefined) return Effect.void;
  return runnerIdled({ target: idled.target, sessionId, sequence: idled.sequence }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`runner-events: the idle runner was not retired: ${failure._tag}`),
    ),
  );
}

/** Which of the batch's writes moved a turn: one started, one ended, or both, as the task follows them. */
interface TurnsMoved {
  readonly started: boolean;
  readonly ended: boolean;
}

/** Whether the writes start a turn, and whether they end one, by the events they carry. */
function turnsMovedBy(writes: readonly NativeWrite[]): TurnsMoved {
  const kinds = new Set(
    writes.flatMap((write) => (write.kind === NATIVE_WRITE.EVENT ? [write.event.kind] : [])),
  );
  return {
    started: kinds.has(RUN_EVENT.TURN_STARTED),
    ended: kinds.has(RUN_EVENT.TURN_ENDED),
  };
}

/** The numbers of the batch's unapplied events of one of the runner's own types. */
function runnerEventsOf(
  batch: RunnerEventBatch,
  after: number | null,
  type: (typeof RUNNER_EVENT)[keyof typeof RUNNER_EVENT],
): readonly number[] {
  return unapplied(batch, after).flatMap(({ sequence, message }) =>
    Predicate.isObject(message) && "type" in message && message.type === type ? [sequence] : [],
  );
}

const decodeEndReason = Schema.decodeUnknownOption(Schema.Literals(Object.values(RUNNER_END)));

/** The END events of the batch not yet applied, in order, each with why its launch ended, where it said a reason this build reads. */
function runnerEndsOf(
  batch: RunnerEventBatch,
  after: number | null,
): readonly { readonly sequence: number; readonly reason: RunnerEnd | undefined }[] {
  return unapplied(batch, after).flatMap(({ sequence, message }) =>
    Predicate.isObject(message) && "type" in message && message.type === RUNNER_EVENT.END
      ? [
          {
            sequence,
            reason: Option.getOrUndefined(
              decodeEndReason("reason" in message ? message.reason : undefined),
            ),
          },
        ]
      : [],
  );
}

const registered = (name: string): boolean => Object.hasOwn(CODER_TOOL_SET, name);

/** The events of the batch not yet applied, in order, each number once. */
function unapplied(batch: RunnerEventBatch, after: number | null): RunnerEventBatch["events"] {
  const seen = new Set<number>();
  return [...batch.events]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => {
      if ((after !== null && event.sequence <= after) || seen.has(event.sequence)) return false;
      seen.add(event.sequence);
      return true;
    });
}

/** A native turn that failed, as its issue names it: by its harness and failure kind, its ids and detail its attributes. */
class NativeTurnFailed extends Data.TaggedError("NativeTurnFailed")<{
  readonly message: string;
  readonly [ErrorReporter.attributes]: Readonly<Record<string, string>>;
}> {}

/** A failed turn of the batch, which it says once its row is written. */
type FailedTurn = Extract<NativeWrite, { kind: typeof NATIVE_WRITE.FAILED }>;

/** Whether the payer is the starter's own credential, whose refusal is theirs to mend rather than ours. */
function paysOwnCredential(payer: AgentPayer | undefined): boolean {
  return payer === AGENT_PAYER.API_KEY || (payer !== undefined && PLAN_ROW[payer] !== undefined);
}

/**
 * Says a turn that failed in the log, and reports it as an issue unless its
 * user expected it: the plan's limit, or a refusal of their own key or plan,
 * such as a key expired. Note that the ids are the log's annotations, never
 * its words, so a line is found by them.
 */
function sayTurnFailed(
  failed: FailedTurn,
  harness: ConversationRuntime,
  payer: AgentPayer | undefined,
  ids: Readonly<Record<string, string>>,
) {
  const attributes = {
    ...ids,
    harness,
    turnId: failed.turnId,
    failure: failed.failure,
    detail: redactKeepingPlanCodes(failed.detail),
  };
  const issue = new NativeTurnFailed({
    message: `a ${harness} turn failed: ${failed.failure}`,
    [ErrorReporter.attributes]: attributes,
  });
  return Effect.andThen(
    Effect.logError("runner-events: a native turn failed").pipe(Effect.annotateLogs(attributes)),
    failed.expected || (failed.refused && paysOwnCredential(payer))
      ? Effect.void
      : ErrorReporter.report(Cause.fail(issue)),
  );
}

/** Says a write the writer refused, which is passed over rather than posted again. */
function reportRefused(what: string, result: Result.Result<unknown, { readonly refusal: string }>) {
  return Result.isFailure(result)
    ? Effect.logWarning(`runner-events: the store refused ${what}: ${result.failure.refusal}`)
    : Effect.void;
}

/** Lands the events gathered so far as one write of the writer. */
function landEvents(applying: Applying, events: readonly RunEvent[]) {
  return Effect.gen(function* () {
    if (events.length === 0) return;
    const results = yield* applying.writer.consumeAll(applying.target, events);
    for (const [index, result] of results.entries()) {
      yield* reportRefused(`a ${events[index]?.kind} event`, result);
    }
  });
}

/** One write the projection asked for, other than an event. */
function landWrite(
  applying: Applying,
  write: Exclude<NativeWrite, { kind: "event" }>,
  now: number,
) {
  const { target, writer } = applying;
  switch (write.kind) {
    case NATIVE_WRITE.ENQUEUE:
      return Effect.flatMap(
        writer.enqueueTurn(target, {
          turnId: write.turnId,
          // A native turn's id is the one a Stop names it by (`coder-host/stop.ts`), since no runtime mints another.
          runtimeTurnId: write.turnId,
          origin: TURN_ORIGIN.TYPED,
          model: applying.model,
          reasoningEffort: applying.reasoningEffort,
        }),
        (result) => reportRefused("a turn's queueing", result),
      );
    case NATIVE_WRITE.TAKE_LINE:
      // The runner's line is stamped taken, so no later launch is handed it again (`runner-lines-app.ts`),
      // and what its words handed the session is kept now that the session has them, in the batch's transaction.
      return Effect.flatMap(
        Effect.andThen(
          Effect.flatMap(
            acceptRunnerLine(target.userId, applying.agentId, write.clientId),
            (handed) =>
              Option.isSome(handed) ? recordNativeHanded(target, handed.value) : Effect.void,
          ),
          writer.takeAwaitingLine(target, { clientId: write.clientId, turnId: write.turnId }),
        ),
        (result) => reportRefused("a line's taking", result),
      );
    case NATIVE_WRITE.SESSION:
      return Effect.asVoid(
        recordAgentNativeSession(target.userId, applying.agentId, write.sessionId),
      );
    case NATIVE_WRITE.TRANSCRIPT_BROKEN:
      // A session whose stored transcript holds a gap is let go at the next launch, which replays the agent's steps.
      return markSessionBroken(target.userId, target.conversationId, write.sessionId);
    case NATIVE_WRITE.COMPACTED:
      // The summary may have dropped what the turns' messages handed, so the next message hands it again.
      return Effect.andThen(
        recordAgentCompaction(target.userId, applying.agentId, new Date(now)),
        compactNativeTurnHanded(target),
      );
    case NATIVE_WRITE.CONTEXT:
      // Note that the harness's own instructions and tools are no text we composed, so they are
      // told as the conversation's share rather than estimated, and the brief alone is estimated.
      return recordAgentStep(target.userId, applying.agentId, {
        ...write.usage,
        systemPromptTokens: 0,
        toolDefinitionTokens: 0,
        briefTokens: estimatedTokens(JSON.stringify(applying.brief)),
        at: now,
      });
    case NATIVE_WRITE.FAILED:
      // Said once the batch has landed, so a turn is said failed only once its row is.
      return Effect.void;
    case NATIVE_WRITE.PLAN_STATUS: {
      // Note that the row is the starter's credential that pays: its plan's, or, for an agent its API key
      // pays for, that key's, which a refusal marks invalid; a plan's limit is no key's.
      const row =
        applying.payer === AGENT_PAYER.API_KEY
          ? write.status === PROVIDER_KEY_STATUS.LIMIT_REACHED
            ? undefined
            : apiKeyRowOf(applying.model)
          : applying.payer === undefined
            ? undefined
            : PLAN_ROW[applying.payer];
      if (row === undefined) return Effect.void;
      return setPlanStatus(
        target.userId,
        row.provider,
        row.kind,
        write.status,
        write.resetsAt === undefined ? undefined : new Date(write.resetsAt),
        new Date(write.turnOpenedAt ?? now),
        new Date(now),
      );
    }
  }
}

/**
 * The writes, in order: the events between two other writes land together
 * as one of the writer's batches, so a turn's journal is rewritten once per
 * run of them rather than once for each.
 */
function landWrites(applying: Applying, writes: readonly NativeWrite[], now: number) {
  return Effect.gen(function* () {
    let events: RunEvent[] = [];
    // Only the newest reading of the context stands, so one batch writes it once.
    const lastContext = writes.findLastIndex((write) => write.kind === NATIVE_WRITE.CONTEXT);
    for (const [index, write] of writes.entries()) {
      if (write.kind === NATIVE_WRITE.CONTEXT && index !== lastContext) continue;
      if (write.kind === NATIVE_WRITE.EVENT) {
        events.push(write.event);
        continue;
      }
      yield* landEvents(applying, events);
      events = [];
      yield* landWrite(applying, write, now);
    }
    yield* landEvents(applying, events);
  });
}

/**
 * The conversation's turns still running under a launch older than the one
 * posting, whose runner this launch replaced, failed as their runner lost,
 * or canceled where a Stop was asked of them; and the projection without the
 * turn it held, where that was one of them, so this launch opens its own.
 */
function supersededDropped(
  applying: Applying,
  state: NativeProjection,
  launch: number,
  now: number,
) {
  return Effect.gen(function* () {
    const { conversationId } = applying.target;
    const superseded = yield* supersededTurnsOf(conversationId, launch);
    if (superseded.length === 0) return state;
    const failed = yield* settleRunnerLostTurns(
      applying.writer,
      conversationId,
      now,
      RUNNER_LOST_DETAIL,
      new Set(superseded),
      TURN_FAILURE.RUNNER_LOST,
    );
    if (failed.length > 0) {
      yield* Effect.logWarning("runner-events: a newer launch replaced a turn's runner").pipe(
        Effect.annotateLogs({ turnId: failed.join(","), failure: TURN_FAILURE.RUNNER_LOST }),
      );
    }
    const { turn, ...rest } = state;
    return turn !== undefined && superseded.includes(turn.id) ? rest : state;
  });
}

/** The batch's events not yet applied, projected and written, and the place the conversation keeps after them. */
function applyBatch(applying: Applying, batch: RunnerEventBatch, held: NativeProjectionRow) {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const events = unapplied(batch, held.sequence);
    const { conversationId } = applying.target;
    let state: NativeProjection = yield* supersededDropped(
      applying,
      heldProjection(held.projection),
      held.launch,
      now,
    );
    // A sandbox stops its idle window after its last touch, so a turn that ran all along, whether or not
    // this batch ends it, whose runner left it untouched past that window had it stop under the turn, and
    // the gap is said. Note that it is measured from the last touch, not the last post, because the touch
    // is what the stop counts from; one ending as the sandbox stopped tells that the runner went quiet.
    const untouched = state.keptAliveAt === undefined ? 0 : now - state.keptAliveAt;
    if (state.turn !== undefined && untouched > Duration.toMillis(SANDBOX_IDLE)) {
      yield* Effect.logWarning(
        `runner-events: a running turn's sandbox went ${Math.round(untouched / 1000)}s without a touch`,
      ).pipe(Effect.annotateLogs({ agentId: applying.agentId, conversationId }));
    }
    // The next turn the runner opens is the one its line queued, where one stands queued.
    let queuedTurnId = Option.getOrUndefined(yield* queuedTurnOf(conversationId));
    const { launch } = held;
    const writes: NativeWrite[] = [];
    const reports: string[] = [];
    for (const { sequence, message } of events) {
      const held: NativeHeld = {
        callName: (callId) => state.turn?.calls[callId],
        session: state.session,
        sequence,
      };
      const moments = applying.read(message, held);
      const projected = projectMoments(state, moments, {
        conversationId,
        sequence,
        now,
        attempt: launch,
        queuedTurnId,
        model: applying.model,
        ownKey: applying.payer === AGENT_PAYER.API_KEY,
        registered,
        report: (said) => reports.push(said),
      });
      state = projected.state;
      writes.push(...projected.writes);
      // A turn starting takes the servers mentioned to the agent since its last turn started
      // (`agent-runtime/servers.ts`), and keeps them for its calls at our own
      // MCP server, which hands them whatever the switches say (`integrations/connection-door.ts`).
      // They are taken event by event, so a turn that starts and ends within one batch takes its
      // own, never the next turn's.
      for (const write of projected.writes) {
        if (write.kind !== NATIVE_WRITE.ENQUEUE) continue;
        if (write.turnId === queuedTurnId) queuedTurnId = undefined;
        const taken = yield* takeAgentMentionedServers(
          applying.target.userId,
          applying.target.conversationId,
        );
        state = withTurnServers(state, write.turnId, taken);
      }
    }
    // Each is said under the agent's ids, so what a harness said that no turn keeps is found by them.
    for (const said of reports) {
      yield* Effect.logWarning(`runner-events: ${said}`).pipe(
        Effect.annotateLogs({ agentId: applying.agentId, conversationId }),
      );
    }
    yield* landWrites(applying, writes, now);
    const last = events.at(-1)?.sequence;
    const ends = runnerEndsOf(batch, held.sequence);
    // Only the turn's progress pushes on its deadline (`turn-state.ts`), a heartbeat only where the turn
    // is expected to be silent, so a runner gone quiet, or alive with its harness stuck, lapses.
    if (ends.length === 0 && turnProgressed(events.length, state)) {
      yield* progressTurns(conversationId, launch, now);
    }
    // Only the batch's last IDLE is told, and none where the launch ended in the same batch.
    const idle =
      ends.length === 0
        ? runnerEventsOf(batch, held.sequence, RUNNER_EVENT.IDLE).at(-1)
        : undefined;
    // Any post while a turn runs is its sandbox in use, a heartbeat with no events among them, but a
    // warm runner with no turn keeps nothing up, a batch that ends the launch touches nothing, since
    // its runner uses the sandbox no more, and a launch that has applied nothing yet has a sandbox
    // that opened moments ago.
    const sequence = last ?? held.sequence;
    const keepsAlive =
      sequence !== null &&
      ends.length === 0 &&
      state.turn !== undefined &&
      (state.keptAliveAt === undefined ||
        now - state.keptAliveAt >= Duration.toMillis(SANDBOX_TOUCH_EVERY));
    if (keepsAlive) state = { ...state, keptAliveAt: now };
    const result = {
      applied: { applied: events.length, sequence: last ?? held.sequence } satisfies Applied,
      ends,
      idle,
      turns: turnsMovedBy(writes),
      failed: writes.filter((write): write is FailedTurn => write.kind === NATIVE_WRITE.FAILED),
      keepsAlive,
    };
    return sequence === null || (last === undefined && !keepsAlive)
      ? { result }
      : { result, saved: { sequence, projection: state } };
  });
}

/** How many events a batch that would not decode says it holds, where it holds an array of them. */
function eventCountOf(parsed: unknown): number | undefined {
  if (!Predicate.isObject(parsed) || !("events" in parsed)) return undefined;
  return Array.isArray(parsed.events) ? parsed.events.length : undefined;
}

/**
 * A runner's batch refused for good, logged by its status, size, and event
 * count, never its body. Note that it is logged here because the runner
 * ends on such a refusal (`packages/agent-runner/src/events.ts`), and its turn's
 * lease then runs out, whose settle can say only that the runner went.
 */
const batchRefused = (
  ids: { readonly agentId: string; readonly conversationId: string },
  refusal: HostedRefusal,
  size: { readonly bytes: number | string; readonly events?: number | undefined },
) =>
  Effect.logWarning(`runner-events: a batch was refused: ${refusal.error}`).pipe(
    Effect.annotateLogs({
      ...ids,
      status: HOSTED_REFUSAL_STATUS[refusal.error],
      bytes: size.bytes,
      events: size.events ?? "unknown",
    }),
  );

/** POST: one batch of a runner's events, admitted by its bearer and applied once. */
const runnerEventsEndpoint = /* @__PURE__ */ Effect.fn("web/runnerEventsEndpoint")(function* <R>(
  options: RunnerEventsOptions<R>,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | Scope.Scope | Sandbox | R
> {
  const { read, ended, idled, alive, title } = options;
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const bearer = presentedBearer(request);
  if (bearer === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const admitted = yield* hostedStoreOrUnavailable(
    admitRunnerBearer(bearer, presentedLaunch(request)),
  );
  if (Option.isNone(admitted)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const { target } = admitted.value;
  // Every line the batch writes, and every issue it raises, names the account the agent runs for.
  yield* Effect.annotateLogsScoped({ userId: target.userId });
  const agent = yield* hostedStoreOrUnavailable(
    readAgentOfConversation(target.userId, target.conversationId),
  );
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(target.userId, agent.value.id));
  const runtime = Option.map(routing, (row) => row.runtime);
  const codex = Option.contains(runtime, CONVERSATION_RUNTIME.CODEX);
  const reader = read ?? (codex ? codexMoments : claudeCodeMoments);
  const refusedFor = { agentId: agent.value.id, conversationId: target.conversationId };
  const body = yield* readBodyBytesEffect(MAX_BODY_BYTES).pipe(
    Effect.tapError((refusal) =>
      batchRefused(refusedFor, refusal, {
        bytes: request.headers.get("content-length") ?? `over ${MAX_BODY_BYTES}`,
      }),
    ),
  );
  const parsed = yield* parseJsonBytes(body).pipe(
    Effect.tapError((refusal) => batchRefused(refusedFor, refusal, { bytes: body.byteLength })),
  );
  const batch = readBatch(parsed);
  if (Option.isNone(batch)) {
    yield* batchRefused(refusedFor, HOSTED_REFUSAL.INVALID_REQUEST, {
      bytes: body.byteLength,
      events: eventCountOf(parsed),
    });
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  const applying: Applying = {
    target,
    agentId: agent.value.id,
    model: agent.value.model,
    reasoningEffort: agent.value.effort,
    writer,
    read: reader,
    payer: Option.getOrUndefined(routing)?.payer ?? undefined,
    brief: agent.value.prompt ?? agent.value.descriptionSnapshot ?? "",
  };
  // Note that the turns the batch settles are heard once its transaction commits, not as the
  // writer's savepoint inside it ends, so what a listener reads of a turn (its final words, for
  // the Slack thread and the agent's starter) is what the batch wrote, and a rolled back batch
  // tells nobody.
  const settled: SettledAgentTurn[] = [];
  const queued: QueuedAgentTurn[] = [];
  const collecting = Layer.merge(
    Layer.succeed(SettledTurnListener, {
      heard: (turn) => Effect.sync(() => void settled.push(turn)),
    }),
    Layer.succeed(QueuedTurnListener, {
      heard: (turn) => Effect.sync(() => void queued.push(turn)),
    }),
  );
  const applied = yield* hostedStoreOrUnavailable(
    withNativeProjection(
      target,
      runnerTokenDigest(bearer),
      (held) => applyBatch(applying, storable(batch.value), held),
      admitted.value.launch,
    ).pipe(Effect.provide(collecting)),
  );
  const listener = yield* Effect.serviceOption(SettledTurnListener);
  if (Option.isSome(listener)) {
    yield* Effect.forEach(settled, listener.value.heard, { discard: true });
  }
  // The turns the batch queued for a runner, as a turn that ended well queues one for the lines it never took, are handed on once it commits too.
  const queuing = yield* Effect.serviceOption(QueuedTurnListener);
  if (Option.isSome(queuing)) {
    yield* Effect.forEach(queued, queuing.value.heard, { discard: true });
  }
  // Note that a conversation cleared, or a bearer retired, since the bearer was read takes nothing more.
  if (Option.isNone(applied)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const { taskId } = agent.value;
  const { runtimeSessionId } = admitted.value;
  for (const failed of applied.value.failed) {
    const harness = codex ? CONVERSATION_RUNTIME.CODEX : CONVERSATION_RUNTIME.CLAUDE_CODE;
    yield* sayTurnFailed(failed, harness, applying.payer, {
      agentId: agent.value.id,
      conversationId: target.conversationId,
      ...(taskId === null ? undefined : { taskId }),
      ...(runtimeSessionId === undefined ? undefined : { sandboxSessionId: runtimeSessionId }),
    });
  }
  // The task follows the turns the batch moved, once their rows are written: a turn starting takes
  // it up, and a turn's end may have finished its work, or archives the agent with a task moved to
  // Done while it worked (`tasks/task-finish.ts`).
  if (taskId !== null && applied.value.turns.started) {
    yield* reopenTaskForWork(target.userId, taskId);
  }
  if (taskId !== null && applied.value.turns.ended) {
    yield* settleTaskAfterTurn(target.userId, taskId, agent.value.id);
  }
  // Note that the title runs after the answer, kept awake past it, because the runner need not wait on a model.
  if (title !== undefined && (applied.value.turns.started || applied.value.turns.ended)) {
    yield* afterResponse("a coding agent's title", title(target, agent.value));
  }
  if (alive !== undefined && applied.value.keepsAlive) {
    yield* alive({ target, sessionId: admitted.value.runtimeSessionId });
  }
  if (ended !== undefined) {
    for (const { sequence, reason } of applied.value.ends) {
      yield* ended({
        target,
        sessionId: admitted.value.runtimeSessionId,
        sequence,
        reason,
        launch: admitted.value.launch,
      });
    }
  }
  if (idled !== undefined && applied.value.idle !== undefined) {
    yield* idled({
      target,
      sessionId: admitted.value.runtimeSessionId,
      sequence: applied.value.idle,
    });
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, applied.value.applied);
});

/** The group: the one events path, read as the conversation's harness's unless told otherwise, and the hosted vocabulary's own refusal for any other. */
export function runnerEventsApp<R = never>(
  options: RunnerEventsOptions<R> = {},
): WebRoutes<DatabaseServices | Sandbox | R> {
  const endpoint = runnerEventsEndpoint(options);
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_EVENTS_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
