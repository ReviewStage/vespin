// index.tsx -- New task, Home's composer as a sheet, or Create with an agent where the route's `purpose` names an automation, which a bar's compose opens, a task's New sub-task opens as a sub-task of the task the route's `parent` names, a section's + opens to file the task in the section `section` names, a repository header's + opens in the repository `repository` names, and a draft the share sheet kept opens prefilled, its pictures attached (`share-sheet.ts`).

import { useLocalSearchParams } from "expo-router";
import { START_PURPOSE } from "../../../automations/automation-routes.js";
import { NewTaskScreen } from "../../../screens/start-screens.js";
import { draftPictures } from "../../../share/draft-pictures.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function StartTaskRoute() {
  const { parent, section, prompt, workspace, repository, pictures, purpose } =
    useLocalSearchParams<{
      purpose?: string;
      parent?: string;
      section?: string;
      prompt?: string;
      workspace?: string;
      repository?: string;
      pictures?: string;
    }>();

  return (
    <NewTaskScreen
      parent={parent === "" ? undefined : parent}
      section={section === "" ? undefined : section}
      repository={prompt === undefined && repository !== "" ? repository : undefined}
      forAutomation={purpose === START_PURPOSE.AUTOMATION}
      draft={
        prompt === undefined
          ? undefined
          : { prompt, workspaceId: workspace, repository, pictures: draftPictures(pictures) }
      }
    />
  );
}
