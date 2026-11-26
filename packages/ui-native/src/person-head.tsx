// person-head.tsx -- a person's page's head: their photo or monogram large and centered, their name, and who they are to the workspace, as Contacts heads a card.

import { VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityLabel,
  accessibilityValue,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowSeparator,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { Avatar } from "./marks.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The face's width, in points, as the Account page's head draws the reader's own. */
const PERSON_HEAD_FACE_SIZE = 72;

/**
 * A person heading their page, the first row of its list: their face large
 * and centered on the page's ground rather than in a row's card, as Contacts
 * heads a card, their name under it as the page's heading, then who they
 * are to the workspace in the muted ink, such as "Admin · ada@example.com"
 * or "Former member". It takes no press, and VoiceOver hears it as one
 * heading, their name then the line.
 */
export function PersonHead({
  id,
  name,
  picture,
  line,
}: {
  /** Their account id, which their monogram's hue is read off, as every face of theirs reads it. */
  readonly id: string;
  readonly name: string;
  readonly picture?: string | undefined;
  readonly line?: string | undefined;
}) {
  const colors = useColors();

  return (
    <VStack
      spacing={SPACE.TIGHT}
      modifiers={[
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "center" }),
        padding({ vertical: SPACE.ROW }),
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        accessibilityElement("ignore"),
        accessibilityLabel(name),
        accessibilityAddTraits(["isHeader"]),
        ...(line === undefined || line === "" ? [] : [accessibilityValue(line)]),
      ]}
    >
      <Avatar id={id} name={name} picture={picture} size={PERSON_HEAD_FACE_SIZE} />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
        ]}
      >
        {name}
      </Text>
      {line === undefined || line === "" ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {line}
        </Text>
      )}
    </VStack>
  );
}
