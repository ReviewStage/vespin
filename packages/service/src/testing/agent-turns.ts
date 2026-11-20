/**
 * agent-turns.ts -- one coding agent turn written through the store writer from its start to its end, as a test of what hears its settle drives it.
 */

import { randomUUID } from "node:crypto";
import type { Agent } from "@repo/database/models/agent-store";
import { storeWriter } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AssistantMessageBuilder,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  type RunStatus,
  TOOL_CALL_SETTLEMENT,
  TURN_FAILURE,
  TURN_TRIGGER,
  type TurnFailure,
} from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { TURN_ORIGIN } from "@repo/wire";
import { Effect } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { ACTION_RESULT_STATUS, unparsedWire } from "../core.js";

/** One turn of the agent's, begun just before `at`, answered with the words given where some are, each of `sent` sent to people by an accepted `send_to_user`, closed by an `end_turn` taken with the summary given where one is, and ended in the run status given at `at`, a failed one for `failure`; its id. */
export const endedAt = (
  agent: Agent,
  status: RunStatus,
  at: number,
  said?: string,
  failure: TurnFailure = TURN_FAILURE.MODEL,
  summary?: string,
  sent: readonly string[] = [],
) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const target = { userId: agent.userId, conversationId: agent.conversationId };
    const turnId = randomUUID();
    const turn = { conversationId: sessionKey(agent.conversationId), turnId };
    yield* writer.enqueueTurn(target, {
      turnId,
      origin: TURN_ORIGIN.TYPED,
      runtimeTurnId: "turn_0",
    });
    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: at - 1,
    });

    if (said !== undefined) {
      const answer = new AssistantMessageBuilder();
      answer.stepStart();
      answer.text("Reading the description first.");
      answer.stepStart();
      answer.text(said);

      const calls = [
        ...sent.map((text) => ({ name: AGENT_TOOL.SEND_TO_USER, input: { text } })),
        ...(summary === undefined ? [] : [{ name: AGENT_TOOL.END_TURN, input: { summary } }]),
      ];

      for (const { name, input } of calls) {
        const callId = randomUUID();
        answer.toolCall(
          { callId, name, argumentsJson: JSON.stringify(input) },
          unparsedWire(input),
        );
        answer.toolResult(callId, {
          state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
          output: unparsedWire({ status: ACTION_RESULT_STATUS.ACCEPTED }),
        });
      }

      yield* writer.consume(target, {
        ...turn,
        kind: RUN_EVENT.MESSAGE_COMPLETED,
        sequence: 2,
        message: answer.finish(randomUUID()),
      });
    }

    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_ENDED,
      sequence: 3,
      status,
      ...(status === RUN_STATUS.FAILED ? { failure } : undefined),
      responseIds: [],
      at,
    });

    return turnId;
  });
