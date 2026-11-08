// list-row.tsx -- a row as the panel draws one in the Inbox and Tasks: unread dot, status mark or avatar, title, a muted preview with its glyph, and a time.

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
  monospacedDigit,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { sinceText } from "@repo/features/time-format";
import type { ReactElement } from "react";
import { Avatar, TaskStatusMark, UnreadDot } from "./marks.js";
import type { SfSymbol } from "./sf-symbol.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";

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

type ListRowProps = {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  readonly title: string;
  /** The last word in its thread, or where it stands, drawn muted under the title. */
  readonly preview?: string | undefined;
  /** The glyph leading the preview: what the last word was, such as a pull request or an ask. */
  readonly previewSymbol?: SfSymbol | undefined;
  /** Whether the row leads with the unread dot; a row that is never unread leaves this out. */
  readonly unread?: boolean | undefined;
  /** The task's status, drawn as its mark ahead of the title. */
  readonly status?: TaskStatus | undefined;
  /** The name whose avatar the row leads with, where no status does. */
  readonly avatar?: string | undefined;
  /** When it last changed, in epoch milliseconds, said as the panel's rows say it: "now", "5m", "3h". */
  readonly at?: number | undefined;
  /** What `at` counts from; now where none is given. */
  readonly now?: number | undefined;
  /** The acts a swipe from the trailing edge reveals, the first of them on a full swipe. */
  readonly trailingActions?: readonly RowAction[] | undefined;
  /** The acts a swipe from the leading edge reveals. */
  readonly leadingActions?: readonly RowAction[] | undefined;
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

function RowLead({ status, avatar }: Pick<ListRowProps, "status" | "avatar">) {
  if (status !== undefined) return <TaskStatusMark status={status} />;
  if (avatar !== undefined) return <Avatar name={avatar} />;
  return null;
}

function RowBody(props: ListRowProps & { readonly colors: BrandColors }) {
  const { title, preview, previewSymbol, at, now, colors } = props;
  return (
    <VStack alignment="leading" spacing={2}>
      <HStack spacing={SPACE.ROW} alignment="firstTextBaseline">
        <Text modifiers={[font({ textStyle: "body", weight: "semibold" }), lineLimit(1)]}>
          {title}
        </Text>
        <Spacer />
        {at === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: "subheadline" }),
              monospacedDigit(),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {sinceText(at, now ?? Date.now())}
          </Text>
        )}
      </HStack>
      {preview === undefined ? null : (
        <HStack spacing={SPACE.TIGHT} alignment="firstTextBaseline">
          {previewSymbol === undefined ? null : (
            <Image
              systemName={previewSymbol}
              size={MARK_SIZE.GLYPH - 2}
              color={colors.TEXT_MUTED}
            />
          )}
          <Text
            modifiers={[
              font({ textStyle: "subheadline" }),
              foregroundStyle(colors.TEXT_MUTED),
              lineLimit(2),
            ]}
          >
            {preview}
          </Text>
        </HStack>
      )}
    </VStack>
  );
}

/**
 * One row of a `RowList`. Its acts stand twice, as the system's own rows
 * carry them: behind a swipe from either edge, and in the menu a long press
 * opens, the trailing ones first, so a person who never swipes still finds
 * them.
 */
export function ListRow(props: ListRowProps) {
  const { id, unread, status, avatar, trailingActions = [], leadingActions = [] } = props;
  const colors = useColors();
  const actions = [...trailingActions, ...leadingActions];
  const row: ReactElement = (
    <HStack spacing={SPACE.ROW} alignment="center">
      {unread === undefined ? null : <UnreadDot unread={unread} />}
      <RowLead status={status} avatar={avatar} />
      <RowBody {...props} colors={colors} />
    </HStack>
  );
  if (actions.length === 0) return <HStack modifiers={[tag(id)]}>{row}</HStack>;
  return (
    <SwipeActions modifiers={[tag(id)]}>
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
