// start-task.tsx -- New task, Home's composer as a sheet, which the tab bar's round + opens, a task's New sub-task opens as a sub-task of the task the route's `parent` names, and a draft the share sheet kept opens prefilled, its pictures attached (`share-sheet.ts`).

import { SHARE_DRAFT_PICTURE_FILES } from "@repo/features/ios-share-wire";
import { useLocalSearchParams } from "expo-router";
import { appGroupFileUri } from "../app-group.js";
import { NewTaskScreen } from "../screens/start-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

/**
 * The addresses of the draft's picture files that `param`, a JSON list of
 * their names, names and that stand. Note that a route's params may come
 * from any link, so only the share sheet's own file names are read, from
 * the group, and never an address a param spells.
 */
function draftPictures(param: string | undefined): readonly string[] | undefined {
  if (param === undefined) return undefined;
  let read: unknown;
  try {
    read = JSON.parse(param);
  } catch {
    return undefined;
  }
  if (!Array.isArray(read)) return undefined;
  return SHARE_DRAFT_PICTURE_FILES.filter((name) => read.includes(name)).flatMap(
    (name) => appGroupFileUri(name) ?? [],
  );
}

export default function StartTaskRoute() {
  const { parent, prompt, workspace, repository, pictures } = useLocalSearchParams<{
    parent?: string;
    prompt?: string;
    workspace?: string;
    repository?: string;
    pictures?: string;
  }>();
  return (
    <NewTaskScreen
      parent={parent === "" ? undefined : parent}
      draft={
        prompt === undefined
          ? undefined
          : { prompt, workspaceId: workspace, repository, pictures: draftPictures(pictures) }
      }
    />
  );
}
