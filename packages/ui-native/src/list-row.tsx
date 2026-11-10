// list-row.tsx -- the rows the Inbox and Tasks draw: plain and edge to edge, a 14 pt leading mark, a 15 pt title over a 13 pt muted line, and a hairline inset to the words.

import { Button, ContextMenu, HStack, Spacer, SwipeActions, Text, VStack } from "@expo/ui/swift-ui";
import {
  alignmentGuide,
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
import type { PullRequestState } from "@repo/features/agent-wire";
import type { InboxLineKind } from "@repo/features/inbox-list-model";
import type { TaskStatus } from "@repo/features/task-wire";
import { sinceText } from "@repo/features/time-format";
import type { ReactElement, ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { INBOX_LINE_LOOK, PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { Avatar, TaskStatusMark, ToneGlyph, UnreadDot } from "./marks.js";
import type { SfSymbol } from "./sf-symbol.js";
import { type BrandColors, STATUS_TONE, useColors } from "./tokens/colors.js";
import { MARK_SIZE, ROW_INSET, SPACE } from "./tokens/space.js";
import { ACCESSIBILITY_SCALE, TYPE_ROLE } from "./tokens/type.js";

/** How many lines a row's title and its line take: one each at the standard sizes, and more at an accessibility size, so they still read. */
const ROW_LINES = {
  STANDARD: { title: 1, line: 1 },
  ACCESSIBILITY: { title: 3, line: 2 },
} as const;

/** The lines a row's words take at the reader's text size. */
function useRowLines(): (typeof ROW_LINES)[keyof typeof ROW_LINES] {
  const { fontScale } = useWindowDimensions();
  return fontScale > ACCESSIBILITY_SCALE ? ROW_LINES.ACCESSIBILITY : ROW_LINES.STANDARD;
}

/** What parts a row's line from the task it names. */
const LINE_PART = " · ";

/** How a row's action reads: the accent, a plain gray, or a destructive red. */
export const ROW_ACTION_TONE = {
  ACCENT: "accent",
  NEUTRAL: "neutral",
  DESTRUCTIVE: "destructive",
} as const;

export type RowActionTone = (typeof ROW_ACTION_TONE)[keyof typeof ROW_ACTION_TONE];

export type RowAction = {
  /** The act's name, as the panel's menu names it: Mark done, Mark unread. */
  readonly label: string;
  readonly symbol: SfSymbol;
  readonly tone: RowActionTone;
  readonly onPress: () => void;
};

/** The acts a row carries: a swipe from either edge, and the same acts in its long press menu. */
type RowActs = {
  /** The acts a swipe from the trailing edge reveals, the first of them on a full swipe. */
  readonly trailingActions?: readonly RowAction[] | undefined;
  /** The acts a swipe from the leading edge reveals. */
  readonly leadingActions?: readonly RowAction[] | undefined;
};

type ListRowProps = RowActs & {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  /** The thread's title, the row's first line. */
  readonly title: string;
  /** What holds the thread: its task, whose status ring leads the row and whose name ends its line, or an agent's own by its name alone. */
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
  readonly face?: string | undefined;
  /** When it last changed, in epoch milliseconds, said as the panel's rows say it: "now", "5m", "3h". */
  readonly at?: number | undefined;
  /** What `at` counts from; now where none is given. */
  readonly now?: number | undefined;
};

type TaskRowProps = RowActs & {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  /** Whether the task has news unread, which carries the dot and sets its name in medium. */
  readonly unread?: boolean | undefined;
  /** Its pull request's state, drawn as the mark before the time. */
  readonly pullRequest?: PullRequestState | undefined;
  readonly at?: number | undefined;
  readonly now?: number | undefined;
};

function actionButton(action: RowAction, colors: BrandColors) {
  const destructive = action.tone === ROW_ACTION_TONE.DESTRUCTIVE;
  const ink = action.tone === ROW_ACTION_TONE.ACCENT ? colors.ACCENT : colors.TEXT_MUTED;
  return (
    <Button
      key={action.label}
      label={action.label}
      systemImage={action.symbol}
      role={destructive ? "destructive" : "default"}
      onPress={action.onPress}
      modifiers={destructive ? [] : [tint(ink)]}
    />
  );
}

/** A row's time, 12 pt in the muted ink and tabular figures, as the panel's rows end. */
function RowTime({ at, now }: { readonly at: number; readonly now: number | undefined }) {
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

/**
 * A row's frame in its list: the id its list picks it by, the list's own
 * ground behind it rather than a card's, its insets, which stand the unread
 * dot in the margin, and its hairline, which starts under the words rather
 * than the mark. Its acts stand twice, as the system's own rows carry them:
 * behind a swipe from either edge, and in the menu a long press opens, the
 * trailing ones first, so a person who never swipes still finds them.
 */
export function RowFrame({
  id,
  row,
  trailingActions = [],
  leadingActions = [],
}: RowActs & {
  readonly id: string;
  readonly row: ReactElement;
}) {
  const colors = useColors();
  const actions = [...trailingActions, ...leadingActions];
  const frameModifiers = [
    tag(id),
    listRowBackground("clear"),
    listRowInsets({
      leading: ROW_INSET.LEADING,
      trailing: SPACE.EDGE,
      top: ROW_INSET.VERTICAL,
      bottom: ROW_INSET.VERTICAL,
    }),
    listRowSeparatorTint(colors.CHIP_EDGE),
    alignmentGuide("listRowSeparatorLeading", ROW_INSET.TEXT - ROW_INSET.LEADING),
  ];
  if (actions.length === 0) return <HStack modifiers={frameModifiers}>{row}</HStack>;
  return (
    <SwipeActions modifiers={frameModifiers}>
      <ContextMenu>
        <ContextMenu.Items>
          {actions.map((action) => actionButton(action, colors))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>{row}</ContextMenu.Trigger>
      </ContextMenu>
      {trailingActions.length === 0 ? null : (
        <SwipeActions.Actions edge="trailing">
          {trailingActions.map((action) => actionButton(action, colors))}
        </SwipeActions.Actions>
      )}
      {leadingActions.length === 0 ? null : (
        <SwipeActions.Actions edge="leading">
          {leadingActions.map((action) => actionButton(action, colors))}
        </SwipeActions.Actions>
      )}
    </SwipeActions>
  );
}

/**
 * A row's first line: the unread dot in the margin, the leading mark in its
 * column, the title, and what ends the line. The line centers its pieces,
 * so the mark stands on the title at any Dynamic Type size.
 */
export function RowHead({
  unread,
  faded,
  lead,
  title,
  ink,
  end,
}: {
  readonly unread: boolean;
  readonly faded: boolean;
  readonly lead: ReactNode;
  readonly title: string;
  readonly ink: string;
  readonly end: ReactNode;
}) {
  const lines = useRowLines();
  return (
    <HStack spacing={SPACE.TIGHT} alignment="center">
      <UnreadDot unread={unread} faded={faded} />
      <HStack spacing={SPACE.ROW} alignment="center">
        <HStack modifiers={[frame({ width: MARK_SIZE.LEAD })]}>{lead}</HStack>
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: unread ? "medium" : "regular" }),
            foregroundStyle(ink),
            lineLimit(lines.title),
          ]}
        >
          {title}
        </Text>
        <Spacer />
        {end}
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
 * An Inbox row's second line, under the title: an ask's glyph, where the
 * row's lead is the task's ring rather than it, the thread's last words, in
 * the accent where they are an ask waiting on you, and the task's name after
 * them, all 13 pt in the muted ink.
 */
function ThreadLine(props: ListRowProps & { readonly glyph: boolean }) {
  const { line, summary, task, glyph } = props;
  const colors = useColors();
  const lines = useRowLines();
  const look = line === undefined ? undefined : INBOX_LINE_LOOK[line];
  const asks = look?.tone === STATUS_TONE.ATTENTION;
  const words = summary?.trim() === "" ? undefined : summary;
  if (words === undefined && task === undefined) return null;
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
        {words === undefined ? null : (
          <Text modifiers={[foregroundStyle(asks ? colors.ACCENT_TEXT : colors.TEXT_MUTED)]}>
            {words}
          </Text>
        )}
        {task === undefined ? null : (
          <Text>{words === undefined ? task.name : `${LINE_PART}${task.name}`}</Text>
        )}
      </Text>
      <Spacer />
    </HStack>
  );
}

/**
 * One Inbox thread: the copper dot in the margin while it is unread, its
 * task's status ring leading it (or, on an agent's own thread, the glyph of
 * what it asks), its title in 15 pt with the time at the line's end, and
 * under it the glyph and words of what it asks, then the task's name, in a
 * 13 pt muted line. A teammate's face stands before the time on a thread
 * that waits on them.
 */
export function ListRow(props: ListRowProps) {
  const { id, title, task, line, unread = false, done = false, face, at, now } = props;
  const colors = useColors();
  const ring = task?.status === undefined ? undefined : <TaskStatusMark status={task.status} />;
  const row: ReactElement = (
    <VStack alignment="leading" spacing={2}>
      <RowHead
        unread={unread}
        faded={done}
        lead={ring ?? <LineGlyph line={line} />}
        title={title}
        ink={titleInk(colors, unread, done)}
        end={
          <HStack spacing={SPACE.TIGHT + 2}>
            {face === undefined ? null : <Avatar name={face} size={MARK_SIZE.FACE} />}
            {at === undefined ? null : <RowTime at={at} now={now} />}
          </HStack>
        }
      />
      <ThreadLine {...props} glyph={ring !== undefined} />
    </VStack>
  );
  return <RowFrame {...props} id={id} row={row} />;
}

/**
 * One task on a single line: the dot while it has news, its status ring,
 * its name in 15 pt, and at the line's end its pull request's mark and the
 * time.
 */
export function TaskRow(props: TaskRowProps) {
  const { id, name, status, unread = false, pullRequest, at, now } = props;
  const colors = useColors();
  const pull = pullRequest === undefined ? undefined : PULL_REQUEST_LOOK[pullRequest];
  const row: ReactElement = (
    <RowHead
      unread={unread}
      faded={false}
      lead={<TaskStatusMark status={status} />}
      title={name}
      ink={titleInk(colors, unread, false)}
      end={
        <HStack spacing={SPACE.TIGHT + 2}>
          {pull === undefined ? null : <ToneGlyph glyph={pull.symbol} tone={pull.tone} />}
          {at === undefined ? null : <RowTime at={at} now={now} />}
        </HStack>
      }
    />
  );
  return <RowFrame {...props} id={id} row={row} />;
}
