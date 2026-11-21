// list-row.tsx -- the rows the Inbox and Tasks draw: plain and edge to edge, a leading mark, a title in the body style over a muted subheadline line, and a hairline inset to the words.

import {
  Button,
  ContextMenu,
  DisclosureGroup,
  Divider,
  HStack,
  Image,
  Menu,
  Section,
  Spacer,
  SwipeActions,
  Text,
  Toggle,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  accessibilityValue,
  alignmentGuide,
  background,
  buttonStyle,
  disabled,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  hidden,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listRowSeparatorTint,
  type ModifierConfig,
  menuIndicator,
  menuStyle,
  monospacedDigit,
  onGeometryChange,
  padding,
  tag,
  tint,
  zIndex,
} from "@expo/ui/swift-ui/modifiers";
import { GLYPH_STATE, GLYPH_STATE_WORDS } from "@repo/features/glyph-state";
import { type InboxLineKind, NEEDS_YOU } from "@repo/features/inbox-list-model";
import { REMIND_WORDS } from "@repo/features/inbox-remind-times";
import type { IntegrationProvider } from "@repo/features/integration-wire";
import { pullRequestMarkLabel, pullRequestMarkState } from "@repo/features/pull-request-model";
import { TASK_AGENTS_STATUS, type TaskAgentsStatus } from "@repo/features/task-agents-model";
import { TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskStatus } from "@repo/features/task-wire";
import { dueText, sinceHeard, sinceText } from "@repo/features/time-format";
import { VERB } from "@repo/features/words";
import { Predicate } from "effect";
import {
  createContext,
  Fragment,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from "react";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { RowAsking, type RowQuestion } from "./asks.js";
import { GLYPH, type Glyph, glyphImage, type MarkLayer } from "./glyph.js";
import { actContent, markContent, menuActContent, menuLabel } from "./glyph-label.js";
import { INBOX_LINE_LOOK, PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { cellFocusRingOff, dragLink } from "./interactions.js";
import {
  Avatar,
  type Face,
  FailedMark,
  NeedsYouDot,
  SubTaskProgress,
  subTasksHeard,
  TaskStatusMark,
  ToneGlyph,
  UnreadDot,
  WorkingMark,
} from "./marks.js";
import { useMinute } from "./minute.js";
import {
  RowChoosingContext,
  RowOpenContext,
  RowSearchedContext,
  RowSelectedContext,
} from "./row-open.js";
import { searchedTitleMarkdown } from "./searched-title-model.js";
import { sparedMarksDropped } from "./task-row-fit-model.js";
import {
  type BrandColors,
  STATUS_TONE,
  type StatusTone,
  toneColor,
  useColors,
} from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, ROW_INSET, SPACE } from "./tokens/space.js";
import { SYSTEM_COLOR, type SystemColor, useSystemColors } from "./tokens/swipe-colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How many lines a row's title and its line take: one each at the standard sizes, and more at an accessibility size, so they still read. */
const ROW_LINES = {
  STANDARD: { title: 1, line: 1 },
  ACCESSIBILITY: { title: 3, line: 2 },
} as const;

/** The lines a row's words take at the reader's text size. */
function useRowLines(): (typeof ROW_LINES)[keyof typeof ROW_LINES] {
  return useAccessibilitySize() ? ROW_LINES.ACCESSIBILITY : ROW_LINES.STANDARD;
}

/** How a row's title is drawn: plain, or as Markdown with a search's words in bold, each by a native text of its own. */
const TITLE_LOOK = {
  PLAIN: "plain",
  MARKED: "marked",
} as const;

/** What parts the pieces of what a row is heard as, as VoiceOver pauses between a label's phrases. */
const HEARD_PART = ", ";

/**
 * What VoiceOver hears of a row, read as one element: its label, the words
 * a person picks it by (its title, so Voice Control and a flow find it by
 * the words on screen), and its value, where it stands in words: unread,
 * what waits on you, its status, its time, each mark said rather than drawn.
 */
type RowHeard = {
  readonly label: string;
  readonly value: readonly (string | undefined | false)[];
};

/** A row's heard value, the pieces that say something joined. */
function heardValue(value: RowHeard["value"]): string {
  return value
    .filter((part): part is string => Predicate.isString(part) && part !== "")
    .join(HEARD_PART);
}

/** The words VoiceOver hears for a row's marks, each said where the mark is drawn. */
const UNREAD_WORDS = "Unread";
const PULL_REQUEST_HEARD = "Pull request";
const SUB_TASKS_SHOWN = "Sub-tasks shown";
const SUB_TASKS_HIDDEN = "Sub-tasks hidden";

/**
 * What a row's act means, which sets the color its swipe stands on: one
 * that marks a row read or unread, sets a reminder, finishes something
 * (Resolve, Mark done), pins, archives, or deletes, and the rest. In a long
 * press menu only a destructive act, a delete, reads apart, in the system's
 * red; the rest stand in the menu's ink. Copper is kept for what wants the
 * reader, so no act is drawn in it.
 */
export const ROW_ACTION_TONE = {
  NEUTRAL: "neutral",
  DESTRUCTIVE: "destructive",
  READ: "read",
  REMIND: "remind",
  DONE: "done",
  PIN: "pin",
  ARCHIVE: "archive",
} as const;

export type RowActionTone = (typeof ROW_ACTION_TONE)[keyof typeof ROW_ACTION_TONE];

/**
 * The system color each act's swipe stands on, its glyph in white, as Mail
 * colors its swipes on iOS 26: Read and Unread blue, Remind Me and Archive
 * purple, Flag orange (a pin here), Trash red, and More gray, so red is kept
 * for a delete. Remind me and Archive never share a list. Mail has no act that
 * finishes a thread, so Resolve and Mark done take green, as Reminders
 * marks one complete. This one table sets every list's swipe colors.
 */
const SWIPE_FILL = {
  [ROW_ACTION_TONE.NEUTRAL]: SYSTEM_COLOR.GRAY,
  [ROW_ACTION_TONE.DESTRUCTIVE]: SYSTEM_COLOR.RED,
  [ROW_ACTION_TONE.READ]: SYSTEM_COLOR.BLUE,
  [ROW_ACTION_TONE.REMIND]: SYSTEM_COLOR.PURPLE,
  [ROW_ACTION_TONE.DONE]: SYSTEM_COLOR.GREEN,
  [ROW_ACTION_TONE.PIN]: SYSTEM_COLOR.ORANGE,
  [ROW_ACTION_TONE.ARCHIVE]: SYSTEM_COLOR.PURPLE,
} as const satisfies Record<RowActionTone, SystemColor>;

export type RowAction = {
  /** The act's name, as the panel's menu names it: Mark done, Mark unread. */
  readonly label: string;
  /** Its glyph; none for an act that stands as words alone, such as a reminder's time. */
  readonly symbol?: Glyph | undefined;
  /** What a menu says under its words, such as when a reminder's time comes due. */
  readonly detail?: string | undefined;
  readonly tone: RowActionTone;
  readonly onPress: () => void;
  /** Whether it stands dimmed and takes no press, its `detail` saying why, as the panel's Unfollow stands for the assignee. */
  readonly disabled?: boolean | undefined;
};

/** A choice of a menu, checked where it stands, beside its glyph where it has one, such as a status's mark, in its tone where it has one. */
export type MenuChoice = {
  readonly label: string;
  /** What tells the choice apart where two may share a label, such as two tasks of one name; the label where none is given. */
  readonly id?: string | undefined;
  readonly symbol?: Glyph | undefined;
  /** The tone the glyph is drawn in, as a status's mark is in the panel's menu; the menu's own ink where none is given. */
  readonly tone?: StatusTone | undefined;
  /** A glyph drawn faint under its own in the same tone, as a priority's lit bars stand over every bar it can light (`MarkLayers`); none where its glyph stands alone. */
  readonly under?: MarkLayer | undefined;
  /** A person's photo, as a file on this device, drawn round in the glyph's place, as the panel's assignee menu leads each member with their face. */
  readonly photo?: string | undefined;
  /** The integration whose mark leads it in the glyph's place, as the panel's MCP server rows lead with their provider's mark. */
  readonly mark?: IntegrationProvider | undefined;
  /** What the menu says under its words, such as a member's email, or You for the reader, as the panel's people menus say it. */
  readonly detail?: string | undefined;
  readonly on: boolean;
  readonly onPress: () => void;
};

/** A menu within a row's long press menu, such as a task's Status: its choices, each checked where it stands, as the system checks them, and the acts under them, such as a task's Remove from section. */
export type RowSubmenu = {
  readonly label: string;
  readonly symbol: Glyph;
  readonly choices: readonly MenuChoice[];
  /** Menus one level further down, after its choices, such as a task's repository inside More. */
  readonly submenus?: readonly RowSubmenu[] | undefined;
  readonly actions?: readonly RowAction[] | undefined;
  /** What it means as a swipe, which sets the color it stands on, such as Remind me's purple; a plain act's gray where none is given. */
  readonly tone?: RowActionTone | undefined;
};

/** What a swipe reveals: an act, or a menu of choices, such as a task's Status, which opens where the act would run. */
export type RowSwipe = RowAction | RowSubmenu;

/** A group of a row's long press menu, set apart from the groups around it by a divider, as Mail's and Reminders' row menus group their acts: its menus, then its acts. */
export type RowMenuGroup = {
  readonly submenus?: readonly RowSubmenu[] | undefined;
  readonly actions?: readonly RowAction[] | undefined;
};

/** Whether a group holds anything to draw. */
function menuGroupFilled(group: RowMenuGroup): boolean {
  return (group.submenus?.length ?? 0) + (group.actions?.length ?? 0) > 0;
}

/** Whether a swipe's piece is a menu of choices rather than one act. */
function isSubmenu(swipe: RowSwipe): swipe is RowSubmenu {
  return "choices" in swipe;
}

/** The acts a row carries: a swipe from either edge, the same acts in its long press menu, what that menu holds alone, and the preview it lifts. */
type RowActs = {
  /** What VoiceOver hears of the row as one element; its pieces apart where none is given, as a row holding a button of its own stands. */
  readonly heard?: RowHeard | undefined;
  /** What a swipe from the trailing edge reveals, the first of it on a full swipe, as the system's own rows take one. */
  readonly trailingActions?: readonly RowSwipe[] | undefined;
  /** What a swipe from the leading edge reveals, the first of it on a full swipe. */
  readonly leadingActions?: readonly RowSwipe[] | undefined;
  /** Menus the long press menu holds after the swipes' acts, such as a task's Status. */
  readonly menuSubmenus?: readonly RowSubmenu[] | undefined;
  /** Acts the long press menu alone holds, after its menus and in the swipes' group, such as Pin or Open in browser. */
  readonly menuActions?: readonly RowAction[] | undefined;
  /** The long press menu's further groups, after the swipes' group, each set apart by a divider, such as a task's ways to organize it and, last, Permanently delete. */
  readonly menuGroups?: readonly RowMenuGroup[] | undefined;
  /** The long press menu whole, in its own order, for a row whose menu follows the panel's right-click rather than leading with its swipes: each group set apart by a divider, after Open. Where given, the swipes stand behind the swipe alone, and `menuSubmenus`, `menuActions` and `menuGroups` are left out. */
  readonly menu?: readonly LongPressGroup[] | undefined;
  /** What the long press lifts over its menu, a glance at what the row opens (`ThreadPreview`, `TaskPreview`, `AgentPreview`), as the system's own apps lift one. */
  readonly preview?: ReactElement | undefined;
  /** Its vespin.dev link, which a drag carries out of the row: into another app as a URL, or onto a section here (`ListSection`'s `onDropLink`). */
  readonly link?: string | undefined;
  /** What its own acts ask first, standing by the row (`RowAsking`), `QUIET_ROW_QUESTION` while it asks nothing; none for a row whose acts never ask. */
  readonly question?: RowQuestion | undefined;
};

type ListRowProps = RowActs & {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  /** The thread's title, the row's first line. */
  readonly title: string;
  /** What holds the thread: its task, whose status ring and name stand on the row's first line, over its title, or an agent's own by its name alone. */
  readonly task?: { readonly name: string; readonly status?: TaskStatus | undefined } | undefined;
  /** What the thread's last line is, which picks the glyph leading it. */
  readonly line?: InboxLineKind | undefined;
  /** The thread's last line: an ask's options or steps, or the last message's words. */
  readonly summary?: string | undefined;
  /** Whether the thread is unread, which carries the dot and sets its title in semibold. */
  readonly unread?: boolean | undefined;
  /** Whether the thread is done, which mutes its words. */
  readonly done?: boolean | undefined;
  /** The teammate a thread of someone else's waits on, whose face stands before the time. */
  readonly face?: Face | undefined;
  /** When it last changed, in epoch milliseconds, said as the panel's rows say it: "now", "5m", "3h". */
  readonly at?: number | undefined;
  /** What `at` counts from; the minute, moved on as it turns (`useMinute`), where none is given. */
  readonly now?: number | undefined;
  /** When a reminder the reader set on the thread comes back, in epoch milliseconds, said in the time's place as the panel's row says it: "3:04 PM", "Mon 9:00 AM". */
  readonly due?: number | undefined;
};

/** Whether the rows nested under a row stand open, and what turns them: a parent task's sub-tasks, or the agents an agent started. */
export type RowFold = { readonly open: boolean; readonly onToggle: () => void };

/** What a fold's chevron and its menu item are heard as, folded and open: "Show sub-tasks", "Hide sub-tasks". */
export type FoldWords = { readonly show: string; readonly hide: string };

type TaskRowProps = RowActs & {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  /** Whether the task has news unread, which sets its name in semibold, as the panel's task rows say it, with no dot. */
  readonly unread?: boolean | undefined;
  /** Whether the task is done or canceled, which mutes its name, as a search finds one. */
  readonly finished?: boolean | undefined;
  /** Whether a thread of it waits on the reader, which its end says before anything of its agents. */
  readonly needsYou?: boolean | undefined;
  /** What its agents say at the line's end, as the panel's row end says it: failed, at work, or its pull request. */
  readonly agents?: TaskAgentsStatus | undefined;
  /** Whether a task it waits on is still open, which its end marks with a stop sign in the muted ink and says as Blocked, as the panel's rows do. */
  readonly blocked?: boolean | undefined;
  /** How many of its sub-tasks are finished, of all of them, as a ring and "2/5"; none where it has none. */
  readonly subTasks?: { readonly finished: number; readonly total: number } | undefined;
  /** The face of who is on it, where someone other than the reader is. */
  readonly assignee?: Face | undefined;
  /** Whether no one is on it, which its end marks with the dashed unassigned mark, as the panel's sidebar row does. */
  readonly unassigned?: boolean | undefined;
  /** When it last moved, said at the line's end ("18m"), as the panel's sidebar row ends. */
  readonly at?: number | undefined;
  /** Its key, `ACME-42`, which ends the line, where a search's finds draw it, as ⌘K's do. */
  readonly taskKey?: string | undefined;
  /** Its sub-tasks' fold, where it has sub-tasks: whether they stand open under it, and what its long press's Show or Hide sub-tasks does, the chevron being its caller's `RowDisclosure`'s. */
  readonly fold?: RowFold | undefined;
  /** How deep it stands under the tasks above it, which sets it in from the list's edge. */
  readonly depth?: number | undefined;
  /** Its status as a menu its ring opens, each status by its mark in its tone, as the panel's row opens its status chip; none where the row only reads, where the ring is its mark alone. */
  readonly statusMenu?: RowSubmenu | undefined;
};

/** A row's act as a button of its long press menu or its swipe: red where it takes something away, through the system's destructive role where `roled`, and otherwise in `ink`, the muted ink a menu's glyph takes unless a swipe asks for its fill. */
export function actionButton(
  action: RowAction,
  colors: BrandColors,
  ink: string = colors.TEXT_MUTED,
  roled = true,
) {
  const destructive = roled && action.tone === ROW_ACTION_TONE.DESTRUCTIVE;

  return (
    <Button
      key={action.label}
      {...menuActContent(action.label, action.symbol, action.detail)}
      role={destructive ? "destructive" : "default"}
      onPress={action.onPress}
      modifiers={[
        ...(destructive ? [] : [tint(ink)]),
        ...(action.disabled === true ? [disabled(true)] : []),
      ]}
    />
  );
}

/** A menu choice's glyph's color: its tone's ink, where it has a tone. */
export function choiceColor(choice: MenuChoice, colors: BrandColors): string | undefined {
  return choice.tone === undefined ? undefined : toneColor(colors, choice.tone);
}

/** What a menu's choice holds: its words beside its photo, or its glyph in its tone, or its words alone. */
export function choiceContent(choice: MenuChoice, colors: BrandColors) {
  if (choice.mark !== undefined) return markContent(choice.label, choice.mark);

  // Note that a choice saying more under its words, such as a member's email, stands as a menu's title and subtitle.
  if (choice.detail !== undefined)
    return menuActContent(
      choice.label,
      choice.symbol,
      choice.detail,
      choiceColor(choice, colors),
      choice.photo,
    );

  return actContent(
    choice.label,
    choice.symbol,
    undefined,
    choiceColor(choice, colors),
    choice.photo,
    choice.under,
  );
}

/** A submenu of a row's long press menu as SwiftUI's: each choice a toggle the system checks, then its acts. */
function rowSubmenu(submenu: RowSubmenu, colors: BrandColors, ink?: string) {
  return (
    <Menu
      key={submenu.label}
      label={menuLabel(submenu.label, submenu.symbol)}
      modifiers={ink === undefined ? [] : [tint(ink)]}
    >
      {submenu.choices.map((choice) => (
        <Toggle
          key={choice.label}
          {...choiceContent(choice, colors)}
          isOn={choice.on}
          onIsOnChange={() => choice.onPress()}
        />
      ))}
      {(submenu.submenus ?? []).map((inner) => rowSubmenu(inner, colors, ink))}
      {(submenu.actions ?? []).map((action) => actionButton(action, colors))}
    </Menu>
  );
}

/** A row's time, in the time's style, in the muted ink and tabular figures, as the panel's rows end. Note that it keeps its whole width, so a long title is what cuts short, as Mail's date stands whole beside a sender. */
export function RowTime({ at, now }: { readonly at: number; readonly now: number | undefined }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME }),
        monospacedDigit(),
        foregroundStyle(colors.TEXT_MUTED),
        fixedSize(),
      ]}
    >
      {sinceText(at, now ?? Date.now())}
    </Text>
  );
}

/** When a reminder comes back, in the time's place: the clock in the accent ink and its time as a row says a moment to come, heard as a reminder. */
function RowDue({ due, now }: { readonly due: number; readonly now: number | undefined }) {
  const colors = useColors();
  const words = dueText(due, now ?? Date.now());
  const clock = useScaledSize(MARK_SIZE.GLYPH - 4);

  return (
    <HStack spacing={SPACE.TIGHT}>
      <Image
        {...glyphImage(GLYPH.TIME)}
        size={clock}
        color={colors.ACCENT_TEXT}
        modifiers={[accessibilityHidden(true)]}
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.TIME }),
          monospacedDigit(),
          foregroundStyle(colors.ACCENT_TEXT),
          accessibilityLabel(`${REMIND_WORDS.DUE} ${words}`),
          fixedSize(),
        ]}
      >
        {words}
      </Text>
    </HStack>
  );
}

/**
 * Where a row stands in its list: on the list's own ground, inset so the
 * unread dot stands in the margin, its hairline starting under the words.
 * Note that a selected row stands on the `SELECTED` gray, as iOS's own
 * selection does, since a clear row ground leaves the system no fill to draw,
 * so an iPad's selected row showed only the keyboard focus's black outline.
 * Note that the row's insets are its own padding and the gray is drawn
 * behind that padding, never as the list's row background, because a list
 * draws a row's background across the whole column, and on iPadOS 26 a
 * split view's list column runs on under the floating sidebar, so the gray
 * stood under the sidebar's glass to the window's edge. A row's own view
 * stays inside the column's safe area, as Mail's rows do. The gray is
 * rounded and set in from the column's edges by `ROW_INSET.FILL`, as Mail's
 * selected message stands, the padding inside it giving back that inset so
 * the row's words and marks stand where an unselected row's do, and its
 * hairlines step aside while it is selected, as Mail's do. Note that a row
 * draws no hairline over itself, only the one under it, because a list
 * column's first row drew one under its search field, where Mail draws none.
 */
export function rowPlacement(
  colors: BrandColors,
  selected = false,
  vertical: number = ROW_INSET.VERTICAL,
  indent = 0,
  leading: number = ROW_INSET.LEADING,
  reach = 0,
) {
  return [
    listRowBackground("clear"),
    listRowInsets({ leading: 0, trailing: 0, top: 0, bottom: 0 }),
    padding({
      leading: leading - ROW_INSET.FILL,
      trailing: SPACE.EDGE - ROW_INSET.FILL,
      top: vertical,
      bottom: vertical,
    }),
    ...(selected
      ? [
          // Note that a fill that reaches past the row's own frame, under what the system stands after it, is drawn on the frame padded out by that much and the padding taken back, so the row lays out as it did.
          padding({ trailing: reach }),
          background(
            colors.SELECTED,
            SwiftModifiers.shapes.roundedRectangle({ cornerRadius: RADIUS.SIDEBAR_ROW }),
          ),
          padding({ trailing: -reach }),
          listRowSeparator("hidden"),
        ]
      : []),
    padding({ horizontal: ROW_INSET.FILL }),
    listRowSeparatorTint(colors.CHIP_EDGE),
    alignmentGuide("listRowSeparatorLeading", ROW_INSET.TEXT + indent),
  ];
}

/** The tones of acts that ask before they run, which a full swipe never runs, so they wait for their button's tap. */
const ASKS_FIRST: ReadonlySet<RowActionTone> = new Set([
  ROW_ACTION_TONE.DESTRUCTIVE,
  ROW_ACTION_TONE.ARCHIVE,
]);

/** Whether a full swipe from an edge runs its first act: never where that act asks first, such as Archive or a delete, nor where it is a menu. */
function fullSwipes(swipes: readonly RowSwipe[]): boolean {
  const first = swipes[0];

  return first !== undefined && !isSubmenu(first) && !ASKS_FIRST.has(first.tone);
}

/**
 * A swipe's piece behind the row: an act's button, or a menu's, filled with
 * the system color its meaning takes (`SWIPE_FILL`). Note that a delete
 * fills red without the destructive role, because
 * SwiftUI takes a row out of its list the moment a destructive swipe is
 * pressed, before an act that asks first, such as Archive, hears its answer,
 * so a Cancel left the row gone under its section's count.
 */
function swipeButton(
  swipe: RowSwipe,
  colors: BrandColors,
  fills: Readonly<Record<SystemColor, string>>,
) {
  const fill = fills[SWIPE_FILL[swipe.tone ?? ROW_ACTION_TONE.NEUTRAL]];

  if (isSubmenu(swipe)) return rowSubmenu(swipe, colors, fill);

  return actionButton(swipe, colors, fill, false);
}

/** A swiped act as it stands again in the long press menu: in the muted ink a menu's glyph takes, and red through the system's destructive role, since a menu takes no row away. */
function swipeMenuButton(swipe: RowSwipe, colors: BrandColors) {
  return isSubmenu(swipe)
    ? rowSubmenu(swipe, colors, colors.TEXT_MUTED)
    : actionButton(swipe, colors);
}

/** One group of a long press menu, in the menu's order: its acts and the menus within it. */
export type LongPressGroup = readonly RowSwipe[];

/**
 * The one long press menu the app opens on anything held, as the panel opens
 * its right-click menu on the same things: SwiftUI's own menu, its groups in
 * the panel's order, each set apart from the next by a divider, an act red
 * where it takes something away, and the preview it lifts where it has one,
 * as the system's own apps lift a glance at what a row opens. A row draws it
 * through `RowFrame`, a section's header through `ListSection`'s `menu`,
 * and SwiftUI or React Native views held through `HeldSwiftMenu` and
 * `HeldMenu`. The content alone where it offers nothing.
 */
export function LongPressMenu({
  groups,
  title,
  preview,
  children,
}: {
  readonly groups: readonly LongPressGroup[];
  /** What heads the menu, such as when a message was sent, as Messages heads a held message's menu by its time; none where it says nothing over its acts. */
  readonly title?: string | undefined;
  readonly preview?: ReactElement | undefined;
  readonly children: ReactElement;
}) {
  const colors = useColors();
  const filled = groups.filter((group) => group.length > 0);

  if (filled.length === 0 && preview === undefined) return children;

  const items = filled.map((group, at) => (
    // Note that a group is keyed by its first item's words, which a menu holds once.
    <Fragment key={group[0]?.label ?? at}>
      {at === 0 ? null : <Divider />}
      {group.map((item) => swipeMenuButton(item, colors))}
    </Fragment>
  ));

  return (
    <ContextMenu>
      <ContextMenu.Items>
        {title === undefined ? items : <Section title={title}>{items}</Section>}
      </ContextMenu.Items>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      {preview === undefined ? null : <ContextMenu.Preview>{preview}</ContextMenu.Preview>}
    </ContextMenu>
  );
}

/** A row's content with the question its acts ask standing by it, where its acts ask any. */
function asking(content: ReactElement, question: RowQuestion | undefined): ReactElement {
  return question === undefined ? content : <RowAsking question={question}>{content}</RowAsking>;
}

/**
 * A row's frame in its list: the id its list picks it by, the list's own
 * ground behind it rather than a card's, its insets, which stand the unread
 * dot in the margin, and its hairline, which starts under the words rather
 * than the mark. Its acts stand twice, as the system's own rows carry them:
 * behind a swipe from either edge, a full swipe running the first unless it
 * is destructive, and in
 * the menu a long press opens, the trailing ones first, so a person who
 * never swipes still finds them; that menu then holds its submenus and the
 * acts only it offers, and after a divider each of its further groups. A row with a link is dragged out as it, on an iPad
 * into another app or onto a section. A row with a preview lifts it over the menu, which
 * then leads with Open. Note that SwiftUI's preview takes no tap of its own,
 * a tap on it closing the menu, so Open is what opens the row from there. A
 * row given what it is heard as reads to VoiceOver as one element, its title
 * then where it stands, rather than each mark and word apart.
 */
export function RowFrame({
  id,
  row,
  heard,
  trailingActions = [],
  leadingActions = [],
  menuSubmenus = [],
  menuActions = [],
  menuGroups = [],
  menu: ordered,
  preview,
  link,
  question,
  vertical,
  indent,
  leading,
}: RowActs & {
  readonly id: string;
  readonly row: ReactElement;
  /** The row's top and bottom inset, where it stands roomier than the list's own, as an Inbox thread does. */
  readonly vertical?: number | undefined;
  /** How far past the list's text column the row's words start, where it stands in deeper, a second mark leads it, or its lead grows, so its hairline starts under them. */
  readonly indent?: number | undefined;
  /** The row's leading inset: the unread dot's margin where none is given, or the list's edge for a row that draws no dot (`ROW_INSET.PLAIN`). */
  readonly leading?: number | undefined;
}) {
  const colors = useColors();
  const fills = useSystemColors();
  const open = useContext(RowOpenContext);
  const selected = useContext(RowSelectedContext) === id;
  const disclosed = useContext(RowDisclosedContext);
  const chevronRoom = useScaledSize(DISCLOSURE_CHEVRON_ROOM);
  const choosing = useContext(RowChoosingContext);
  const swiped = [...trailingActions, ...leadingActions];

  // Note that a heard row is one element, its children's acts kept as its own, so VoiceOver offers a swipe's acts in its Actions rotor and its menu by a long press, as it does the system's rows.
  const frameModifiers = [
    tag(id),
    ...rowPlacement(
      colors,
      selected,
      vertical,
      indent,
      leading,
      disclosed ? SPACE.EDGE + chevronRoom : 0,
    ),
    ...(heard === undefined
      ? []
      : [
          accessibilityElement("combine"),
          accessibilityLabel(heard.label),
          accessibilityValue(heardValue(heard.value)),
        ]),
    ...(link === undefined ? [] : [dragLink(link)]),
    // Note that a row of a list that opens its rows draws no keyboard focus ring around its cell, as iPadOS's own sidebars draw none, since its selection already stands on the `SELECTED` fill; it's set by whether the row opens at all, not by whether it's selected now, so the modifiers don't change as the selection does.
    ...(open === undefined ? [] : [cellFocusRingOff()]),
  ];

  const groups = menuGroups.filter(menuGroupFilled);

  const ownGroup =
    ordered === undefined
      ? swiped.length + menuSubmenus.length + menuActions.length > 0
      : ordered.some((group) => group.length > 0);

  // Note that a row in Select mode offers no long press and no swipe, as Mail's rows don't while it selects, so a press only ticks it.
  if (choosing || (!ownGroup && groups.length === 0 && preview === undefined)) {
    return <HStack modifiers={frameModifiers}>{asking(row, question)}</HStack>;
  }

  const opening: readonly RowAction[] =
    preview === undefined || open === undefined
      ? []
      : [
          // Note that Open stands as words alone, since it opens the row in the app; the arrow out marks only what leaves it, such as Open in browser.
          { label: VERB.OPEN, tone: ROW_ACTION_TONE.NEUTRAL, onPress: () => open(id) },
        ];

  const menu = asking(
    <LongPressMenu
      groups={
        ordered === undefined
          ? [
              opening,
              [...swiped, ...menuSubmenus, ...menuActions],
              ...groups.map((group) => [...(group.submenus ?? []), ...(group.actions ?? [])]),
            ]
          : [opening, ...ordered]
      }
      preview={preview}
    >
      {row}
    </LongPressMenu>,
    question,
  );

  // Note that a row with no swipe stands its menu in a plain frame, since a swipe with no acts has nothing to reveal.
  if (swiped.length === 0) return <HStack modifiers={frameModifiers}>{menu}</HStack>;

  return (
    <SwipeActions modifiers={frameModifiers}>
      {menu}
      {trailingActions.length === 0 ? null : (
        <SwipeActions.Actions edge="trailing" allowsFullSwipe={fullSwipes(trailingActions)}>
          {trailingActions.map((swipe) => swipeButton(swipe, colors, fills))}
        </SwipeActions.Actions>
      )}
      {leadingActions.length === 0 ? null : (
        <SwipeActions.Actions edge="leading" allowsFullSwipe={fullSwipes(leadingActions)}>
          {leadingActions.map((swipe) => swipeButton(swipe, colors, fills))}
        </SwipeActions.Actions>
      )}
    </SwipeActions>
  );
}

/**
 * A row's title, the words a search typed set in bold where they stand in
 * it, as Mail's search results set them, and plain outside a search. Note
 * that a marked title is one Markdown string in one native text, never texts
 * nested in it, so a key typed redraws the words in place rather than
 * building the row's text anew. A title turning from marked to plain, or
 * back, is drawn by a native text of its own (`TITLE_LOOK`), because the one
 * native text, handed its plain words with no Markdown, kept drawing the bold
 * of the last search it marked.
 */
function TitleWords({
  title,
  modifiers,
}: {
  readonly title: string;
  readonly modifiers: readonly ModifierConfig[];
}) {
  const marked = searchedTitleMarkdown(title, useContext(RowSearchedContext));

  return marked === undefined ? (
    <Text key={TITLE_LOOK.PLAIN} modifiers={[...modifiers]}>
      {title}
    </Text>
  ) : (
    <Text key={TITLE_LOOK.MARKED} markdownEnabled modifiers={[...modifiers]}>
      {marked}
    </Text>
  );
}

/** What a row fitted to its title is told: its title's whole width, and the room the title has on the line, each in points as the line is laid out. */
type TitleFit = {
  readonly onName: (width: number) => void;
  readonly onRoom: (width: number) => void;
};

/**
 * A row's first line: the unread dot in the margin, the leading mark in its
 * column, the title, and what ends the line. The line centers its pieces,
 * so the mark stands on the title at any Dynamic Type size, and at an
 * accessibility size stacks its end under the title, the mark's column
 * growing with the words. What trails the line, such as the arrow of a row
 * that opens GitHub, keeps the trailing edge at every size, as iOS keeps a
 * row's chevron there.
 */
export function RowHead({
  dot = true,
  unread,
  faded,
  fold,
  mark,
  lead,
  beside,
  title,
  ink,
  end,
  trail,
  fit,
}: {
  /** Whether the unread dot stands in the margin; a task's row draws none, its unread name standing in semibold alone, as the panel's task rows do. */
  readonly dot?: boolean | undefined;
  readonly unread: boolean;
  readonly faded: boolean;
  /** A parent's fold chevron, standing before its lead mark; none for a row that folds nothing, or a task's, whose chevron stands in its lead's place. */
  readonly fold?: ReactNode;
  /** A mark before the lead, in a column of the lead's width, as a task row's priority stands before its status. */
  readonly mark?: ReactNode;
  readonly lead: ReactNode;
  /** What stands between the lead and the title, such as the avatar of the App that runs a check; nothing where none is given. */
  readonly beside?: ReactNode;
  readonly title: string;
  readonly ink: string;
  readonly end: ReactNode;
  readonly trail?: ReactNode;
  /** Where given, what the title's whole width and its room on the line are told to, so the row can let marks of its end go before the title is cut. */
  readonly fit?: TitleFit | undefined;
}) {
  const lines = useRowLines();
  const stacked = useAccessibilitySize();
  const leadWidth = useScaledSize(MARK_SIZE.LEAD);

  const words = (
    <TitleWords
      title={title}
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: unread ? "semibold" : "regular" }),
        foregroundStyle(ink),
        lineLimit(lines.title),
      ]}
    />
  );

  // Note that a row fitted to its title measures the title's room as the title and the gap after it, and its whole width from an unseen copy that never cuts, which takes no room on the line; at an accessibility size its end stands under it, so nothing needs fitting.
  const fitted =
    fit === undefined || stacked ? undefined : (
      <HStack
        spacing={0}
        modifiers={[onGeometryChange(({ width }) => fit.onRoom(width - SPACE.ROW))]}
      >
        <ZStack alignment="leading">
          {words}
          <HStack modifiers={[frame({ width: 0, height: 0 }), hidden(), accessibilityHidden(true)]}>
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: unread ? "semibold" : "regular" }),
                fixedSize(),
                onGeometryChange(({ width }) => fit.onName(width)),
              ]}
            >
              {title}
            </Text>
          </HStack>
        </ZStack>
        <Spacer minLength={SPACE.ROW} />
      </HStack>
    );

  // Note that at an accessibility size the line's end stands under the title rather than beside it, as Mail's rows stack their date, so the title keeps the row's width rather than wrapping a word to a line, and the dot stands on the title's first line rather than centered on the whole stack.
  const line = (
    <HStack spacing={SPACE.ROW} alignment={stacked ? "top" : "center"}>
      {/* Note that the fold and the marks stand centered on each other, so the chevron sits beside the ring rather than on the row's top edge where an accessibility size aligns the line to its top. */}
      <HStack spacing={SPACE.ROW} alignment="center">
        {fold}
        {mark === undefined ? null : (
          <HStack modifiers={[frame({ width: leadWidth })]}>{mark}</HStack>
        )}
        <HStack modifiers={[frame({ width: leadWidth })]}>{lead}</HStack>
      </HStack>
      {beside}
      {stacked ? (
        <VStack alignment="leading" spacing={2}>
          {words}
          {end}
        </VStack>
      ) : (
        (fitted ?? words)
      )}
      {fitted === undefined ? <Spacer /> : null}
      {stacked ? null : end}
      {trail}
    </HStack>
  );

  if (!dot) return line;

  return (
    <HStack spacing={SPACE.TIGHT} alignment={stacked ? "firstTextBaseline" : "center"}>
      <UnreadDot unread={unread} faded={faded} />
      {line}
    </HStack>
  );
}

/** The ink a row's title stands in: muted once done, the full ink while unread, and the body's at rest. */
function titleInk(colors: BrandColors, unread: boolean, done: boolean): string {
  if (done) return colors.TEXT_MUTED;

  return unread ? colors.TEXT : colors.TEXT_BODY;
}

/** A line's glyph at the line's size, growing with Dynamic Type, in its tone's ink: the accent's for an ask that waits on you, the muted ink for the rest. It is never heard, since the line's words say what it marks. */
function LineGlyph({ line }: { readonly line: InboxLineKind | undefined }) {
  const look = line === undefined ? undefined : INBOX_LINE_LOOK[line];

  if (look === undefined) return null;

  return <ToneGlyph glyph={look.symbol} tone={look.tone} textStyle={TYPE_ROLE.ROW_LINE} hidden />;
}

/**
 * An Inbox row's first line, over the title, as the panel's lead line: the
 * copper dot in the margin while the thread is unread, the task's status
 * ring in the lead column, the task's name, the row's largest words, in
 * semibold, and the time at the line's end. Its name takes the title's ink,
 * the full ink while unread, the body's at rest, and the muted one once
 * done. At an accessibility size the time stands under the name, as a
 * title's does.
 */
function TaskLine({
  task,
  unread,
  done,
  end,
}: {
  readonly task: NonNullable<ListRowProps["task"]>;
  readonly unread: boolean;
  readonly done: boolean;
  readonly end: ReactNode;
}) {
  const colors = useColors();
  const lines = useRowLines();
  const stacked = useAccessibilitySize();
  const leadWidth = useScaledSize(MARK_SIZE.LEAD);

  const name = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LEAD, weight: "semibold" }),
        foregroundStyle(titleInk(colors, unread, done)),
        lineLimit(lines.title),
      ]}
    >
      {task.name}
    </Text>
  );

  return (
    <HStack spacing={SPACE.TIGHT} alignment={stacked ? "firstTextBaseline" : "center"}>
      <UnreadDot unread={unread} faded={done} />
      <HStack spacing={SPACE.ROW} alignment={stacked ? "top" : "center"}>
        <HStack modifiers={[frame({ width: leadWidth })]}>
          {task.status === undefined ? null : <TaskStatusMark status={task.status} />}
        </HStack>
        {stacked ? (
          <VStack alignment="leading" spacing={2}>
            {name}
            {end}
          </VStack>
        ) : (
          name
        )}
        <Spacer />
        {stacked ? null : end}
      </HStack>
    </HStack>
  );
}

/**
 * The words of an Inbox row's lines under its task's, standing flush with
 * the task's ring rather than its name, as the panel's title and preview
 * start where its lead line does, the unread dot's margin left empty so they
 * keep the line's column.
 */
function FlushLine({ children }: { readonly children: ReactNode }) {
  return (
    <HStack spacing={SPACE.TIGHT} alignment="center">
      <UnreadDot unread={false} />
      {children}
      <Spacer />
    </HStack>
  );
}

/**
 * An Inbox row's last line, the glyph and words of what it asks, in the 13
 * pt line, as the panel's row reads and as Mail's preview stands under its
 * subject: the muted ink at rest or once done and the full ink while unread, only the
 * ask's glyph in the attention ink. Under a task's line it stands flush with
 * the ring, the glyph leading its words; on an agent's own thread, whose
 * title the glyph leads, it stands in the title's column, a glyph's column
 * left empty, so the words hang under the title at every size.
 */
function ThreadLine(props: ListRowProps & { readonly flush: boolean }) {
  const { line, summary, flush, unread = false, done = false } = props;
  const colors = useColors();
  const lines = useRowLines();
  const leadWidth = useScaledSize(MARK_SIZE.LEAD);
  const words = summary?.trim() === "" ? undefined : summary;

  if (words === undefined) return null;

  const text = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        foregroundStyle(unread && !done ? colors.TEXT : colors.TEXT_MUTED),
        lineLimit(lines.line),
      ]}
    >
      {words}
    </Text>
  );

  if (flush) {
    return (
      <FlushLine>
        <HStack spacing={SPACE.TIGHT} alignment="center">
          <LineGlyph line={line} />
          {text}
        </HStack>
      </FlushLine>
    );
  }

  return (
    <HStack spacing={SPACE.TIGHT} alignment="center">
      <UnreadDot unread={false} />
      <HStack spacing={SPACE.ROW} alignment="center">
        <HStack modifiers={[frame({ width: leadWidth })]}>{null}</HStack>
        {text}
        <Spacer />
      </HStack>
    </HStack>
  );
}

/**
 * One Inbox thread, in the panel's three lines and their hierarchy: its
 * task, the status ring and the task's name, the row's largest words, with
 * the time at the line's end and the copper dot in the margin while it is
 * unread; its title under it in the subject's style, semibold while
 * unread; and the glyph and words of what it asks in the muted line under
 * that, as Mail's sender, subject and preview stand, the title and that line
 * standing flush with the ring, as the panel's lead row stands. An agent's
 * own thread, which has no task, stands in two, the glyph of what it asks
 * leading its title, with the time at the title's end and the dot beside it. A teammate's face stands before the time on a thread
 * that waits on them, and a thread put away until a reminder says when it
 * comes back in its time's place, as the panel's row does. It stands
 * roomier than a task's row, with Mail's breathing room above, below, and
 * between its lines.
 */
export function ListRow(props: ListRowProps) {
  const { id, title, task, line, unread = false, done = false, face, at, due } = props;
  const colors = useColors();
  const lines = useRowLines();
  // Note that the row reads the minute itself, so its time and what VoiceOver hears of it move on with no draw of the list that holds it.
  const minute = useMinute();
  const now = props.now ?? minute;

  const end = (
    <HStack spacing={SPACE.TIGHT + 2}>
      {face === undefined ? null : (
        <Avatar name={face.name} id={face.id} picture={face.picture} size={MARK_SIZE.FACE} />
      )}
      {due !== undefined ? (
        <RowDue due={due} now={now} />
      ) : at === undefined ? null : (
        <RowTime at={at} now={now} />
      )}
    </HStack>
  );

  // Note that the title under a task's line is its subject, a step under the line that leads it, as Mail's subject stands under its sender.
  const titleModifiers = [
    font({ textStyle: TYPE_ROLE.ROW_SUBJECT, weight: unread ? "semibold" : "regular" }),
    foregroundStyle(titleInk(colors, unread, done)),
    lineLimit(lines.title),
  ];

  // Note that a task's thread leads with its task's line, the title and the preview flush under its ring, as the panel's lead row stands, while an agent's own thread leads with its title.
  const row: ReactElement =
    task === undefined ? (
      <VStack alignment="leading" spacing={ROW_INSET.THREAD_LINE_GAP}>
        <RowHead
          unread={unread}
          faded={done}
          lead={<LineGlyph line={line} />}
          title={title}
          ink={titleInk(colors, unread, done)}
          end={end}
        />
        <ThreadLine {...props} flush={false} />
      </VStack>
    ) : (
      <VStack alignment="leading" spacing={0}>
        <TaskLine task={task} unread={unread} done={done} end={end} />
        <VStack alignment="leading" spacing={ROW_INSET.THREAD_PREVIEW_GAP}>
          <FlushLine>
            <TitleWords title={title} modifiers={titleModifiers} />
          </FlushLine>
          <ThreadLine {...props} flush />
        </VStack>
      </VStack>
    );

  return (
    <RowFrame
      {...props}
      id={id}
      row={row}
      heard={props.heard ?? threadHeard(props, now)}
      vertical={ROW_INSET.THREAD_VERTICAL}
    />
  );
}

/** What VoiceOver hears of an Inbox row: its title, then unread, what waits on you, its last words, its task and the task's status, whom it waits on, and when. */
function threadHeard(props: ListRowProps, moment: number): RowHeard {
  const { title, task, line, summary, unread = false, face, at, due } = props;
  const asks = line !== undefined && INBOX_LINE_LOOK[line]?.tone === STATUS_TONE.ATTENTION;

  return {
    label: title,
    value: [
      unread && UNREAD_WORDS,
      asks && NEEDS_YOU.LABEL,
      summary?.trim(),
      task?.name,
      task?.status === undefined ? undefined : TASK_STATUS_WORDS[task.status],
      face?.name,
      due !== undefined
        ? `${REMIND_WORDS.DUE} ${dueText(due, moment)}`
        : at === undefined
          ? undefined
          : sinceHeard(at, moment),
    ],
  };
}

/** What VoiceOver hears of a task row's end: a thread that needs the reader, then its agents. */
function agentsHeard(agents: TaskAgentsStatus | undefined): string | undefined {
  switch (agents?.kind) {
    case TASK_AGENTS_STATUS.FAILED:
      return GLYPH_STATE_WORDS[GLYPH_STATE.FAILED];
    case TASK_AGENTS_STATUS.WORKING:
      return GLYPH_STATE_WORDS[GLYPH_STATE.WORKING];
    case TASK_AGENTS_STATUS.PULL_REQUEST:
      return `${PULL_REQUEST_HEARD} ${pullRequestMarkLabel(agents.pullRequest)}`;
    case TASK_AGENTS_STATUS.NONE:
    case undefined:
      return undefined;
    default: {
      const unhandled: never = agents;
      throw new Error(
        `A task's agents stand in no status a row says: ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/** What a task row is heard as: its name, then unread, its status, a thread that needs you, its sub-tasks' count, its agents, who is on it, when it last moved, its key, and whether its sub-tasks are open. */
function taskHeard(props: TaskRowProps, moment: number): RowHeard {
  const {
    name,
    status,
    unread = false,
    needsYou = false,
    blocked = false,
    agents,
    taskKey,
    fold,
    subTasks,
    assignee,
    unassigned = false,
    at,
  } = props;

  return {
    label: name,
    value: [
      unread && UNREAD_WORDS,
      TASK_STATUS_WORDS[status],
      blocked && BLOCKED_WORDS,
      needsYou && NEEDS_YOU.LABEL,
      subTasks === undefined ? undefined : subTasksHeard(subTasks.finished, subTasks.total),
      agentsHeard(agents),
      assignee?.name,
      unassigned && NO_ASSIGNEE_HEARD,
      at === undefined ? undefined : sinceHeard(at, moment),
      taskKey,
      fold !== undefined && (fold.open ? SUB_TASKS_SHOWN : SUB_TASKS_HIDDEN),
    ],
  };
}

/** What VoiceOver hears of a task no one is on, the panel's words for the assignee it has not. */
const NO_ASSIGNEE_HEARD = "No assignee";

/** What a blocked task's row says, the panel's word for its mark (`@repo/ui`'s `BLOCKED_WORDS`). */
const BLOCKED_WORDS = "Blocked";

/** The marks of a task row's end it lets go before its name is cut, in the order it lets them go: its agents' mark, then its sub-tasks' progress, as Mail's rows keep the sender's name over their marks. */
const SPARED_MARK = {
  AGENTS: "agents",
  SUB_TASKS: "subTasks",
} as const;

type SparedMark = (typeof SPARED_MARK)[keyof typeof SPARED_MARK];

/** The gap between the marks of a task row's end, in points. */
const END_GAP = SPACE.TIGHT + 2;

/** What a task row measured of its line, for the task it last drew, since a recycled row holds another task's. */
type RowFitState = {
  readonly id: string;
  readonly name: number | undefined;
  readonly room: number | undefined;
  readonly widths: Partial<Record<SparedMark, number>>;
  readonly dropped: number;
};

/** Which of a task row's lesser marks stand aside, and what measures its title and each mark. */
type SparedMarks = {
  readonly aside: ReadonlySet<SparedMark>;
  readonly fit: TitleFit | undefined;
  readonly measured: (mark: SparedMark) => (width: number) => void;
};

/**
 * Which of a task row's lesser marks stand aside so its name reads whole, as
 * the row measures its line (`sparedMarksDropped`), and what its title and
 * each mark are measured by; none stands aside, and nothing is measured,
 * where the row has none to let go.
 */
function useSparedMarks(id: string, spared: readonly SparedMark[]): SparedMarks {
  const [state, setState] = useState<RowFitState>({
    id,
    name: undefined,
    room: undefined,
    widths: {},
    dropped: 0,
  });

  const measure = (change: Partial<Pick<RowFitState, "name" | "room" | "widths">>) =>
    setState((was) => {
      const base: RowFitState =
        was.id === id ? was : { id, name: undefined, room: undefined, widths: {}, dropped: 0 };

      const next = { ...base, ...change, widths: { ...base.widths, ...change.widths } };

      if (next.name === undefined || next.room === undefined) return next;

      const dropped = sparedMarksDropped({
        name: next.name,
        room: next.room,
        marks: spared.map((mark, at) => ({ width: next.widths[mark], dropped: at < base.dropped })),
      });

      return { ...next, dropped };
    });

  const dropped = state.id === id ? state.dropped : 0;

  return {
    aside: new Set(spared.slice(0, dropped)),
    fit:
      spared.length === 0
        ? undefined
        : { onName: (name) => measure({ name }), onRoom: (room) => measure({ room }) },
    measured: (mark) => (width) => measure({ widths: { [mark]: width + END_GAP } }),
  };
}

/** What a task's agents say on its row, as the panel's sidebar row says it in one mark: a failed agent, one at work, or its pull request's state. */
function TaskAgentsMark({ agents }: Pick<TaskRowProps, "agents">) {
  switch (agents?.kind) {
    case TASK_AGENTS_STATUS.FAILED:
      return <FailedMark />;
    case TASK_AGENTS_STATUS.WORKING:
      return <WorkingMark />;
    case TASK_AGENTS_STATUS.PULL_REQUEST: {
      const pull = PULL_REQUEST_LOOK[pullRequestMarkState(agents.pullRequest)];

      return <ToneGlyph glyph={pull.symbol} tone={pull.tone} />;
    }

    case TASK_AGENTS_STATUS.NONE:
    case undefined:
      return null;
    default: {
      const unhandled: never = agents;
      throw new Error(
        `A task's agents stand in no status a row draws: ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/** Whether a row stands as a disclosure's label, after which the system stands the disclosure's chevron. */
const RowDisclosedContext = createContext(false);

/** The room the system's disclosure chevron takes after its label, in points at the default text size, the gap before it included, measured on the iPad (j10090r2), which a selected label's fill reaches under. */
const DISCLOSURE_CHEVRON_ROOM = 7;

/**
 * A row with the rows nested under it, folded by SwiftUI's own disclosure,
 * as Files and Notes fold a folder: the row stands as its label, its
 * chevron at the line's trailing edge, turning as it opens, the rows under
 * it set in by the system and eased in and out, and VoiceOver hearing it
 * expanded or collapsed. Its holder keeps whether it stands open, since a
 * recycled row holds no state (`RowForEach`). Note that the label is the
 * row's own press, which opens what the row is, so only the chevron folds.
 */
export function RowDisclosure({
  open,
  onOpenChange,
  label,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: ReactNode;
  readonly children: ReactNode;
}) {
  // Note that the disclosure, not its label, is the list's row, so it takes the row's ground and its insets here: the label's own (`RowFrame`) stood ignored, setting the parent's ring in from every other row's and drawing the list's selection in the screen's ink behind it; its trailing inset keeps the chevron off the column's edge, and the system sets its rows in under the parent's name. A selected label's fill reaches on under the chevron (`RowDisclosedContext`), since a view modifier here would fall on every row nested under it too.
  return (
    <DisclosureGroup
      isExpanded={open}
      onIsExpandedChange={onOpenChange}
      modifiers={[
        listRowInsets({ leading: 0, trailing: SPACE.EDGE, top: 0, bottom: 0 }),
        listRowBackground("clear"),
      ]}
    >
      <DisclosureGroup.Label>
        <RowDisclosedContext value={true}>{label}</RowDisclosedContext>
      </DisclosureGroup.Label>
      {children}
    </DisclosureGroup>
  );
}

/** What a parent task's chevron is heard as, folded and open. */
const SUB_TASK_FOLD: FoldWords = { show: "Show sub-tasks", hide: "Hide sub-tasks" };

/** The least a fold chevron answers a press across, in points, as the system asks of every target. */
const FOLD_TARGET = 44;

/**
 * A parent's fold before its lead mark, as the panel's chevron stands
 * before a task's or an agent's name: it opens the rows nested under it,
 * while a press on the row itself still opens what the row is. Note that
 * the button itself is the whole 44 pt square, since a borderless button
 * in a selectable row takes a press only within its own frame, and the
 * overhang is taken back outside it, so the row lays out a lead mark's
 * square: a nested row's mark stands under its parent's and the row stands
 * no taller than its mark. It stands above the mark beside it, which its
 * square reaches over. While the overhang was taken back inside the
 * button, laying it out at no height, a press on it opened the row instead
 * (j9614, Nov 16).
 */
export function FoldChevron({
  fold,
  words,
}: {
  readonly fold: RowFold;
  readonly words: FoldWords;
}) {
  const colors = useColors();
  // Note that the chevron and the column it lays out grow with the reader's text, as the mark beside it does, so it stands no speck beside large words.
  const lead = useScaledSize(MARK_SIZE.LEAD);
  const glyph = useScaledSize(MARK_SIZE.GLYPH - 4);
  const target = Math.max(FOLD_TARGET, lead);
  const overhang = (target - lead) / 2;

  return (
    <Button
      onPress={fold.onToggle}
      modifiers={[
        buttonStyle("borderless"),
        accessibilityLabel(fold.open ? words.hide : words.show),
        padding({ all: -overhang }),
        zIndex(1),
      ]}
    >
      <Image
        {...glyphImage(fold.open ? GLYPH.UNFOLDED : GLYPH.FOLDED)}
        size={glyph}
        color={colors.TEXT_MUTED}
        modifiers={[
          frame({ width: target, height: target }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      />
    </Button>
  );
}

/** What a task's status ring is heard as, among its row's actions: the menu it opens. */
const STATUS_WORD = "Status";

/**
 * A task's status ring that opens its Status menu, as the panel's row opens
 * its status chip and Reminders sets a task from its circle: the system's
 * menu, anchored on the ring, each status by its mark in its tone and the
 * current one checked. Its target is 44 pt tall and reaches only toward the
 * row's leading edge, by `edge`, and into the gap before the name, so a
 * press on the name still opens the task; beside a parent's fold it reaches
 * none of the way, since the chevron's 44 pt square already overhangs the
 * gap between them, and a ring standing over that overhang took a press
 * meant for the fold. It is the
 * mark alone where its row only reads, or while its list stands in Select
 * mode. Note that its row stays one element to VoiceOver, which offers the
 * menu among the row's actions as Status, since a heard row keeps its
 * children's acts as its own.
 */
export function StatusRing({
  status,
  menu,
  edge,
}: {
  readonly status: TaskStatus;
  readonly menu: RowSubmenu | undefined;
  /** How far toward the row's leading edge its target reaches: the row's leading inset, or nothing beside a fold, whose chevron's square takes the gap. */
  readonly edge: number;
}) {
  const colors = useColors();
  const choosing = useContext(RowChoosingContext);
  const lead = useScaledSize(MARK_SIZE.LEAD);
  const target = Math.max(FOLD_TARGET, lead);

  if (menu === undefined || choosing) return <TaskStatusMark status={status} />;

  // Note that the ring never reaches past the gap before the name.
  const reach = {
    leading: edge,
    trailing: SPACE.ROW,
    vertical: (target - lead) / 2,
  };

  return (
    <Menu
      label={
        <HStack
          modifiers={[
            frame({ width: lead + reach.leading + reach.trailing, height: target }),
            SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
          ]}
        >
          <TaskStatusMark status={status} />
        </HStack>
      }
      modifiers={[
        menuStyle("button"),
        buttonStyle("borderless"),
        menuIndicator("hidden"),
        accessibilityLabel(STATUS_WORD),
        padding({
          leading: -reach.leading,
          trailing: -reach.trailing,
          top: -reach.vertical,
          bottom: -reach.vertical,
        }),
        zIndex(1),
      ]}
    >
      {menu.choices.map((choice) => (
        <Toggle
          key={choice.label}
          {...choiceContent(choice, colors)}
          isOn={choice.on}
          onIsOnChange={() => choice.onPress()}
        />
      ))}
    </Menu>
  );
}

/** A fold's item in its row's long press menu, so a person who reaches the row as one element, through VoiceOver or Voice Control, still opens what it folds; none for a row that folds nothing. */
export function foldActions(fold: RowFold | undefined, words: FoldWords): readonly RowAction[] {
  if (fold === undefined) return [];

  return [
    {
      label: fold.open ? words.hide : words.show,
      symbol: fold.open ? GLYPH.UNFOLDED : GLYPH.FOLDED,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: fold.onToggle,
    },
  ];
}

/** How far each level of nesting, or a parent's fold, sets a row in: a column of the lead's scaled width, so a nested row's mark stands under its parent's at every size. */
export function useNestColumn(): number {
  return useScaledSize(MARK_SIZE.LEAD) + SPACE.ROW;
}

/**
 * One task on a single line, as the panel's sidebar draws it
 * (`SidebarTask`): its status ring, its name in the row title's style,
 * semibold while it has news, and at the line's end its trailing run: the
 * stop sign while a task it waits on is open, the needs-you dot while a
 * thread of it waits on the reader, how many of its sub-tasks are finished
 * as a ring and "2/5", one mark for its agents (failed, at work, or its pull
 * request), the face of who is on it where that is someone other than the
 * reader or the dashed mark where no one is, and how long ago it last moved.
 * Its ring stands at the list's edge, where an Inbox row's ring stands past
 * the dot's margin, so the two lists' marks and words line up. A task with
 * sub-tasks stands as the label of its caller's `RowDisclosure`, whose
 * chevron, at the line's trailing edge as Files and Notes stand theirs,
 * folds them; the row offers Show and Hide sub-tasks in its long press too
 * (`fold`), and says which.
 */
export function TaskRow(props: TaskRowProps) {
  const { id, name, status, unread = false, finished = false, taskKey, fold, depth = 0 } = props;

  const colors = useColors();
  const minute = useMinute();
  const lead = useScaledSize(MARK_SIZE.LEAD);
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  const column = useNestColumn();
  // Note that the hairline starts under the name, as Reminders' does under a subtask's, so it stands in by the row's depth, each a column of the lead's scaled width, and by however much the lead has grown.
  const indent = depth * column + lead - MARK_SIZE.LEAD;

  const agentsMarked = props.agents !== undefined && props.agents.kind !== TASK_AGENTS_STATUS.NONE;

  // Note that a narrow column, such as an iPad's 320 pt list, cut a long name to its first word while its marks kept their room, so the agents' mark and then the sub-tasks' progress step aside first.
  const spared = useSparedMarks(id, [
    ...(agentsMarked ? [SPARED_MARK.AGENTS] : []),
    ...(props.subTasks === undefined ? [] : [SPARED_MARK.SUB_TASKS]),
  ]);

  const row: ReactElement = (
    <HStack modifiers={[padding({ leading: depth * column })]}>
      <RowHead
        dot={false}
        unread={unread}
        faded={finished}
        lead={<StatusRing status={status} menu={props.statusMenu} edge={ROW_INSET.PLAIN} />}
        title={name}
        ink={titleInk(colors, unread, finished)}
        fit={spared.fit}
        end={
          <HStack spacing={END_GAP}>
            {props.blocked === true ? (
              <ToneGlyph glyph={GLYPH.BLOCKED_BY} tone={STATUS_TONE.NEUTRAL} hidden />
            ) : null}
            {props.needsYou === true ? <NeedsYouDot /> : null}
            {props.subTasks === undefined || spared.aside.has(SPARED_MARK.SUB_TASKS) ? null : (
              <HStack
                modifiers={[
                  onGeometryChange(({ width }) => spared.measured(SPARED_MARK.SUB_TASKS)(width)),
                ]}
              >
                <SubTaskProgress done={props.subTasks.finished} total={props.subTasks.total} />
              </HStack>
            )}
            {!agentsMarked || spared.aside.has(SPARED_MARK.AGENTS) ? null : (
              <HStack
                modifiers={[
                  onGeometryChange(({ width }) => spared.measured(SPARED_MARK.AGENTS)(width)),
                ]}
              >
                <TaskAgentsMark agents={props.agents} />
              </HStack>
            )}
            {props.assignee === undefined ? null : (
              <Avatar
                name={props.assignee.name}
                id={props.assignee.id}
                picture={props.assignee.picture}
                size={MARK_SIZE.FACE}
              />
            )}
            {props.unassigned === true ? (
              <Image
                {...glyphImage(GLYPH.UNASSIGNED)}
                size={glyph}
                color={colors.TEXT_MUTED}
                modifiers={[accessibilityHidden(true)]}
              />
            ) : null}
            {props.at === undefined ? null : <RowTime at={props.at} now={minute} />}
            {taskKey === undefined ? null : (
              <Text
                modifiers={[
                  font({ textStyle: TYPE_ROLE.TIME }),
                  monospacedDigit(),
                  foregroundStyle(colors.TEXT_MUTED),
                  fixedSize(),
                ]}
              >
                {taskKey}
              </Text>
            )}
          </HStack>
        }
      />
    </HStack>
  );

  return (
    <RowFrame
      {...props}
      id={id}
      row={row}
      indent={indent}
      leading={ROW_INSET.PLAIN}
      menuActions={[...foldActions(fold, SUB_TASK_FOLD), ...(props.menuActions ?? [])]}
      heard={props.heard ?? taskHeard(props, minute)}
    />
  );
}
