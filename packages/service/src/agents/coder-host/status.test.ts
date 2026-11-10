import { CONNECTION_LOST_DETAIL, connectionLostFailure } from "@repo/agent-runner/protocol";
import type { AgentLine } from "@repo/database/models/agent-store";
import {
  AGENT_BRIEF,
  AGENT_FAILURE,
  AGENT_KIND,
  AGENT_MACHINE,
  CONTEXT_WINDOW,
} from "@repo/features/agent-wire";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { expect, test } from "vitest";
import { TURN_FAILURE, TURN_STATUS } from "../../core.js";
import { agentFailureOf, agentSummary } from "./status.js";

const STARTED = new Date(1_000);

/**
 * status.test.ts -- why a failed turn failed, a prompt past the model's
 * window told apart; and the Mac a local agent's summary names, and when it
 * last beat.
 */

/** A turn the model call failed, its failure detail as given. */
const failedOnModel = (failureDetail: string) => ({
  status: TURN_STATUS.FAILED,
  failure: TURN_FAILURE.MODEL,
  failureDetail,
});

test("a prompt the provider refused as longer than the window reads as a context overflow, any other model failure as the model's", () => {
  // The words of the continue Anthropic refused in production, as the retired runtime kept them.
  const refused = failedOnModel(
    "MODEL_CALL_FAILED [statusCode] prompt is too long: 1368155 tokens > 1000000 maximum",
  );
  const openAi = failedOnModel(
    "MODEL_CALL_FAILED [code] context_length_exceeded This model's maximum context length is 272000 tokens.",
  );
  const overloaded = failedOnModel("MODEL_CALL_FAILED [statusCode] Overloaded");

  expect(agentFailureOf(refused)).toBe(AGENT_FAILURE.CONTEXT_OVERFLOW);
  expect(agentFailureOf(openAi)).toBe(AGENT_FAILURE.CONTEXT_OVERFLOW);
  expect(agentFailureOf(overloaded)).toBe(AGENT_FAILURE.MODEL);
});

test("a turn the sweep failed as its runner lost reads as that, not as a run that said nothing", () => {
  const lost = {
    status: TURN_STATUS.FAILED,
    failure: TURN_FAILURE.RUNNER_LOST,
    failureDetail: "the agent's runner stopped before its turn ended",
  };

  expect(agentFailureOf(lost)).toBe(AGENT_FAILURE.RUNNER_LOST);
});

test("a turn its runner ended over a provider it waited for in vain reads as the connection lost, by either of the runner's words", () => {
  const gaveUp = failedOnModel(
    `failed ${connectionLostFailure("api.anthropic.com", CONNECTION_LOST_DETAIL.GAVE_UP)}`,
  );
  const lostAgain = failedOnModel(
    `failed ${connectionLostFailure("chatgpt.com", CONNECTION_LOST_DETAIL.LOST_AGAIN)}; responseStreamDisconnected`,
  );
  // The harness's own words for a connection it gave up on, from a runner that probed nothing, stay the model's.
  const unprobed = failedOnModel("success: API Error: Connection error.");

  expect(agentFailureOf(gaveUp)).toBe(AGENT_FAILURE.CONNECTION_LOST);
  expect(agentFailureOf(lostAgain)).toBe(AGENT_FAILURE.CONNECTION_LOST);
  expect(agentFailureOf(unprobed)).toBe(AGENT_FAILURE.MODEL);
});

test("a local agent's summary names its Mac and when it last beat; an agent in a sandbox names none", () => {
  const DEVICE = "device-1";
  const line: AgentLine = {
    id: "agent-1",
    userId: "user-1",
    taskId: "task-1",
    organizationId: "workspace-1",
    automationId: null,
    automationName: null,
    automationRunId: null,
    startedFrom: null,
    startedByAgentId: null,
    conversationId: "conversation-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    contextWindow: CONTEXT_WINDOW.LONG,
    brief: AGENT_BRIEF.BLANK,
    repository: null,
    branch: null,
    startBranch: null,
    title: null,
    archivedAt: null,
    archivedBy: null,
    disabledServers: [],
    author: null,
    githubAccess: GITHUB_ACCESS.APP,
    kind: AGENT_KIND.CODER,
    createdAt: STARTED,
    machine: AGENT_MACHINE.DEVICE,
    deviceId: DEVICE,
  };
  const now = 100_000;
  const seen = (lastSeenAt: number) =>
    agentSummary(
      line,
      { turn: undefined },
      now,
      new Map(),
      [],
      new Map([
        [
          DEVICE,
          {
            id: DEVICE,
            userId: "charles",
            name: "Charles's MacBook Pro",
            platform: DEVICE_PLATFORM.DARWIN,
            machineId: null,
            model: null,
            lastSeenAt: new Date(lastSeenAt),
            codexExecutable: null,
            setup: null,
            setupFailure: null,
          },
        ],
      ]),
    ).mac;

  expect(seen(now - 44_000)).toEqual({
    name: "Charles's MacBook Pro",
    seenAt: now - 44_000,
    deviceId: DEVICE,
  });
});
