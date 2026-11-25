import { ENTITY_KIND } from "@repo/features/entity-kind";
import { TASK_BOUNDS } from "@repo/features/task-wire";
import { backToWords } from "@repo/features/words";
import {
  BackButton,
  IconButton,
  InlineEdit,
  type InlineEditEnd,
  NO_BACK_KEY,
  OneLine,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TOOLBAR_CORNERS,
  type ToolbarPickUp,
  Tooltip,
} from "@repo/ui";
import { EntityGlyph } from "../entities/entity-glyph.js";
import type { AwayStep } from "../places/window-steps.js";
import { isOverviewTab, type MainTab } from "../tasks/use-main-tabs.js";
import type { MenuAction } from "./action-menu.js";
import { PhoneHead, type TaskHeadBack } from "./phone-head.js";

/**
 * task-pane-switcher.tsx -- how a phone heads a task: one row of the way
 * back, the title of what is on screen, and one ⋯, over a task whose
 * Overview is its one page and whose agents and tabs are screens pushed
 * over it.
 *
 * Nothing here is held apart from the column and the side panel: the
 * screens read what they already hold. Overview is the panel shut over the
 * column on its Overview, the task's description, which leads with the task's
 * agents (`overview-agents.tsx`); an agent is the panel shut over the column on
 * its tab, a draft's among them; and a tab of the panel, opened from a link
 * or an agent's ⋯, is the panel open over either, full screen. So the tabs
 * a phone opens are the same tabs, kept the same way (`use-main-tabs.ts`,
 * `use-side-panel.ts`), and Back walks them as it did. The panel lists
 * none of its tabs here: each is reached from what opens it.
 *
 * The row is a phone's standard header and holds nothing else: the way
 * back, its glyph alone, is the window's Back, one step back, on Overview
 * to the page the task was opened from, and back a screen anywhere else,
 * Overview standing in the screen's step where it is no step behind,
 * named for where it
 * goes ("Back to Overview"); the title, one line centered between the two
 * equal corners and fading where it is cut, names what is on screen, or
 * on Overview the task's path in muted words (its repository and key, as
 * the iOS app's bar names a task) until the description's own heading
 * scrolls away and the row picks its name up; and the ⋯
 * holds the menu of what is on screen: the task's own on Overview
 * (`task-actions.tsx`), the agent's on its screen (`agent-actions.tsx`),
 * and the tab's on one of the panel's. On Overview, New agent stands
 * before the ⋯, its glyph alone, as the page's Agents "+" starts one.
 */

/** What stands on a phone's task: its Overview, an agent's screen pushed over it, or a tab of the panel pushed over either. */
export const TASK_PANE = {
  OVERVIEW: "overview",
  AGENT: "agent",
  PANEL: "panel",
} as const;

export type TaskPane = (typeof TASK_PANE)[keyof typeof TASK_PANE];

/** What the way out of a task is called where no page stands behind it, and it opens Home. */
export const HOME_BACK = "Home";

/** What the way out of a task is called where the page behind it has no name yet. */
const BACK = "Back";

/**
 * Which screen stands: a tab of the panel while it is open; else Overview
 * while the column shows it, and an agent's on any other of its tabs.
 */
export function taskPaneOf(input: {
  readonly open: boolean;
  readonly column: MainTab | undefined;
}): TaskPane {
  if (input.open) return TASK_PANE.PANEL;

  return isOverviewTab(input.column) ? TASK_PANE.OVERVIEW : TASK_PANE.AGENT;
}

/** The way back a screen to `label`, named for it as its hint names it ("Back to Overview"). */
export function screenBack(label: string, onPress: () => void): TaskHeadBack {
  return { label, name: backToWords(label), onPress };
}

/**
 * What a phone's way back out of a task is called: the step the window's
 * Back goes to, as its history names it, the Tasks page, the Inbox, or
 * another task; Home where none stands behind it.
 */
export function awayBack(behind: AwayStep | undefined): Pick<TaskHeadBack, "label"> {
  return { label: behind === undefined ? HOME_BACK : (behind.title?.label ?? BACK) };
}

/** The task's name being edited in the title's place, as the ⋯'s Rename asks. */
interface TaskHeadRename {
  readonly editing: boolean;
  readonly onEnd: (end: InlineEditEnd) => void;
}

/**
 * The row heading a task on a phone; see the module's head. It is a phone's
 * header (`phone-head.tsx`): the way back at its start, the ⋯ at its end,
 * and the title centered between them, in every phone header's title type,
 * on one line that fades where it is cut (`OneLine`), or the task's name as
 * a field while it is renamed.
 */
export function TaskHead({
  back,
  title,
  path,
  pickUp,
  rename,
  newAgent,
  actions,
}: {
  back: TaskHeadBack;
  /** What is on screen: the agent's or the tab's name; none on Overview, whose description names the task in its own heading, which the row then picks up once it scrolls away (`pickUp`). */
  title: string | undefined;
  /** The task's path in words ("ada/relay › AL-42"), muted in the title's place where there is no title and no heading picked up. */
  path?: string | undefined;
  /** The description's heading as the row picks it up where it draws no title. */
  pickUp?: ToolbarPickUp | undefined;
  /** The task's name as a field in the title's place while it is renamed, `title` then being the task's name. */
  rename?: TaskHeadRename | undefined;
  /** New agent, before the ⋯ (`newAgentStarts`); none off Overview or on a task that starts no agent. */
  newAgent?: MenuAction | undefined;
  /** The row's one ⋯ (`PlaceMore`). */
  actions: React.ReactNode;
}): React.JSX.Element {
  // Note that the row draws the picked-up heading as its own title, in a phone header's title type, rather than the bar's larger page title.
  const named = title ?? (pickUp?.shown === true ? pickUp.name : undefined);

  return (
    <PhoneHead
      place="task"
      start={
        // Note that it names no key, as no phone's header does.
        <BackButton
          label={back.label}
          place={back.label}
          name={back.name}
          command={NO_BACK_KEY}
          onBack={back.onPress}
        />
      }
      title={
        named === undefined ? (
          path === undefined ? undefined : (
            <TaskHeadPath path={path} />
          )
        ) : (
          <Text
            as={TEXT_ELEMENT.H1}
            variant={TEXT_VARIANT.TOOLBAR_TITLE}
            className="ui-toolbar-title"
          >
            {rename?.editing === true ? (
              <InlineEdit
                value={named}
                label="Task name"
                maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
                editing
                onEnd={(end) => rename.onEnd(end)}
              />
            ) : (
              <OneLine>{named}</OneLine>
            )}
          </Text>
        )
      }
      corners={newAgent === undefined ? undefined : TOOLBAR_CORNERS.FIT}
      end={
        newAgent === undefined ? (
          actions
        ) : (
          <>
            <TaskHeadNewAgent start={newAgent} />
            {actions}
          </>
        )
      }
    />
  );
}

/** The task's path as a phone's row names it on Overview: one muted line, cut where it meets the corners. */
function TaskHeadPath({ path }: { path: string }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.H1}
      variant={TEXT_VARIANT.TOOLBAR_TITLE}
      tone={TEXT_TONE.MUTED}
      className="ui-toolbar-title"
    >
      <OneLine>{path}</OneLine>
    </Text>
  );
}

/** New agent before a phone's ⋯: the agent's glyph alone, named still, unavailable with Start's reason while a Start is out. */
function TaskHeadNewAgent({ start }: { start: MenuAction }): React.JSX.Element {
  return (
    // Note that it names no key, as no phone's header does.
    <Tooltip label={start.detail ?? start.label}>
      <IconButton
        icon={<EntityGlyph kind={ENTITY_KIND.AGENT} />}
        label={start.label}
        disabled={start.disabled}
        focusableWhenDisabled
        onClick={start.onSelect}
      />
    </Tooltip>
  );
}
