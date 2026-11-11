// start-task.tsx -- New task, Home's composer as a sheet, which the tab bar's round + opens, a task's New sub-task opens as a sub-task of the task the route's `parent` names, and a draft the share sheet kept opens prefilled (`share-sheet.ts`).

import { useLocalSearchParams } from "expo-router";
import { NewTaskScreen } from "../screens/start-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function StartTaskRoute() {
  const { parent, prompt, workspace, repository } = useLocalSearchParams<{
    parent?: string;
    prompt?: string;
    workspace?: string;
    repository?: string;
  }>();
  return (
    <NewTaskScreen
      parent={parent === "" ? undefined : parent}
      draft={prompt === undefined ? undefined : { prompt, workspaceId: workspace, repository }}
    />
  );
}
