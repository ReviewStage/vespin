// undelivered-mark.tsx -- the mark under a message of the reader's that did not go, an Inbox reply's or a line sent to an agent: the alert and "Not delivered" in the danger ink, whose press opens the system's menu headed by why, with Retry, Edit, and Delete.

import { HStack, Image, Menu, Section, Button as SwiftUIButton } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityLabel,
  foregroundStyle,
} from "@expo/ui/swift-ui/modifiers";
import { UNDELIVERED_WORDS } from "@repo/features/inbox-undelivered";
import { font } from "./font.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The role of the act that takes a message away, which the system draws in red. */
const DELETE_ROLE = "destructive";

/** A message of the reader's that did not go, as its mark says it and offers what mends it, as the panel's Not delivered does. */
export type UndeliveredLine = {
  /** Why it did not go, which heads its mark's menu. */
  readonly why: string;
  /** Whether it was to start a new thread with the agent rather than reply here. */
  readonly newThread: boolean;
  /** Sends it again under the key it went under; none where it cannot go as it stands, such as one whose files this device no longer holds. */
  readonly onRetry?: (() => void) | undefined;
  /** Takes it back into the box to be written again. */
  readonly onEdit: () => void;
  readonly onDelete: () => void;
};

/**
 * The mark a message of the reader's that did not go stands under its
 * words, as Messages marks one: the alert and "Not delivered" in the
 * danger ink, after "New thread" for a thread's start, whose press opens
 * the system's menu headed by why, with Retry, Edit, and Delete in red. It
 * is SwiftUI's, so a React Native row stands it in an `InlineHost`.
 */
export function UndeliveredMark({ line }: { readonly line: UndeliveredLine }) {
  const colors = useColors();

  const words = line.newThread
    ? `${UNDELIVERED_WORDS.NEW_THREAD} · ${UNDELIVERED_WORDS.NOT_DELIVERED}`
    : UNDELIVERED_WORDS.NOT_DELIVERED;

  const label = (
    <HStack spacing={SPACE.TIGHT + 2}>
      <Image
        {...glyphImage(GLYPH.FAILED)}
        size={MARK_SIZE.GLYPH - 2}
        color={colors.DANGER}
        modifiers={[accessibilityHidden(true)]}
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
          foregroundStyle(colors.DANGER_TEXT),
        ]}
      >
        {words}
      </Text>
    </HStack>
  );

  // Note that the mark is heard as what it says and why, and its press opens the menu, as a VoiceOver reader expects of a button.
  return (
    <Menu label={label} modifiers={[accessibilityLabel(`${words}. ${line.why}`)]}>
      <Section title={line.why}>
        {line.onRetry === undefined ? null : (
          <SwiftUIButton
            {...actContent(UNDELIVERED_WORDS.RETRY, GLYPH.RETRY)}
            onPress={line.onRetry}
          />
        )}
        <SwiftUIButton
          {...actContent(UNDELIVERED_WORDS.EDIT, GLYPH.EDIT_MESSAGE)}
          onPress={line.onEdit}
        />
      </Section>
      <SwiftUIButton
        {...actContent(UNDELIVERED_WORDS.DELETE, GLYPH.DELETE)}
        role={DELETE_ROLE}
        onPress={line.onDelete}
      />
    </Menu>
  );
}
