// use-document-mentions.ts -- what an `@` typed in a document's words offers, as a task's description or an automation's prompt is edited: the `@` word its caret stands in, and a pick putting the mention's pill in its place, held the one way for every document field.

import { mentionPill } from "@repo/features/pill-words";
import type { CaretAtWord, DocumentFieldHandle, DocumentPageMentions } from "@repo/ui-native";
import { type RefObject, useState } from "react";
import { useMentionOffer } from "./use-mention-offer.js";

/** What a document field's `@` offers, and the door its caret's `@` word is told through. */
export interface DocumentMentions {
  /** What the `@` word offers, as the document's page draws it; none while no `@` word stands. */
  readonly mentions: DocumentPageMentions | undefined;
  readonly onAtWord: (word: CaretAtWord | undefined) => void;
}

/**
 * What the `@` word the caret of the document field behind `field` stands
 * in offers in `place`, a pick putting the mention's pill there through
 * the field's door; none while no `@` word stands, or while the field is
 * not `listening`, as an inline description that is only being read.
 */
export function useDocumentMentions(
  place: Parameters<typeof useMentionOffer>[0],
  field: RefObject<DocumentFieldHandle | null>,
  listening = true,
): DocumentMentions {
  const [atWord, setAtWord] = useState<CaretAtWord | undefined>(undefined);

  const offered = useMentionOffer(place, {
    word: listening ? atWord : undefined,
    pick: (mention) => field.current?.pick(mentionPill(mention.name, mention.target)),
    rewrite: (words) => field.current?.rewrite(words),
  });

  return {
    mentions:
      offered === undefined
        ? undefined
        : {
            groups: offered.groups,
            empty: offered.empty,
            crumb: offered.crumb,
            onPick: offered.pick,
          },
    onAtWord: setAtWord,
  };
}
