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
  RUNNER_CHOICE,
  TURN_HANDOVER,
} from "../agents/coder-host/runtime-sessions.js";
import {
  type AgentSessions,
  MACHINE_UP,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
  type SessionTurn,
} from "../agents/sessions/agent-sessions.js";

/** A script's sessions, and where it scripts one, how a member's answer to an ask reaches the runner, not live unless scripted, and how a first launch's machine boots, up at once unless scripted. */
export type ScriptedSessions = Omit<AgentSessions, "boot"> &
  Partial<Pick<NativeSessions, "answer" | "boot">>;

/** The sessions fakes booted whose first message is still to come, by their minted ids, which no two boots share. */
const BOOTED = new Set<string>();

/** A first launch's machine as a fake's sessions boot it: a session minted and the machine up at once. */
export const bootedAtOnce: AgentSessions["boot"] = () =>
  Effect.succeed({
    outcome: SESSION_SEND_OUTCOME.ACCEPTED,
    sessionId: `${NATIVE_SESSION_PREFIX.claude_code}${randomUUID()}`,
    up: Effect.succeed(MACHINE_UP.READY),
  } as const);

/**
 * A fake's sessions as a first launch reaches them: its boot mints a session
 * with its machine up at once, and the first message sent to that session,
 * the Start's own as its queue hands it on, is taken by the fake's `open`,
 * as it was before a first launch booted its machine first, so what the
 * fake writes down of an open still stands for the Start's.
 */
export function openedOnBoot<Turn extends SessionTurn>(
  sessions: Omit<AgentSessions<Turn>, "boot">,
): AgentSessions<Turn> {
  const booted = BOOTED;
  return {
    ...sessions,
    boot: () =>
      Effect.sync(() => {
        const sessionId = `${NATIVE_SESSION_PREFIX.claude_code}${randomUUID()}`;
        booted.add(sessionId);
        return {
          outcome: SESSION_SEND_OUTCOME.ACCEPTED,
          sessionId,
          up: Effect.succeed(MACHINE_UP.READY),
        } as const;
      }),
    send: (sessionId, message) =>
      booted.delete(sessionId)
        ? Effect.map(sessions.open(message), (opened) =>
            opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED
              ? { outcome: opened.outcome, sessionId, deliveryId: randomUUID() }
              : opened,
          )
        : sessions.send(sessionId, message),
  };
}

/** Who the script writes down a harness's call as made for: the agent's starter. */
export function harnessFor(account: string): string {
  return `harness for ${account}`;
}

/** The native harnesses, every one answered by the script acting for the account each is asked for, as above. */
export function scriptedHarness(
  script: (account: string) => ScriptedSessions,
): NativeAgentSessionsService {
  // Note that a script with no boot of its own takes a first launch's first message by its open (`openedOnBoot`),
  // whichever of the harness's sessions the boot and the queue's hand-off each reached.
  const booted = BOOTED;
  const bootedScript = (account: string): ScriptedSessions => {
    const scripted = script(account);
    if (scripted.boot !== undefined) return scripted;
    return {
      ...scripted,
      boot: () =>
        Effect.sync(() => {
          const sessionId = `${NATIVE_SESSION_PREFIX.claude_code}${randomUUID()}`;
          booted.add(sessionId);
          return {
            outcome: SESSION_SEND_OUTCOME.ACCEPTED,
            sessionId,
            up: Effect.succeed(MACHINE_UP.READY),
          } as const;
        }),
      send: (sessionId, message) =>
        booted.delete(sessionId)
          ? Effect.map(scripted.open(message), (opened) =>
              opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED
                ? { outcome: opened.outcome, sessionId, deliveryId: randomUUID() }
                : opened,
            )
          : scripted.send(sessionId, message),
    };
  };
  return {
    sessions: (_runtime, account) => {
      // Note that one script stands for the lookup, so its boot and its sends read the same state.
      const scripted = bootedScript(account);
      return Option.some(
        Effect.succeed({
          answer: () => Effect.succeed(RUNNER_ANSWER.NOT_LIVE),
          ...scripted,
          retry: (sessionId, message) => scripted.send(sessionId, message),
          retune: () => Effect.succeed(RUNNER_CHOICE.NOT_LIVE),
          halt: () => Effect.succeed(true),
          deliverTurn: () => Effect.succeed(TURN_HANDOVER.HANDED),
          warm: () => Effect.void,
          boot: scripted.boot ?? bootedAtOnce,
        }),
      );
    },
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
