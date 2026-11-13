// task-relation.tsx -- the Task relation sheet over the task the route's `task` names, opened on the kind its `kind` names, or on the four kinds where it names none.

import { useLocalSearchParams } from "expo-router";
import { isRelationKind, TaskRelationScreen } from "../../screens/relation-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function TaskRelationRoute() {
  const { task = "", kind } = useLocalSearchParams<{ task: string; kind?: string }>();

  return <TaskRelationScreen taskId={task} kind={isRelationKind(kind) ? kind : undefined} />;
}
