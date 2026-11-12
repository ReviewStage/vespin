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
import { FieldChip, StatusChip } from "./button.js";
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
};

/**
 * A page's heading in 20 pt semibold, heard as a heading, the bar above it
 * holding its path; under it a task's status, priority, and assignee as
 * small chips, one to a line at an accessibility size, and a line in the
 * body's ink.
 */
export function PageHeader({ title, summary, status, priority, assignee }: PageHeaderProps) {
  const colors = useColors();
  const chips = status !== undefined || priority !== undefined || assignee !== undefined;
  // Note that at an accessibility size the chips stand one to a line, since three in a row run off a phone's screen.
  const stacked = useAccessibilitySize();

  const chipRow = (
    <>
      {status === undefined ? null : <StatusChip status={status} />}
      {priority === undefined ? null : <FieldChip label={priority} />}
      {assignee === undefined ? null : assignee.nobody ? (
        <FieldChip label={assignee.name} symbol="person.crop.circle.dashed" />
      ) : (
        <FieldChip label={assignee.name} face={assignee} />
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
