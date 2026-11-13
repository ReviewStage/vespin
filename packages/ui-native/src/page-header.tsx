// page-header.tsx -- the heading a detail page opens with under its bar: its title, its fields as chips, and a line.

import { HStack, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  font,
  foregroundStyle,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { useAccessibilitySize } from "./accessibility.js";
import { FieldChip, type FieldMenu, FollowingChip, StatusChip } from "./button.js";
import { GLYPH } from "./glyph.js";
import type { Face } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

type PageHeaderProps = {
  readonly title: string;
  /** A line under the chips: where the thing stands, or what it asks. */
  readonly summary?: string | undefined;
  /** A task's status, drawn as its chip under the title. */
  readonly status?: TaskStatus | undefined;
  /** A task's priority, drawn as a chip after its status. */
  readonly priority?: string | undefined;
  /** Who a task is assigned to, drawn as a chip with their face, or the words for no one beside an empty face. */
  readonly assignee?: (Face & { readonly nobody: boolean }) | undefined;
  /** Who follows a task, drawn as a chip under its fields that opens them; none while its workspace has Following off. */
  readonly following?: PageFollowing | undefined;
  /** What a press on each of a task's chips offers, where the reader may change that field; a chip with none only says. */
  readonly menus?: StandingMenus | undefined;
};

/** The menus a task's status, priority, and assignee chips open, each the field's values with the one it holds checked. */
export type StandingMenus = {
  readonly status?: FieldMenu | undefined;
  readonly priority?: FieldMenu | undefined;
  readonly assignee?: FieldMenu | undefined;
};

/** Who follows a task as its page's chip says it (`FollowingChip`). */
export type PageFollowing = {
  readonly label: string;
  readonly faces: readonly Face[];
  readonly more: number;
  readonly hint: string;
  readonly heard: string;
  readonly onPress: () => void;
};

/**
 * A page's heading in 20 pt semibold, heard as a heading, the bar above it
 * holding its path; under it a task's status, priority, and assignee as
 * small chips, one to a line at an accessibility size, each opening the
 * menu of its field's values where it carries one, and a line in the
 * body's ink. A task's followers stand under its fields as a chip that
 * opens them, on a line of its own, since a fourth chip runs off a phone's
 * screen.
 */
export function PageHeader(props: PageHeaderProps) {
  const { title, summary, status, priority, assignee, following, menus } = props;
  const colors = useColors();

  const chips = status !== undefined || priority !== undefined || assignee !== undefined;

  // Note that at an accessibility size the chips stand one to a line, since three in a row run off a phone's screen.
  const stacked = useAccessibilitySize();

  const chipRow = (
    <>
      {status === undefined ? null : <StatusChip status={status} menu={menus?.status} />}
      {priority === undefined ? null : <FieldChip label={priority} menu={menus?.priority} />}
      {assignee === undefined ? null : assignee.nobody ? (
        <FieldChip label={assignee.name} symbol={GLYPH.UNASSIGNED} menu={menus?.assignee} />
      ) : (
        <FieldChip label={assignee.name} face={assignee} menu={menus?.assignee} />
      )}
    </>
  );

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.ROW}
      modifiers={[padding({ horizontal: SPACE.EDGE, top: SPACE.TIGHT, bottom: SPACE.ROW })]}
    >
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
          accessibilityAddTraits(["isHeader"]),
        ]}
      >
        {title}
      </Text>
      {!chips ? null : stacked ? (
        <VStack alignment="leading" spacing={SPACE.TIGHT + 2}>
          {chipRow}
        </VStack>
      ) : (
        <HStack spacing={SPACE.TIGHT + 2}>{chipRow}</HStack>
      )}
      {following === undefined ? null : <FollowingChip {...following} />}
      {summary === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(colors.TEXT_BODY)]}
        >
          {summary}
        </Text>
      )}
    </VStack>
  );
}
