/**
 * agent-end-line.ts -- the line an agent's transcript ends on once its turn was stopped or failed, and the press its row may offer (Continue, the API keys, or Try again), as the panel's tab and the iPhone's agent page both read them.
 */

import {
  endLineContinues,
  endLineOffersContinue,
  failedLineWords,
} from "./agent-continue-model.js";
import { hostLostWords, launchStoppedWords, mendedByNewAgent } from "./agent-failure-words.js";
import {
  AGENT_FAILURE,
  AGENT_STATUS,
  type AgentFailure,
  type AgentStatus,
  type NativeAgentRuntime,
} from "./agent-wire.js";
import type { DeviceLaunchStep, DeviceLaunchUnstarted } from "./device-agent-wire.js";
import { FAILURE_REASON, type FailureReason } from "./failure-remedy.js";

/** The line Try again sends the agent, which reads in the transcript as the developer's own. */
export const RETRY_LINE = "Try again";

/** The parts of the line a transcript ends on: its words, and whether it tells of a failure, which is drawn as one. */
export interface EndLineParts {
  readonly words: string;
  readonly failed: boolean;
  /** Why a failed turn failed, as the service's word, which the failure it reports names; none for a stop, or a failure that said no reason. */
  readonly failure?: AgentFailure | undefined;
  /** Why a host's launch never started, where its host said, which may draw a card of its own in the line's place (`github-sign-in-card.tsx`). */
  readonly unstarted?: DeviceLaunchUnstarted | undefined;
}

/** Where a launch its host settled unstarted stopped, and why where its host said, as the page said, and the harness the agent runs, as its summary says. */
export interface LaunchStopped {
  readonly step: DeviceLaunchStep;
  readonly runtime?: NativeAgentRuntime | undefined;
  readonly unstarted?: DeviceLaunchUnstarted | undefined;
}

/**
 * The quiet line a transcript ends on once its turn failed or was stopped,
 * in parts, so its words and its failed mark can be drawn apart; nothing
 * for an agent still writing or one that completed. A teammate's agent
 * names its starter's key, since it runs on theirs and not the reader's.
 * An agent whose tab offers Continue, or that another already continued
 * (`continuable`), is not told to start a new one. One whose host stopped
 * beating while its turn ran (`hostLost`) names the host and that a message
 * carries it on once the host is back, in place of its failure's words. One
 * whose host settled its launch unstarted (`launchStopped`) names the step
 * the launch stopped at and that a message tries again.
 * Note that it names no price, because a price in the window means the
 * whole run's, which the model menu's last line says (`agent-payer.tsx`).
 */
export function endLineParts(
  status: AgentStatus,
  failure: AgentFailure | undefined,
  starter?: string,
  continuable = false,
  hostLost?: { readonly host: string },
  launchStopped?: LaunchStopped,
): EndLineParts | undefined {
  switch (status) {
    case AGENT_STATUS.CANCELED:
      return { words: "Stopped", failed: false };
    case AGENT_STATUS.FAILED: {
      if (hostLost !== undefined)
        return { words: hostLostWords(hostLost.host), failed: true, failure };

      if (launchStopped !== undefined) {
        const words = launchStoppedWords(
          launchStopped.step,
          launchStopped.runtime,
          launchStopped.unstarted,
        );

        const { unstarted } = launchStopped;

        return { words, failed: true, failure, ...(unstarted !== undefined && { unstarted }) };
      }

      return { words: failedLineWords(failure, starter, continuable), failed: true, failure };
    }

    case AGENT_STATUS.STARTING:
    case AGENT_STATUS.RUNNING:
    case AGENT_STATUS.COMPLETED:
      return undefined;
  }
}

/** What the press that sends a failed agent a line again says, on the failed end line where a message carries it on (`endLineOffersTryAgain`). */
export const TRY_AGAIN_LABEL = "Try again";

/** What Try again says while the service sends again. */
export const TRYING_AGAIN_LABEL = "Sending again";

/**
 * The failures a message sent again would only meet again, since what mends
 * them is a choice the line's words name: a teammate's key, which only they
 * replace, Fast, which a model chosen with it off mends, or the model's
 * refusal, which a continue on another model mends (`endLineOffersOtherModel`).
 */
const MENDED_BY_CHOICE: ReadonlySet<AgentFailure> = new Set([
  AGENT_FAILURE.PROVIDER_KEY,
  AGENT_FAILURE.FAST_ON_OWN_KEY,
  AGENT_FAILURE.FAST_NOT_ENABLED,
  AGENT_FAILURE.REFUSAL,
]);

/**
 * Whether the failed end line's row ends on Try again, which sends the
 * agent again the lines its failed turn never took, as a launch that failed
 * before its runner read the prompt leaves it, or, where none was lost, a
 * line of the developer's own (`RETRY_LINE`), as the GitHub sign-in card's
 * Retry does: where a message carries the agent on, its box stands open to
 * send it, and nothing else ends the row. So never where Continue does
 * (`endLineOffersContinue`), on a key the reader mends in Settings, or on a
 * failure a choice mends (`MENDED_BY_CHOICE`).
 */
export function endLineOffersTryAgain(input: {
  readonly status: AgentStatus;
  readonly endReason: FailureReason;
  readonly failure: AgentFailure | undefined;
  readonly continued: boolean;
  readonly boxClosed: boolean;
}): boolean {
  if (!endLineContinues(input.status, input.endReason)) return false;

  if (input.continued || input.boxClosed) return false;

  if (input.failure === undefined) return true;

  return !mendedByNewAgent(input.failure) && !MENDED_BY_CHOICE.has(input.failure);
}

/** The ways on a failed end line's row may end on, one at most. */
export const END_LINE_PRESS = {
  /** Continue in new agent, or Continue again once another agent continued it (`endLineOffersContinue`). */
  CONTINUE: "continue",
  /** The reader's own API key was refused, so the press opens where it is mended. */
  KEY: "key",
  /** Try again, which sends the agent a line of the reader's to carry it on (`endLineOffersTryAgain`). */
  TRY_AGAIN: "try-again",
} as const;

export type EndLinePress = (typeof END_LINE_PRESS)[keyof typeof END_LINE_PRESS];

/**
 * The press a failed end line's row ends on, as the panel's picks it
 * (`useAgentEndDoors`, `AgentEndRow`): Continue where a new agent is the way
 * on, the API keys where the reader's own key was refused, else Try again
 * where a message carries the agent on; none where none does. Note that the
 * panel's continue in the cloud and on another model are not offered here,
 * so their lines end on their words.
 */
export function endLinePress(ending: {
  readonly status: AgentStatus;
  readonly endReason: FailureReason;
  readonly failure: AgentFailure | undefined;
  readonly continued: boolean;
  readonly boxClosed: boolean;
}): EndLinePress | undefined {
  if (endLineOffersContinue(ending)) return END_LINE_PRESS.CONTINUE;

  if (ending.status === AGENT_STATUS.FAILED && ending.endReason === FAILURE_REASON.API_KEY)
    return END_LINE_PRESS.KEY;

  return endLineOffersTryAgain(ending) ? END_LINE_PRESS.TRY_AGAIN : undefined;
}
