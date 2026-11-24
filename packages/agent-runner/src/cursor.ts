/**
 * cursor.ts -- one launch of Cursor for an agent: Cursor's SDK run in the runner's own process on the account's Cursor API key in the cloud and on the machine's own Cursor sign-in on a host, the agent made or resumed from its store, the service's lines turned into runs, steers, cancels, and summaries, every message the SDK streams posted out, and the launch ended, or kept warm, once the agent's turn is over.
 *
 * One controller fiber owns the launch's state and acts on one signal at a
 * time, as Codex's does (`codex.ts`): a line the service wrote, a run ended,
 * a steer answered. Each run's messages are posted by a fiber of their own
 * as the SDK streams them, so their order is Cursor's own; the controller
 * only decides.
 *
 * Turns. A message with no run going is sent as a run (`agent.send`), which
 * takes it as ACCEPTED says, the checkout recorded before it where it opens
 * the agent's turn. A message sent while a run goes is steered into it
 * (`run.steer`): Cursor answers that the run took it, that it is to go as a
 * follow-up, which the launch sends as the next run, or that Cursor queued
 * that follow-up itself, whose run the launch posts in turn once the one
 * going ends. A message carrying pictures is never steered, since a steer
 * takes words alone, and goes as the next run. The agent's turn is over once
 * a run ends with no message left for another and no steer unanswered: the
 * launch ends as `turn_ended`, or, where the config asks it to stay warm,
 * posts IDLE and waits for the service's next message (`RUNNER_WARM`). A
 * message line marked `compact` summarizes the conversation in its place
 * (`agent.summarize`, Cursor's own `/summarize`), a run of its own, once no
 * run goes. A Stop cancels the run going (`run.cancel`) and ends the launch
 * as `stopped` once it ends, or within `RUNNER_CONTROL.ANSWER_MS` where it
 * never does; a run that fails ends it as `failed` with Cursor's words.
 * A run that streams nothing for `RUNNER_UNANSWERED.SILENCE_MS` while none of
 * its tool calls runs ends the launch as `failed` too, its run canceled, so
 * a turn Cursor stopped answering ends rather than holding until a Stop or
 * the service's progress deadline (`watchSilence`). A call the model wrote
 * past no longer counts as running, since Cursor can leave one it gave up on
 * running for good.
 * Cursor keeps no goal, so a line marked `goal` goes as words, as it does to
 * a runner from before the mark.
 *
 * Modes. Cursor's SDK asks nobody: a call it may not run comes back to the
 * model as the call's error, and the run goes on. So full access runs every
 * call (no Auto-review, no sandbox), and Auto hands each call to Cursor's
 * own Auto-review (`autoReview`), which refuses what it judges risky. The
 * SDK's sandbox is never on, since it refuses every MCP server and its
 * kernel needs are unchecked in the cloud's sandbox. Our own tools are
 * custom tools (`cursor-tools.ts`), which run in every mode.
 *
 * Instructions. The SDK takes no instructions beside its own prompt but in
 * place of it, which an account must be granted. So our coder instructions
 * lead the first message an agent made anew is sent, and the first after
 * its conversation is summarized, which drops them from what the model
 * reads. Whether they are due is kept in the agent's store, so a launch
 * that ends between a summary and the next message leaves them to the next.
 *
 * Skills. The SDK takes no folder of skills, so the member's installed
 * skills are linked into the checkout's `.agents/skills`, kept out of git,
 * before the agent is made (`cursor-skills.ts`).
 *
 * Secrets. The key is handed the SDK as its `apiKey`. The SDK runs the
 * agent's shell from this process, so before the agent is made the key, the
 * runner's bearer, and every other credential are taken out of the
 * environment each command inherits. Note that this keeps them out of a
 * command's environment, not out of its reach: the runner's process still
 * holds them, and the environment it started with stays readable at
 * `/proc/<runner pid>/environ`, as it does beside Claude Code and Codex. In
 * the cloud's sandbox the key is a placeholder, swapped for the real one at
 * the firewall on Cursor's API, as OpenAI's is. On a host the launch is handed no key, and
 * reads none the runner was started with: the SDK runs on the sign-in it
 * keeps of its own on the machine (`~/.cursor/sdk/auth.json`, made by
 * `vespin-host cursor-login`), and a machine with none, or one expired,
 * ends the launch with words that say how to sign in
 * (`CURSOR_SIGNED_OUT_DETAIL`).
 */

import { randomUUID } from "node:crypto";
import type {
  AgentOptions,
  LocalAgentStore,
  ModelSelection,
  RunResultStatus,
  SDKCustomTool,
  SDKImage,
  SDKMessage,
  SendOptions,
  SteerAckOutcome,
} from "@cursor/sdk";
import {
  Clock,
  Data,
  Duration,
  Effect,
  Option,
  Queue,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { CheckoutSnapshots } from "./checkout-snapshot.js";
import { type CursorAgentHandle, type CursorRun, CursorSdk } from "./cursor-sdk.js";
import { linkInstalledSkills } from "./cursor-skills.js";
import { type CursorStore, cursorStore, restoredEntries } from "./cursor-store.js";
import { type CursorTools, openCursorTools } from "./cursor-tools.js";
import { type LaunchContext, type LaunchOutcome, runsOnHost, toolEnvOf } from "./launch.js";
import { mcpServersOf } from "./mcp-servers.js";
import {
  type CheckoutSnapshot,
  type ContentBlock,
  CURSOR_AGENT_PREFIX,
  CURSOR_SIGNED_OUT_DETAIL,
  CURSOR_SILENT_DETAIL,
  type CursorConfig,
  type CursorModelSelection,
  INPUT_LINE,
  type InputLine,
  InputLineSchema,
  PERMISSION_MODE,
  RUNNER_CONTROL,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_UNANSWERED,
  RUNNER_WARM,
  type RunnerEnd,
  type TurnFilesSummary,
} from "./protocol.js";
import { RUNNER_SPAN } from "./trace.js";
import { transcriptStore } from "./transcripts.js";

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));

/** The runner's own variables taken out of the environment the agent's shell inherits: the bearer, and every account credential. */
const WITHHELD_FROM_SHELL = [
  RUNNER_ENV.BEARER,
  RUNNER_ENV.CLAUDE_TOKEN,
  RUNNER_ENV.API_KEY,
  RUNNER_ENV.OPENAI_API_KEY,
  RUNNER_ENV.CURSOR_API_KEY,
] as const;

/** The settings the SDK loads of the checkout's own, as Claude Code's launch loads them: the project's alone. */
const SETTING_SOURCES = ["project"] as const;

/** The kinds of message the launch reads of those the SDK streams, as it spells them. */
const MESSAGE = {
  THINKING: "thinking",
  ASSISTANT: "assistant",
  TOOL_CALL: "tool_call",
  SUMMARY: "summary",
} as const;

/** The SDK's word for a summary written, which drops the instructions the conversation began with. */
const SUMMARY_COMPLETED = "completed";

/** The SDK's word for a tool call under way; any other status ends it. */
const TOOL_CALL_RUNNING = "running";

/** The outcomes of a run that end the launch as failed, as the SDK spells them. */
const RUN_STATUS = {
  ERROR: "error",
  CANCELED: "cancelled",
} as const satisfies Record<string, RunResultStatus>;

/** What Cursor answers a steer, as the SDK spells it: the run took it, or it is to go as a follow-up the launch sends. */
const STEER_OUTCOME = {
  COMPLETE_DELIVERED: "complete_delivered",
  REVERT_TO_FOLLOWUP: "revert_to_followup",
} as const satisfies Record<string, SteerAckOutcome>;

/** What a launch whose store the service did not answer ends with. */
const STORE_UNREAD = "the agent's Cursor store could not be read from the service";

/** What a launch whose store the service would not take as it ended ends with. */
const STORE_UNKEPT = "the agent's Cursor store could not be kept at the service";

/** How many more times a launch's last mirror is sent where the service did not take it, and how long it waits before the first. */
const STORE_RETRIES = 2;
const STORE_RETRY_DELAY = Duration.seconds(1);

/** What a launch with no key to run Cursor on ends with. */
const NO_KEY = "no Cursor API key was handed to the launch";

/** Why the SDK refused a step of the launch, which ends it. */
class CursorFailed extends Data.TaggedError("CursorFailed")<{ readonly detail: string }> {}

/** The words of a failure the SDK threw. */
function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** What the controller acts on, one at a time. */
const SIGNAL = {
  LINE: "line",
  INPUT_CLOSED: "input_closed",
  RUN_ENDED: "run_ended",
  STEERED: "steered",
  /** A Stop's cancel left the run going past `RUNNER_CONTROL.ANSWER_MS`. */
  CANCEL_UNANSWERED: "cancel_unanswered",
  /** A run streamed nothing for `RUNNER_UNANSWERED.SILENCE_MS` with none of its tool calls running. */
  RUN_SILENT: "run_silent",
  CUT_OFF: "cut_off",
} as const;

type Signal =
  | { readonly kind: typeof SIGNAL.LINE; readonly text: string }
  | { readonly kind: typeof SIGNAL.INPUT_CLOSED }
  | {
      readonly kind: typeof SIGNAL.RUN_ENDED;
      readonly run: CursorRun;
      readonly status: RunResultStatus;
      readonly error: string | undefined;
    }
  | {
      readonly kind: typeof SIGNAL.STEERED;
      readonly outgoing: Outgoing;
      /** Cursor's answer; none where the steer failed, which sends the message as the next run. */
      readonly outcome: SteerAckOutcome | undefined;
    }
  | { readonly kind: typeof SIGNAL.CANCEL_UNANSWERED; readonly run: CursorRun }
  | { readonly kind: typeof SIGNAL.RUN_SILENT; readonly run: CursorRun }
  | { readonly kind: typeof SIGNAL.CUT_OFF; readonly why: string };

const LAUNCH_STATE = {
  IDLE: "idle",
  RUN: "run",
} as const;

/**
 * Where the launch stands: idle, warm where its turn is over and its IDLE
 * posted or it started warm; or a run going, a summary's or a message's,
 * stopping once a Stop canceled it.
 */
type LaunchState =
  | { readonly kind: typeof LAUNCH_STATE.IDLE; readonly warm: boolean }
  | {
      readonly kind: typeof LAUNCH_STATE.RUN;
      readonly run: CursorRun;
      readonly summary: boolean;
      readonly stopping: boolean;
    };

const IDLE: LaunchState = { kind: LAUNCH_STATE.IDLE, warm: false };

/** A message the service sent, as Cursor takes it, and the service's lines it carries: one, or several merged into one run. */
interface Outgoing {
  readonly lines: readonly string[];
  readonly text: string;
  readonly images: readonly SDKImage[];
}

/** The launch's state, which the controller alone changes. */
interface CursorLaunch {
  readonly context: LaunchContext<CursorConfig>;
  readonly signals: Queue.Queue<Signal>;
  readonly agent: CursorAgentHandle;
  readonly tools: CursorTools;
  readonly store: CursorStore;
  /** Cursor's id for the agent the launch runs: the config's, or the one a fork minted. */
  readonly session: string;
  state: LaunchState;
  /** Messages for the next run. */
  waiting: Outgoing[];
  /** A summary the service asked for while a run went, run once none does. */
  compactNext: Outgoing | undefined;
  /** A follow-up run Cursor queued for a steer, posted once the run going ends. */
  queued: CursorRun | undefined;
  /** How many steers Cursor has not answered yet; the agent's turn is not over before they are. */
  steering: number;
  /** Whether a run ended while steers were unanswered, so the last answer decides what comes next. */
  settling: boolean;
  model: CursorModelSelection;
  /** The service's lines this launch has said it took, each said once. */
  readonly accepted: Set<string>;
  /** Whether the agent's turn is under way, as the service holds it: a run that goes on for it records no checkout. */
  open: boolean;
  readonly snapshot: (lineId: string) => Effect.Effect<CheckoutSnapshot | undefined>;
  /** The snapshot the turn under way opened on, until its end reads the turn's files from it. */
  opening: string | undefined;
  readonly filesSince: (from: string) => Effect.Effect<TurnFilesSummary | undefined>;
}

/** Ends the launch: the outcome the controller's loop stops on. */
function ended(end: RunnerEnd, failure = ""): LaunchOutcome {
  return { end, failure };
}

/** The changes to the runner's environment the agent's shell runs with: the image's tools' in the cloud, and nothing of ours to use. */
function shellEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const withheld = Object.fromEntries(WITHHELD_FROM_SHELL.map((name) => [name, undefined]));

  return { ...toolEnvOf(env), ...withheld };
}

/** A model as the SDK's types take it. */
function modelSelectionOf(selection: CursorModelSelection): ModelSelection {
  return {
    id: selection.id,
    ...(selection.params === undefined
      ? undefined
      : { params: selection.params.map((param) => ({ ...param })) }),
    ...(selection.maxMode === undefined ? undefined : { maxMode: selection.maxMode }),
  };
}

/** The options the agent is made or resumed with: the key where the launch was handed one, the checkout, the model, the store, our tools, and Auto-review where the mode is Auto. */
function agentOptions(
  config: CursorConfig,
  apiKey: string | undefined,
  store: LocalAgentStore,
  customTools: Record<string, SDKCustomTool>,
): AgentOptions {
  return {
    ...(apiKey === undefined ? undefined : { apiKey }),
    model: modelSelectionOf(config.model),
    local: {
      cwd: config.cwd,
      settingSources: [...SETTING_SOURCES],
      store,
      customTools,
      ...(config.permissionMode === PERMISSION_MODE.AUTO ? { autoReview: true } : undefined),
    },
  };
}

/** A message line's blocks as Cursor takes them: its words joined, and its pictures inline. */
function outgoingOf(lineId: string, content: readonly ContentBlock[]): Outgoing {
  return {
    lines: [lineId],
    text: content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n"),
    images: content.flatMap((block) =>
      block.type === "image"
        ? [{ data: block.source.data, mimeType: block.source.media_type }]
        : [],
    ),
  };
}

/** Messages merged into one run, in order. */
function merged(messages: readonly Outgoing[]): Outgoing {
  return {
    lines: messages.flatMap((message) => message.lines),
    text: messages.flatMap((message) => (message.text === "" ? [] : [message.text])).join("\n\n"),
    images: messages.flatMap((message) => message.images),
  };
}

/** A message's words led by our instructions. */
function withInstructions(instructions: string, text: string): string {
  return `<coder_instructions>\n${instructions}\n</coder_instructions>\n\n${text}`;
}

/** ACCEPTED for each of the lines the launch has not said it took yet, the first carrying the checkout recorded before its run. */
const accepted = Effect.fn("agent-runner/cursor/accepted")(function* (
  launch: CursorLaunch,
  lines: readonly string[],
  snapshot: CheckoutSnapshot | undefined,
) {
  for (const uuid of lines) {
    if (launch.accepted.has(uuid)) continue;
    launch.accepted.add(uuid);
    const opening = uuid === lines[0] ? snapshot : undefined;
    yield* launch.context.sink.emit({
      type: RUNNER_EVENT.ACCEPTED,
      uuid,
      ...(opening === undefined ? undefined : { snapshot: opening }),
    });
  }
});

/** What a run's silence is read from: when it last streamed a message, on `monotonicMillis`, and its tool calls running. */
interface Heard {
  at: number;
  readonly calls: Set<string>;
}

/**
 * Milliseconds on the monotonic clock, which a run's silence is measured on.
 * Note that the wall clock is not, because a host's clock set forward would
 * count as silence and end a run that just spoke.
 */
const monotonicMillis = Effect.map(Clock.monotonicTimeNanos, (nanos) => Number(nanos / 1_000_000n));

/** Notes a message the run streamed: heard now, and the tool call it starts or ends. */
function hear(heard: Heard, message: SDKMessage, now: number) {
  heard.at = now;

  // Note that the model writes again only once it holds every call's answer, so a call still said running is one Cursor gave up on.
  if (message.type === MESSAGE.THINKING || message.type === MESSAGE.ASSISTANT) heard.calls.clear();

  if (message.type !== MESSAGE.TOOL_CALL) return;

  if (message.status === TOOL_CALL_RUNNING) heard.calls.add(message.call_id);
  else heard.calls.delete(message.call_id);
}

/**
 * Signals the run silent once it has streamed nothing for
 * `RUNNER_UNANSWERED.SILENCE_MS` with none of its tool calls running. Note that
 * a call running holds the watch off however long it runs, since a long
 * command or one of our own tools streams nothing until it ends, and its
 * end is heard as a message, from which the silence counts afresh.
 */
const watchSilence = Effect.fn("agent-runner/cursor/watchSilence")(function* (
  launch: CursorLaunch,
  run: CursorRun,
  heard: Heard,
) {
  for (;;) {
    const quiet = (yield* monotonicMillis) - heard.at;

    if (quiet >= RUNNER_UNANSWERED.SILENCE_MS && heard.calls.size === 0) break;

    const wait =
      heard.calls.size > 0 ? RUNNER_UNANSWERED.SILENCE_MS : RUNNER_UNANSWERED.SILENCE_MS - quiet;

    yield* Effect.sleep(Duration.millis(wait));
  }

  yield* Effect.logWarning("agent-runner: the Cursor run went silent");
  yield* Queue.offer(launch.signals, { kind: SIGNAL.RUN_SILENT, run });
});

/** Posts a run's messages as the SDK streams them, and signals its end with its outcome, or its silence where it goes quiet first. */
const follow = Effect.fn("agent-runner/cursor/follow")(function* (
  launch: CursorLaunch,
  run: CursorRun,
) {
  const heard: Heard = { at: yield* monotonicMillis, calls: new Set() };

  const posted = Stream.fromAsyncIterable(run.stream(), (cause) => cause).pipe(
    Stream.runForEach((message: SDKMessage) =>
      Effect.gen(function* () {
        hear(heard, message, yield* monotonicMillis);

        // A summary written drops the instructions, so the next message leads with them again.
        if (message.type === MESSAGE.SUMMARY && message.status === SUMMARY_COMPLETED) {
          launch.store.dueInstructions(launch.session, true);
        }

        yield* launch.context.sink.emit(message);
      }),
    ),
    Effect.andThen(Effect.tryPromise(() => run.wait())),
    Effect.match({
      onSuccess: (result): Signal => ({
        kind: SIGNAL.RUN_ENDED,
        run,
        status: result.status,
        error: result.error?.message,
      }),
      onFailure: (cause): Signal => ({
        kind: SIGNAL.RUN_ENDED,
        run,
        status: RUN_STATUS.ERROR,
        error: detailOf(cause),
      }),
    }),
    Effect.flatMap((signal) => Queue.offer(launch.signals, signal)),
  );

  // The watch is the following fiber's child, so it ends once the run's end is signaled.
  yield* Effect.forkScoped(
    Effect.andThen(Effect.forkChild(watchSilence(launch, run, heard)), posted),
  );
});

/** The send options of the launch's next run: its model, and our tools as they now stand. */
function sendOptionsOf(launch: CursorLaunch): SendOptions {
  return {
    model: modelSelectionOf(launch.model),
    local: { customTools: launch.tools.current() },
  };
}

/** Sends the messages given, merged, as the agent's next run. */
const sendRun = Effect.fn("agent-runner/cursor/sendRun")(function* (
  launch: CursorLaunch,
  messages: readonly Outgoing[],
) {
  const outgoing = merged(messages);
  // The checkout is recorded before the run can touch it, where the run opens the agent's turn.
  const first = outgoing.lines[0];
  const snapshot = launch.open || first === undefined ? undefined : yield* launch.snapshot(first);

  if (!launch.open && launch.opening === undefined) launch.opening = snapshot?.commit;
  launch.open = true;
  yield* accepted(launch, outgoing.lines, snapshot);

  const text = launch.store.instructionsDue(launch.session)
    ? withInstructions(launch.context.config.instructions, outgoing.text)
    : outgoing.text;

  const message = outgoing.images.length === 0 ? { text } : { text, images: [...outgoing.images] };

  // The checkpoint the agent stands at is where a rewind or a fork before this line resumes it.
  if (first !== undefined) launch.store.markCut(launch.session, first);

  const run = yield* Effect.tryPromise({
    try: () => launch.agent.send(message, sendOptionsOf(launch)),
    catch: (cause) => new CursorFailed({ detail: detailOf(cause) }),
  });

  launch.store.dueInstructions(launch.session, false);
  launch.state = { kind: LAUNCH_STATE.RUN, run, summary: false, stopping: false };
  yield* follow(launch, run);
});

/**
 * Summarizes the conversation in the message's place, a run of its own; an
 * agent with no conversation yet has nothing to summarize, so its turn is
 * over at once, as Claude Code's `/compact` is. Answers the launch's outcome
 * where that ends it.
 */
const startSummary = Effect.fn("agent-runner/cursor/startSummary")(function* (
  launch: CursorLaunch,
  outgoing: Outgoing,
) {
  // The line is taken before Cursor is asked, as a message's is, so a summary it refuses fails the turn with its words.
  yield* accepted(launch, outgoing.lines, undefined);

  if (!launch.store.conversed(launch.session)) return yield* turnOver(launch);

  const run = yield* Effect.tryPromise({
    try: () => launch.agent.summarize(),
    catch: (cause) => new CursorFailed({ detail: detailOf(cause) }),
  });

  launch.state = { kind: LAUNCH_STATE.RUN, run, summary: true, stopping: false };
  yield* follow(launch, run);

  return undefined;
});

/** Steers a message into the run going, Cursor's answer signaled once it comes, so a Stop meanwhile is not held up. */
const steer = Effect.fn("agent-runner/cursor/steer")(function* (
  launch: CursorLaunch,
  run: CursorRun,
  outgoing: Outgoing,
) {
  const steerRun = run.steer;

  if (steerRun === undefined) {
    launch.waiting.push(outgoing);

    return;
  }

  launch.steering += 1;
  yield* accepted(launch, outgoing.lines, undefined);

  yield* Effect.tryPromise(() => steerRun(outgoing.text)).pipe(
    Effect.option,
    Effect.flatMap((outcome) =>
      Queue.offer(launch.signals, {
        kind: SIGNAL.STEERED,
        outgoing,
        outcome: Option.getOrUndefined(outcome),
      }),
    ),
    Effect.forkScoped,
  );
});

/** Cancels the run going, and ends the launch where it has not ended within `RUNNER_CONTROL.ANSWER_MS`. */
const cancel = Effect.fn("agent-runner/cursor/cancel")(function* (
  launch: CursorLaunch,
  run: CursorRun,
) {
  yield* Effect.tryPromise(() => run.cancel()).pipe(
    Effect.catch(() => Effect.logWarning("agent-runner: the Cursor run's cancel failed")),
    Effect.forkScoped,
  );
  yield* Effect.sleep(Duration.millis(RUNNER_CONTROL.ANSWER_MS)).pipe(
    Effect.andThen(Queue.offer(launch.signals, { kind: SIGNAL.CANCEL_UNANSWERED, run })),
    Effect.forkScoped,
  );
});

/** A message line, acted on: sent as a run, steered into the run going, or left for the next run or a summary; answers the launch's outcome where a summary ends it. */
const takeMessage = Effect.fn("agent-runner/cursor/takeMessage")(function* (
  launch: CursorLaunch,
  line: Extract<InputLine, { type: typeof INPUT_LINE.MESSAGE }>,
) {
  yield* launch.context.trace.taken;
  const outgoing = outgoingOf(line.uuid ?? randomUUID(), line.content);
  const { state } = launch;

  // A summary waits for the run going to end, as Cursor summarizes no conversation at work.
  if (line.compact === true) {
    if (state.kind === LAUNCH_STATE.IDLE) return yield* startSummary(launch, outgoing);
    launch.compactNext = outgoing;

    return undefined;
  }

  if (state.kind === LAUNCH_STATE.IDLE) {
    yield* sendRun(launch, [outgoing]);

    return undefined;
  }

  // A message sent while the run stops or summarizes, or carrying pictures, which a steer cannot take, goes as the next run.
  if (state.stopping || state.summary || outgoing.images.length > 0) {
    launch.waiting.push(outgoing);

    return undefined;
  }

  yield* steer(launch, state.run, outgoing);

  return undefined;
});

/** A Stop line, acted on: the run going canceled, or the launch ended where none goes. */
const takeStop = Effect.fn("agent-runner/cursor/takeStop")(function* (
  launch: CursorLaunch,
  line: Extract<InputLine, { type: typeof INPUT_LINE.STOP }>,
) {
  // A stop for another launch's turn is not this launch's to take.
  if (line.launch !== undefined && line.launch !== launch.context.config.firstSequence) {
    yield* Effect.logWarning("agent-runner: skipped a stop for another launch");

    return undefined;
  }

  const { state } = launch;

  if (state.kind !== LAUNCH_STATE.RUN) return ended(RUNNER_END.STOPPED);
  launch.state = { ...state, stopping: true };
  yield* cancel(launch, state.run);

  return undefined;
});

/** A retire line: the launch ends where it is warm with nothing waiting. */
const takeRetire = Effect.fn("agent-runner/cursor/takeRetire")(function* (launch: CursorLaunch) {
  const { state } = launch;

  // Lines are taken one at a time, so a message ahead of this one already took the launch out of warm.
  if (state.kind === LAUNCH_STATE.IDLE && state.warm && launch.waiting.length === 0) {
    return ended(RUNNER_END.IDLED);
  }

  yield* Effect.logWarning("agent-runner: skipped a retire for a launch at work");

  return undefined;
});

/** One of the service's lines, acted on; answers the launch's outcome where the line ends it. */
const takeLine = Effect.fn("agent-runner/cursor/takeLine")(function* (
  launch: CursorLaunch,
  text: string,
) {
  const line = decodeLine(text);

  if (Option.isNone(line)) {
    // Note that we never echo the line, because a message carries the user's words.
    yield* Effect.logWarning("agent-runner: skipped a stdin line it could not read");

    return undefined;
  }

  const value = line.value;

  switch (value.type) {
    case INPUT_LINE.MESSAGE:
      return yield* takeMessage(launch, value);
    case INPUT_LINE.STOP:
      return yield* takeStop(launch, value);
    case INPUT_LINE.RETIRE:
      return yield* takeRetire(launch);
    // Note that a warm launch's window is its wait for the next signal, which this one already ran again from now.
    case INPUT_LINE.WARM:
      return undefined;
    case INPUT_LINE.APPROVAL:
      yield* Effect.logWarning("agent-runner: skipped an approval, since Cursor asks none");

      return undefined;
    case INPUT_LINE.MODEL: {
      if (value.selection !== undefined) launch.model = value.selection;
      else yield* Effect.logWarning("agent-runner: skipped a model line naming no Cursor model");

      return undefined;
    }
  }
});

/**
 * What comes after a run, once no steer is unanswered: the follow-up Cursor
 * queued, the messages left for another run, a summary asked for meanwhile,
 * or the agent's turn over.
 */
const settle = Effect.fn("agent-runner/cursor/settle")(function* (launch: CursorLaunch) {
  if (launch.steering > 0) {
    launch.settling = true;

    return undefined;
  }

  launch.settling = false;
  const queued = launch.queued;

  if (queued !== undefined) {
    launch.queued = undefined;
    launch.state = { kind: LAUNCH_STATE.RUN, run: queued, summary: false, stopping: false };
    yield* follow(launch, queued);

    return undefined;
  }

  if (launch.waiting.length > 0) {
    const waiting = launch.waiting;
    launch.waiting = [];
    yield* sendRun(launch, waiting);

    return undefined;
  }

  launch.open = false;
  const summary = launch.compactNext;

  if (summary !== undefined) {
    launch.compactNext = undefined;

    return yield* startSummary(launch, summary);
  }

  return yield* turnOver(launch);
});

/** The agent's turn is over: the launch ends, or, where the config asks it to stay warm, posts IDLE and waits for the service's next message. */
const turnOver = Effect.fn("agent-runner/cursor/turnOver")(function* (launch: CursorLaunch) {
  if (launch.context.config.warm !== true) return ended(RUNNER_END.TURN_ENDED);
  launch.state = { kind: LAUNCH_STATE.IDLE, warm: true };
  const files = yield* turnFilesOf(launch);
  yield* launch.context.sink.emit({
    type: RUNNER_EVENT.IDLE,
    ...(files === undefined ? undefined : { files }),
  });

  return undefined;
});

/** The files the turn under way changed since the snapshot it opened on, its opening let go; none where no snapshot stands. */
function turnFilesOf(launch: CursorLaunch): Effect.Effect<TurnFilesSummary | undefined> {
  const from = launch.opening;
  launch.opening = undefined;

  return from === undefined ? Effect.succeed(undefined) : launch.filesSince(from);
}

/** The run going ended: the launch ends, or goes on as `settle` says. */
const takeRunEnded = Effect.fn("agent-runner/cursor/takeRunEnded")(function* (
  launch: CursorLaunch,
  signal: Extract<Signal, { kind: typeof SIGNAL.RUN_ENDED }>,
) {
  const { state } = launch;

  if (state.kind !== LAUNCH_STATE.RUN || state.run !== signal.run) return undefined;
  launch.state = IDLE;
  // A mirror the service did not take goes again with the next run's, and at the launch's end; none holds up the controller.
  yield* launch.store.mirror.pipe(
    Effect.catch(() =>
      Effect.logWarning("agent-runner: the Cursor agent's store was not mirrored"),
    ),
    Effect.forkScoped,
  );

  // A stopped run's own messages end with it; those still waiting for a run, whenever they were sent, go as the next.
  if (state.stopping) {
    const waiting = launch.waiting;
    launch.waiting = [];
    launch.queued = undefined;

    if (waiting.length === 0) return ended(RUNNER_END.STOPPED);
    yield* sendRun(launch, waiting);

    return undefined;
  }

  if (signal.status === RUN_STATUS.ERROR) {
    return ended(RUNNER_END.FAILED, signal.error ?? "the run failed");
  }

  if (signal.status === RUN_STATUS.CANCELED) {
    return ended(RUNNER_END.FAILED, signal.error ?? "the run was canceled");
  }

  return yield* settle(launch);
});

/** Cursor answered a steer: the message is the run's, or goes as the next run, or rides the follow-up Cursor queued. */
const takeSteered = Effect.fn("agent-runner/cursor/takeSteered")(function* (
  launch: CursorLaunch,
  signal: Extract<Signal, { kind: typeof SIGNAL.STEERED }>,
) {
  launch.steering -= 1;
  const { outcome } = signal;

  if (outcome === undefined || outcome === STEER_OUTCOME.REVERT_TO_FOLLOWUP) {
    launch.waiting.push(signal.outgoing);
  } else if (outcome !== STEER_OUTCOME.COMPLETE_DELIVERED && outcome.run !== undefined) {
    launch.queued = outcome.run;
  }

  return launch.settling && launch.state.kind === LAUNCH_STATE.IDLE
    ? yield* settle(launch)
    : undefined;
});

/** Acts on one signal; answers the launch's outcome where it ends it. */
function takeSignal(
  launch: CursorLaunch,
  signal: Signal,
): Effect.Effect<LaunchOutcome | undefined, CursorFailed, Scope.Scope | CheckoutSnapshots> {
  switch (signal.kind) {
    case SIGNAL.LINE:
      return takeLine(launch, signal.text);
    case SIGNAL.INPUT_CLOSED: {
      // A run still going is let finish; the launch ends with it.
      // Note that a steer Cursor has not answered may yet send its message as a run, so it holds the launch too.
      const idle =
        launch.state.kind === LAUNCH_STATE.IDLE &&
        launch.waiting.length === 0 &&
        launch.steering === 0;

      return Effect.succeed(idle ? ended(RUNNER_END.INPUT_CLOSED) : undefined);
    }

    case SIGNAL.RUN_ENDED:
      return takeRunEnded(launch, signal);
    case SIGNAL.STEERED:
      return takeSteered(launch, signal);
    case SIGNAL.CANCEL_UNANSWERED: {
      const { state } = launch;
      const going = state.kind === LAUNCH_STATE.RUN && state.run === signal.run && state.stopping;

      return Effect.succeed(going ? ended(RUNNER_END.STOPPED) : undefined);
    }

    case SIGNAL.RUN_SILENT: {
      // Note that the launch's end cancels the run going, as it does any run it cuts short; a run a Stop cancels ends as stopped.
      const { state } = launch;
      const going = state.kind === LAUNCH_STATE.RUN && state.run === signal.run && !state.stopping;

      return Effect.succeed(going ? ended(RUNNER_END.FAILED, CURSOR_SILENT_DETAIL) : undefined);
    }

    case SIGNAL.CUT_OFF:
      return Effect.succeed(ended(RUNNER_END.FAILED, signal.why));
  }
}

/** The agent's store, as the service keeps it where the config names the store, held as `session`'s where that is a fork's; fails where the service did not answer. */
const openStore = Effect.fn("agent-runner/cursor/openStore")(function* (
  context: LaunchContext<CursorConfig>,
  session: string,
) {
  const { config } = context;

  if (config.transcriptsUrl === undefined) return cursorStore(config.cwd, [], undefined);
  const transcripts = transcriptStore(config.transcriptsUrl, context.bearer, context.trace.headers);
  const entries = yield* restoredEntries(transcripts, config.session);
  const forkAs = session === config.session ? undefined : session;

  return cursorStore(config.cwd, entries, transcripts, forkAs);
});

/** The agent, resumed where its store holds it and made anew under the config's id otherwise, on the key given or else the SDK's own sign-in; and whether it was made. */
const openAgent = Effect.fn("agent-runner/cursor/openAgent")(function* (
  context: LaunchContext<CursorConfig>,
  apiKey: string | undefined,
  store: CursorStore,
  tools: CursorTools,
  session: string,
) {
  const { config } = context;
  const cursor = yield* CursorSdk;
  // The agent's shell inherits the runner's environment, from here on without our bearer or any key.
  cursor.setEnvironment(shellEnvironment(context.env));
  // Our own tools are listed before the agent is made, so its first run has them.
  yield* tools.ready;
  const options = agentOptions(config, apiKey, store.store, tools.current());
  const made = !store.holds(session);

  const agent = yield* context.trace.step(
    RUNNER_SPAN.CLI,
    Effect.tryPromise({
      try: () =>
        made
          ? cursor.create(config.sdk, { ...options, agentId: session })
          : cursor.resume(config.sdk, session, options),
      catch: (cause) => new CursorFailed({ detail: detailOf(cause) }),
    }),
  );

  return { agent, made };
});

/** Whether the SDK at `sdk` holds a sign-in of the machine's own that stands; false where it cannot say. */
const machineSignedIn = Effect.fn("agent-runner/cursor/machineSignedIn")(function* (sdk: string) {
  const cursor = yield* CursorSdk;

  return yield* Effect.tryPromise(() => cursor.signedIn(sdk)).pipe(
    Effect.orElseSucceed(() => false),
  );
});

/** Links the member's installed skills into the checkout; ones that could not be are logged, and the agent opens without them rather than not at all. */
const linkSkills = Effect.fn("agent-runner/cursor/linkSkills")(function* (config: CursorConfig) {
  yield* Effect.try({
    try: () => linkInstalledSkills(config.cwd, config.installedSkills),
    catch: detailOf,
  }).pipe(
    Effect.catch((detail) =>
      Effect.logWarning(`agent-runner: the installed skills were not linked: ${detail}`),
    ),
  );
});

/** The service's lines joined to the signals in a loop of their own, so a line is never held up behind what the controller is waiting on. */
function forwardLines(context: LaunchContext<CursorConfig>, signals: Queue.Queue<Signal>) {
  return Stream.fromQueue(context.lines).pipe(
    Stream.runForEach((text) => Queue.offer(signals, { kind: SIGNAL.LINE, text })),
    Effect.andThen(Queue.offer(signals, { kind: SIGNAL.INPUT_CLOSED })),
    Effect.forkScoped,
  );
}

/**
 * The launch opened: its store read, the skills linked, our tools listed,
 * and the agent made or resumed, the service's lines and its cut-off then
 * joining the signals. Fails with the words the launch ends with where it
 * could not open.
 */
const openLaunch = Effect.fn("agent-runner/cursor/openLaunch")(function* (
  context: LaunchContext<CursorConfig>,
  apiKey: string | undefined,
) {
  const { config } = context;
  const snapshots = yield* CheckoutSnapshots;
  const signals = yield* Queue.unbounded<Signal>();
  yield* context.cutOff.pipe(
    Effect.flatMap((why) => Queue.offer(signals, { kind: SIGNAL.CUT_OFF, why })),
    Effect.forkScoped,
  );

  // A fork resumes its source's agent as one of its own, under an id it mints, as Claude Code's `forkSession` does.
  const session = config.fork === true ? `${CURSOR_AGENT_PREFIX}${randomUUID()}` : config.session;

  const store = yield* openStore(context, session).pipe(
    Effect.mapError(() => new CursorFailed({ detail: STORE_UNREAD })),
  );

  // A rewind or a fork at a message resumes the agent from the checkpoint marked before that line.
  if (config.rewindBefore !== undefined) store.cutBefore(session, config.rewindBefore);
  yield* linkSkills(config);
  const tools = yield* openCursorTools(mcpServersOf(config), context.bearer);

  const opened = yield* openAgent(context, apiKey, store, tools, session).pipe(
    Effect.tapError((failure) =>
      Effect.logWarning(`agent-runner: Cursor's agent could not open: ${failure.detail}`),
    ),
  );

  // Note that a fork resumes its source's conversation, which holds the source's instructions, never its own.
  if (opened.made || config.fork === true) store.dueInstructions(session, true);

  const launch: CursorLaunch = {
    context,
    signals,
    agent: opened.agent,
    tools,
    store,
    session,
    // Note that a warm launch is warm from its start, so one launched with no message waits for its first as one past an IDLE does.
    state: { kind: LAUNCH_STATE.IDLE, warm: config.warm === true },
    waiting: [],
    compactNext: undefined,
    queued: undefined,
    steering: 0,
    settling: false,
    model: config.model,
    accepted: new Set(),
    open: false,
    snapshot: (lineId) =>
      config.agentId === undefined
        ? Effect.succeed(undefined)
        : snapshots.take(config.cwd, config.agentId, lineId),
    opening: undefined,
    filesSince: (from) => snapshots.summarize(config.cwd, from),
  };

  yield* forwardLines(context, signals);

  return launch;
});

/** The controller's next signal; none where a warm launch's window passed with none. */
function nextSignal(launch: CursorLaunch): Effect.Effect<Option.Option<Signal>> {
  const { state, signals, context } = launch;

  if (state.kind !== LAUNCH_STATE.IDLE || !state.warm) return Effect.asSome(Queue.take(signals));
  const window = Duration.millis(context.config.warmForMs ?? RUNNER_WARM.IDLE_CAP_MS);

  return Queue.take(signals).pipe(Effect.timeoutOption(window));
}

/** Acts on the launch's signals, one at a time, until one ends it; answers how it ended. */
const control = Effect.fn("agent-runner/cursor/control")(
  function* (launch: CursorLaunch) {
    for (;;) {
      // A warm launch waits at most its window for the next signal, and ends where none came.
      const next = yield* nextSignal(launch);

      if (Option.isNone(next)) return ended(RUNNER_END.IDLED);
      const done = yield* takeSignal(launch, next.value);

      if (done !== undefined) return done;
    }
  },
  Effect.catch((error) => Effect.succeed(ended(RUNNER_END.FAILED, error.detail))),
);

/**
 * The launch let go once its controller ended it: the run cut short
 * canceled, the agent closed, and the store mirrored a last time. Answers
 * the outcome with the turn's files, failed where the service never took
 * the store.
 */
const closeLaunch = Effect.fn("agent-runner/cursor/closeLaunch")(function* (
  launch: CursorLaunch,
  outcome: LaunchOutcome,
) {
  // A run the end cut short is canceled, and the agent let go, before the launch's last event.
  if (launch.state.kind === LAUNCH_STATE.RUN) {
    const { run } = launch.state;
    yield* Effect.tryPromise(() => run.cancel()).pipe(
      Effect.timeout(Duration.millis(RUNNER_CONTROL.ANSWER_MS)),
      Effect.ignore,
    );
  }

  launch.agent.close();

  // Note that a store the service never took leaves the next launch resuming an older conversation, so the launch fails rather than say its turn is kept.
  const kept = yield* launch.store.mirror.pipe(
    Effect.retry({ times: STORE_RETRIES, schedule: Schedule.exponential(STORE_RETRY_DELAY) }),
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

  // A turn the end cut short, or ended without an IDLE, still says what it changed.
  const files = yield* turnFilesOf(launch);

  const settled =
    kept || outcome.end === RUNNER_END.FAILED ? outcome : ended(RUNNER_END.FAILED, STORE_UNKEPT);

  return files === undefined ? settled : { ...settled, files };
});

/**
 * One Cursor launch, from its config to the moment its agent is let go.
 * Answers why it ended, and the failure where it failed.
 */
export const runCursor = Effect.fn("agent-runner/runCursor")(function* (
  context: LaunchContext<CursorConfig>,
) {
  const { config } = context;
  const onHost = runsOnHost(context.env);
  // Note that a host's harnesses run on the machine's own logins, so a key the runner was started with there is never read.
  const apiKey = onHost ? undefined : context.env[RUNNER_ENV.CURSOR_API_KEY];

  if (!onHost && (apiKey === undefined || apiKey === "")) {
    return ended(RUNNER_END.FAILED, NO_KEY);
  }

  if (onHost && !(yield* machineSignedIn(config.sdk))) {
    return ended(RUNNER_END.FAILED, CURSOR_SIGNED_OUT_DETAIL);
  }

  const opened = yield* openLaunch(context, apiKey).pipe(Effect.result);

  if (Result.isFailure(opened)) return ended(RUNNER_END.FAILED, opened.failure.detail);
  const outcome = yield* control(opened.success);

  return yield* closeLaunch(opened.success, outcome);
});
