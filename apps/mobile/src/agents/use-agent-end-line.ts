/**
 * use-agent-end-line.ts -- the line an agent's page ends its transcript on once its turn was stopped or failed, and the press on it, as the panel's end line offers them (`AgentEndRow`): Continue in new agent, the API keys where the reader's own key was refused, or Try again.
 *
 * The words and the press are the panel's (`@repo/features/agent-end-line`);
 * what each press does is the page's: Continue opens the new agent's draft,
 * the key's press opens Settings › Agents, and Try again sends the agent the
 * reader's line, as the panel's does, busy until the service took it. The
 * panel's continue in the cloud and on another model are not offered here,
 * so those lines end on their words.
 */

import {
  CONTINUE_AGAIN_LABEL,
  CONTINUE_LABEL,
  continuedByIds,
  endLineReason,
  settledFailure,
} from "@repo/features/agent-continue-model";
import {
  END_LINE_PRESS,
  type EndLinePress,
  endLineParts,
  endLinePress,
  RETRY_LINE,
  TRY_AGAIN_LABEL,
} from "@repo/features/agent-end-line";
import { messageFailureWords } from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import type { AgentStatus } from "@repo/features/agent-wire";
import { FAILURE_REASON, remedyLabel } from "@repo/features/failure-remedy";
import { providerOf } from "@repo/features/model-label";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { ACT_KIND } from "@repo/host/acts";
import type { FollowedAgent } from "@repo/host/app-state-reads";
import { BUZZ, type EndPress, type TranscriptEnd } from "@repo/ui-native";
import { randomUUID } from "expo-crypto";
import { useMemo, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** The end line the page draws, and the label its ⋯ menu's Continue takes where the line offers Continue. */
export interface AgentEndLine {
  readonly end: TranscriptEnd | undefined;
  /** Continue in new agent, or Continue again; none where the line offers no Continue. */
  readonly continueLabel: string | undefined;
  readonly onPress: (press: EndPress) => void;
}

/** The end line's parts and its press, as the agent's last turn ended; none while it writes, or before it is read. */
function endLineOf(input: {
  readonly agent: FollowedAgent | undefined;
  readonly status: AgentStatus | undefined;
  readonly readerId: string | undefined;
  readonly hostLost: { readonly host: string } | undefined;
  readonly loaded: boolean;
  readonly offersContinue: boolean;
  readonly offersPress: boolean;
}):
  | {
      readonly words: string;
      readonly failed: boolean;
      readonly press: EndLinePress | undefined;
      readonly continued: boolean;
    }
  | undefined {
  const { agent, status, readerId } = input;

  // Note that the line waits for the transcript's first page, as the panel's does, so it never stands over a read still out, and stands alone where the page holds no message.
  if (!input.loaded || agent === undefined || status === undefined || agentStillWriting(status))
    return undefined;
  const failure = settledFailure({ status, turn: agent.turn });
  const { startedBy } = agent;

  // Note that a teammate's refused key is theirs to mend, so the line names the starter where the reader did not start the agent.
  const starter =
    startedBy === undefined || readerId === undefined || startedBy.userId === readerId
      ? undefined
      : startedBy.name;

  const continued = continuedByIds(agent, undefined, undefined).length > 0;

  const picked = input.offersPress
    ? endLinePress({
        status,
        endReason: endLineReason(failure, starter),
        failure,
        continued,
        boxClosed: false,
      })
    : undefined;

  // Note that Continue opens a new agent on the agent's task, so an agent on none is offered none.
  const press = picked === END_LINE_PRESS.CONTINUE && !input.offersContinue ? undefined : picked;
  const continuable = press === END_LINE_PRESS.CONTINUE;
  const parts = endLineParts(status, failure, starter, continuable, input.hostLost);

  return parts === undefined ? undefined : { ...parts, press, continued };
}

/**
 * The end line of an agent's page: what it says once the agent's turn was
 * stopped or failed, and its press, labeled as the panel's, with what each
 * does. An archived agent takes no message, so its line offers no press,
 * its bar's Unarchive standing in the composer's place.
 */
export function useAgentEndLine({
  agentId,
  agent,
  status,
  readerId,
  hostLost,
  taskId,
  archived,
  loaded,
  onContinue,
  onOpenKeys,
}: {
  readonly agentId: string;
  readonly agent: FollowedAgent | undefined;
  readonly status: AgentStatus | undefined;
  readonly readerId: string | undefined;
  /** The machine that dropped the agent's turn, as its transcript says; none where none did. */
  readonly hostLost: { readonly host: string } | undefined;
  readonly taskId: string | undefined;
  readonly archived: boolean;
  /** Whether the transcript's first page was read, which the line waits for. */
  readonly loaded: boolean;
  readonly onContinue: () => void;
  readonly onOpenKeys: () => void;
}): AgentEndLine {
  const acts = useHostActs();
  const write = useWrite();

  // The turn a Try again was sent past, which holds the press busy until a turn of its own replaces it.
  const [retried, setRetried] = useState<{ readonly turnId: string | undefined } | undefined>(
    undefined,
  );

  const line = endLineOf({
    agent,
    status,
    readerId,
    hostLost,
    offersContinue: taskId !== undefined,
    loaded,
    offersPress: !archived,
  });

  const turnId = agent?.turn?.id;
  const sent = retried !== undefined && retried.turnId === turnId;

  const label =
    line?.press === END_LINE_PRESS.CONTINUE
      ? line.continued
        ? CONTINUE_AGAIN_LABEL
        : CONTINUE_LABEL
      : line?.press === END_LINE_PRESS.KEY
        ? remedyLabel({
            reason: FAILURE_REASON.API_KEY,
            text: line.words,
            provider: agent === undefined ? undefined : providerOf(agent.model),
          })
        : TRY_AGAIN_LABEL;

  const words = line?.words;
  const failed = line?.failed ?? false;
  const kind = label === undefined ? undefined : line?.press;
  const busy = kind === END_LINE_PRESS.TRY_AGAIN && sent;

  // Note that the line is one object while its parts stand, so the list's rows are not handed anew on every draw of the page.
  const end = useMemo(
    (): TranscriptEnd | undefined =>
      words === undefined
        ? undefined
        : {
            words,
            failed,
            press: kind === undefined || label === undefined ? undefined : { kind, label, busy },
          },
    [words, failed, kind, label, busy],
  );

  // Note that Try again goes once, its press held busy from the press, so a second press before the service took it sends nothing; a refusal lets it go again.
  const tryAgain = () => {
    if (sent) return;
    setRetried({ turnId });
    void write(
      () =>
        acts[ACT_KIND.AGENTS_MESSAGE]({
          agentId,
          text: RETRY_LINE,
          clientKey: randomUUID(),
          retry: true,
          ...(taskId === undefined ? undefined : { taskId }),
        }),
      {
        went: BUZZ.SUCCESS,
        refused: (answer) =>
          "failure" in answer ? messageFailureWords(answer.failure) : undefined,
        unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      },
    ).then((went) => {
      if (!went) setRetried(undefined);
    });
  };

  const onPress = (press: EndPress) => {
    switch (press.kind) {
      case END_LINE_PRESS.CONTINUE:
        return onContinue();
      case END_LINE_PRESS.KEY:
        return onOpenKeys();
      case END_LINE_PRESS.TRY_AGAIN:
        return tryAgain();
    }
  };

  return {
    end,
    continueLabel: line?.press === END_LINE_PRESS.CONTINUE ? label : undefined,
    onPress,
  };
}
