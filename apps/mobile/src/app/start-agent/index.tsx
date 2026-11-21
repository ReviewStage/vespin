// index.tsx -- New agent on the task the route's `task` names, as a sheet over its page, filled in from a suggestion where `suggestedBy` and `button` name one, a fork of the agent `forkOf` names at its message `at`, whose opening words `opening` quotes, or a continue of the agent `continueOf` names on its whole transcript.

import { type AgentFork, continueFork } from "@repo/features/agent-fork-model";
import { REPLY_BUTTON_ACTION } from "@repo/features/reply-button-wire";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useShownAgent } from "../../agents/use-agent.js";
import { type OpenedSuggestion, useOpenedSuggestion } from "../../agents/use-suggestions.js";
import { NewAgentScreen } from "../../screens/start-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function StartAgentRoute() {
  const {
    task = "",
    suggestedBy,
    button,
    forkOf,
    at,
    opening = "",
    continueOf,
  } = useLocalSearchParams<{
    task: string;
    suggestedBy?: string;
    button?: string;
    forkOf?: string;
    at?: string;
    opening?: string;
    continueOf?: string;
  }>();

  const read = useOpenedSuggestion({ suggestedBy, button });
  // Note that New agent opens only on a new agent's suggestion, so a link naming a message's suggestion never sends it under Start.
  const opened = read?.view.action.kind === REPLY_BUTTON_ACTION.START ? read : undefined;
  // Note that a suggestion's agent starts on the task of the agent that suggested it, as the service starts it.
  const suggester = useShownAgent(suggestedBy ?? "");
  // The suggestion as first read, held while the sheet stands, so a send that lands or a refetch never draws it anew.
  const [held, setHeld] = useState<OpenedSuggestion | undefined>(undefined);
  // Note that a fork starts on its source's model, so its page is drawn once the source is read, its choice seeded from it.
  const source = useShownAgent(forkOf ?? continueOf ?? "");

  const fork: AgentFork | undefined =
    forkOf !== undefined && at !== undefined
      ? { agentId: forkOf, messageId: at, opening }
      : continueOf === undefined
        ? undefined
        : continueFork(continueOf);

  if (held === undefined && opened !== undefined) setHeld(opened);

  const shown = held ?? opened;

  // Note that the sheet is drawn anew once, as the suggestion or the fork's source is first read, so its words and model start from it.
  return (
    <NewAgentScreen
      key={
        fork !== undefined
          ? source === undefined
            ? "fork"
            : "fork-read"
          : shown === undefined
            ? "draft"
            : "suggested"
      }
      taskId={suggester?.taskId ?? task}
      opened={fork === undefined ? shown : undefined}
      fork={fork}
    />
  );
}
