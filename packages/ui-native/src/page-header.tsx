// page-header.tsx -- the title and line a detail page opens with.

import { HStack, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { TaskStatusMark } from "./marks.js";
import { STATUS_MARK_LABEL } from "./status-mark-model.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

type PageHeaderProps = {
  readonly title: string;
  /** A line under the title: where the thing stands, or what it asks. */
  readonly summary?: string | undefined;
  /** A task's status, drawn as its ring and its name over the title, as a task's page heads itself. */
  readonly status?: TaskStatus | undefined;
};

/** A page's title in the system's title type, its line under it in the body's, and a task's status over it. */
export function PageHeader({ title, summary, status }: PageHeaderProps) {
  const colors = useColors();
  return (
    <VStack
      alignment="leading"
      spacing={SPACE.TIGHT * 2}
      modifiers={[padding({ horizontal: SPACE.PAGE, vertical: SPACE.PAGE - 4 })]}
    >
      {status === undefined ? null : (
        <HStack spacing={SPACE.TIGHT + 2}>
          <TaskStatusMark status={status} />
          <Text
            modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(colors.TEXT_MUTED)]}
          >
            {STATUS_MARK_LABEL[status]}
          </Text>
        </HStack>
      )}
      <Text
        modifiers={[
          font({ textStyle: "title2", weight: "semibold" }),
          foregroundStyle(colors.TEXT),
        ]}
      >
        {title}
      </Text>
      {summary === undefined ? null : (
        <Text modifiers={[foregroundStyle(colors.TEXT_BODY)]}>{summary}</Text>
      )}
    </VStack>
  );
}
