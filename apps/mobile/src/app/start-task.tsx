// start-task.tsx -- New task, Home's composer as a sheet, which the tab bar's round + opens, and which a draft the share sheet kept opens prefilled (`share-sheet.ts`).

import { useLocalSearchParams } from "expo-router";
import { NewTaskScreen } from "../screens/start-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function StartTaskRoute() {
  const { prompt, workspace, repository } = useLocalSearchParams<{
    prompt?: string;
    workspace?: string;
    repository?: string;
  }>();
  return (
    <NewTaskScreen
      draft={prompt === undefined ? undefined : { prompt, workspaceId: workspace, repository }}
    />
  );
}
