// index.tsx -- New agent on the task the route's `task` names, as a sheet over its page, filled in from a suggestion where `suggestedBy` and `button` name one.

import { useLocalSearchParams } from "expo-router";
import { useOpenedSuggestion } from "../../agents/use-suggestions.js";
import { NewAgentScreen } from "../../screens/start-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function StartAgentRoute() {
  const {
    task = "",
    suggestedBy,
    button,
  } = useLocalSearchParams<{ task: string; suggestedBy?: string; button?: string }>();

  const opened = useOpenedSuggestion({ suggestedBy, button });

  // Note that the sheet is drawn anew once the suggestion is read, so its words and model start from it.
  return (
    <NewAgentScreen
      key={opened === undefined ? "draft" : "suggested"}
      taskId={task}
      opened={opened}
    />
  );
}
