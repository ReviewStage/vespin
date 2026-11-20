import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { writeAccountTimeZone } from "@repo/database/models/account-time-zone";
import { type Agent, createAgent, recordNativeHanded } from "@repo/database/models/agent-store";
import type { DescriptionWriter } from "@repo/database/models/description-revisions";
import { tallyMemoryRecalls } from "@repo/database/models/memory-recall-store";
import { type MemoryOutcome, rememberMemory } from "@repo/database/models/memory-store";
import { storeWriter } from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  experimentInTestWorkspace,
  getTestDB,
  openWorkspace,
  startTask,
} from "@repo/database/testing";
import { AGENT_KIND, AGENT_PAYER } from "@repo/features/agent-wire";
import { DESCRIPTION_ACTOR } from "@repo/features/task-wire";
import { RUN_STATUS, RUN_TURN_ORIGIN, TURN_TRIGGER } from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { EXPERIMENT } from "@repo/settings";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS, RUN_EVENT, TURN_ORIGIN, unparsedWire } from "../../core.js";
import { saveNotes } from "../../tasks/description-notes.js";
import { fakeAgentSessions } from "../../testing/agents-app-support.js";
import { openGithubUser } from "../../testing/github-app-fake.js";
import { added } from "../../testing/task-contents.js";
import { AGENT_CALLER } from "../agent-tools.js";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";
import { SESSION_TURN } from "../sessions/agent-sessions.js";
import { runAgentEditDescription } from "./agent-doors.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import { runSendToUser } from "./send-to-user-tool.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import {
  handedAfterCompaction,
  handedToFreshSession,
  type TurnHanded,
  taskWithLead,
} from "./turn-context.js";
import { coderTurnMessage } from "./turn-message.js";

/**
 * turn-message.test.ts -- the message a coding agent's turn opens with: the call's words let go after a spoken turn, and its task handed again once another writer saved the description.
 *
 * Over the real migrations on PGlite, an agent on a task, admitted as the
 * MCP door admits it, its turns written through the store writer as a
 * native harness's are: the turn after a spoken one says the call's words
 * no longer hold, as after a compaction that kept only that, and the next
 * says nothing of them; and a typed turn hands the task once after the
 * agent's first turn, then only where someone other than the agent saved
 * the description after its previous turn started, never on its first turn or for
 * its own notes; and an agent's first turn alone, with Memory on, is handed
 * the memories of its own workspace its task's words find; and a turn whose
 * request names no zone reads the developer's day in the zone their account
 * keeps, and in UTC, said to be so, only where it keeps none; and a
 * Manager's spoken turn is told to answer in plain text, and its
 * `send_to_user` refused, until the typed turn after it. Synthetic
 * accounts, tasks, and words throughout.
 */

const DESCRIPTION_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

/** What a turn is told of a description last edited before Task descriptions was last turned on. */
const STALE_WORDS = "before the most recent work; check it against the code before relying on it.";

/** When the agent's first turn starts, which a test reads against its own clock, which starts at nothing. */
const TURN_STARTS_AT = 10 * 60_000;

/** The developer, as the writer of our notes. */
const DEVELOPER: DescriptionWriter = { actor: DESCRIPTION_ACTOR.DEVELOPER };

/** A sandbox door no call of notes alone opens: one that fails if it is. */
const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

/** An account with one agent on Claude Code on a task, admitted as the MCP door admits it. */
const openAgent = Effect.gen(function* () {
  const userId = yield* openGithubUser();
  yield* experimentInTestWorkspace(userId, EXPERIMENT.DESCRIPTIONS);
  const task = yield* startTask(userId, { name: "Teammate invitations", repository: "acme/relay" });

  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: DESCRIPTION_TEXT,
    prompt: null,
    repository: "acme/relay",
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  });

  const agent: Agent = Option.getOrThrow(started).agent;

  const admitted: AdmittedConversation = {
    caller: userId,
    target: { userId, conversationId: agent.conversationId },
    runtimeSessionId: undefined,
    timeZone: undefined,
  };

  return { userId, agent, admitted };
});

/** The agent's turn, started at the instant given and ended, as a native harness's runner reports one. */
const ranTurn = (admitted: AdmittedConversation, turnId: string, at: number) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const turn = { conversationId: sessionKey(admitted.target.conversationId), turnId };
    yield* writer.enqueueTurn(admitted.target, {
      turnId,
      origin: TURN_ORIGIN.TYPED,
      runtimeTurnId: turnId,
    });
    yield* writer.consume(admitted.target, {
      ...turn,
      kind: RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at,
    });
    yield* writer.consume(admitted.target, {
      ...turn,
      kind: RUN_EVENT.TURN_ENDED,
      sequence: 2,
      status: RUN_STATUS.SUCCEEDED,
      responseIds: [],
      at,
    });
  });

/** The id of the memory a keep wrote. */
function keptId(outcome: MemoryOutcome): string {
  assert.ok("memory" in outcome, `nothing was written: ${outcome.kind}`);

  return outcome.memory.id;
}

it.layer(getTestDB())("a coding agent's turn message", (it) => {
  it.effect(
    "the turn after one spoken on a call says the call's words no longer hold, as it does after a compaction kept only that, and the turn after it says nothing of them",
    () =>
      Effect.gen(function* () {
        const { agent, admitted } = yield* openAgent;

        const typedOn = (handed: TurnHanded) =>
          coderTurnMessage(
            admitted,
            agent,
            { kind: SESSION_TURN.TYPED, turnId: undefined },
            handed,
            TURN_STARTS_AT,
          );

        const after = yield* typedOn({ spoken: true });
        assert.ok(after.text?.startsWith("This turn is typed"), after.text ?? "");
        const next = yield* typedOn(after.handed);
        assert.ok(!next.text?.includes("This turn is"), next.text ?? "");
        const compacted = yield* typedOn(handedAfterCompaction({ spoken: true }));
        assert.ok(compacted.text?.startsWith("This turn is typed"), compacted.text ?? "");
      }),
  );

  it.effect(
    "a Manager's spoken turn answers in its plain text, its send_to_user refused, and the typed turn after it goes back to send_to_user",
    () =>
      Effect.gen(function* () {
        const opened = yield* openAgent;
        const agent: Agent = { ...opened.agent, kind: AGENT_KIND.MANAGER };

        const turnOn = (spoken: boolean, handed: TurnHanded) =>
          coderTurnMessage(
            opened.admitted,
            agent,
            { kind: SESSION_TURN.TYPED, turnId: undefined, spoken },
            handed,
            TURN_STARTS_AT,
          );

        // A send as the runner leaves the session's row once the turn's message is composed.
        const sentOn = (handed: TurnHanded) =>
          Effect.gen(function* () {
            yield* recordNativeHanded(opened.admitted.target, handed);
            const agentSessions = fakeAgentSessions().agentSessions("deployment");

            return yield* runSendToUser(
              {
                caller: { kind: AGENT_CALLER.AGENT, agent, descriptionsOn: true },
                agentSessions,
                agentSessionsAs: () => agentSessions,
                writer: storeWriter({ tools: CODER_TOOL_SET }),
                clientKey: randomUUID(),
              },
              unparsedWire({ text: "The invite email is sent." }),
            );
          });

        const spoken = yield* turnOn(true, {});
        const spokenText = spoken.text ?? "";
        assert.ok(spokenText.includes("do not call `send_to_user` this turn"), spokenText);
        assert.ok(!spokenText.includes("end_turn"), spokenText);
        assert.deepEqual(yield* sentOn(spoken.handed), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "You're on a call: answer in plain text; the voice will say it.",
        });

        const typed = yield* turnOn(false, spoken.handed);
        const typedText = typed.text ?? "";
        assert.ok(typedText.includes("only `send_to_user` reaches people again"), typedText);
        assert.deepEqual(yield* sentOn(typed.handed), { status: ACTION_RESULT_STATUS.ACCEPTED });
      }),
  );

  it.effect(
    "a move is told in the turn after it, even where that turn opens a fresh session, and never in the turn after that",
    () =>
      Effect.gen(function* () {
        const { agent, admitted } = yield* openAgent;

        const typedOn = (handed: TurnHanded) =>
          coderTurnMessage(
            admitted,
            agent,
            { kind: SESSION_TURN.TYPED, turnId: undefined },
            handed,
            TURN_STARTS_AT,
          );

        const moved: TurnHanded = {
          moved: { from: { onMac: false }, to: { onMac: true, name: "Studio" } },
        };

        const after = yield* typedOn(handedToFreshSession(moved));
        assert.ok(
          after.text?.startsWith("You moved from the cloud to the developer's Mac `Studio`"),
          after.text ?? "",
        );
        const next = yield* typedOn(after.handed);
        assert.ok(!next.text?.includes("You moved"), next.text ?? "");
      }),
  );

  it.effect(
    "a turn whose request names no zone reads the zone the account keeps, one that names its own reads that, and one with neither reads UTC and says so",
    () =>
      Effect.gen(function* () {
        const { userId, agent, admitted } = yield* openAgent;

        const timeOf = (zone: string | undefined) =>
          Effect.map(
            coderTurnMessage(
              { ...admitted, timeZone: zone },
              agent,
              { kind: SESSION_TURN.TYPED, turnId: undefined },
              {},
              TURN_STARTS_AT,
            ),
            (message) => message.text ?? "",
          );

        const unknown = yield* timeOf(undefined);
        assert.ok(unknown.includes("Their time zone is unknown, so read it as UTC."), unknown);

        yield* writeAccountTimeZone(userId, "America/New_York");
        const kept = yield* timeOf(undefined);
        assert.ok(kept.includes("7:10 PM America/New_York (UTC 00:10), offset -05:00"), kept);
        assert.ok(!kept.includes("unknown"), kept);

        const named = yield* timeOf("Asia/Tokyo");
        assert.ok(named.includes("9:10 AM Asia/Tokyo (UTC 00:10), offset +09:00"), named);
      }),
  );

  it.effect(
    "a typed turn's message hands the task as it stands once after the agent's first turn, then only once someone other than the agent saved the description after its previous turn started, even where the agent then wrote over the same section, and never on its first turn, for its own notes, or once its workspace turned Task descriptions off, and says so where its last edit predates Task descriptions going back on",
    () =>
      Effect.gen(function* () {
        const { userId, agent, admitted } = yield* openAgent;
        assert.ok(agent.taskId !== null);
        const binding = { userId, taskId: agent.taskId };
        const firstTurn = randomUUID();
        const nextTurn = randomUUID();
        let handed: TurnHanded = {};

        // Each typed turn's message, the session keeping what it handed; the task's text, or nothing where it was not handed.
        const typedAt = (turnId: string) =>
          Effect.map(
            Effect.suspend(() =>
              coderTurnMessage(
                admitted,
                agent,
                { kind: SESSION_TURN.TYPED, turnId },
                handed,
                TURN_STARTS_AT,
              ),
            ),
            (message) => {
              handed = message.handed;
              const text = message.text ?? "";

              // Note that the task is read as handed by its lead, since with Descriptions off it is handed without its document.
              return text.includes(taskWithLead("")) ? text : undefined;
            },
          );

        const agentNotes = (notes: Parameters<typeof saveNotes>[1]) =>
          Effect.map(
            runAgentEditDescription(
              admitted,
              unparsedWire({ taskId: binding.taskId, notes }),
              0,
              noSandbox,
            ),
            (answer) => answer.status,
          );

        // Our notes before the agent's first turn: that turn opens on the description as its first message.
        yield* TestClock.adjust("1 minute");
        yield* saveNotes(binding, [added("Context", "Invites go by email.")], DEVELOPER);
        assert.equal(yield* typedAt(firstTurn), undefined);
        // The first turn runs, started after our notes.
        yield* ranTurn(admitted, firstTurn, TURN_STARTS_AT);
        // Once the first turn ran, the session hands the task whole once: its threads and brief are new to it.
        assert.ok(yield* typedAt(nextTurn));
        assert.equal(yield* typedAt(nextTurn), undefined);

        // The agent's own notes after its turn started: it wrote them, so there is nothing new to read.
        yield* TestClock.adjust("10 minutes");
        assert.equal(
          yield* agentNotes([added("Approach", "- Invites expire after 7 days.")]),
          ACTION_RESULT_STATUS.ACCEPTED,
        );
        assert.equal(yield* typedAt(nextTurn), undefined);

        // Our notes while that turn ran, and the agent's after them in the same section, which
        // leave the agent the section's last writer: the next typed turn is handed the description all the same.
        yield* TestClock.adjust("1 minute");
        yield* saveNotes(
          binding,
          [added("Approach", "- A withdrawn invite never grants access.")],
          DEVELOPER,
        );
        yield* TestClock.adjust("1 minute");
        assert.equal(
          yield* agentNotes([added("Approach", "- Resending renews the link.")]),
          ACTION_RESULT_STATUS.ACCEPTED,
        );
        const changed = (yield* typedAt(nextTurn)) ?? "";
        assert.ok(changed.includes("A withdrawn invite never grants access."), changed);
        assert.ok(!changed.includes(STALE_WORDS), changed);
        assert.ok(!changed.includes("## This turn is spoken"), changed);

        // With Task descriptions off a save hands nothing, and the description is never what a turn reads.
        yield* experimentInTestWorkspace(userId, EXPERIMENT.DESCRIPTIONS, false);
        yield* TestClock.adjust("1 minute");
        yield* saveNotes(
          binding,
          [added("Approach", "- Only admins withdraw invites.")],
          DEVELOPER,
        );
        assert.equal(yield* typedAt(nextTurn), undefined);

        // A turn runs after that save, and Task descriptions goes back on: the next turn is handed the description it was not.
        yield* TestClock.adjust("1 minute");
        yield* ranTurn(admitted, nextTurn, yield* Clock.currentTimeMillis);
        yield* TestClock.adjust("1 minute");
        yield* experimentInTestWorkspace(userId, EXPERIMENT.DESCRIPTIONS);
        const back = (yield* typedAt(randomUUID())) ?? "";
        assert.ok(back.includes("Only admins withdraw invites."), back);
        // Its last edit came while Task descriptions was off, so it is said to predate the work since.
        assert.ok(back.includes(STALE_WORDS), back);
      }),
  );

  it.effect(
    "an agent's first turn, with Memory on, is handed the memories of its own workspace its task and words find, never another workspace's, one that matches nothing, or any on a later turn, and nothing at all with Memory off",
    () =>
      Effect.gen(function* () {
        const { userId, agent, admitted } = yield* openAgent;
        const elsewhere = yield* openWorkspace(userId);

        const kept = (workspaceId: string, text: string) =>
          Effect.map(rememberMemory(workspaceId, userId, text, undefined), keptId);

        const invitations = yield* kept(
          agent.organizationId,
          "Invitation emails go out through the mail queue.",
        );

        const releases = yield* kept(
          agent.organizationId,
          "Release notes are dated in Eastern time.",
        );

        yield* kept(elsewhere, "Invitations in the other workspace expire after a day.");

        const recalls = Effect.map(
          tallyMemoryRecalls(agent.organizationId, [invitations, releases]),
          (tallies) => [invitations, releases].map((id) => tallies.get(id)?.recalls30d),
        );

        const firstTurn = randomUUID();

        const typedAt = (turnId: string) =>
          Effect.map(
            coderTurnMessage(
              admitted,
              agent,
              { kind: SESSION_TURN.TYPED, turnId, words: "Send the invitation email." },
              {},
              TURN_STARTS_AT,
            ),
            (message) => message.text ?? "",
          );

        const off = yield* typedAt(firstTurn);
        assert.ok(!off.includes("What the workspace remembers"), off);
        assert.deepEqual(yield* recalls, [0, 0]);

        yield* experimentInTestWorkspace(userId, EXPERIMENT.MEMORY);
        const first = yield* typedAt(firstTurn);
        assert.ok(first.includes("Invitation emails go out through the mail queue."), first);
        assert.ok(!first.includes("Eastern time"), first);
        assert.ok(!first.includes("other workspace"), first);
        // The memory the turn was handed is logged as recalled, and only it.
        assert.deepEqual(yield* recalls, [1, 0]);

        yield* ranTurn(admitted, firstTurn, TURN_STARTS_AT);
        const later = yield* typedAt(randomUUID());
        assert.ok(!later.includes("What the workspace remembers"), later);
      }),
  );
});
