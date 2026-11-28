// use-mention-pills.ts -- a composer's field of pills handed what its `@` offers as the trees its native list draws, so the list stands on the keystroke itself, and the presses it sends back acted on against what was offered for the same words.

import { type ComposerPills, type OfferPress, offerPressed, useOfferTrees } from "@repo/ui-native";
import type { MentionsOffered, MentionsState } from "./use-mention-offer.js";

/**
 * The field's pills with what an `@` offers handed to its native list: the
 * `@` word's offer, none while a `/` offers its skills instead, and a bare
 * `@`'s, held while the field holds the keyboard, which the list stands the
 * moment an `@` is typed; a press comes back by the words it answered and
 * acts only on what was offered for them (`offerPressed`).
 */
export function useMentionPills(
  pills: ComposerPills,
  mentions: MentionsState,
  offering: boolean,
): ComposerPills {
  const offered: MentionsOffered | undefined = offering ? mentions.offered : undefined;
  const trees = useOfferTrees(offered, offering ? mentions.bare : undefined);

  // Note that a press acts only where its words are those typed now, never the deferred search's alone, so no pick lands on a row of words already moved past.
  const onPress = (press: OfferPress) => {
    if (press.query === mentions.typed) offerPressed(press, offered);
  };

  return { ...pills, offer: { trees, onPress } };
}
