// newer-ask-card.tsx -- the card of an ask whose type this build does not know: where to answer it, in the muted ink, as the panel's card says it, so the ask never vanishes.

import {
  accessibilityIdentifier,
  font,
  foregroundStyle,
  frame,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { CARD_WORDS_INSET, Card, ROW_PADDING } from "./ask-card.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What a flow finds the card by. */
const NEWER_ASK_ID = "newer-ask";

/**
 * The card of an ask whose type this build does not know, its one row
 * saying where to answer it (`NEWER_APP_ASK`), as the panel's card does; the
 * box under the thread still replies.
 */
export function NewerAskCard({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <Card inset={CARD_WORDS_INSET.BARE}>
      {[
        <Text
          key="words"
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_TITLE }),
            foregroundStyle(colors.TEXT_MUTED),
            frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
            padding(ROW_PADDING),
            accessibilityIdentifier(NEWER_ASK_ID),
          ]}
        >
          {words}
        </Text>,
      ]}
    </Card>
  );
}
