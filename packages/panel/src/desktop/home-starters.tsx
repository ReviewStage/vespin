import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { devicePlatformOf } from "@repo/features/device-platform";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { MARK_PROVIDER, ProviderMark, SuggestionCard, SuggestionCards } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { DRAFT_PLACE, useDraftWriter } from "../composer-drafts.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { repositoryListsQuery } from "../live-reads.js";
import { useTaskCountUpTo } from "../task-list-collections.js";
import { useRepositoryMend } from "../tasks/no-repositories-banner.js";
import { useNewTaskRunsOn } from "../tasks/runs-on.js";
import {
  draftWithStarter,
  type OfferedStarter,
  STARTER,
  STARTER_BOUNDS,
  STARTER_NEED,
  type Starter,
  startersFor,
} from "../tasks/starter-tasks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * home-starters.tsx -- the starters under Home's composer while the listed workspace holds few tasks: a card for each job, whose press writes the job into New task's box, or connects GitHub for one that needs it.
 *
 * The cards are `@repo/ui`'s suggestions (`SuggestionCards`), as the
 * Automations list suggests its presets, one for each starter the
 * workspace is offered (`startersFor`), in their declared order, judged by
 * the repository it reaches, read as the repository chip reads it, and a
 * Mac of the member's among the devices Runs on offers. A press writes the
 * starter's words into New task's draft in the workspace, after what the
 * member typed there (`draftWithStarter`), which the
 * composer above draws at once, and hands the words the caret
 * (`onFilled`), so the member reads what the agent will do and starts it
 * with Return; one run on a Mac picks that Mac in Runs on as well. One
 * needing a repository the workspace lacks says at its foot, as a Sentry
 * automation's card asks for Sentry, the press that adds one, Connect
 * GitHub or a member's Add with your token (`useRepositoryMend`), and its
 * press opens Settings there. Nothing stands until the task list is
 * read, nor once the workspace holds `STARTER_BOUNDS.UNTIL_TASKS` tasks, by which
 * time the box alone serves.
 */

/** What the region of starters is called. */
const STARTERS_TITLE = "Try one of these";

/** Each starter's glyph, as the app draws what it makes. */
const STARTER_GLYPH = {
  [STARTER.AGENT_HISTORY]: <GLYPH.CLEAN_UP />,
  [STARTER.RACE_FIXES]: <EntityGlyph kind={ENTITY_KIND.PULL_REQUEST} />,
  [STARTER.SMALL_FIX]: <GLYPH.DONE />,
  [STARTER.DAILY_BRIEFING]: <EntityGlyph kind={ENTITY_KIND.AUTOMATION} />,
  [STARTER.LIVE_APP]: <GLYPH.WEBSITE />,
  [STARTER.SITE_WALKTHROUGH]: <GLYPH.RECORDING />,
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
  // Note that only how many tasks the workspace holds is read, up to where the starters go, so no change to a task row draws them.
  const held = useTaskCountUpTo(tasks.workspace?.id, STARTER_BOUNDS.UNTIL_TASKS);
  const repositories = useQuery(repositoryListsQuery(workspaceId)).data?.repositories;
  const mend = useRepositoryMend(tasks.newTask.repositoriesIn(workspaceId));
  const offered = devices ?? [];
  const chooseDevice = useNewTaskRunsOn(offered).choose;
  const writer = useDraftWriter();
  const mac = offered.find((device) => devicePlatformOf(device) === DEVICE_PLATFORM.DARWIN);

  if (!tasks.signedIn || !tasks.listRead || workspaceId === undefined) return null;

  if (held >= STARTER_BOUNDS.UNTIL_TASKS) return null;

  const starters = startersFor({
    repository: (repositories?.length ?? 0) > 0,
    connectable: mend !== undefined,
    mac: mac !== undefined,
  });

  const press = ({ task, runnable }: OfferedStarter) => {
    if (!runnable) {
      mend?.open();

      return;
    }

    // Note that a job run on the Mac picks it in Runs on, since its words read files only that Mac holds.
    if (mac !== undefined && task.needs === STARTER_NEED.MAC) chooseDevice(mac.deviceId);
    writer.update({ kind: DRAFT_PLACE.NEW_TASK, workspaceId }, (was) => ({
      ...was,
      text: draftWithStarter(was.text, task),
    }));
    onFilled();
  };

  const needs =
    mend === undefined
      ? undefined
      : { mark: <ProviderMark provider={MARK_PROVIDER.GITHUB} />, words: mend.label };

  return (
    <ReplayUnmask>
      <div className="home-starters mb-page-section-gap">
        <SuggestionCards title={STARTERS_TITLE}>
          {starters.map((starter) => (
            <SuggestionCard
              key={starter.task.starter}
              glyph={STARTER_GLYPH[starter.task.starter]}
              name={starter.task.name}
              detail={starter.task.detail}
              needs={starter.runnable ? undefined : needs}
              onPress={() => press(starter)}
            />
          ))}
        </SuggestionCards>
      </div>
    </ReplayUnmask>
  );
}
