// pick.tsx -- a kind's page in the Task relation sheet, pushed over the four kinds once one is picked, so the system's back returns to them.

import { useLocalSearchParams } from "expo-router";
import { isRelationKind, TaskRelationScreen } from "../../screens/relation-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function TaskRelationPickRoute() {
  const { task = "", kind } = useLocalSearchParams<{ task: string; kind?: string }>();

  return <TaskRelationScreen taskId={task} kind={isRelationKind(kind) ? kind : undefined} pushed />;
}
