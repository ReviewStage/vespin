// list-row.tsx -- the rows the panel draws in the Inbox and Tasks: an Inbox thread's three lines, and a task's one.

import {
  Button,
  ContextMenu,
  HStack,
  Image,
  Spacer,
  SwipeActions,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  lineLimit,
  listRowBackground,
  listRowSeparator,
  monospacedDigit,
  padding,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { PullRequestState } from "@repo/features/agent-wire";
import type { TaskStatus } from "@repo/features/task-wire";
import { sinceText } from "@repo/features/time-format";
import type { ReactElement } from "react";
import { INBOX_LINE_LOOK, type InboxLine, PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { Avatar, TaskStatusMark, UnreadDot } from "./marks.js";
import type { SfSymbol } from "./sf-symbol.js";
import { type BrandColors, toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";

/** How far the unread dot stands down, so it centers on the row's first line rather than the row. */
const DOT_DROP = 6;

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
  /** The thread's title, the row's second line. */
  readonly title: string;
  /** The task the thread stands in, named on the first line after its status ring. */
  readonly task?: { readonly name: string; readonly status: TaskStatus } | undefined;
  /** What the thread's last line is, which picks the glyph leading it. */
  readonly line?: InboxLine | undefined;
  /** The thread's last line: an ask's options or steps, or the last message's words. */
  readonly summary?: string | undefined;
  /** Whether the thread is unread, which leads it with the dot and sets its words in the full ink. */
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
  /** Whether the task has news unread, which sets its name in semibold. */
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

/** A row's time, in the caption's muted ink and tabular figures, as the panel's rows end. */
function RowTime({
  at,
  now,
  colors,
}: {
  at: number;
  now: number | undefined;
  colors: BrandColors;
}) {
  return (
    <Text
      modifiers={[
        font({ textStyle: "caption" }),
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
 * ground behind it rather than a card's, no rule between it and the next, as
 * the panel's rows stand, and its acts. They stand twice, as
 * the system's own rows carry them: behind a swipe from either edge, and in
 * the menu a long press opens, the trailing ones first, so a person who never
 * swipes still finds them.
 */
function RowFrame({
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
  const frame = [tag(id), listRowBackground("clear"), listRowSeparator("hidden")];
  if (actions.length === 0) return <HStack modifiers={frame}>{row}</HStack>;
  return (
    <SwipeActions modifiers={frame}>
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

/** The ink a row's words stand in: muted once done, full while unread, and the sidebar's ink at rest. */
function wordsInk(colors: BrandColors, unread: boolean, done: boolean): string {
  if (done) return colors.TEXT_MUTED;
  return unread ? colors.TEXT : colors.SIDEBAR_INK;
}

/** An Inbox row's first line: its task's status ring and name, then the teammate's face and the time. */
function ThreadHead(props: ListRowProps & { readonly colors: BrandColors; readonly ink: string }) {
  const { task, face, at, now, colors, ink } = props;
  return (
    <HStack spacing={SPACE.TIGHT + 2} alignment="center">
      {task === undefined ? null : <TaskStatusMark status={task.status} />}
      {task === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: "semibold" }),
            foregroundStyle(ink),
            lineLimit(1),
          ]}
        >
          {task.name}
        </Text>
      )}
      <Spacer />
      {face === undefined ? null : <Avatar name={face} size={MARK_SIZE.FACE} />}
      {at === undefined ? null : <RowTime at={at} now={now} colors={colors} />}
    </HStack>
  );
}

/** An Inbox row's last line: the glyph of what it is, then its words. */
function ThreadLine(props: ListRowProps & { readonly colors: BrandColors }) {
  const { line, summary, unread = false, colors } = props;
  const look = line === undefined ? undefined : INBOX_LINE_LOOK[line];
  if (summary === undefined) return null;
  return (
    <HStack spacing={SPACE.TIGHT} alignment="firstTextBaseline">
      {look === undefined ? null : (
        <Image
          systemName={look.symbol}
          color={toneColor(colors, look.tone)}
          modifiers={[font({ textStyle: "caption" })]}
        />
      )}
      <Text
        modifiers={[
          font({ textStyle: "caption" }),
          foregroundStyle(unread ? colors.TEXT : colors.TEXT_MUTED),
          lineLimit(1),
        ]}
      >
        {summary}
      </Text>
    </HStack>
  );
}

/**
 * One Inbox thread, as the panel's Inbox row draws it: the unread dot in its
 * own column, then the task's status ring and name with the time at the
 * line's end, the thread's title, and the glyph of what the thread asks with
 * its words. No avatar leads it; a teammate's face stands before the time on
 * a thread that waits on them.
 */
export function ListRow(props: ListRowProps) {
  const { id, title, unread = false, done = false } = props;
  const colors = useColors();
  const ink = wordsInk(colors, unread, done);
  const row: ReactElement = (
    <HStack spacing={SPACE.ROW} alignment="top">
      <VStack modifiers={[padding({ top: DOT_DROP })]}>
        <UnreadDot unread={unread} faded={done} />
      </VStack>
      <VStack alignment="leading" spacing={3}>
        <ThreadHead {...props} colors={colors} ink={ink} />
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: unread ? "semibold" : "regular" }),
            foregroundStyle(ink),
            lineLimit(1),
          ]}
        >
          {title}
        </Text>
        <ThreadLine {...props} colors={colors} />
      </VStack>
    </HStack>
  );
  return <RowFrame {...props} id={id} row={row} />;
}

/**
 * One task, as the panel's Tasks list draws it on a phone: its status ring,
 * its name, and at the line's end its pull request's mark and the time.
 */
export function TaskRow(props: TaskRowProps) {
  const { id, name, status, unread = false, pullRequest, at, now } = props;
  const colors = useColors();
  const pull = pullRequest === undefined ? undefined : PULL_REQUEST_LOOK[pullRequest];
  const row: ReactElement = (
    <HStack spacing={SPACE.ROW} alignment="center">
      <TaskStatusMark status={status} />
      <Text
        modifiers={[
          font({ textStyle: "body", weight: unread ? "semibold" : "regular" }),
          foregroundStyle(unread ? colors.TEXT : colors.SIDEBAR_INK),
          lineLimit(1),
        ]}
      >
        {name}
      </Text>
      <Spacer />
      {pull === undefined ? null : (
        <Image
          systemName={pull.symbol}
          color={toneColor(colors, pull.tone)}
          modifiers={[font({ textStyle: "caption" })]}
        />
      )}
      {at === undefined ? null : <RowTime at={at} now={now} colors={colors} />}
    </HStack>
  );
  return <RowFrame {...props} id={id} row={row} />;
}
