// list-row.tsx -- the rows the Inbox and Tasks draw: plain and edge to edge, a 14 pt leading mark, a 15 pt title over a 13 pt muted line, and a hairline inset to the words.

import {
  Button,
  ContextMenu,
  HStack,
  Image,
  Menu,
  Spacer,
  SwipeActions,
  Text,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  accessibilityValue,
  alignmentGuide,
  background,
  buttonStyle,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparatorTint,
  monospacedDigit,
  padding,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { GLYPH_STATE, GLYPH_STATE_WORDS } from "@repo/features/glyph-state";
import { type InboxLineKind, NEEDS_YOU } from "@repo/features/inbox-list-model";
import { REMIND_WORDS } from "@repo/features/inbox-remind-times";
import { pullRequestMarkLabel, pullRequestMarkState } from "@repo/features/pull-request-model";
import { TASK_AGENTS_STATUS, type TaskAgentsStatus } from "@repo/features/task-agents-model";
import { TASK_PRIORITY_WORDS, TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import { TASK_PRIORITY, type TaskPriority, type TaskStatus } from "@repo/features/task-wire";
import { dueText, sinceHeard, sinceText } from "@repo/features/time-format";
import { VERB } from "@repo/features/words";
import { Predicate } from "effect";
import { type ReactElement, type ReactNode, useContext } from "react";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent, menuLabel } from "./glyph-label.js";
import { INBOX_LINE_LOOK, PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { cellFocusRingOff, dragLink } from "./interactions.js";
import {
  Avatar,
  type Face,
  FailedMark,
  NeedsYouDot,
  TaskPriorityMark,
  TaskStatusMark,
  ToneGlyph,
  UnreadDot,
  WorkingMark,
} from "./marks.js";
import { RowOpenContext, RowSelectedContext } from "./row-open.js";
import {
  type BrandColors,
  STATUS_TONE,
  type StatusTone,
  toneColor,
  useColors,
} from "./tokens/colors.js";
import { MARK_SIZE, ROW_INSET, SPACE } from "./tokens/space.js";
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

/** How a row's action reads: a plain gray, or a destructive red. Copper is kept for what wants the reader, so no act is drawn in it. */
export const ROW_ACTION_TONE = {
  NEUTRAL: "neutral",
  DESTRUCTIVE: "destructive",
} as const;

export type RowActionTone = (typeof ROW_ACTION_TONE)[keyof typeof ROW_ACTION_TONE];

export type RowAction = {
  /** The act's name, as the panel's menu names it: Mark done, Mark unread. */
  readonly label: string;
  readonly symbol: Glyph;
  readonly tone: RowActionTone;
  readonly onPress: () => void;
};

/** A choice of a menu, checked where it stands, beside its glyph where it has one, such as a status's mark, in its tone where it has one. */
export type MenuChoice = {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  /** The tone the glyph is drawn in, as a status's mark is in the panel's menu; the menu's own ink where none is given. */
  readonly tone?: StatusTone | undefined;
  /** A person's photo, as a file on this device, drawn round in the glyph's place, as the panel's assignee menu leads each member with their face. */
  readonly photo?: string | undefined;
  readonly on: boolean;
  readonly onPress: () => void;
};

/** A menu within a row's long press menu, such as a task's Status: its choices, each checked where it stands, as the system checks them, and the acts under them, such as a task's Remove from section. */
export type RowSubmenu = {
  readonly label: string;
  readonly symbol: Glyph;
  readonly choices: readonly MenuChoice[];
  readonly actions?: readonly RowAction[] | undefined;
};

/** What a swipe reveals: an act, or a menu of choices, such as a task's Status, which opens where the act would run. */
export type RowSwipe = RowAction | RowSubmenu;

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
  /** Acts the long press menu alone holds, last, such as Pin or Open in browser. */
  readonly menuActions?: readonly RowAction[] | undefined;
  /** What the long press lifts over its menu, a glance at what the row opens (`ThreadPreview`, `TaskPreview`, `AgentPreview`), as the system's own apps lift one. */
  readonly preview?: ReactElement | undefined;
  /** Its vespin.dev link, which a drag carries out of the row: into another app as a URL, or onto a section here (`ListSection`'s `onDropLink`). */
  readonly link?: string | undefined;
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
  /** Whether the thread is unread, which carries the dot and sets its title in medium. */
  readonly unread?: boolean | undefined;
  /** Whether the thread is done, which mutes its words. */
  readonly done?: boolean | undefined;
  /** The teammate a thread of someone else's waits on, whose face stands before the time. */
  readonly face?: Face | undefined;
  /** When it last changed, in epoch milliseconds, said as the panel's rows say it: "now", "5m", "3h". */
  readonly at?: number | undefined;
  /** What `at` counts from; now where none is given. */
  readonly now?: number | undefined;
  /** When a reminder the reader set on the thread comes back, in epoch milliseconds, said in the time's place as the panel's row says it: "3:04 PM", "Mon 9:00 AM". */
  readonly due?: number | undefined;
};

/** Whether a parent task's sub-tasks stand open under it, and what turns them. */
export type TaskFold = { readonly open: boolean; readonly onToggle: () => void };

type TaskRowProps = RowActs & {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  /** Its priority, whose mark leads the line before its status, as the panel's List row leads with it; none where the list draws no priority. */
  readonly priority?: TaskPriority | undefined;
  /** Whether the task has news unread, which carries the dot and sets its name in medium. */
  readonly unread?: boolean | undefined;
  /** Whether the task is done or canceled, which mutes its name, as a search finds one. */
  readonly finished?: boolean | undefined;
  /** Whether a thread of it waits on the reader, which its end says before anything of its agents. */
  readonly needsYou?: boolean | undefined;
  /** What its agents say at the line's end, as the panel's row end says it: failed, at work, or its pull request. */
  readonly agents?: TaskAgentsStatus | undefined;
  /** Its key, `ACME-42`, which ends the line. */
  readonly taskKey?: string | undefined;
  /** Its sub-tasks' fold, where it has sub-tasks: whether they stand open under it, and what its chevron's press does. Its caller holds it, since a recycled row holds no state (`RowForEach`). */
  readonly fold?: TaskFold | undefined;
  /** How deep it stands under the tasks above it, which sets it in from the list's edge. */
  readonly depth?: number | undefined;
};

/** A row's act as a button of its long press menu or its swipe: red where it takes something away, and in the muted ink otherwise. */
export function actionButton(action: RowAction, colors: BrandColors) {
  const destructive = action.tone === ROW_ACTION_TONE.DESTRUCTIVE;

  return (
    <Button
      key={action.label}
      {...actContent(action.label, action.symbol)}
      role={destructive ? "destructive" : "default"}
      onPress={action.onPress}
      modifiers={destructive ? [] : [tint(colors.TEXT_MUTED)]}
    />
  );
}

/** A menu choice's glyph's color: its tone's ink, where it has a tone. */
export function choiceColor(choice: MenuChoice, colors: BrandColors): string | undefined {
  return choice.tone === undefined ? undefined : toneColor(colors, choice.tone);
}

/** What a menu's choice holds: its words beside its photo, or its glyph in its tone, or its words alone. */
export function choiceContent(choice: MenuChoice, colors: BrandColors) {
  return actContent(
    choice.label,
    choice.symbol,
    undefined,
    choiceColor(choice, colors),
    choice.photo,
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
      {(submenu.actions ?? []).map((action) => actionButton(action, colors))}
    </Menu>
  );
}

/** A row's time, 12 pt in the muted ink and tabular figures, as the panel's rows end. */
export function RowTime({ at, now }: { readonly at: number; readonly now: number | undefined }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME }),
        monospacedDigit(),
        foregroundStyle(colors.TEXT_MUTED),
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

  return (
    <HStack spacing={SPACE.TIGHT}>
      <Image
        {...glyphImage(GLYPH.TIME)}
        size={MARK_SIZE.GLYPH - 4}
        color={colors.ACCENT_TEXT}
        modifiers={[accessibilityHidden(true)]}
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.TIME }),
          monospacedDigit(),
          foregroundStyle(colors.ACCENT_TEXT),
          accessibilityLabel(`${REMIND_WORDS.DUE} ${words}`),
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
 * stays inside the column's safe area, as Mail's rows do.
 */
export function rowPlacement(
  colors: BrandColors,
  selected = false,
  vertical: number = ROW_INSET.VERTICAL,
  text: number = ROW_INSET.TEXT,
) {
  return [
    listRowBackground("clear"),
    listRowInsets({ leading: 0, trailing: 0, top: 0, bottom: 0 }),
    padding({ leading: ROW_INSET.LEADING, trailing: SPACE.EDGE, top: vertical, bottom: vertical }),
    ...(selected ? [background(colors.SELECTED)] : []),
    listRowSeparatorTint(colors.CHIP_EDGE),
    alignmentGuide("listRowSeparatorLeading", text),
  ];
}

/** Whether a full swipe from an edge runs its first act: never where that act is destructive, such as Archive, which then waits for its button's tap, nor where it is a menu. */
function fullSwipes(swipes: readonly RowSwipe[]): boolean {
  const first = swipes[0];

  return first !== undefined && !isSubmenu(first) && first.tone !== ROW_ACTION_TONE.DESTRUCTIVE;
}

/** A swipe's piece as SwiftUI draws it behind the row: an act's button, or a menu's, in the muted ink. */
function swipeButton(swipe: RowSwipe, colors: BrandColors) {
  return isSubmenu(swipe)
    ? rowSubmenu(swipe, colors, colors.TEXT_MUTED)
    : actionButton(swipe, colors);
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
 * acts only it offers. A row with a link is dragged out as it, on an iPad
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
  preview,
  link,
  vertical,
  text,
}: RowActs & {
  readonly id: string;
  readonly row: ReactElement;
  /** The row's top and bottom inset, where it stands roomier than the list's own, as an Inbox thread does. */
  readonly vertical?: number | undefined;
  /** Where its words, and so its hairline, start, where a second mark before them sets them further in than the list's own. */
  readonly text?: number | undefined;
}) {
  const colors = useColors();
  const open = useContext(RowOpenContext);
  const selected = useContext(RowSelectedContext) === id;
  const swiped = [...trailingActions, ...leadingActions];

  // Note that a heard row is one element, its children's acts kept as its own, so VoiceOver offers a swipe's acts in its Actions rotor and its menu by a long press, as it does the system's rows.
  const frameModifiers = [
    tag(id),
    ...rowPlacement(colors, selected, vertical, text),
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

  if (swiped.length + menuSubmenus.length + menuActions.length === 0 && preview === undefined) {
    return <HStack modifiers={frameModifiers}>{row}</HStack>;
  }

  const opening: readonly RowAction[] =
    preview === undefined || open === undefined
      ? []
      : [
          {
            label: VERB.OPEN,
            symbol: GLYPH.OPEN_EXTERNALLY,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => open(id),
          },
        ];

  const menu = (
    <ContextMenu>
      <ContextMenu.Items>
        {opening.map((action) => actionButton(action, colors))}
        {swiped.map((swipe) => swipeButton(swipe, colors))}
        {menuSubmenus.map((submenu) => rowSubmenu(submenu, colors))}
        {menuActions.map((action) => actionButton(action, colors))}
      </ContextMenu.Items>
      <ContextMenu.Trigger>{row}</ContextMenu.Trigger>
      {preview === undefined ? null : <ContextMenu.Preview>{preview}</ContextMenu.Preview>}
    </ContextMenu>
  );

  // Note that a row with no swipe stands its menu in a plain frame, since a swipe with no acts has nothing to reveal.
  if (swiped.length === 0) return <HStack modifiers={frameModifiers}>{menu}</HStack>;

  return (
    <SwipeActions modifiers={frameModifiers}>
      {menu}
      {trailingActions.length === 0 ? null : (
        <SwipeActions.Actions edge="trailing" allowsFullSwipe={fullSwipes(trailingActions)}>
          {trailingActions.map((swipe) => swipeButton(swipe, colors))}
        </SwipeActions.Actions>
      )}
      {leadingActions.length === 0 ? null : (
        <SwipeActions.Actions edge="leading" allowsFullSwipe={fullSwipes(leadingActions)}>
          {leadingActions.map((swipe) => swipeButton(swipe, colors))}
        </SwipeActions.Actions>
      )}
    </SwipeActions>
  );
}

/**
 * A row's first line: the unread dot in the margin, the leading mark in its
 * column, the title, and what ends the line. The line centers its pieces,
 * so the mark stands on the title at any Dynamic Type size, and at an
 * accessibility size stacks its end under the title, the mark's column
 * growing with the words.
 */
export function RowHead({
  unread,
  faded,
  mark,
  lead,
  title,
  ink,
  end,
}: {
  readonly unread: boolean;
  readonly faded: boolean;
  /** A mark before the lead, in a column of the lead's width, as a task row's priority stands before its status. */
  readonly mark?: ReactNode;
  readonly lead: ReactNode;
  readonly title: string;
  readonly ink: string;
  readonly end: ReactNode;
}) {
  const lines = useRowLines();
  const stacked = useAccessibilitySize();
  const leadWidth = useScaledSize(MARK_SIZE.LEAD);

  const words = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: unread ? "medium" : "regular" }),
        foregroundStyle(ink),
        lineLimit(lines.title),
      ]}
    >
      {title}
    </Text>
  );

  // Note that at an accessibility size the line's end stands under the title rather than beside it, as Mail's rows stack their date, so the title keeps the row's width rather than wrapping a word to a line.
  return (
    <HStack spacing={SPACE.TIGHT} alignment="center">
      <UnreadDot unread={unread} faded={faded} />
      <HStack spacing={SPACE.ROW} alignment={stacked ? "top" : "center"}>
        {mark === undefined ? null : (
          <HStack modifiers={[frame({ width: leadWidth })]}>{mark}</HStack>
        )}
        <HStack modifiers={[frame({ width: leadWidth })]}>{lead}</HStack>
        {stacked ? (
          <VStack alignment="leading" spacing={2}>
            {words}
            {end}
          </VStack>
        ) : (
          words
        )}
        <Spacer />
        {stacked ? null : end}
      </HStack>
    </HStack>
  );
}

/** The ink a row's title stands in: muted once done, the full ink while unread, and the body's at rest. */
function titleInk(colors: BrandColors, unread: boolean, done: boolean): string {
  if (done) return colors.TEXT_MUTED;

  return unread ? colors.TEXT : colors.TEXT_BODY;
}

/** A line's glyph at the line's 13 pt, growing with Dynamic Type, in its tone's ink: the accent's for an ask that waits on you, the muted ink for the rest. It is never heard, since the line's words say what it marks. */
function LineGlyph({ line }: { readonly line: InboxLineKind | undefined }) {
  const look = line === undefined ? undefined : INBOX_LINE_LOOK[line];

  if (look === undefined) return null;

  return <ToneGlyph glyph={look.symbol} tone={look.tone} textStyle={TYPE_ROLE.ROW_LINE} hidden />;
}

/**
 * An Inbox row's first line, over the title: the task's status ring in the
 * lead column and the task's name, 13 pt in the muted ink, as the panel's row
 * heads its title with the task. The unread dot's column stands empty, so
 * the dot keeps its place beside the title.
 */
function TaskLine({ task }: { readonly task: NonNullable<ListRowProps["task"]> }) {
  const colors = useColors();
  const lines = useRowLines();
  const leadWidth = useScaledSize(MARK_SIZE.LEAD);

  return (
    <HStack spacing={SPACE.TIGHT} alignment="center">
      <UnreadDot unread={false} />
      <HStack spacing={SPACE.ROW} alignment="center">
        <HStack modifiers={[frame({ width: leadWidth })]}>
          {task.status === undefined ? null : <TaskStatusMark status={task.status} />}
        </HStack>
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT_MUTED),
            lineLimit(lines.line),
          ]}
        >
          {task.name}
        </Text>
        <Spacer />
      </HStack>
    </HStack>
  );
}

/**
 * An Inbox row's last line, under the title: an ask's glyph, where the task's
 * line leads the row rather than it, and the thread's last words, 13 pt in
 * the muted ink, as the panel's row reads: only the ask's glyph stands in the
 * attention ink.
 */
function ThreadLine(props: ListRowProps & { readonly glyph: boolean }) {
  const { line, summary, glyph } = props;
  const colors = useColors();
  const lines = useRowLines();
  const words = summary?.trim() === "" ? undefined : summary;

  if (words === undefined) return null;

  return (
    <HStack
      spacing={SPACE.TIGHT + 1}
      alignment="center"
      modifiers={[padding({ leading: ROW_INSET.TEXT - ROW_INSET.LEADING })]}
    >
      {glyph ? <LineGlyph line={line} /> : null}
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(lines.line),
        ]}
      >
        {words}
      </Text>
      <Spacer />
    </HStack>
  );
}

/**
 * One Inbox thread, in the panel's three lines: its task, the task's status
 * ring and name in a 13 pt muted line; its title in 15 pt with the time at
 * the line's end and the copper dot in the margin while it is unread; and
 * the glyph and words of what it asks, in a 13 pt muted line. An agent's own
 * thread, which has no task, stands in two, the glyph of what it asks
 * leading its title. A teammate's face stands before the time on a thread
 * that waits on them, and a thread put away until a reminder says when it
 * comes back in its time's place, as the panel's row does. It stands
 * roomier than a task's row, with Mail's breathing room above, below, and
 * between its lines.
 */
export function ListRow(props: ListRowProps) {
  const { id, title, task, line, unread = false, done = false, face, at, now, due } = props;
  const colors = useColors();

  const row: ReactElement = (
    <VStack alignment="leading" spacing={ROW_INSET.THREAD_LINE_GAP}>
      {task === undefined ? null : <TaskLine task={task} />}
      <RowHead
        unread={unread}
        faded={done}
        lead={task === undefined ? <LineGlyph line={line} /> : null}
        title={title}
        ink={titleInk(colors, unread, done)}
        end={
          <HStack spacing={SPACE.TIGHT + 2}>
            {face === undefined ? null : (
              <Avatar name={face.name} picture={face.picture} size={MARK_SIZE.FACE} />
            )}
            {due !== undefined ? (
              <RowDue due={due} now={now} />
            ) : at === undefined ? null : (
              <RowTime at={at} now={now} />
            )}
          </HStack>
        }
      />
      <ThreadLine {...props} glyph={task !== undefined} />
    </VStack>
  );

  return (
    <RowFrame
      {...props}
      id={id}
      row={row}
      heard={props.heard ?? threadHeard(props)}
      vertical={ROW_INSET.THREAD_VERTICAL}
    />
  );
}

/** What VoiceOver hears of an Inbox row: its title, then unread, what waits on you, its last words, its task and the task's status, whom it waits on, and when. */
function threadHeard(props: ListRowProps): RowHeard {
  const { title, task, line, summary, unread = false, face, at, now, due } = props;
  const asks = line !== undefined && INBOX_LINE_LOOK[line]?.tone === STATUS_TONE.ATTENTION;
  const moment = now ?? Date.now();

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

/** What a task row is heard as: its name, then unread, its status, its priority where it has one, a thread that needs you, its agents, its key, and whether its sub-tasks are open. */
function taskHeard(props: TaskRowProps): RowHeard {
  const { name, status, priority, unread = false, needsYou = false, agents, taskKey, fold } = props;

  return {
    label: name,
    value: [
      unread && UNREAD_WORDS,
      TASK_STATUS_WORDS[status],
      priority !== undefined && priority !== TASK_PRIORITY.NONE && TASK_PRIORITY_WORDS[priority],
      needsYou && NEEDS_YOU.LABEL,
      agentsHeard(agents),
      taskKey,
      fold !== undefined && (fold.open ? SUB_TASKS_SHOWN : SUB_TASKS_HIDDEN),
    ],
  };
}

/** What a task row's end says first: a thread that needs the reader, then a failed agent, one at work, or its pull request's state. */
function TaskEndMark({ needsYou = false, agents }: Pick<TaskRowProps, "needsYou" | "agents">) {
  if (needsYou) return <NeedsYouDot />;

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

/** How far each level of sub-tasks stands in, in points: past a parent's mark, so a sub-task's mark stands under its parent's name. */
const SUB_TASK_INDENT = MARK_SIZE.LEAD + SPACE.ROW;

/** Where a task row's words start where its priority's mark stands before its status: a lead's column further in. */
const PRIORITY_TEXT_INSET = ROW_INSET.TEXT + MARK_SIZE.LEAD + SPACE.ROW;

/** What a parent's chevron is heard as, folded and open. */
const SHOW_SUB_TASKS = "Show sub-tasks";
const HIDE_SUB_TASKS = "Hide sub-tasks";

/** A parent's fold in its ring's place: a chevron that opens its sub-tasks under it, so a press on the row itself still opens the task. */
function SubTaskFold({ open, onPress }: { readonly open: boolean; readonly onPress: () => void }) {
  const colors = useColors();

  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle("borderless"),
        accessibilityLabel(open ? HIDE_SUB_TASKS : SHOW_SUB_TASKS),
      ]}
    >
      <Image
        {...glyphImage(open ? GLYPH.UNFOLDED : GLYPH.FOLDED)}
        size={MARK_SIZE.GLYPH - 4}
        color={colors.TEXT_MUTED}
        modifiers={[frame({ width: MARK_SIZE.LEAD, height: MARK_SIZE.LEAD })]}
      />
    </Button>
  );
}

/**
 * One task on a single line, as Linear's rows stand: the dot while it has
 * news, its priority's mark where its list draws one, its status ring, its name in 15 pt, and at the line's end what its
 * agents say and its key. A task with sub-tasks leads with the panel's fold
 * in its ring's place, whose press opens them; its caller draws them as rows
 * of their own under it, a level deeper. Note that SwiftUI's disclosure is
 * not used, because a press on its row folds it rather than picking the row.
 */
export function TaskRow(props: TaskRowProps) {
  const {
    id,
    name,
    status,
    priority,
    unread = false,
    finished = false,
    taskKey,
    fold,
    depth = 0,
  } = props;

  const colors = useColors();

  const row: ReactElement = (
    <HStack modifiers={[padding({ leading: depth * SUB_TASK_INDENT })]}>
      <RowHead
        unread={unread}
        faded={finished}
        mark={priority === undefined ? undefined : <TaskPriorityMark priority={priority} />}
        lead={
          fold === undefined ? (
            <TaskStatusMark status={status} />
          ) : (
            <SubTaskFold open={fold.open} onPress={fold.onToggle} />
          )
        }
        title={name}
        ink={titleInk(colors, unread, finished)}
        end={
          <HStack spacing={SPACE.TIGHT + 2}>
            <TaskEndMark needsYou={props.needsYou} agents={props.agents} />
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

  // Note that the fold stands in the row's menu too, so a person who reaches the row as one element, through VoiceOver or Voice Control, still opens its sub-tasks.
  const folding: readonly RowAction[] =
    fold === undefined
      ? []
      : [
          {
            label: fold.open ? HIDE_SUB_TASKS : SHOW_SUB_TASKS,
            symbol: fold.open ? GLYPH.UNFOLDED : GLYPH.FOLDED,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: fold.onToggle,
          },
        ];

  return (
    <RowFrame
      {...props}
      id={id}
      row={row}
      text={priority === undefined ? undefined : PRIORITY_TEXT_INSET}
      menuActions={[...folding, ...(props.menuActions ?? [])]}
      heard={props.heard ?? taskHeard(props)}
    />
  );
}
