import assert from "node:assert/strict";
import {
  AGENT_PART,
  agentParts,
  agentRows,
  delegates,
  messageWords,
  placedMessages,
  startedAgentOf,
} from "@repo/features/agent-parts";
import { messageFailureWords } from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import {
  AGENT_FAILURE,
  AGENT_PAYER,
  AGENT_RUNTIME,
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentSummary,
  type AgentTranscriptMessage,
  type AgentTurn,
  CHECK_SUMMARY,
  CONTEXT_WINDOW,
  LOCAL_AGENT_REFUSAL,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { FAILURE_REASON, remedyLabel } from "@repo/features/failure-remedy";
import { choiceOn, effortFor } from "@repo/features/model-effort";
import { MODEL_PROVIDER, MODEL_SPEED } from "@repo/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { REPOSITORY_UNREACHED } from "@repo/features/repository-reach-wire";
import { dayAndTimeText } from "@repo/features/time-format";
import { TOOL_STATE } from "@repo/features/tool-call-block";
import { TURN_ROW } from "@repo/features/turn-rows";
import { MESSAGE_ROLE, TURN_STATUS, type WireValue } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { test } from "vitest";
import {
  agentLines,
  agentWorkingSince,
  checkoutCommand,
  choiceLabel,
  choiceModelId,
  continueFailureNote,
  dockedPullRequests,
  finishedReplyLead,
  lastTurnEnding,
  messageFailureNote,
  modelLabel,
  noteWhileOffline,
  offeredModels,
  offersStop,
  payerPlanName,
  planPayerOf,
  pullRequestPillLabel,
  pullRequestStateWord,
  readModelChoice,
  SENT_LINE_STATE,
  type SentLine,
  startFailureNote,
  type TabSends,
  tabTurnOf,
  transcriptRowKey,
  unreadSentLines,
  wakeupDelayOf,
  workingLineWords,
} from "./agent-model.js";
import { inboxNoteReading } from "./inbox-model.js";

test("a model is named by the catalog where it has been read, else by its own id made readable, either way without Claude before its name", () => {
  const models = [
    {
      id: "anthropic/claude-opus-5.5",
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["high"],
    },
    {
      id: "openai/gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      provider: MODEL_PROVIDER.OPENAI,
      efforts: ["high"],
    },
  ];

  assert.equal(modelLabel("anthropic/claude-opus-5.5", models), "Opus 5.5");
  assert.equal(modelLabel("openai/gpt-5.6-terra", models), "GPT-5.6 Terra");
  assert.equal(modelLabel("anthropic/claude-opus-5.5"), "Opus 5.5");
  assert.equal(modelLabel("openai/gpt-6.1-sol"), "GPT 6.1 Sol");
  assert.equal(modelLabel("openai/gpt-6.1-sol", models), "GPT 6.1 Sol");
});

test("a stored message's parts are read for drawing: text, reasoning, a tool call with its state, and anything else skipped", () => {
  const parts = agentParts({
    id: "m",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Read the guide first." },
      {
        type: "tool-bash",
        toolCallId: "call_1",
        state: "output-error",
        input: { command: "pnpm check" },
        errorText: "exit 1",
      },
      {
        type: "tool-read_file",
        toolCallId: "call_2",
        state: "output-available",
        input: {},
        output: "ok",
      },
      { type: "text", text: "Done." },
      { type: "data-weather", data: {} },
      { type: "text" },
    ],
  });

  assert.deepEqual(parts, [
    { kind: AGENT_PART.STEP_START },
    { kind: AGENT_PART.REASONING, text: "Read the guide first." },
    {
      kind: AGENT_PART.TOOL,
      tool: "bash",
      callId: "call_1",
      state: TOOL_STATE.OUTPUT_ERROR,
      input: { command: "pnpm check" },
      output: undefined,
      errorText: "exit 1",
    },
    {
      kind: AGENT_PART.TOOL,
      tool: "read_file",
      callId: "call_2",
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      input: {},
      output: "ok",
      errorText: undefined,
    },
    { kind: AGENT_PART.TEXT, text: "Done." },
    { kind: AGENT_PART.OTHER },
    { kind: AGENT_PART.OTHER },
  ]);
});

test("a finished turn that ended with end_turn replies in its summary, keeping the words it wrote before the call and folding those after it, which the summary stands in for, while a turn still moving keeps its words", () => {
  const summary = "- Fixed the failing check.\n- Pushed to #214.";

  const turn: AgentTranscriptMessage = {
    id: "t",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      { type: "text", text: "Reading the check's log." },
      {
        type: "tool-end_turn",
        toolCallId: "call_end",
        state: "output-available",
        input: { summary, followUps: ["Show pending invitations on the Members page"] },
        output: { status: "accepted" },
      },
      { type: "text", text: "It's all in the summary above." },
    ],
  };

  const words = (moving: boolean) =>
    agentRows(turn, moving).flatMap((row) =>
      row.kind === TURN_ROW.BLOCK && row.block.kind === AGENT_PART.TEXT ? [row.block.text] : [],
    );

  assert.deepEqual(words(false), ["Reading the check's log.", summary]);
  assert.deepEqual(words(true), ["Reading the check's log.", "It's all in the summary above."]);
  assert.equal(messageWords(turn), summary);
  assert.equal(finishedReplyLead([turn])?.lead, "Fixed the failing check.");

  // A follow-up offered twice is one to tick.
  const twice: AgentTranscriptMessage = {
    ...turn,
    parts: [
      {
        type: "tool-end_turn",
        toolCallId: "call_end",
        state: "output-available",
        input: { summary, followUps: ["Add a Members page", " Add a Members page", "Resend"] },
        output: { status: "accepted" },
      },
    ],
  };

  assert.deepEqual(lastTurnEnding([twice])?.followUps, ["Add a Members page", "Resend"]);

  // A line the turn took in under way stands after its journal yet waits on no turn; one no turn took does.
  const line = (taken: boolean): AgentTranscriptMessage => ({
    id: taken ? "steer" : "next",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Keep the link valid for a week." }],
    ...(taken && { arrivedIn: { journalId: twice.id, afterStep: 1 } }),
  });

  assert.equal(lastTurnEnding([twice, line(true)])?.messageId, twice.id);
  assert.equal(lastTurnEnding([twice, line(false)]), undefined);

  // A later call refused stands for the turn, which then replies in its own words.
  const refused: AgentTranscriptMessage = {
    ...turn,
    parts: [
      ...turn.parts,
      {
        type: "tool-end_turn",
        toolCallId: "call_again",
        state: "output-available",
        input: { summary: "" },
        output: { status: "rejected", reason: "A summary is required." },
      },
    ],
  };

  assert.equal(messageWords(refused), "Reading the check's log.\n\nIt's all in the summary above.");
});

test("the wakeup a turn booked is read off Claude Code's own call or ours alike, by the delay held or asked, past a cancel or a refused call", () => {
  type Call = { input: Record<string, number | string | boolean>; output?: WireValue };

  const turnWith = (tool: string, ...calls: Call[]) => ({
    id: "t",
    role: "assistant" as const,
    parts: [
      { type: "text", text: "Pushed; waiting on the checks." },
      ...calls.map((call, index) => ({
        type: `tool-${tool}`,
        toolCallId: `call_${index}`,
        state: "output-available",
        input: call.input,
        output: call.output ?? "ok",
      })),
    ],
  });

  assert.equal(
    wakeupDelayOf(turnWith("ScheduleWakeup", { input: { delaySeconds: 270, prompt: "Check CI" } })),
    270_000,
  );
  // The service held the booking to a minute, which its answer names, so the head says a minute and not the second asked.
  assert.equal(
    wakeupDelayOf(
      turnWith("schedule_wakeup", {
        input: { delaySeconds: 1, prompt: "Check CI" },
        output: {
          status: "accepted",
          wakeup: { at: "2026-10-21T12:01:00.000Z", delaySeconds: 60 },
        },
      }),
    ),
    60_000,
  );
  // A refused call left the booking before it standing, and a cancel books none.
  assert.equal(
    wakeupDelayOf(
      turnWith(
        "schedule_wakeup",
        {
          input: { delaySeconds: 600, prompt: "Check CI" },
          output: {
            status: "accepted",
            wakeup: { at: "2026-10-21T12:10:00.000Z", delaySeconds: 600 },
          },
        },
        {
          input: { delaySeconds: 3_600 },
          output: { status: "rejected", reason: "Not booked: pass a prompt." },
        },
      ),
    ),
    600_000,
  );
  assert.equal(wakeupDelayOf(turnWith("schedule_wakeup", { input: { stop: true } })), undefined);
  assert.equal(wakeupDelayOf(undefined), undefined);
});

/** A row of the developer's, as the service writes one. */
function developer(id: string, text: string): AgentTranscriptMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

test("a line after a turn still open is placed in that turn, unless it did not go, when it stands where the order puts it", () => {
  const ask = developer("m-1", "Add invitations.");

  const open: AgentTranscriptMessage = {
    id: "m-2",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }],
    startedAt: 1_000,
  };

  const steer = developer("m-3", "Use the mailer.");

  const placed = (unsent: (id: string) => boolean) =>
    placedMessages([ask, open, steer], unsent).map((each) => [
      each.message.id,
      each.arrived.map((line) => line.id),
    ]);

  assert.deepEqual(
    placed(() => false),
    [
      ["m-1", []],
      ["m-2", ["m-3"]],
    ],
  );
  assert.deepEqual(
    placed((id) => id === "m-3"),
    [
      ["m-1", []],
      ["m-2", []],
      ["m-3", []],
    ],
  );
});

/** A line sent under `clientKey`, still on its way. */
function sentUnder(clientKey: string, text: string): SentLine {
  return {
    id: sentLineId(clientKey),
    clientKey,
    text,
    attachments: [],
    steers: false,
    sentAt: 0,
    state: SENT_LINE_STATE.PENDING,
  };
}

/** The developer's row the service wrote for a line sent under `clientKey`. */
function writtenFor(id: string, clientKey: string, text: string): AgentTranscriptMessage {
  return { ...developer(id, text), clientId: sentLineId(clientKey) };
}

test("a sent line is read back by the row written under its key alone, so two lines of the same words are each read back by their own", () => {
  const description = developer("m-plan", "Go on.");
  const first = sentUnder("key-1", "Go on.");
  const second = sentUnder("key-2", "Go on.");
  // The description already says the same words, and a row of the same words under another key is another line's.
  assert.deepEqual(unreadSentLines([first, second], [description]), [first, second]);
  const secondLanded = [description, writtenFor("m-2", "key-2", "Go on.")];
  assert.deepEqual(unreadSentLines([first, second], secondLanded), [first]);
  const both = [...secondLanded, writtenFor("m-1", "key-1", "Go on.")];
  assert.deepEqual(unreadSentLines([first, second], both), []);
  assert.equal(messageWords(both[2] ?? description), "Go on.");
});

test("a line refused for now is let go once its row lands, and one refused for good stands", () => {
  const unsent = { ...sentUnder("key-1", "Stop."), state: SENT_LINE_STATE.FAILED };
  const undelivered = { ...sentUnder("key-2", "Wait."), state: SENT_LINE_STATE.UNDELIVERED };
  const rows = [writtenFor("m-1", "key-1", "Stop."), writtenFor("m-2", "key-2", "Wait.")];
  assert.deepEqual(unreadSentLines([unsent, undelivered], rows), [undelivered]);
});

test("a developer's row is keyed by the id its line was drawn under, and every other row by its own", () => {
  const line = sentUnder("key-1", "Soon.");
  const row = writtenFor("m-1", "key-1", "Soon.");
  const [drawn] = agentLines([], [line]);
  assert.ok(drawn);
  assert.equal(transcriptRowKey(row), transcriptRowKey(drawn));
  assert.equal(transcriptRowKey(developer("m-2", "Older.")), "m-2");
  const reply: AgentTranscriptMessage = { id: "m-3", role: MESSAGE_ROLE.ASSISTANT, parts: [] };
  assert.equal(transcriptRowKey(reply), "m-3");
});

test("the lines sent and not read back follow the transcript's rows, as the developer's own, in the order they went", () => {
  const task = developer("m-plan", "Go on.");
  const taken = developer("m-1", "Taken.");
  const soon = sentUnder("key-1", "Soon.");
  const later = sentUnder("key-2", "Later.");
  const drawn = agentLines([task, taken], [soon, later]);
  assert.deepEqual(
    drawn.map((each) => [each.id, each.role, messageWords(each)]),
    [
      ["m-plan", "user", "Go on."],
      ["m-1", "user", "Taken."],
      [soon.id, "user", "Soon."],
      [later.id, "user", "Later."],
    ],
  );
});

const PULL_REQUEST: AgentPullRequest = {
  number: 123,
  title: "Teammate invitations",
  url: "https://github.com/acme/relay/pull/123",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

test("the dock lists every pull request the agent opened, one still open before its newest merged one, and none of another agent's", () => {
  const agentId = "8f1c3a52-6b0e-4d7a-9c21-5e4b7a0d2f10";
  const merged = { ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED };

  const line = (number: number, opener: string) => ({
    ...PULL_REQUEST,
    number,
    url: `https://github.com/acme/relay/pull/${number}`,
    agentId: opener,
  });

  const docked = dockedPullRequests(
    { repository: "acme/relay", branch: "luke/invites", pullRequest: merged },
    [line(121, agentId), line(122, "2d6e9b1f-0c47-4a83-b5e2-7f19c4a6d830"), { ...merged, agentId }],
    agentId,
  );

  assert.deepEqual(
    docked.map(({ pullRequest, current }) => [pullRequest.number, current]),
    [
      [121, false],
      [123, true],
    ],
  );
});

test("the checkout command fetches and switches to the branch", () => {
  assert.equal(
    checkoutCommand("luke/teammate-invitations"),
    "git fetch origin luke/teammate-invitations && git switch luke/teammate-invitations",
  );
  // A branch a shell would read into is quoted, never read.
  assert.equal(
    checkoutCommand("luke/$(touch pwned)'x"),
    "git fetch origin 'luke/$(touch pwned)'\\''x' && git switch 'luke/$(touch pwned)'\\''x'",
  );
});

test("the row says where the pull request stands only once it is a draft, merged, closed, or queued, and the mark says it to a reader without its color", () => {
  assert.deepEqual(
    Object.values(PULL_REQUEST_STATE).map((state) => pullRequestStateWord({ state })),
    [undefined, "Draft", "Merged", "Closed"],
  );
  assert.equal(pullRequestStateWord({ state: PULL_REQUEST_STATE.OPEN, queued: true }), "Queued");
  assert.equal(pullRequestStateWord({ state: PULL_REQUEST_STATE.MERGED, queued: true }), "Merged");
  assert.equal(
    pullRequestPillLabel({ ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED }),
    "Pull request #123, merged",
  );
});

test("a fast or Ultrafast version is folded into its base model by its id, read back as the base at that speed, and named in the choice line", () => {
  const model = (id: string, name: string) => ({
    id,
    name,
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  });

  const models = [
    model("anthropic/claude-opus-5.5-fast", "Claude Opus 5.5 (Fast)"),
    model("anthropic/claude-opus-5.5", "Claude Opus 5.5"),
    model("anthropic/claude-fable-5", "Claude Fable 5"),
    // A suffixed id with no base beside it is a model of its own.
    model("anthropic/claude-haiku-4-fast", "Claude Haiku 4 (Fast)"),
    { ...model("openai/gpt-6.1-sol", "GPT-6.1 Sol"), provider: MODEL_PROVIDER.OPENAI },
    {
      ...model("openai/gpt-6.1-sol-ultrafast", "GPT-6.1 Sol (Ultrafast)"),
      provider: MODEL_PROVIDER.OPENAI,
    },
    { ...model("openai/gpt-6.1-sol-fast", "GPT-6.1 Sol (Fast)"), provider: MODEL_PROVIDER.OPENAI },
  ];

  const offered = offeredModels(models);
  assert.deepEqual(
    offered.map((each) => [each.model.id, each.fast?.id, each.ultrafast?.id]),
    [
      ["anthropic/claude-opus-5.5", "anthropic/claude-opus-5.5-fast", undefined],
      ["anthropic/claude-fable-5", undefined, undefined],
      ["anthropic/claude-haiku-4-fast", undefined, undefined],
      ["openai/gpt-6.1-sol", "openai/gpt-6.1-sol-fast", "openai/gpt-6.1-sol-ultrafast"],
    ],
  );
  assert.deepEqual(readModelChoice(models, "anthropic/claude-opus-5.5-fast"), {
    base: "anthropic/claude-opus-5.5",
    speed: MODEL_SPEED.FAST,
  });
  assert.deepEqual(readModelChoice(models, "anthropic/claude-opus-5.5"), {
    base: "anthropic/claude-opus-5.5",
    speed: MODEL_SPEED.STANDARD,
  });
  assert.deepEqual(readModelChoice(models, "anthropic/claude-haiku-4-fast"), {
    base: "anthropic/claude-haiku-4-fast",
    speed: MODEL_SPEED.STANDARD,
  });
  assert.deepEqual(readModelChoice(models, "openai/gpt-6.1-sol-ultrafast"), {
    base: "openai/gpt-6.1-sol",
    speed: MODEL_SPEED.ULTRAFAST,
  });
  const [opus, fable, , sol] = offered;
  assert.ok(opus && fable && sol);
  assert.equal(choiceModelId(opus, MODEL_SPEED.FAST), "anthropic/claude-opus-5.5-fast");
  assert.equal(choiceModelId(opus, MODEL_SPEED.STANDARD), "anthropic/claude-opus-5.5");
  assert.equal(
    choiceModelId(fable, MODEL_SPEED.FAST),
    "anthropic/claude-fable-5",
    "no fast version to name",
  );
  assert.equal(choiceModelId(sol, MODEL_SPEED.ULTRAFAST), "openai/gpt-6.1-sol-ultrafast");
  assert.equal(
    choiceModelId(opus, MODEL_SPEED.ULTRAFAST),
    "anthropic/claude-opus-5.5",
    "no Ultrafast version to name",
  );
  assert.equal(
    choiceLabel({ model: "anthropic/claude-opus-5.5-fast", effort: "high" }, models),
    "Opus 5.5 High Fast",
  );
  assert.equal(
    choiceLabel({ model: "openai/gpt-6.1-sol-ultrafast", effort: "high" }, models),
    "GPT-6.1 Sol High Ultrafast",
  );
  assert.equal(
    choiceLabel({ model: "anthropic/claude-fable-5", effort: "xhigh" }, models),
    "Fable 5 Extra high",
  );
});

test("a choice names its window after the effort only where it runs on the standard one and the model offers two, and a change of model keeps the standard window only where the next model offers two too", () => {
  const models = [
    {
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      provider: MODEL_PROVIDER.OPENAI,
      efforts: ["low", "high"],
      contextWindows: { standardTokens: 272_000, longTokens: 1_050_000 },
    },
    {
      id: "anthropic/claude-opus-5.5",
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "high"],
    },
  ];

  const standard = {
    model: "openai/gpt-5.5",
    effort: "high",
    contextWindow: CONTEXT_WINDOW.STANDARD,
  };

  assert.equal(choiceLabel(standard, models), "GPT-5.5 High 272K");
  assert.equal(choiceLabel({ model: "openai/gpt-5.5", effort: "high" }, models), "GPT-5.5 High");
  assert.equal(
    choiceLabel({ ...standard, contextWindow: CONTEXT_WINDOW.LONG }, models),
    "GPT-5.5 High",
  );
  assert.equal(
    choiceLabel({ ...standard, model: "anthropic/claude-opus-5.5" }, models),
    "Opus 5.5 High",
  );

  assert.deepEqual(
    choiceOn(models, { model: "openai/gpt-5.5", effort: "low" }, CONTEXT_WINDOW.STANDARD),
    { model: "openai/gpt-5.5", effort: "low", contextWindow: CONTEXT_WINDOW.STANDARD },
  );
  assert.deepEqual(
    choiceOn(
      models,
      { model: "anthropic/claude-opus-5.5", effort: "low" },
      CONTEXT_WINDOW.STANDARD,
    ),
    { model: "anthropic/claude-opus-5.5", effort: "low" },
  );
  assert.deepEqual(
    choiceOn(models, { model: "openai/gpt-5.5", effort: "low" }, CONTEXT_WINDOW.LONG),
    { model: "openai/gpt-5.5", effort: "low" },
  );
});

test("an effort carried to a model that lacks it falls to the nearest the model lists at or below it on the scale, else the lowest above, else the model's first", () => {
  assert.equal(effortFor(["low", "medium", "high"], "high"), "high", "listed, kept");
  assert.equal(effortFor(["low", "medium", "high"], "xhigh"), "high", "Extra high lands on High");
  assert.equal(effortFor(["low", "high", "max"], "medium"), "low");
  assert.equal(effortFor(["minimal", "low"], "max"), "low");
  assert.equal(effortFor(["high", "max"], "low"), "high", "nothing below, so the lowest above");
  assert.equal(effortFor(["low", "high"], undefined), "low", "nothing chosen yet");
  assert.equal(
    effortFor(["turbo", "high"], "ludicrous"),
    "turbo",
    "a name off the scale takes the first",
  );
  assert.equal(
    effortFor(["turbo", "medium"], "high"),
    "medium",
    "names off the scale are passed over",
  );
  assert.equal(effortFor([], "high"), undefined);
});

test("a tab reads its agent from the newer of its summary's turn and its answered send's, never from its transcript, and words the working line by that turn's state", () => {
  const turn = (
    id: string,
    queuedAt: number,
    status: AgentTurn["status"],
    more = {},
  ): AgentTurn => ({
    id,
    queuedAt,
    status,
    ...more,
  });

  const idle: TabSends = { turn: undefined, unanswered: false, rewinding: false };
  const settled = turn("t-1", 1_000, TURN_STATUS.SETTLED);
  const queued = turn("t-2", 2_000, TURN_STATUS.QUEUED);

  const read = (agent: Pick<AgentSummary, "status" | "turn">, sends = idle) => {
    const { working, phase, status, failure } = tabTurnOf(agent, sends);

    return [working, phase, status, failure];
  };

  // A send answered with a turn newer than the list's holds the tab at work until the list catches up.
  assert.deepEqual(
    read({ status: AGENT_STATUS.COMPLETED, turn: settled }, { ...idle, turn: queued }),
    [true, "starting", AGENT_STATUS.RUNNING, undefined],
  );
  // Once the list names that turn, its record is the one read, here failed with why.
  const failed = turn("t-2", 2_000, TURN_STATUS.FAILED, { failure: AGENT_FAILURE.MODEL });
  assert.deepEqual(read({ status: AGENT_STATUS.FAILED, turn: failed }, { ...idle, turn: queued }), [
    false,
    "starting",
    AGENT_STATUS.FAILED,
    AGENT_FAILURE.MODEL,
  ]);
  // A running turn works, and one a Stop was asked of is stopping until its runner ends it.
  const running = turn("t-2", 2_000, TURN_STATUS.RUNNING);
  assert.deepEqual(read({ status: AGENT_STATUS.RUNNING, turn: running }).slice(0, 2), [
    true,
    "working",
  ]);
  assert.deepEqual(
    read({ status: AGENT_STATUS.CANCELED, turn: { ...running, stopAsked: true } }).slice(0, 3),
    [true, "stopping", AGENT_STATUS.CANCELED],
  );
  // A turn held open for a usage limit's reset works, its line naming when the limit resets.
  const resetsAt = new Date(2026, 10, 9, 15, 40).getTime();

  const waiting = tabTurnOf(
    { status: AGENT_STATUS.RUNNING, turn: { ...running, waitsUntil: resetsAt } },
    idle,
  );

  assert.equal(waiting.working, true);
  assert.equal(
    workingLineWords(waiting.phase, waiting.waitsUntil, resetsAt - 60_000),
    "Waiting for your usage limit to reset at 3:40 PM",
  );
  // A send not yet answered, or a rewind out, works past an ended turn until its call answers.
  assert.deepEqual(
    read({ status: AGENT_STATUS.COMPLETED, turn: settled }, { ...idle, unanswered: true }).slice(
      0,
      2,
    ),
    [true, "starting"],
  );
  assert.deepEqual(
    read({ status: AGENT_STATUS.COMPLETED, turn: settled }, { ...idle, rewinding: true }).slice(
      0,
      2,
    ),
    [true, "rewinding"],
  );
  // With no turn, the summary's status says it: starting, then failed as one that never started.
  assert.deepEqual(read({ status: AGENT_STATUS.STARTING }).slice(0, 2), [true, "starting"]);
  assert.deepEqual(read({ status: AGENT_STATUS.FAILED }), [
    false,
    "starting",
    AGENT_STATUS.FAILED,
    AGENT_FAILURE.NOT_STARTED,
  ]);
});

test("Stop is offered only while a turn runs that it can cancel, not while the agent sets up or once it has ended", () => {
  assert.equal(offersStop({ status: AGENT_STATUS.RUNNING }), true);
  // A line awaiting a runner to take it, as while the agent's machine is set up, has no turn to cancel yet.
  assert.equal(offersStop({ status: AGENT_STATUS.RUNNING, stoppable: false }), false);
  assert.equal(offersStop({ status: AGENT_STATUS.STARTING }), false);
  assert.equal(offersStop({ status: AGENT_STATUS.COMPLETED }), false);
});

test("the working line counts from the press of the line that opened the turn, through the turn and a line steering it", () => {
  const said = (id: string, text: string, sentAt: number): AgentTranscriptMessage => ({
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: AGENT_PART.TEXT, text }],
    sentAt,
  });

  const ask = said("m-ask", "Add invitations.", 500);

  const opened: AgentTranscriptMessage = {
    id: "m-turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: AGENT_PART.STEP_START }],
    startedAt: 1_000,
  };

  const steer = said("m-steer", "Use the mailer.", 4_000);
  assert.equal(agentWorkingSince([ask]), 500, "a line awaiting the first turn");
  assert.equal(agentWorkingSince([ask, opened]), 500);
  assert.equal(agentWorkingSince([ask, opened, steer]), 500, "a steer awaiting its place");
  assert.equal(agentWorkingSince([opened]), 1_000, "a turn no line opened counts from its start");
});

test("a planning transcript's raw parts read as the agent tab reads them: the retired runtime's own worker call is a delegation, and a start names the agent it began once it answered one", () => {
  const [worker, started, refused, coding] = agentParts({
    id: "turn-raw",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      {
        type: "tool-worker",
        toolCallId: "w",
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        input: { message: "Compare the queues." },
        output: "Started task worker-ha1bbn.",
      },
      {
        type: "tool-start_coding_agent",
        toolCallId: "s",
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        input: { task: "Fix the invite emails." },
        output: { status: "accepted", agent: { id: "agent-9" } },
      },
      {
        type: "tool-start_coding_agent",
        toolCallId: "r",
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        input: {},
        output: { status: "rejected", reason: "The plan has no repository." },
      },
      { type: "tool-bash", toolCallId: "b", state: TOOL_STATE.OUTPUT_AVAILABLE, input: {} },
    ],
  });

  assert.ok(worker?.kind === AGENT_PART.TOOL && started?.kind === AGENT_PART.TOOL);
  assert.ok(refused?.kind === AGENT_PART.TOOL && coding?.kind === AGENT_PART.TOOL);
  assert.equal(delegates(worker), true);
  assert.equal(delegates(coding), false);
  assert.equal(startedAgentOf(started), "agent-9");
  assert.equal(startedAgentOf(refused), undefined);
  assert.equal(startedAgentOf(worker), undefined);
});

test("a message refused for a repository out of reach names the plan's remedy on a plan, and on an agent with no plan says its words alone but where the remedy needs no plan", () => {
  const refused = {
    failure: AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
    unreached: { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: "acme/relay" },
  } as const;

  const onTask = messageFailureNote(refused, "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10");
  const taskless = messageFailureNote(refused, null);

  assert.equal("taskId" in onTask && onTask.taskId, "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10");
  assert.deepEqual(taskless, {
    reason: FAILURE_REASON.OTHER,
    text: messageFailureWords(AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE),
  });

  // Giving the repository to our GitHub App is pressed on GitHub, not the task, so it stands for an agent with no task.
  const notSelected = messageFailureNote(
    {
      failure: AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
      unreached: {
        reason: REPOSITORY_UNREACHED.NOT_SELECTED,
        repository: "acme/relay",
        settingsUrl: "https://github.com/settings/installations/7",
      },
    },
    null,
  );

  assert.deepEqual(notSelected, {
    reason: FAILURE_REASON.ADD_REPOSITORY,
    text: "Vespin's GitHub App doesn't have access to acme/relay.",
    repository: "acme/relay",
    settingsUrl: "https://github.com/settings/installations/7",
  });
});

test("a refusal for the member's own GitHub token reads with its remedy, Update GitHub token, with or without a task", () => {
  const refused = (reason: "no-token" | "token-no-access" | "token-cannot-push") =>
    ({
      failure: AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
      unreached: { reason, repository: "acme/relay" },
    }) as const;

  const noToken = messageFailureNote(refused(REPOSITORY_UNREACHED.NO_TOKEN), null);
  const noAccess = startFailureNote(refused(REPOSITORY_UNREACHED.TOKEN_NO_ACCESS), null);

  const cannotPush = startFailureNote(
    refused(REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH),
    "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  );

  assert.deepEqual(noToken, {
    reason: FAILURE_REASON.GITHUB_TOKEN,
    text: "Your saved GitHub token could not be opened.",
  });
  assert.deepEqual(noAccess, {
    reason: FAILURE_REASON.GITHUB_TOKEN,
    text: "Your GitHub token cannot access acme/relay. Check the repository still exists under that name, or ask its owner to give your GitHub account access.",
  });
  assert.deepEqual(cannotPush, {
    reason: FAILURE_REASON.GITHUB_TOKEN,
    text: "Your GitHub token cannot push to acme/relay. Ask its owner to give your GitHub account write access.",
  });
  assert.equal(remedyLabel(cannotPush), "Update GitHub token");
});

test("a message a Claude plan refused says to reconnect it, a limit says when it resets, and a plan's refusal says nothing of turning to another payer", () => {
  const resetsAt = Date.UTC(2026, 9, 21, 15, 40);
  const claude = planPayerOf(AGENT_RUNTIME.CLAUDE_CODE);

  const words = (refused: Parameters<typeof messageFailureNote>[0], payer = claude) =>
    messageFailureNote(refused, null, payer).text;

  assert.deepEqual(
    [
      words({ failure: AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT }),
      words({ failure: AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED, resetsAt }),
      words({ failure: AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED }),
      words(
        { failure: AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED, resetsAt },
        planPayerOf(AGENT_RUNTIME.CODEX),
      ),
      messageFailureNote({ failure: AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT }, null).text,
    ],
    [
      "Signed out of Claude. Connect your Claude plan again in Settings.",
      `Usage limit reached · Resets ${dayAndTimeText(resetsAt)}`,
      "Usage limit reached",
      `Usage limit reached · Resets ${dayAndTimeText(resetsAt)}`,
      messageFailureWords(AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT),
    ],
  );
});

test("a Start refused for a missing credential says in one sentence which harness to connect, its press opening Settings beside Retry", () => {
  const missing = (provider?: (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER]) => ({
    failure: AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING,
    ...(provider === undefined ? undefined : { provider }),
  });

  assert.deepEqual(
    [
      startFailureNote(missing(MODEL_PROVIDER.ANTHROPIC), null),
      startFailureNote(missing(MODEL_PROVIDER.OPENAI), "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10"),
      messageFailureNote(missing(MODEL_PROVIDER.OPENAI), null, AGENT_PAYER.API_KEY),
    ],
    [
      {
        reason: FAILURE_REASON.CONNECT_AGENTS,
        text: "Connect Claude in Settings to start an agent.",
        provider: MODEL_PROVIDER.ANTHROPIC,
      },
      {
        reason: FAILURE_REASON.CONNECT_AGENTS,
        text: "Connect Codex in Settings to start an agent.",
        provider: MODEL_PROVIDER.OPENAI,
      },
      {
        reason: FAILURE_REASON.CONNECT_AGENTS,
        text: "Connect Codex in Settings to message this agent.",
        provider: MODEL_PROVIDER.OPENAI,
      },
    ],
  );
});

test("a message to an agent whose device is away offers to continue it in the cloud under the composer, and says it in a Start's words in the Inbox, which offers no move", () => {
  const refused = {
    failure: AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED,
    localAgentRefusal: LOCAL_AGENT_REFUSAL.MAC_AWAY,
    refusedDevice: { name: "Studio" },
  };

  const note = messageFailureNote(refused, null);

  assert.deepEqual(
    [note, remedyLabel(note), messageFailureWords(AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED)],
    [
      {
        reason: FAILURE_REASON.CONTINUE_IN_CLOUD,
        text: "Studio is offline. Unpushed changes stay on it.",
      },
      "Continue in the cloud",
      "Your device is offline, so this agent can't start there. Wake it and log in on it, or start it in the cloud.",
    ],
  );
});

test("a message Vespin heard nothing back on says to try again in the Inbox, which draws no Retry, and its words alone beside the composer's Retry", () => {
  assert.deepEqual(
    [
      messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      messageFailureNote({ failure: AGENT_CALL_FAILURE.UNANSWERED }, null).text,
    ],
    ["No answer came back. Try again.", "No answer came back."],
  );
});

test("a message Vespin heard nothing back on while the app does not reach the service says the developer is offline, in the composer and the Inbox, and any other note keeps its words", () => {
  const unheard = { failure: AGENT_CALL_FAILURE.UNANSWERED };
  const tooLong = { failure: AGENT_CALL_FAILURE.MESSAGE_TOO_LONG };
  const inboxNote = { words: messageFailureWords(unheard.failure), failure: unheard.failure };
  assert.deepEqual(
    [
      noteWhileOffline({ ...messageFailureNote(unheard, null), cause: unheard }, false)?.text,
      inboxNoteReading(inboxNote, undefined, false).words,
      noteWhileOffline({ ...messageFailureNote(tooLong, null), cause: tooLong }, false)?.text,
    ],
    [
      "You're offline.",
      "You're offline. Try again once you're back online.",
      "That message is too long.",
    ],
  );
});

test("a Start another member's device refused names the device and its owner and offers no way out the reader cannot take, and says the same, unnamed, where the service named neither", () => {
  const refused = (refusedDevice?: { name: string; owner?: string }) =>
    startFailureNote(
      {
        failure: AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED,
        localAgentRefusal: LOCAL_AGENT_REFUSAL.NOT_OWNER,
        ...(refusedDevice === undefined ? undefined : { refusedDevice }),
      },
      null,
    ).text;

  assert.deepEqual(
    [
      refused({ name: "Charles's MacBook Pro", owner: "Charles" }),
      refused({ name: "Studio" }),
      refused(),
    ],
    [
      "This task runs on Charles's MacBook Pro. Only Charles can start agents on it.",
      "This task runs on Studio. Only its owner can start agents on it.",
      "This task runs on another member's device. Only its owner can start agents on it.",
    ],
  );
});

test("a missing credential's press names the harness to connect, and Settings where the service named none", () => {
  const missing = (provider?: (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER]) =>
    remedyLabel(
      startFailureNote(
        {
          failure: AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING,
          ...(provider === undefined ? undefined : { provider }),
        },
        null,
      ),
    );

  assert.deepEqual(
    [missing(MODEL_PROVIDER.ANTHROPIC), missing(MODEL_PROVIDER.OPENAI), missing()],
    ["Connect Claude", "Connect Codex", "Open Settings"],
  );
});

test("a Start or a message refused for an API key saved but unreadable says so and offers Settings, where saving it again mends it; a Start its plan refused for good offers Settings too, a message the plan refused does not", () => {
  const unreadable = { failure: AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE } as const;

  assert.deepEqual(
    [
      startFailureNote(unreadable, "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10"),
      messageFailureNote(unreadable, null, AGENT_PAYER.API_KEY),
      startFailureNote({ failure: AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT }, null),
      startFailureNote({ failure: AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE }, null),
      messageFailureNote({ failure: AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE }, null).reason,
    ],
    [
      {
        reason: FAILURE_REASON.CONNECT_AGENTS,
        text: "Your saved API key can't be read. Save it again.",
      },
      {
        reason: FAILURE_REASON.CONNECT_AGENTS,
        text: "Your saved API key can't be read. Save it again.",
      },
      {
        reason: FAILURE_REASON.CONNECT_AGENTS,
        text: "Your plan is signed out. Connect it again.",
      },
      {
        reason: FAILURE_REASON.CONNECT_AGENTS,
        text: "Your plan isn't eligible to run this agent. Choose your API key.",
      },
      FAILURE_REASON.OTHER,
    ],
  );
});

test("a Continue refused for what Settings mends names Settings, since no press beside it opens Settings", () => {
  assert.deepEqual(
    [AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE, AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT].map(
      (failure) => continueFailureNote({ failure }, null).text,
    ),
    [
      "Your saved API key can't be read. Save it again in Settings to start an agent.",
      "Your plan is signed out. Connect it again in Settings to start an agent.",
    ],
  );
});

test("a message to a teammate's agent its starter's own key refused names the starter and offers the reader no Settings of their own", () => {
  const note = (failure: AgentCallFailure) =>
    messageFailureNote({ failure }, null, AGENT_PAYER.API_KEY, "Ada");

  assert.deepEqual(
    [
      note(AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE),
      note(AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING),
    ],
    [
      {
        reason: FAILURE_REASON.OTHER,
        text: "Ada's saved API key can't be read. They save it again in Settings to unblock this agent.",
      },
      {
        reason: FAILURE_REASON.OTHER,
        text: "Ada has no plan or API key connected for this agent. They connect one in Settings to unblock it.",
      },
    ],
  );
});

test("a plan payer names the reader's plan the page named, a new agent's first with room left, and none of a plan the reader does not hold or a teammate's agent", () => {
  const plan = (id: string, position: number, more: Partial<SubscriptionKeySummary>) => ({
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    hint: "ChatGPT",
    addedAt: 0,
    statusAt: 0,
    status: PROVIDER_KEY_STATUS.VERIFIED,
    id,
    position,
    ...more,
  });

  const plans: SubscriptionKeySummary[] = [
    plan("third", 2, { email: "side@work.test" }),
    plan("first", 0, { email: "ana@work.test", status: PROVIDER_KEY_STATUS.LIMIT_REACHED }),
    plan("second", 1, { email: "ana@home.test", label: "Home" }),
  ];

  const { CHATGPT_SUBSCRIPTION, API_KEY } = AGENT_PAYER;
  assert.equal(payerPlanName(CHATGPT_SUBSCRIPTION, plans, "third", false), "side@work.test");
  assert.equal(payerPlanName(CHATGPT_SUBSCRIPTION, plans, undefined, true), "Home");
  assert.equal(payerPlanName(CHATGPT_SUBSCRIPTION, plans, "a-teammates", false), undefined);
  assert.equal(payerPlanName(CHATGPT_SUBSCRIPTION, plans, undefined, false), undefined);
  assert.equal(payerPlanName(CHATGPT_SUBSCRIPTION, plans, undefined, true, true), undefined);
  assert.equal(payerPlanName(API_KEY, plans, "third", false), undefined);
});
