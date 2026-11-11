/**
 * native-harness-fake.ts -- a suite's scripted sessions standing in for the native harnesses its agents start on.
 *
 * No agent starts on the retired runtime, and one left on it takes no message
 * (`agent-runtime-choice.ts`, `runtime-sessions.ts`), so a suite whose
 * agents start and take messages provides `NativeAgentSessions` over the
 * scripted sessions it writes its calls down with. Each harness acts for
 * the agent's starter, whose account the script is handed, and a script
 * that writes down whom it acts for names it `harnessFor(account)`; none
 * has a runner up to take a change of model or a halt, nor an answer to an
 * ask unless the script writes one down. A script whose ids
 * name a harness (`NATIVE_SESSION_PREFIX`) takes a Stop and a retire too,
 * acting for the caller, as a harness does.
 */

import { randomUUID } from "node:crypto";
import { Effect, Layer, Option } from "effect";
import { NATIVE_SESSION_PREFIX } from "../agents/coder-host/native-runtime.js";
import {
  NativeAgentSessions,
  type NativeAgentSessionsService,
  type NativeSessions,
  RUNNER_ANSWER,
  RUNNER_CHECKOUT,
  RUNNER_CHOICE,
  type RunnerCheckout,
  TURN_HANDOVER,
} from "../agents/coder-host/runtime-sessions.js";
import {
  type AgentSessions,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
} from "../agents/sessions/agent-sessions.js";

/** A script's sessions, and where it scripts one, how a member's answer to an ask reaches the runner; not live unless scripted. */
export type ScriptedSessions = AgentSessions & Partial<Pick<NativeSessions, "answer">>;

/** Who the script writes down a harness's call as made for: the agent's starter. */
export function harnessFor(account: string): string {
  return `harness for ${account}`;
}

/** The native harnesses, every one answered by the script acting for the account each is asked for, as above, an added repository's checkout answered as `checkout` says, not live unless named. */
export function scriptedHarness(
  script: (account: string) => ScriptedSessions,
  checkout: RunnerCheckout = RUNNER_CHECKOUT.NOT_LIVE,
): NativeAgentSessionsService {
  return {
    sessions: (_runtime, account) =>
      Option.some(
        Effect.succeed({
          answer: () => Effect.succeed(RUNNER_ANSWER.NOT_LIVE),
          ...script(account),
          retry: (sessionId, message) => script(account).send(sessionId, message),
          retune: () => Effect.succeed(RUNNER_CHOICE.NOT_LIVE),
          checkOut: () => Effect.succeed(checkout),
          halt: () => Effect.succeed(true),
          deliverTurn: () => Effect.succeed(TURN_HANDOVER.HANDED),
          warm: () => Effect.void,
        }),
      ),
  };
}

/** `scriptedHarness` as the layer a suite provides. */
export function scriptedHarnessLayer(
  script: (account: string) => ScriptedSessions,
): Layer.Layer<NativeAgentSessions> {
  return Layer.succeed(NativeAgentSessions, scriptedHarness(script));
}

/** One launch or message a harness took, and the account it acted for. */
interface HeardCall {
  readonly call: "open" | "send";
  readonly account: string;
}

/** The native harnesses taking every launch and message, each written down with the account it acted for. */
export function recordingHarness() {
  const heard: HeardCall[] = [];
  const layer = scriptedHarnessLayer((account) => ({
    open: () =>
      Effect.sync(() => {
        heard.push({ call: "open", account });
        return {
          outcome: SESSION_SEND_OUTCOME.ACCEPTED,
          sessionId: `${NATIVE_SESSION_PREFIX.claude_code}${randomUUID()}`,
        } as const;
      }),
    send: (sessionId) =>
      Effect.sync(() => {
        heard.push({ call: "send", account });
        return {
          outcome: SESSION_SEND_OUTCOME.ACCEPTED,
          sessionId,
          deliveryId: randomUUID(),
        } as const;
      }),
    cancel: () => Effect.succeed({ outcome: SESSION_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: SESSION_RESET_OUTCOME.RESET }),
  }));
  return { heard, layer };
}
