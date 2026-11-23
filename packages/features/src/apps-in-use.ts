/**
 * apps-in-use.ts -- the apps an agent is using on the developer's Mac this turn, each as the conversation names it, which the panel floats over its box as a stack of windows and the iOS app stands over its composer as capsules.
 *
 * Read from the turn's `computer` calls alone, the one used last first,
 * each with the icon and newest window a call on it kept
 * (`computerAppsOf`), whether the agent is still in it, and where its
 * cursor last stood. Nothing here draws.
 */

import { MESSAGE_ROLE } from "@repo/wire";
import { AGENT_PART, agentParts, type ComputerApp, computerAppsOf } from "./agent-parts.js";
import { AGENT_TOOL } from "./agent-tools.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { computerCallRefused, computerCursor } from "./tool-call-model.js";

/** Where the agent's cursor last stood this turn, by the app whose window it stood over, as a share of that window, whether it pressed there, and the call that put it there. */
interface CursorInUse {
  readonly app: string;
  readonly x: number;
  readonly y: number;
  readonly pressed: boolean;
  readonly callId: string;
}

/** The apps an agent used this turn, the one it used last first, each as the conversation names it (`computerAppsOf`), whether its newest call is still on that one while it works, and where its cursor last stood, where a call this turn said. */
export interface AppsInUse {
  readonly apps: readonly ComputerApp[];
  readonly using: boolean;
  readonly cursor?: CursorInUse;
}

/** A call's tool, its id, and its answer, as the stack reads them. */
interface ReadCall {
  readonly tool: string;
  readonly callId: string;
  readonly output: Parameters<typeof computerCallRefused>[0];
}

/**
 * Every call of the turn under way, the newest first: back to the
 * developer's line that opened it. Note that a line the turn took in under
 * way (`arrivedIn`), or one that follows its journal while it is still open,
 * steers that turn rather than opening one, as the transcript places it
 * (`placedMessages`), so the apps used before it stay the turn's; a line
 * after a closed journal opens the next turn, even before it is read back,
 * so the turn before it is never shown as the one under way.
 */
function* turnCallsNewestFirst(messages: readonly AgentTranscriptMessage[]): Generator<ReadCall> {
  const journal = messages.findLastIndex((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  const open = journal >= 0 && messages[journal]?.finishedAt === undefined;

  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at];

    if (message === undefined) return;

    if (message.role === MESSAGE_ROLE.USER) {
      const steers = message.arrivedIn !== undefined || (open && at > journal);

      if (steers) continue;

      return;
    }

    const parts = agentParts(message);

    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];

      if (part?.kind === AGENT_PART.TOOL) yield part;
    }
  }
}

/**
 * The apps the agent used this turn, each once, the one it used last
 * first, each with its icon and newest window as the conversation names the
 * app (`computerAppsOf`), so a call still running, which names its app only
 * as the agent typed it, counts as the app it turns out to be; none in use
 * once it is done; nothing where the turn used none. A call that names no
 * app, listing them, adds none, nor does one the Mac refused, such as for a
 * grant it lacks, so a refused app never floats a window it never read or
 * says it is in use.
 */
export function appsInUse(
  messages: readonly AgentTranscriptMessage[],
  working: boolean,
): AppsInUse | undefined {
  const named = computerAppsOf(messages);
  const calls = [...turnCallsNewestFirst(messages)];

  const appOf = (call: ReadCall): ComputerApp | undefined =>
    call.tool !== AGENT_TOOL.COMPUTER || computerCallRefused(call.output)
      ? undefined
      : named.byCall.get(call.callId);

  const apps = [...new Set(calls.map(appOf))].filter((app) => app !== undefined);
  const top = apps[0];
  const newest = calls[0];

  if (top === undefined || newest === undefined) return undefined;
  const using = working && appOf(newest) === top;

  // Note that the Mac's cursor is one, so it stands where the newest call that placed it left it, over that call's app alone.
  for (const call of calls) {
    const app = appOf(call);
    const point = app === undefined ? undefined : computerCursor(call.output);

    if (app === undefined || point === undefined) continue;

    return { apps, using, cursor: { app: app.id, ...point, callId: call.callId } };
  }

  return { apps, using };
}
