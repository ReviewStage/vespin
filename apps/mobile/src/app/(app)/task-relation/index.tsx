// index.tsx -- the Task relation sheet over the task the route's `task` names, opened on the kind its `kind` names.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { isRelationKind, TaskRelationScreen } from "../../../screens/relation-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function TaskRelationRoute() {
  const router = useRouter();
  const { task = "", kind } = useLocalSearchParams<{ task: string; kind?: string }>();
  const named = isRelationKind(kind) ? kind : undefined;

  // Note that every menu names the kind the sheet opens on, so a route naming none is let go rather than drawn empty.
  useEffect(() => {
    if (named === undefined) router.back();
  }, [named, router]);

  return named === undefined ? null : <TaskRelationScreen taskId={task} kind={named} />;
}
