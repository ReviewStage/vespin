// index.tsx -- New agent on the task the route's `task` names, as a sheet over its page, filled in from a suggestion where `suggestedBy` and `button` name one.

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
  } = useLocalSearchParams<{ task: string; suggestedBy?: string; button?: string }>();

  const read = useOpenedSuggestion({ suggestedBy, button });
  // Note that New agent opens only on a new agent's suggestion, so a link naming a message's suggestion never sends it under Start.
  const opened = read?.view.action.kind === REPLY_BUTTON_ACTION.START ? read : undefined;
  // Note that a suggestion's agent starts on the task of the agent that suggested it, as the service starts it.
  const suggester = useShownAgent(suggestedBy ?? "");
  // The suggestion as first read, held while the sheet stands, so a send that lands or a refetch never draws it anew.
  const [held, setHeld] = useState<OpenedSuggestion | undefined>(undefined);

  if (held === undefined && opened !== undefined) setHeld(opened);

  const shown = held ?? opened;

  // Note that the sheet is drawn anew once, as the suggestion is first read, so its words and model start from it.
  return (
    <NewAgentScreen
      key={shown === undefined ? "draft" : "suggested"}
      taskId={suggester?.planId ?? task}
      opened={shown}
    />
  );
}
