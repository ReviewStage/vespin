import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { DatabaseServices } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { beginAgentBoot, endAgentBoot } from "@repo/database/models/agent-boot-store";
import {
  claimQueueHead,
  type QueuedMessageRow,
  readAgentQueue,
} from "@repo/database/models/agent-queue-store";
import { readAgent } from "@repo/database/models/agent-store";
import { sentLineStands } from "@repo/database/models/message-reads";
import { storeWriter } from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace } from "@repo/database/testing";
import { AGENT_QUEUE_BOUNDS, QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_KIND,
  AGENT_MACHINE,
  AGENT_SENDER,
  agentMessageAnswerSchema,
  agentMessagesAnswerSchema,
  agentQueueAnswerSchema,
  QUEUE_CHANGE,
  VOICE_SPEAKER,
} from "@repo/features/agent-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { isRecord, MESSAGE_CHANNEL, type WireBoundaryInput } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { noNetwork } from "@repo/wire/testing";
import { DateTime, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import {
  MESSAGE_ROLE,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
} from "../core.js";
import { SERVER_EVENT } from "../events/server-events.js";
import { keptAfterResponse } from "../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { SlackBot, slackBotOver } from "../slack/slack-bot.js";
import {
  AGENT_MESSAGES,
  AGENT_PICTURE,
  AGENT_STOP,
  type Answer,
  countedWith,
  fakeAgentSessions,
  messageAs,
  messagedAgent,
  readAnswer,
  receiptOf,
  request,
  SIZED_PNG,
  SNAPSHOT,
  sessionCookieOf,
  userTexts,
} from "../testing/agents-app-support.js";
import { LOCAL_AGENT_ENVIRONMENT } from "../testing/local-agent.js";
import { harnessFor, scriptedHarnessLayer } from "../testing/native-harness-fake.js";
import { queueAtTurnEnd, sendQueued } from "./coder-host/agent-queue.js";
import { settledTurnListener } from "./coder-host/settled-turns.js";
import { canceledTurn } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { SESSION_SEND_OUTCOME } from "./sessions/agent-sessions.js";

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

/**
 * An agent's queue over the agents routes: a message queued while a turn
 * runs waits for the turn's end and opens the next turn, one at a time; a
 * member's change (add, edit, hold, reorder, delete, steer, resume) moves the
 * queue's revision and is answered with the queue; Stop and every other
 * cancel pause it; a refused hand-off keeps the message and pauses with why;
 * and any member who may message the agent may change it, every message in
 * it whoever queued it. Over the harness the agents
 * routes' tests share (`testing/agents-app.ts`). Synthetic accounts, tasks,
 * and words throughout.
 */

it.layer(SUITE)("an agent's queue", (it) => {
  /** Where a change to an agent's queue lands. */
  const AGENT_QUEUE = "/api/agents/queue";
  /** Where an open of the agent, its own page, lands. */
  const AGENT_OPEN = "/api/agents/agent";

  /** One change to the agent's queue as its owner asks it, and the queue it answers. */
  const queueChanged = (
    ask: (request: Request) => Effect.Effect<Answer>,
    owner: string,
    agentId: string,
    change: WireBoundaryInput,
  ) =>
    Effect.map(
      ask(request(AGENT_QUEUE, owner, { method: "POST", id: agentId, body: change })),
      (answered) => readAnswer(agentQueueAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).queue,
    );

  it.effect(
    "messages queued behind the running turn wait there, edited, held, and put in order, none of them sent, and read on the agent's transcript",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        const sentBefore = agentSessions.sent.length;

        for (const text of ["First", "Second", "Third"]) {
          yield* queueChanged(ask, owner, agent.id, {
            change: QUEUE_CHANGE.ADD,
            text,
            id: randomUUID(),
          });
        }

        const [first, second, third] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.RESUME,
        })).messages;

        assert.ok(first !== undefined && second !== undefined && third !== undefined);
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.EDIT,
          messageId: second.id,
          text: "Second, reworded",
        });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.REORDER,
          order: [third.id, first.id, second.id],
        });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.HOLD,
          messageId: first.id,
          held: true,
        });

        assert.equal(agentSessions.sent.length, sentBefore, "nothing goes while the turn runs");

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.deepEqual(
          page.queue?.messages.map((message) => [message.text, message.editing ?? false]),
          [
            ["Third", false],
            ["First", true],
            ["Second, reworded", false],
          ],
        );
      }),
  );

  /** An image and a PDF a queued message may carry. */
  const SHOT = {
    name: "flow.png",
    mediaType: AGENT_ATTACHMENT_TYPE.PNG,
    data: Buffer.from(SIZED_PNG).toString("base64"),
  };

  const SPEC = {
    name: "spec.pdf",
    mediaType: AGENT_ATTACHMENT_TYPE.PDF,
    data: Buffer.from("%PDF-1.4").toString("base64"),
  };

  /** The names of the files the harness was last handed, in order. */
  const handedFiles = (agentSessions: ReturnType<typeof fakeAgentSessions>) =>
    receiptOf(agentSessions.sent.at(-1)?.message.message).flatMap((part) =>
      part.type === "file" ? [part.filename] : [],
    );

  /** A message queued with an image behind the running turn, and held for an edit. */
  const heldWithImage = (agentSessions: ReturnType<typeof fakeAgentSessions>) =>
    Effect.gen(function* () {
      const started = yield* messagedAgent(agentSessions, { running: true });
      const { agent, ask, owner } = started;

      const [message] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Match this.",
        id: randomUUID(),
        attachments: [SHOT],
      })).messages;

      assert.ok(message !== undefined);
      yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.HOLD,
        messageId: message.id,
        held: true,
      });

      return { ...started, message };
    });

  it.effect(
    "a queued image is read by its id as a picture of the agent, by whoever reads the agent alone; an edit saved with other files replaces it, words and all, and the turn's end hands the agent the saved files",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { agent, ask, fetch, owner, other, message, target, writer, turnId, github } =
          yield* heldWithImage(agentSessions);

        const fileId = message.files?.[0]?.id;
        assert.ok(fileId !== undefined, "the queue names the file by an id");

        const read = (bearer: string) =>
          fetch(request(AGENT_PICTURE, bearer, { id: agent.id, picture: fileId }));

        const served = yield* read(owner);
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())),
          SIZED_PNG,
        );
        assert.equal(
          (yield* read(other)).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
          "an account that cannot read the agent reads none of its queue's files",
        );

        const saved = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.EDIT,
          messageId: message.id,
          text: "",
          attachments: [SPEC],
        });

        assert.deepEqual(
          saved.messages.map((each) => [each.text, each.files?.map((file) => file.name)]),
          [["", ["spec.pdf"]]],
        );
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          status: RUN_STATUS.SUCCEEDED,
          responseIds: [],
          at: 0,
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        yield* queueAtTurnEnd(
          (account) => Effect.succeed(agentSessions.agentSessions(`deployment:${account}`)),
          stored,
        ).pipe(Effect.provide(Layer.mergeAll(github.layer, noNetwork)));

        assert.deepEqual(handedFiles(agentSessions), ["spec.pdf"]);
      }),
  );

  it.effect(
    "a message queued on the voice channel goes on as a spoken line on the caller's line already kept, and a typed one beside it does not",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        const line = randomUUID();

        yield* ask(
          request("/api/agents/voice-lines", owner, {
            method: "POST",
            id: agent.id,
            body: {
              id: line,
              callId: randomUUID(),
              speaker: VOICE_SPEAKER.CALLER,
              text: "Is it done?",
            },
          }),
        );

        const [typed, voice] =
          (yield* Effect.forEach(
            [
              {},
              { channel: MESSAGE_CHANNEL.VOICE, delegationId: "item_delegation_1", lines: [line] },
            ],
            (spoken) =>
              queueChanged(ask, owner, agent.id, {
                change: QUEUE_CHANGE.ADD,
                text: "Is it done?",
                id: randomUUID(),
                ...spoken,
              }),
          )).at(-1)?.messages ?? [];

        assert.ok(typed !== undefined && voice !== undefined);

        for (const queued of [typed, voice]) {
          yield* queueChanged(ask, owner, agent.id, {
            change: QUEUE_CHANGE.STEER,
            messageId: queued.id,
          });
        }

        assert.deepEqual(
          agentSessions.sent.slice(-2).map((each) => each.message.spoken ?? false),
          [false, true],
        );

        // The spoken line the queue handed on is the one kept as it was said, never a second row of its words.
        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.deepEqual(
          page.messages.flatMap((message) =>
            isRecord(message.metadata) && message.metadata.channel === MESSAGE_CHANNEL.VOICE
              ? [message.metadata.delegation_id]
              : [],
          ),
          ["item_delegation_1"],
        );
      }),
  );

  it.effect(
    "a spoken message edited in the queue goes as a line of its own, the caller's line standing as said",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        const line = randomUUID();

        yield* ask(
          request("/api/agents/voice-lines", owner, {
            method: "POST",
            id: agent.id,
            body: {
              id: line,
              callId: randomUUID(),
              speaker: VOICE_SPEAKER.CALLER,
              text: "Is it done?",
            },
          }),
        );

        const [queued] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Is it done?",
          id: randomUUID(),
          channel: MESSAGE_CHANNEL.VOICE,
          delegationId: "item_delegation_1",
          lines: [line],
        })).messages;

        assert.ok(queued !== undefined);
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.STEER,
          messageId: queued.id,
          text: "Is the export done?",
        });

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.deepEqual(
          page.messages.flatMap((message) =>
            isRecord(message.metadata) && message.metadata.channel === MESSAGE_CHANNEL.VOICE
              ? [
                  [
                    message.parts.map((part) => (isRecord(part) ? part.text : undefined)),
                    message.metadata.delegation_id,
                  ],
                ]
              : [],
          ),
          [
            [["Is it done?"], undefined],
            [["Is the export done?"], "item_delegation_1"],
          ],
        );
      }),
  );

  it.effect(
    "a spoken message held while the agent boots and edited there goes with the edit's words",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: false });
        const line = randomUUID();

        yield* ask(
          request("/api/agents/voice-lines", owner, {
            method: "POST",
            id: agent.id,
            body: {
              id: line,
              callId: randomUUID(),
              speaker: VOICE_SPEAKER.CALLER,
              text: "Is it done?",
            },
          }),
        );

        // The agent's machine boots afresh, so the delegation waits in its queue.
        yield* endAgentBoot(agent.id);
        yield* beginAgentBoot(agent.id, yield* DateTime.nowAsDate, undefined);

        const held = readAnswer(
          agentMessageAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(
            messageAs(owner, agent.id, {
              text: "Is it done?",
              clientKey: randomUUID(),
              channel: MESSAGE_CHANNEL.VOICE,
              delegationId: "item_delegation_1",
              lines: [line],
            }),
          ),
        );

        const [queued] = held.queued?.messages ?? [];
        assert.ok(queued !== undefined);
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.EDIT,
          messageId: queued.id,
          text: "Is the export done?",
        });
        // The machine up, its boot record goes, and the member steers the edited message.
        const sql = yield* SqlClient.SqlClient;
        yield* sql`delete from agent_boot where agent_id = ${agent.id}`;
        const sentBefore = agentSessions.sent.length;
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.STEER,
          messageId: queued.id,
        });

        const handed = agentSessions.sent
          .slice(sentBefore)
          .map((each) => JSON.stringify(each.message.message));

        assert.equal(handed.length, 1);
        assert.ok(handed[0]?.includes("Is the export done?"), handed[0] ?? "");
      }),
  );

  it.effect(
    "an edit steered goes now with the edit's words and files in place of the message's",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner, message } = yield* heldWithImage(agentSessions);

        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.STEER,
          messageId: message.id,
          text: "Use the spec instead.",
          attachments: [SPEC],
        });

        assert.deepEqual(queue.messages, []);
        assert.deepEqual(handedFiles(agentSessions), ["spec.pdf"]);
        assert.ok(
          JSON.stringify(agentSessions.sent.at(-1)?.message.message).includes(
            "Use the spec instead.",
          ),
        );
      }),
  );

  it.effect(
    "a message queued while the agent stands idle goes at once as its member's own message, under its own key, and leaves the queue",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { agent, ask, owner, target } = yield* messagedAgent(agentSessions, {
          running: false,
        });

        const id = randomUUID();

        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Now the dark variant.",
          id,
        });

        assert.deepEqual(queue.messages, []);
        assert.ok(
          JSON.stringify(agentSessions.sent.at(-1)?.message.message).includes(
            "Now the dark variant.",
          ),
        );
        assert.equal(yield* sentLineStands(owner, target.conversationId, sentLineId(id)), true);
      }),
  );

  it.effect(
    "every change to the queue moves its revision on, and the page still carries the queue once it stands empty",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        const revisions: number[] = [];

        const changed = (change: WireBoundaryInput) =>
          Effect.tap(queueChanged(ask, owner, agent.id, change), (queue) =>
            Effect.sync(() => revisions.push(queue.revision)),
          );

        const [queued] = (yield* changed({
          change: QUEUE_CHANGE.ADD,
          text: "Run tests",
          id: randomUUID(),
        })).messages;

        assert.ok(queued !== undefined);
        yield* changed({ change: QUEUE_CHANGE.EDIT, messageId: queued.id, text: "Run the tests" });
        yield* changed({ change: QUEUE_CHANGE.REORDER, order: [queued.id] });
        // Held, so the Resume after the Stop hands nothing on.
        yield* changed({ change: QUEUE_CHANGE.HOLD, messageId: queued.id, held: true });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* changed({ change: QUEUE_CHANGE.RESUME });
        yield* changed({ change: QUEUE_CHANGE.DELETE, messageId: queued.id });

        for (const [at, revision] of revisions.entries()) {
          assert.ok(
            at === 0 || revision > (revisions[at - 1] ?? 0),
            `change ${at} moved the revision on`,
          );
        }

        assert.ok(
          (revisions[4] ?? 0) > (revisions[3] ?? 0) + 1,
          "the Stop's pause moved it on too",
        );

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.deepEqual(page.queue, { messages: [], revision: revisions.at(-1) });
      }),
  );

  it.effect(
    "an edited message steered goes once with its new words, never its old ones, and leaves the queue",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });

        const [queued] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Run tests",
          id: randomUUID(),
        })).messages;

        assert.ok(queued !== undefined);
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.HOLD,
          messageId: queued.id,
          held: true,
        });

        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.STEER,
          messageId: queued.id,
          text: "Run tests and fix failures",
        });

        assert.deepEqual(queue.messages, []);
        const said = agentSessions.sent.map((each) => JSON.stringify(each.message.message));
        assert.equal(
          said.filter((words) => words.includes("Run tests and fix failures")).length,
          1,
        );
        assert.equal(
          said.filter((words) => words.includes("Run tests") && !words.includes("fix failures"))
            .length,
          0,
          "the words the edit replaced never went",
        );
      }),
  );

  it.effect("a queued message steered goes into the running turn now and leaves the queue", () =>
    Effect.gen(function* () {
      const agentSessions = fakeAgentSessions();
      const { agent, ask, owner, target } = yield* messagedAgent(agentSessions, { running: true });
      const countedBefore = countedWith(owner, SERVER_EVENT.MESSAGE_SEND).length;
      const id = randomUUID();

      const [queued] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Also the emails.",
        id,
      })).messages;

      assert.ok(queued !== undefined);

      const queue = yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.STEER,
        messageId: queued.id,
      });

      assert.deepEqual(queue.messages, []);
      assert.equal(yield* sentLineStands(owner, target.conversationId, sentLineId(id)), true);
      // Counted once, as it went, and as a message that waited in the queue.
      assert.deepEqual(countedWith(owner, SERVER_EVENT.MESSAGE_SEND).slice(countedBefore), [
        {
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          machine: AGENT_MACHINE.VERCEL,
          agent_kind: AGENT_KIND.CODER,
          turn_running: true,
          queued: true,
        },
      ]);
    }),
  );

  /**
   * An agent whose turn ran while the owner queued `texts`, then ended: the
   * queue at that end as the runner's events route hands it on (with GitHub
   * and no network), and the queue as the owner reads it on the transcript.
   */
  const queuedBehindEndedTurn = (
    agentSessions: ReturnType<typeof fakeAgentSessions>,
    texts: readonly string[],
    ending: typeof RUN_STATUS.SUCCEEDED | typeof RUN_STATUS.FAILED = RUN_STATUS.SUCCEEDED,
  ) =>
    Effect.gen(function* () {
      const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(
        agentSessions,
        {
          running: true,
        },
      );

      for (const text of texts) {
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text,
          id: randomUUID(),
        });
      }

      yield* writer.consume(target, {
        kind: RUN_EVENT.TURN_ENDED,
        conversationId: sessionKey(target.conversationId),
        turnId,
        sequence: 2,
        status: ending,
        responseIds: [],
        at: 0,
      });
      const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));

      const sessionsFor = (account: string) =>
        Effect.succeed(agentSessions.agentSessions(`deployment:${account}`));

      const reach = Layer.mergeAll(github.layer, noNetwork);
      const turnEnded = queueAtTurnEnd(sessionsFor, stored).pipe(Effect.provide(reach));

      /** One queued message handed on, as a hand-off does once it read the queue's head. */
      const handedOn = (message: QueuedMessageRow) =>
        sendQueued(sessionsFor, stored, message).pipe(Effect.provide(reach));

      // Note that the read at once says whether it would have held, and when the clock alone moves it, which the page itself does not carry.
      const queued = Effect.map(
        ask(request(AGENT_MESSAGES, owner, { id: agent.id, wait: "none" })),
        (answered) => {
          // SAFETY: the route answers a page as a JSON object.
          const {
            holds: _holds,
            wakeIn: _wakeIn,
            ...page
          } = answered.body as Record<string, WireBoundaryInput>;

          return readAnswer(agentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, {
            status: answered.status,
            body: page,
          }).queue;
        },
      );

      return { agent, ask, owner, turnEnded, handedOn, queued, stored };
    });

  /** How many times the harness was handed words holding `text`. */
  const handedCount = (agentSessions: ReturnType<typeof fakeAgentSessions>, text: string) =>
    agentSessions.sent.filter((each) => JSON.stringify(each.message.message).includes(text)).length;

  it.effect(
    "at the turn's end the queue hands on its first message alone, and nothing more while that one awaits its turn",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { turnEnded, queued } = yield* queuedBehindEndedTurn(agentSessions, [
          "First",
          "Second",
        ]);

        yield* turnEnded;
        yield* turnEnded;
        assert.deepEqual(
          (yield* queued)?.messages.map((message) => message.text),
          ["Second"],
        );
        assert.equal(handedCount(agentSessions, "First"), 1);
        assert.equal(handedCount(agentSessions, "Second"), 0);
      }),
  );

  it.effect(
    "the turn's end stops at a message being edited, sending nothing past it, and Cancel lets the queue go on with it",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { agent, ask, owner, turnEnded, queued } = yield* queuedBehindEndedTurn(
          agentSessions,
          ["Edited", "After"],
        );

        const [edited] = (yield* queued)?.messages ?? [];
        assert.ok(edited !== undefined);

        const marked = (editing: boolean) =>
          queueChanged(ask, owner, agent.id, {
            change: QUEUE_CHANGE.HOLD,
            messageId: edited.id,
            held: editing,
          });

        yield* marked(true);
        yield* turnEnded;
        assert.deepEqual(
          [handedCount(agentSessions, "Edited"), handedCount(agentSessions, "After")],
          [0, 0],
          "nothing past a message being edited goes",
        );

        yield* marked(false);
        assert.deepEqual(
          [handedCount(agentSessions, "Edited"), handedCount(agentSessions, "After")],
          [1, 0],
        );
      }),
  );

  it.effect(
    "a turn that ended failed pauses the queue rather than handing on, keeping its messages",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { turnEnded, queued } = yield* queuedBehindEndedTurn(
          agentSessions,
          ["First"],
          RUN_STATUS.FAILED,
        );

        yield* turnEnded;

        assert.equal(handedCount(agentSessions, "First"), 0);
        const queue = yield* queued;
        assert.deepEqual(
          queue?.messages.map((message) => message.text),
          ["First"],
        );
        assert.deepEqual(queue?.paused, { because: QUEUE_PAUSE.TURN_FAILED });
      }),
  );

  it.effect(
    "a line held in the queue while the agent booted goes as the sender it recorded, not as the member it was queued under",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { ask, owner, handedOn, stored } = yield* queuedBehindEndedTurn(agentSessions, []);
        const text = "Triage the failures.";

        yield* handedOn({
          id: randomUUID(),
          userId: owner,
          text,
          attachments: [],
          editing: false,
          claimedAt: new Date(0),
          sendKey: randomUUID(),
          line: {
            sender: {
              kind: MESSAGE_SENDER.AUTOMATION,
              automationId: undefined,
              name: "Nightly triage",
            },
          },
        });

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: stored.id })),
        );

        const sent = page.messages.find(
          (message) =>
            message.role === MESSAGE_ROLE.USER && userTexts({ messages: [message] })[0] === text,
        );

        assert.deepEqual(sent?.sentBy, { name: "Nightly triage", kind: AGENT_SENDER.AUTOMATION });
      }),
  );

  it.effect(
    "a message sent while its first launch's hand-off could not be recorded stays claimed in the queue rather than dropped",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { owner, handedOn, stored } = yield* queuedBehindEndedTurn(agentSessions, ["First"]);
        const head = Option.getOrThrow(yield* claimQueueHead(stored.id));
        const sql = yield* SqlClient.SqlClient;

        // The boot's table out of reach for this one hand-off, so recording it fails as a store failure would.
        const unreachable = Effect.acquireUseRelease(
          sql.unsafe("ALTER TABLE agent_boot RENAME TO agent_boot_away"),
          () => handedOn(head),
          () => Effect.orDie(sql.unsafe("ALTER TABLE agent_boot_away RENAME TO agent_boot")),
        );

        yield* unreachable;

        assert.equal(handedCount(agentSessions, "First"), 1);
        const queue = Option.getOrThrow(yield* readAgentQueue(owner, stored.id));
        assert.deepEqual(
          queue.messages.map((message) => message.text),
          ["First"],
          "the message waits to be sent again under its key",
        );
      }),
  );

  it.effect(
    "two hand-offs that read the same head at one turn's end, its IDLE's and its END's, send that message once",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { handedOn, queued, stored } = yield* queuedBehindEndedTurn(agentSessions, [
          "First",
          "Second",
        ]);

        // Both hand-offs read the head before either sent it, as two racing at one end do.
        const head = Option.getOrThrow(yield* claimQueueHead(stored.id));

        yield* handedOn(head);
        yield* handedOn(head);

        assert.equal(handedCount(agentSessions, "First"), 1);
        const queue = yield* queued;
        assert.deepEqual(
          queue?.messages.map((message) => message.text),
          ["Second"],
        );
        assert.equal(queue?.paused, undefined, "the hand-off that lost the race pauses nothing");
      }),
  );

  it.effect(
    "a message whose hand-off claimed it and was cut off before sending it goes once, at an open of the agent after its claim lapsed",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { agent, ask, owner, queued, stored } = yield* queuedBehindEndedTurn(agentSessions, [
          "First",
        ]);

        const opened = ask(request(AGENT_OPEN, owner, { id: agent.id }));
        // The turn's end claimed the head, and its function died before the send.
        assert.ok(Option.isSome(yield* claimQueueHead(stored.id)));

        yield* opened;
        assert.equal(
          handedCount(agentSessions, "First"),
          0,
          "a claim standing is a send under way",
        );

        yield* TestClock.adjust(AGENT_QUEUE_BOUNDS.CLAIM_MS);
        yield* opened;
        yield* opened;

        assert.equal(handedCount(agentSessions, "First"), 1);
        assert.deepEqual((yield* queued)?.messages ?? [], []);
      }),
  );

  it.effect(
    "a hand-off the harness refuses keeps the message in its place and pauses the queue under the refusal",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions({ sends: SESSION_SEND_OUTCOME.FAILED });

        const { turnEnded, queued } = yield* queuedBehindEndedTurn(agentSessions, [
          "First",
          "Second",
        ]);

        const before = (yield* queued)?.revision ?? 0;

        yield* turnEnded;

        const queue = yield* queued;
        assert.ok(
          (queue?.revision ?? 0) > before,
          "the refusal's pause moved the queue on, which wakes its readers",
        );
        assert.deepEqual(
          queue?.messages.map((message) => message.text),
          ["First", "Second"],
        );
        assert.equal(queue?.paused?.because, QUEUE_PAUSE.REFUSED);
        assert.notEqual(queue?.paused?.refusal, undefined);
      }),
  );

  it.effect(
    "a message queued while the agent starts waits behind its first turn and goes once that turn ends",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { agent, ask, owner, target, writer, github } = yield* messagedAgent(
          agentSessions,
          undefined,
        );

        const sentBefore = agentSessions.sent.length;

        const queue = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Then open the pull request.",
          id: randomUUID(),
        });

        assert.deepEqual(
          queue.messages.map((message) => message.text),
          ["Then open the pull request."],
        );
        assert.equal(agentSessions.sent.length, sentBefore, "nothing goes while the agent starts");

        // The first turn opens, takes the Start's line, and ends.
        const turnId = randomUUID();
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          runtimeTurnId: "turn_0",
        });
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 1,
          origin: RUN_TURN_ORIGIN.TYPED,
          trigger: TURN_TRIGGER.ASK,
          at: 0,
        });
        yield* writer.takeAwaitingLine(target, { text: SNAPSHOT, turnId });
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          status: RUN_STATUS.SUCCEEDED,
          responseIds: [],
          at: 0,
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));

        const sessionsFor = (account: string) =>
          Effect.succeed(agentSessions.agentSessions(`deployment:${account}`));

        yield* queueAtTurnEnd(sessionsFor, stored).pipe(
          Effect.provide(Layer.mergeAll(github.layer, noNetwork)),
        );

        assert.equal(handedCount(agentSessions, "Then open the pull request."), 1);
      }),
  );

  it.effect(
    "Resume answers before its hand-off runs, and the answer already leaves out the message it is sending",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const kept = keptAfterResponse();

        const { agent, ask, owner } = yield* messagedAgent(
          agentSessions,
          { running: true },
          undefined,
          kept,
        );

        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* kept.run;
        const sentBefore = agentSessions.sent.length;

        const resumed = yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.RESUME,
        });

        assert.deepEqual(resumed.messages, [], "the message about to go is not listed");
        assert.equal(resumed.paused, undefined);
        assert.equal(agentSessions.sent.length, sentBefore, "the answer is out before the send");
        yield* kept.run;
        assert.equal(handedCount(agentSessions, "Open the pull request."), 1);
      }),
  );

  it.effect(
    "a Resume between the Stop and the stopped turn's end stands: the turn's end pauses nothing again",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(
          agentSessions,
          {
            running: true,
          },
        );

        const [queued] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        })).messages;

        assert.ok(queued !== undefined);
        // Held by an edit, so the Resume hands nothing on and the queue's pause alone is at stake.
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.HOLD,
          messageId: queued.id,
          held: true,
        });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* queueChanged(ask, owner, agent.id, { change: QUEUE_CHANGE.RESUME });

        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          status: RUN_STATUS.CANCELED,
          responseIds: [],
          at: 0,
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));

        const sessionsFor = (account: string) =>
          Effect.succeed(agentSessions.agentSessions(`deployment:${account}`));

        yield* queueAtTurnEnd(sessionsFor, stored).pipe(
          Effect.provide(Layer.mergeAll(github.layer, noNetwork)),
        );

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.equal(page.queue?.paused, undefined);
      }),
  );

  it.effect("a message being sent is no member's to delete, and deleting it says so", () =>
    Effect.gen(function* () {
      const agentSessions = fakeAgentSessions();
      const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });

      const [queued] = (yield* queueChanged(ask, owner, agent.id, {
        change: QUEUE_CHANGE.ADD,
        text: "Open the pull request.",
        id: randomUUID(),
      })).messages;

      assert.ok(queued !== undefined);
      yield* claimQueueHead(agent.id);

      const deleted = yield* ask(
        request(AGENT_QUEUE, owner, {
          method: "POST",
          id: agent.id,
          body: { change: QUEUE_CHANGE.DELETE, messageId: queued.id },
        }),
      );

      assert.equal(deleted.status, HOSTED_HTTP_STATUS.NOT_FOUND);
    }),
  );

  it.effect(
    "a message queued after the turn's end found nothing to hand on still goes at once",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { agent, ask, owner, turnEnded, queued } = yield* queuedBehindEndedTurn(
          agentSessions,
          [],
        );

        yield* turnEnded;

        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Late",
          id: randomUUID(),
        });

        assert.equal(handedCount(agentSessions, "Late"), 1);
        assert.deepEqual((yield* queued)?.messages ?? [], []);
      }),
  );

  it.effect(
    "a Stop pauses what is queued behind the turn, and Resume lets the queue go again",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { agent, ask, owner } = yield* messagedAgent(agentSessions, { running: true });
        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Then open a pull request.",
          id: randomUUID(),
        });
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.deepEqual(page.queue?.paused, { because: QUEUE_PAUSE.STOPPED });

        const resumed = yield* queueChanged(ask, owner, agent.id, { change: QUEUE_CHANGE.RESUME });
        assert.equal(resumed.paused, undefined);
      }),
  );

  it.effect(
    "a teammate who may message the agent queues behind its turn and edits its starter's message, which stays the starter's, until the agent runs on its starter's own Mac",
    () =>
      Effect.gen(function* () {
        const opened = yield* messagedAgent(fakeAgentSessions(), { running: true });
        yield* joinWorkspace(opened.task.workspaceId, opened.other);
        const { agent, ask, owner, other } = opened;

        /** One change as the teammate asks it from their browser, and how it was answered. */
        const teammateAsks = (change: WireBoundaryInput) =>
          ask(
            request(AGENT_QUEUE, undefined, {
              method: "POST",
              id: agent.id,
              cookie: sessionCookieOf(other),
              body: change,
            }),
          );

        const [starters] = (yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        })).messages;

        assert.ok(starters !== undefined);

        yield* teammateAsks({ change: QUEUE_CHANGE.ADD, text: "Also the docs.", id: randomUUID() });

        const edited = readAnswer(
          agentQueueAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* teammateAsks({
            change: QUEUE_CHANGE.EDIT,
            messageId: starters.id,
            text: "Open the pull request as a draft.",
          }),
        ).queue;

        assert.deepEqual(
          edited.messages.map(({ text, queuedBy }) => [text, queuedBy]),
          [
            ["Open the pull request as a draft.", owner],
            ["Also the docs.", other],
          ],
        );
        const sql = yield* SqlClient.SqlClient;
        yield* sql`update agent set machine = 'device' where id = ${agent.id}`;

        const refused = yield* teammateAsks({
          change: QUEUE_CHANGE.DELETE,
          messageId: starters.id,
        });

        assert.equal(refused.status, HOSTED_HTTP_STATUS.FORBIDDEN);
      }),
  );

  it.effect(
    "a turn's end that lands while the Stop's cancel is out finds the queue already paused, and sends nothing",
    () =>
      Effect.gen(function* () {
        let racing: Effect.Effect<void> = Effect.void;
        const agentSessions = fakeAgentSessions({ canceling: Effect.suspend(() => racing) });

        const { agent, ask, owner, target, writer, turnId, github } = yield* messagedAgent(
          agentSessions,
          {
            running: true,
          },
        );

        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));

        const sessionsFor = (account: string) =>
          Effect.succeed(agentSessions.agentSessions(`deployment:${account}`));

        // The runner ends the turn as stopped, and its events hand on the queue, before the harness answers the cancel.
        const database = yield* Effect.context<DatabaseServices>();
        racing = Effect.andThen(
          writer.consume(target, {
            kind: RUN_EVENT.TURN_ENDED,
            conversationId: sessionKey(target.conversationId),
            turnId,
            sequence: 2,
            status: RUN_STATUS.CANCELED,
            responseIds: [],
            at: 0,
          }),
          queueAtTurnEnd(sessionsFor, stored).pipe(
            Effect.provide(Layer.mergeAll(github.layer, noNetwork, memorySandbox().layer)),
          ),
        ).pipe(Effect.provideContext(database), Effect.orDie);

        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));

        assert.equal(
          handedCount(agentSessions, "Open the pull request."),
          0,
          "nothing went after the Stop",
        );

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.equal(page.queue?.paused?.because, QUEUE_PAUSE.STOPPED);
      }),
  );

  it.effect(
    "a turn canceled other than by the Stop route, as a Continue, another agent's stop_agent, or a rewind cancels it, pauses the queue before the cancel",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        const { agent, ask, owner, github } = yield* messagedAgent(agentSessions, {
          running: true,
        });

        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        });
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));

        yield* canceledTurn(
          Effect.succeed(agentSessions.agentSessions(`deployment:${owner}`)),
          storeWriter({ tools: CODER_TOOL_SET }),
          stored,
        ).pipe(Effect.provide(Layer.mergeAll(github.layer, noNetwork)));

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.equal(page.queue?.paused?.because, QUEUE_PAUSE.STOPPED);
        assert.equal(handedCount(agentSessions, "Open the pull request."), 0);
      }),
  );

  it.effect(
    "a turn settled other than by its runner's events, as a Stop's force settles one resumed while its cancel was out, hands on the queue",
    () =>
      Effect.gen(function* () {
        let racing: Effect.Effect<void> = Effect.void;
        const agentSessions = fakeAgentSessions({ canceling: Effect.suspend(() => racing) });

        const { agent, ask, owner, target, turnId, github } = yield* messagedAgent(agentSessions, {
          running: true,
        });

        yield* queueChanged(ask, owner, agent.id, {
          change: QUEUE_CHANGE.ADD,
          text: "Open the pull request.",
          id: randomUUID(),
        });
        // The queue is resumed while the Stop's cancel is out, so the turn still runs and nothing goes.
        racing = Effect.asVoid(queueChanged(ask, owner, agent.id, { change: QUEUE_CHANGE.RESUME }));
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        assert.equal(handedCount(agentSessions, "Open the pull request."), 0);

        // The runner never ends the turn, so the Stop's force settles it canceled, as a lost runner's turn is.
        const listening = settledTurnListener.pipe(
          Layer.provide(
            Layer.mergeAll(
              github.layer,
              noNetwork,
              LOCAL_AGENT_ENVIRONMENT,
              Layer.succeed(SlackBot, slackBotOver(undefined)),
            ),
          ),
        );

        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* settleRunnerLostTurns(
          writer,
          target.conversationId,
          0,
          undefined,
          new Set([turnId]),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              listening,
              github.layer,
              noNetwork,
              scriptedHarnessLayer((account) => agentSessions.agentSessions(harnessFor(account))),
            ),
          ),
        );

        assert.equal(handedCount(agentSessions, "Open the pull request."), 1);
        assert.deepEqual(
          Option.getOrThrow(yield* readAgentQueue(owner, agent.id)).messages,
          [],
          "the message left the queue",
        );
      }),
  );

  it.effect(
    "a Stop pauses what is queued though the turn was already over, so no later hand-on sends it after the Stop",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();

        // The turn ended with a message still queued, which the turn's end has not handed on yet.
        const { agent, ask, owner, queued, turnEnded } = yield* queuedBehindEndedTurn(
          agentSessions,
          ["Open the pull request."],
        );

        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        yield* turnEnded;

        assert.equal((yield* queued)?.paused?.because, QUEUE_PAUSE.STOPPED);
        assert.equal(handedCount(agentSessions, "Open the pull request."), 0);
      }),
  );
});
