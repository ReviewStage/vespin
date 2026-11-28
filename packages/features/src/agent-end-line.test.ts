/**
 * agent-end-line.test.ts -- the one press a failed end line ends on, as the iPhone's agent page reads it: Continue where only a new agent goes on, the API keys where the reader's own key was refused, Try again where a message carries the agent on, and none on a stop or a teammate's key.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { endLineReason } from "./agent-continue-model.js";
import { END_LINE_PRESS, type EndLinePress, endLinePress } from "./agent-end-line.js";
import { AGENT_FAILURE, AGENT_STATUS, type AgentFailure, type AgentStatus } from "./agent-wire.js";

/** An ended agent's line, as its page reads it, with nothing continued it and its box open. */
function ending(status: AgentStatus, failure: AgentFailure | undefined, starter?: string) {
  return {
    status,
    endReason: endLineReason(failure, starter),
    failure,
    continued: false,
    boxClosed: false,
  };
}

describe("endLinePress", () => {
  it.each<[string, ReturnType<typeof ending>, EndLinePress | undefined]>([
    [
      "a conversation too long for the model continues in a new agent",
      ending(AGENT_STATUS.FAILED, AGENT_FAILURE.CONTEXT_OVERFLOW),
      END_LINE_PRESS.CONTINUE,
    ],
    [
      "the reader's own refused key opens the API keys",
      ending(AGENT_STATUS.FAILED, AGENT_FAILURE.PROVIDER_KEY),
      END_LINE_PRESS.KEY,
    ],
    [
      "a teammate's refused key offers nothing, being theirs to mend",
      ending(AGENT_STATUS.FAILED, AGENT_FAILURE.PROVIDER_KEY, "Grace"),
      undefined,
    ],
    [
      "a failed checkout tries again",
      ending(AGENT_STATUS.FAILED, AGENT_FAILURE.SANDBOX),
      END_LINE_PRESS.TRY_AGAIN,
    ],
    ["a stop offers nothing", ending(AGENT_STATUS.CANCELED, undefined), undefined],
  ])("%s", (_, input, press) => {
    assert.equal(endLinePress(input), press);
  });
});
