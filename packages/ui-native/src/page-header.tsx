// page-header.tsx -- the heading a detail page opens with under its bar: its title, its fields as chips, and a line.

import { HStack, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { FieldChip, StatusChip } from "./button.js";
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
  /** Who a task is assigned to, drawn as a chip with their face. */
  readonly assignee?: string | undefined;
};

/**
 * A page's heading in 20 pt semibold, the bar above it holding its path;
 * under it a task's status, priority, and assignee as small chips, and a
 * line in the body's ink.
 */
export function PageHeader({ title, summary, status, priority, assignee }: PageHeaderProps) {
  const colors = useColors();
  const chips = status !== undefined || priority !== undefined || assignee !== undefined;
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
        ]}
      >
        {title}
      </Text>
      {chips ? (
        <HStack spacing={SPACE.TIGHT + 2}>
          {status === undefined ? null : <StatusChip status={status} />}
          {priority === undefined ? null : <FieldChip label={priority} />}
          {assignee === undefined ? null : <FieldChip label={assignee} face={assignee} />}
        </HStack>
      ) : null}
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
