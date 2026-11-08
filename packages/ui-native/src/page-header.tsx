// page-header.tsx -- the title and line a detail page opens with.

import { Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

type PageHeaderProps = {
  readonly title: string;
  /** A line under the title: where the thing stands, or what it asks. */
  readonly summary?: string | undefined;
};

/** A page's title in the system's title type, and its line under it in the body's. */
export function PageHeader({ title, summary }: PageHeaderProps) {
  const colors = useColors();
  return (
    <VStack
      alignment="leading"
      spacing={SPACE.TIGHT * 2}
      modifiers={[padding({ horizontal: SPACE.PAGE, vertical: SPACE.PAGE - 4 })]}
    >
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
