/**
 * scripted-agent-sessions.ts -- native harnesses that play hand-written turns into the store, standing in for Claude Code in a sandbox for an end-to-end suite's local server.
 *
 * A journey starts an agent and watches what a runner's events would land:
 * its words drafted a sentence at a time, a tool call, a thread posted with
 * an ask, and the turn's end. Each message a session takes (a Start's first
 * line, a member's later one, an Inbox answer, all of which reach the
 * harness as an open or a send) plays the next turn of the conversation's
 * script past the answer, written through the store writer as the runner's
 * events route writes a native turn (`runner-events-app.ts`): the turn its
 * line awaits started, the line taken into it, its steps, and its end. An
 * ask is posted as the `post_thread` tool posts one (`postInboxThread`),
 * addressed to the agent's starter, so it stands open in the Inbox and on
 * the agent's page until answered, and the answer, handed to the agent as
 * its next message, plays the turn after.
 *
 * A conversation's script is the first whose cue its first message holds,
 * else the first given; a message past the script's last turn plays that
 * last turn again. The sessions themselves are the suite fake's
 * (`native-harness-fake.ts`), so a Start boots at once and its first line
 * is taken by `open`.
 *
 * Hand it to the local server through its override before any route is
 * imported (`@repo/service/local/local-runtime-override`):
 *
 *   overrideLocalRuntime({ nativeAgentSessions: scriptedAgentSessionsLayer(E2E_AGENT_SCRIPTS) });
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, readAgentOfConversation } from "@repo/database/models/agent-store";
import { queuedTurnOf, turnAwaitedByLine } from "@repo/database/models/turn-state";
import { type ConversationTarget, storeWriter } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { INBOX_ASK, type InboxAsk } from "@repo/features/inbox-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Clock, Duration, Effect, Layer, Option, Predicate, Result } from "effect";
import { NATIVE_SESSION_PREFIX } from "../agents/coder-host/native-runtime.js";
import { NativeAgentSessions } from "../agents/coder-host/runtime-sessions.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
  type SessionMessage,
} from "../agents/sessions/agent-sessions.js";
import {
  ACTION_RESULT_STATUS,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  type RunEventBody,
  sessionKey,
  TOOL_CALL_SETTLEMENT,
  TURN_TRIGGER,
  unparsedWire,
} from "../core.js";
import { postInboxThread } from "../inbox/inbox-store.js";
import { scriptedHarness } from "./native-harness-fake.js";

/** One step of a scripted turn: words drafted a sentence at a time, one tool call answered, or a thread posted with an ask. */
export type ScriptedStep =
  | { readonly say: string }
  | {
      readonly call: {
        readonly name: string;
        readonly input: WireBoundaryInput;
        readonly output: WireBoundaryInput;
      };
    }
  | {
      readonly ask: {
        readonly key: string;
        readonly title: string;
        readonly body: string;
        readonly ask: InboxAsk;
      };
    };

/** A conversation's turns, one played for each message its session takes, and the words a first message holds that choose it. */
export interface AgentScript {
  readonly cue: string;
  readonly turns: readonly (readonly ScriptedStep[])[];
  /** How long the script waits before each event it writes. */
  readonly pace: Duration.Duration;
}

/** One turn's steps and the wait before each event it writes. */
interface ScriptedTurn {
  readonly steps: readonly ScriptedStep[];
  readonly pace: Duration.Duration;
}

/**
 * The wait a script a journey watches stream takes before each event, so the
 * journey sees the turn stream rather than land whole. Note that a script no
 * journey watches stream waits none, because its waits only spend the
 * journey's time budget on a cold first launch.
 */
const STREAM_PACE = Duration.millis(250);

/**
 * The scripts the end-to-end journeys play: words and a tool call that
 * stream to an end, and an ask that waits on its answer and a turn that
 * says it heard. A journey picks one by starting its agent on a prompt
 * holding its cue.
 * @public
 */
export const E2E_AGENT_SCRIPTS: readonly AgentScript[] = [
  {
    cue: "[script:stream]",
    pace: STREAM_PACE,
    turns: [
      [
        { say: "Reading the repository first. The README says where to start." },
        {
          call: {
            name: "Read",
            input: { file_path: "README.md" },
            output: "# Example\n\nA repository for the end-to-end suite.",
          },
        },
        { say: "The README is short. Nothing here needs changing, so I am done." },
      ],
    ],
  },
  {
    cue: "[script:ask]",
    pace: Duration.zero,
    turns: [
      [
        { say: "I need one decision before I go on." },
        {
          ask: {
            key: "e2e-color",
            title: "Which color should the button be?",
            body: "The button can be blue or green.",
            ask: {
              type: INBOX_ASK.DECIDE,
              options: [{ label: "Blue" }, { label: "Green" }],
            },
          },
        },
      ],
      [{ say: "Thanks for the answer. I will go on with it." }],
    ],
  },
];

/** The words a message carries, its files left out. */
function wordsOf(message: SessionMessage): string {
  if (Predicate.isString(message.message)) return message.message;

  return message.message
    .flatMap((part) => (part.type === "text" && Predicate.isString(part.text) ? [part.text] : []))
    .join("\n");
}

/** The words cut after each finished sentence, each cut holding every sentence before it, as a step's drafts grow. */
function draftsOf(words: string): readonly string[] {
  const ends = [...words.matchAll(/[.!?](\s|$)/g)].map((match) => match.index + 1);
  const cuts = ends.length === 0 || ends.at(-1) !== words.length ? [...ends, words.length] : ends;

  return cuts.map((end) => words.slice(0, end).trimEnd());
}

/** The turn the message's line awaits, as its send queued it, else the conversation's queued turn, else one of the script's own. */
function turnIdOf(message: SessionMessage) {
  return Effect.gen(function* () {
    const awaited =
      message.lineId === undefined
        ? Option.none<string>()
        : yield* turnAwaitedByLine(message.conversationId, message.lineId);

    if (Option.isSome(awaited)) return awaited.value;
    const queued = yield* queuedTurnOf(message.conversationId);

    return Option.getOrElse(queued, () => randomUUID());
  });
}

/** One thread posted with its ask, as the agent's `post_thread` posts one, addressed to its starter; the tool's input and answer as its call shows them. */
function postedAsk(agent: Agent, posted: Extract<ScriptedStep, { readonly ask: unknown }>["ask"]) {
  return Effect.gen(function* () {
    const poster = { userId: agent.userId, taskId: agent.taskId, agentId: agent.id };

    const item = yield* postInboxThread(poster, {
      ...posted,
      needsReply: true,
      addresseeId: agent.userId,
    });

    const input = { key: posted.key, title: posted.title, body: posted.body, ask: posted.ask };

    if (Result.isFailure(item)) return { input, output: { status: ACTION_RESULT_STATUS.REJECTED } };

    return { input, output: { status: ACTION_RESULT_STATUS.ACCEPTED, threadId: item.success.id } };
  });
}

/** One scripted turn played into the conversation of the message it answers: started, its line taken, each step written a beat apart, and ended. */
function playedTurn(account: string, message: SessionMessage, { steps, pace }: ScriptedTurn) {
  return Effect.gen(function* () {
    const found = yield* readAgentOfConversation(account, message.conversationId);

    if (Option.isNone(found)) return;
    const agent = found.value;
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });

    const target: ConversationTarget = {
      userId: agent.userId,
      conversationId: agent.conversationId,
    };

    yield* Effect.sleep(pace);
    const turnId = yield* turnIdOf(message);
    const turn = { conversationId: sessionKey(agent.conversationId), turnId };
    let sequence = 0;

    const tell = (body: RunEventBody) =>
      Effect.andThen(
        Effect.sleep(pace),
        writer.consume(target, { ...body, ...turn, sequence: ++sequence }),
      );

    yield* writer.enqueueTurn(target, {
      turnId,
      runtimeTurnId: turnId,
      origin: RUN_TURN_ORIGIN.TYPED,
    });
    yield* tell({
      kind: RUN_EVENT.TURN_STARTED,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: yield* Clock.currentTimeMillis,
    });

    yield* writer.takeAwaitingLine(
      target,
      message.lineId === undefined
        ? { text: wordsOf(message), turnId }
        : { clientId: message.lineId, turnId },
    );

    for (const [index, step] of steps.entries()) {
      const number = index + 1;
      yield* tell({ kind: RUN_EVENT.STEP_STARTED, step: number });

      if ("say" in step) {
        for (const text of draftsOf(step.say)) {
          yield* tell({ kind: RUN_EVENT.TEXT_DRAFTED, step: number, text });
        }

        continue;
      }

      const callId = randomUUID();

      const { name, input, output } =
        "call" in step
          ? step.call
          : { name: AGENT_TOOL.POST_THREAD, ...(yield* postedAsk(agent, step.ask)) };

      yield* tell({ kind: RUN_EVENT.TOOL_CALL_STARTED, callId, name, input: unparsedWire(input) });
      yield* tell({
        kind: RUN_EVENT.TOOL_CALL_SETTLED,
        callId,
        name,
        settlement: { state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE, output: unparsedWire(output) },
      });
    }

    yield* tell({
      kind: RUN_EVENT.TURN_ENDED,
      status: RUN_STATUS.SUCCEEDED,
      responseIds: [],
      at: yield* Clock.currentTimeMillis,
    });
  });
}

/**
 * The native harnesses playing the scripts given, every session's turns
 * written past its answer over the services the layer was built in, as a
 * runner posts its events after the send that woke it answered. Note that
 * which turn each conversation is on is kept here, outside the layer, so
 * every build of it in the process reads the same.
 * @public
 */
export function scriptedAgentSessionsLayer(
  scripts: readonly AgentScript[],
): Layer.Layer<NativeAgentSessions, never, DatabaseServices> {
  const played = new Map<string, { readonly script: AgentScript; readonly turns: number }>();
  const [fallback] = scripts;

  /** The conversation's next turn, its script chosen by the first message it hears. */
  const nextTurn = (message: SessionMessage): ScriptedTurn => {
    const words = wordsOf(message);
    const standing = played.get(message.conversationId);
    const script = standing?.script ?? scripts.find((each) => words.includes(each.cue)) ?? fallback;

    if (script === undefined) return { steps: [], pace: Duration.zero };
    const turns = standing?.turns ?? 0;
    played.set(message.conversationId, { script, turns: turns + 1 });

    return { steps: script.turns[Math.min(turns, script.turns.length - 1)] ?? [], pace: script.pace };
  };

  return Layer.effect(
    NativeAgentSessions,
    Effect.gen(function* () {
      const context = yield* Effect.context<DatabaseServices>();

      // Note that the turn is forked detached, since it plays past the send that woke it, as a runner's events land after it.
      const play = (account: string, message: SessionMessage) =>
        Effect.forkDetach(
          playedTurn(account, message, nextTurn(message)).pipe(
            Effect.catchCause((cause) => Effect.logError("a scripted turn failed", cause)),
            Effect.provideContext(context),
          ),
        );

      return scriptedHarness((account) => ({
        open: (message) =>
          Effect.as(play(account, message), {
            outcome: SESSION_SEND_OUTCOME.ACCEPTED,
            sessionId: `${NATIVE_SESSION_PREFIX.claude_code}${randomUUID()}`,
          } as const),
        send: (sessionId, message) =>
          Effect.as(play(account, message), {
            outcome: SESSION_SEND_OUTCOME.ACCEPTED,
            sessionId,
            deliveryId: randomUUID(),
          } as const),
        cancel: () => Effect.succeed({ outcome: SESSION_CANCEL_OUTCOME.NO_ACTIVE_TURN }),
        reset: () => Effect.succeed({ outcome: SESSION_RESET_OUTCOME.RESET }),
      }));
    }),
  );
}
