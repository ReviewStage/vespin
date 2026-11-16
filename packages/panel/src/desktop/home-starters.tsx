import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { devicePlatformOf } from "@repo/features/device-platform";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { SuggestionCard, SuggestionCards } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { DRAFT_PLACE, useDraftWriter } from "../composer-drafts.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { repositoryListsQuery } from "../live-reads.js";
import { NAMED_ORDER, useNamedTasks } from "../task-list-collections.js";
import { useNewTaskRunsOn } from "../tasks/runs-on.js";
import {
  STARTER,
  STARTER_BOUNDS,
  STARTER_NEED,
  type Starter,
  type StarterTask,
  startersFor,
} from "../tasks/starter-tasks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * home-starters.tsx -- the starters under Home's composer while the listed workspace holds few tasks: a card for each job it can run, whose press writes the job into New task's box.
 *
 * The cards are `@repo/ui`'s suggestions (`SuggestionCards`), as the
 * Automations list suggests its presets, one for each starter the
 * workspace has what it needs for (`startersFor`): a repository it reaches,
 * read as the repository chip reads it, and a Mac of the member's among the
 * devices Runs on offers. A press writes the starter's words into New
 * task's draft in the workspace, which the composer above draws at once,
 * and hands the words the caret (`onFilled`), so the member reads what the
 * agent will do and starts it with Return; one run on a Mac picks that Mac
 * in Runs on as well. Nothing stands until the task list is read, nor once
 * the workspace holds `STARTER_BOUNDS.UNTIL_TASKS` tasks, by which time the
 * box alone serves.
 */

/** What the region of starters is called. */
const STARTERS_TITLE = "Try one of these";

/** Each starter's glyph, as the app draws what it makes. */
const STARTER_GLYPH = {
  [STARTER.CODEX_HISTORY]: <GLYPH.HISTORY />,
  [STARTER.RACE_FIXES]: <EntityGlyph kind={ENTITY_KIND.PULL_REQUEST} />,
  [STARTER.DAILY_BRIEFING]: <EntityGlyph kind={ENTITY_KIND.AUTOMATION} />,
  [STARTER.LIVE_APP]: <GLYPH.LINK />,
  [STARTER.SITE_WALKTHROUGH]: <GLYPH.WEBSITE />,
} as const satisfies Record<Starter, React.JSX.Element>;

/** Home's starters while the listed workspace holds few tasks; nothing otherwise. */
export function HomeStarters({
  tasks,
  onFilled,
}: {
  tasks: TasksControl;
  /** Hands the composer's words the caret once a press wrote into them. */
  onFilled: () => void;
}): React.JSX.Element | null {
  const { workspaceId, devices } = tasks.newTask;
  const listed = useNamedTasks(tasks.typedNames, NAMED_ORDER.PINNED_FIRST, tasks.workspace?.id);
  const repositories = useQuery(repositoryListsQuery(workspaceId)).data?.repositories;
  const offered = devices ?? [];
  const [, chooseDevice] = useNewTaskRunsOn(offered);
  const writer = useDraftWriter();
  const mac = offered.find((device) => devicePlatformOf(device) === DEVICE_PLATFORM.DARWIN);

  if (!tasks.signedIn || !tasks.listRead || workspaceId === undefined) return null;

  if (listed.length >= STARTER_BOUNDS.UNTIL_TASKS) return null;

  const starters = startersFor({
    repository: (repositories?.length ?? 0) > 0,
    mac: mac !== undefined,
  });

  const fill = (task: StarterTask) => {
    // Note that a job run on the Mac picks it in Runs on, since its words read files only that Mac holds.
    if (mac !== undefined && task.needs === STARTER_NEED.MAC) chooseDevice(mac.deviceId);
    writer.update({ kind: DRAFT_PLACE.NEW_TASK, workspaceId }, (was) => ({
      ...was,
      text: task.prompt,
    }));
    onFilled();
  };

  return (
    <ReplayUnmask>
      <div className="home-starters mb-page-section-gap">
        <SuggestionCards title={STARTERS_TITLE}>
          {starters.map((task) => (
            <SuggestionCard
              key={task.starter}
              glyph={STARTER_GLYPH[task.starter]}
              name={task.name}
              detail={task.detail}
              onPress={() => fill(task)}
            />
          ))}
        </SuggestionCards>
      </div>
    </ReplayUnmask>
  );
}
