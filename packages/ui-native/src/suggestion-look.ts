// suggestion-look.ts -- how a suggestion an agent wrote into its reply stands in a message: offered, as the pill a press opens filled in, or reached, as the chip of the agent it started or sent to, with Started or Sent after it.

import { REPLY_BUTTON_ACTION, type ReplyButtonActionKind } from "@repo/features/reply-button-wire";

/** How a suggestion stands: offered until a send of it lands, then the agent it reached. */
export const SUGGESTION_LOOK = {
  OFFERED: "offered",
  REACHED: "reached",
} as const;

/**
 * A suggestion as the screen hands `Markdown` its look, from the button the
 * host read: what it suggests, its label or the reached agent's name, and
 * what a press does. A screen hands none where Suggestions are off or the
 * button is unread, and the link is drawn as the plain link it is.
 */
export type SuggestionLook =
  | {
      readonly look: typeof SUGGESTION_LOOK.OFFERED;
      readonly suggests: ReplyButtonActionKind;
      readonly label: string;
      readonly onPress: () => void;
    }
  | {
      readonly look: typeof SUGGESTION_LOOK.REACHED;
      readonly suggests: ReplyButtonActionKind;
      readonly name: string;
      readonly onPress: () => void;
    };

/** What a reached suggestion says after the agent's name, as the panel's `SuggestionSent` does. */
export const SUGGESTION_SENT_WORDS = {
  [REPLY_BUTTON_ACTION.START]: "Started",
  [REPLY_BUTTON_ACTION.SEND]: "Sent",
} as const satisfies Record<ReplyButtonActionKind, string>;

/** What VoiceOver hears an offered suggestion as before its label. */
const SUGGESTION_WORD = "Suggestion";

/** A suggestion as VoiceOver hears it: a suggestion by its label, or the reached agent by its name and Started or Sent. */
export function suggestionHeard(look: SuggestionLook): string {
  return look.look === SUGGESTION_LOOK.OFFERED
    ? `${SUGGESTION_WORD}: ${look.label}`
    : `${look.name}, ${SUGGESTION_SENT_WORDS[look.suggests]}`;
}
