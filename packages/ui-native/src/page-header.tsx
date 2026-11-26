// page-header.tsx -- the heading a detail page opens with under its bar: its title, its fields as chips, and a line.

import { HStack, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  font,
  foregroundStyle,
  layoutPriority,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskPriority, TaskStatus } from "@repo/features/task-wire";
import { useAccessibilitySize } from "./accessibility.js";
import { FieldChip, type FieldMenu, FollowingChip, PriorityChip, StatusChip } from "./button.js";
import type { Face } from "./marks.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

type PageHeaderProps = {
  readonly title: string;
  /** A line under the chips: where the thing stands, or what it asks. */
  readonly summary?: string | undefined;
  /** Who made it and when, last and quietest in the system's footnote: "Created by Ada Lovelace · Oct 5". */
  readonly byline?: string | undefined;
  /** A task's status, drawn as its chip under the title. */
  readonly status?: TaskStatus | undefined;
  /** A task's priority, drawn as a chip after its status. */
  readonly priority?: TaskPriority | undefined;
  /** Who a task is assigned to, drawn as a chip with their face, or the words for no one beside an empty face. */
  readonly assignee?: (Face & { readonly nobody: boolean }) | undefined;
  /** Who follows a task, drawn as a chip under its fields that opens them; none where it carries no followers. */
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

/** The gap between a page's field chips, in points: at least 8, so a press meant for one never lands on its neighbor, since each is the system's small capsule rather than a 44 pt target. */
const CHIP_GAP = SPACE.TIGHT * 2;

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
 * A page's heading in the page heading's style, semibold, heard as a heading, the bar above it
 * holding its path; under it a task's status and priority as small chips
 * on one line, then its people on the next: the assignee and the chip of
 * who follows it, which opens them, since at the body's 17 pt three chips
 * cut a short name on a phone (the developer, Nov 22, 2026). Each field's
 * chip opens the menu of its values where it carries one; at an
 * accessibility size every chip stands on a line of its own. A line in the
 * body's ink follows, and who made it stands last in the muted footnote,
 * as Notes and Reminders say an item's provenance.
 */
export function PageHeader(props: PageHeaderProps) {
  const { title, summary, byline, status, priority, assignee, following, menus } = props;
  const colors = useColors();

  const fields = status !== undefined || priority !== undefined;

  // Note that at an accessibility size the chips stand one to a line, since chips side by side run off a phone's screen there.
  const stacked = useAccessibilitySize();

  const fieldChips = (
    <>
      {status === undefined ? null : <StatusChip status={status} menu={menus?.status} />}
      {priority === undefined ? null : <PriorityChip priority={priority} menu={menus?.priority} />}
    </>
  );

  // Note that the assignee's chip gives way first, its name cut short, so Following always reads whole where a long name runs the line past a phone's width.
  const assigneeChip =
    assignee === undefined ? null : (
      <HStack modifiers={[layoutPriority(-1)]}>
        {assignee.nobody ? (
          <FieldChip label={assignee.name} nobody menu={menus?.assignee} />
        ) : (
          <FieldChip label={assignee.name} face={assignee} menu={menus?.assignee} />
        )}
      </HStack>
    );

  const followingChip = following === undefined ? null : <FollowingChip {...following} />;

  const people = assignee !== undefined || following !== undefined;

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
      {stacked ? (
        <VStack alignment="leading" spacing={CHIP_GAP}>
          {fieldChips}
          {assigneeChip}
          {followingChip}
        </VStack>
      ) : (
        <>
          {fields ? <HStack spacing={CHIP_GAP}>{fieldChips}</HStack> : null}
          {people ? (
            <HStack spacing={CHIP_GAP}>
              {assigneeChip}
              {followingChip}
            </HStack>
          ) : null}
        </>
      )}
      {summary === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(colors.TEXT_BODY)]}
        >
          {summary}
        </Text>
      )}
      {byline === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {byline}
        </Text>
      )}
    </VStack>
  );
}
