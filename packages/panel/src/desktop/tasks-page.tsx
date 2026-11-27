import {
  filteredFields,
  showsSettledInFull,
  TASKS_PAGE_VIEW,
  type TasksDisplay,
  type TasksPageView,
} from "@repo/features/tasks-page-model";
import {
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Toolbar,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { KanbanIcon, ListFilterIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { NAMED_ORDER, useNamedTasks } from "../task-list-collections.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { PhoneHead, PlaceMore, phoneFindGroups, useMenuAsk } from "./phone-head.js";
import { TasksBoard } from "./tasks-board.js";
import { TasksList } from "./tasks-list.js";
import { INITIAL_DISPLAY, useTasksPageChoices } from "./tasks-page-choices.js";
import type { TasksPageHeld } from "./tasks-page-held.js";
import {
  FILTER,
  FILTERED,
  TasksFilterButton,
  TasksFilterChips,
  TasksViewOptions,
} from "./tasks-page-options.js";
import { useSettledPages } from "./use-settled-pages.js";
import { VIEW_OPTIONS } from "./view-options.js";

/**
 * tasks-page.tsx -- the window's Tasks page: the listed workspace's tasks as a List or as the Board, chosen by a switch beside its title, narrowed by its Filter and laid out by its View options.
 *
 * It stands in the plan's place, opened by the sidebar's Tasks row, and the
 * window's history treats it as the place the Board alone once was.
 *
 * Its toolbar ends in Filter and View options (`tasks-page-options.tsx`).
 * The filter is the page's, one for both views and one for each workspace,
 * since a creator and a repository are a workspace's own; each view keeps a
 * display of its own (`tasks-page-model.ts`). Which view it shows, the
 * filter, and both displays are kept on the account, so every device shows
 * the page alike (`tasks-page-choices.ts`); where it stood scrolled is the
 * router's to put back with the step it stood in (`panel-router.tsx`).
 *
 * The List is `tasks-list.tsx`, and the Board `tasks-board.tsx`.
 */

/** What the page is called, on its toolbar and to a screen reader. */
const TASKS = "Tasks";

/** The List | Columns switch beside the page's title. */
function ViewSwitch({
  view,
  onView,
}: {
  view: TasksPageView;
  onView: (view: TasksPageView) => void;
}): React.JSX.Element {
  return (
    <ChoiceBar<TasksPageView>
      label="Tasks view"
      items={[
        { value: TASKS_PAGE_VIEW.LIST, label: "List" },
        { value: TASKS_PAGE_VIEW.BOARD, label: "Columns" },
      ]}
      value={view}
      look={CHOICE_BAR_LOOK.SEGMENTED}
      size={CHOICE_BAR_SIZE.COMPACT}
      onChange={onView}
    />
  );
}

/** The Tasks page, in the plan's place: the List or the Board, as the reader last chose, under its Filter and View options. */
export function TasksPage({
  tasks,
  room,
  held,
  staged,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  /** Whether the run is a fixture's, whose choices keep nothing. */
  staged: boolean;
  /** What the page holds across its visits, where something outlives it to hold it (`tasks-page-held.ts`). */
  held?: TasksPageHeld | undefined;
}): React.JSX.Element {
  const pictures = useRepositoryPictures();
  const workspaceId = tasks.workspace?.id;
  const choices = useTasksPageChoices(workspaceId, staged);
  const { view, filter, onFilter } = choices;
  const display = choices.displays[view];
  const onDisplay = (next: TasksDisplay) => choices.onDisplay(view, next);
  const choose = choices.onView;

  // Note that settled tasks past those the list holds are read from the service a page at a time while the view shows them in full, once the list they stand beside is read.
  const settledPages = useSettledPages(
    workspaceId,
    tasks.shown && tasks.listRead && showsSettledInFull(filter, display),
  );

  const shared = (tasks.workspace?.memberCount ?? 1) > 1;
  const listed = useNamedTasks(tasks.typedNames, NAMED_ORDER.PINNED_FIRST, workspaceId);
  const filterAsk = useMenuAsk();
  const optionsAsk = useMenuAsk();
  // A phone heads the page as it heads every place (`phone-head.tsx`): its start corner empty where the places bar
  // holds New task (`mobile-bar.tsx`), the title centered, and a ⋯ holding
  // the view's switch and opening the Filter's and View options' own menus where it stands.
  const phone = room === SHELL_ROOM.NARROW;

  const viewItem = (value: TasksPageView, label: string, icon: React.JSX.Element) => ({
    label,
    icon,
    checked: view === value,
    onSelect: () => choose(value),
  });

  const filtered = filteredFields(filter).length > 0;

  const phoneHead = (
    <>
      <PhoneHead
        place="tasks"
        start={null}
        title={
          <Text
            as={TEXT_ELEMENT.H1}
            variant={TEXT_VARIANT.TOOLBAR_TITLE}
            className="ui-toolbar-title"
          >
            {TASKS}
          </Text>
        }
        end={
          <PlaceMore
            thing="Task list"
            replayUnmasked
            shown={tasks.shown}
            groups={(opener) => [
              [
                viewItem(TASKS_PAGE_VIEW.LIST, "List", <ListIcon />),
                viewItem(TASKS_PAGE_VIEW.BOARD, "Columns", <KanbanIcon />),
              ],
              [
                {
                  label: FILTER,
                  icon: <ListFilterIcon />,
                  detail: filtered ? FILTERED : undefined,
                  opens: true,
                  onSelect: () => filterAsk.onAsk(opener),
                },
                {
                  label: VIEW_OPTIONS,
                  icon: <SlidersHorizontalIcon />,
                  opens: true,
                  onSelect: () => optionsAsk.onAsk(opener),
                },
              ],
              ...phoneFindGroups(),
            ]}
          />
        }
      />
      <TasksFilterButton
        shown={tasks.shown}
        tasks={listed}
        filter={filter}
        onFilter={onFilter}
        shared={shared}
        pictures={pictures}
        asked={{ ask: filterAsk.ask }}
      />
      <TasksViewOptions
        shown={tasks.shown}
        board={view === TASKS_PAGE_VIEW.BOARD}
        display={display}
        initial={INITIAL_DISPLAY[view]}
        onDisplay={onDisplay}
        shared={shared}
        asked={{ ask: optionsAsk.ask }}
      />
    </>
  );

  const toolbar = phone ? (
    phoneHead
  ) : (
    <Toolbar
      title={TASKS}
      titleReplayUnmasked
      tag={<ViewSwitch view={view} onView={choose} />}
      actions={
        <>
          <TasksFilterButton
            shown={tasks.shown}
            tasks={listed}
            filter={filter}
            onFilter={onFilter}
            shared={shared}
            pictures={pictures}
          />
          <TasksViewOptions
            shown={tasks.shown}
            board={view === TASKS_PAGE_VIEW.BOARD}
            display={display}
            initial={INITIAL_DISPLAY[view]}
            onDisplay={onDisplay}
            shared={shared}
          />
        </>
      }
    />
  );

  // Note that the line stands while nothing is filtered, hidden, so the chips beside its first and its last glide as they come and go.
  const chips = <TasksFilterChips tasks={listed} filter={filter} onFilter={onFilter} />;

  const frame = {
    toolbar,
    chips,
    filter,
    display,
    onDisplay,
    settledPages,
    staged,
    chosen: held?.chosenIn(view),
    measured: held?.measuredIn(view),
    column: held?.column,
  };

  // Note that find's subject is the view shown, so a search in one view is let go as the other is chosen.
  return (
    <PageFind page={FIND_PAGE.BOARD} at={view} active={tasks.shown} held={held?.find}>
      {/* A face names its assignee or its creator, and the Filter offers them, against the listed workspace's members. */}
      <ReplayUnmask>
        <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
          {view === TASKS_PAGE_VIEW.BOARD ? (
            <TasksBoard tasks={tasks} room={room} title={TASKS} frame={frame} />
          ) : (
            <TasksList tasks={tasks} room={room} frame={frame} />
          )}
        </MemberDirectory>
      </ReplayUnmask>
    </PageFind>
  );
}
