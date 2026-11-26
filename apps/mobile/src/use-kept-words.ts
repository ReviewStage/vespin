/**
 * use-kept-words.ts -- a draft kept while a sheet or a page holds one, words typed or a picture attached: the swipe down or Back is held, and Cancel, the swipe, or Back asks first whether to discard it, as Mail keeps a draft.
 */

import { usePreventRemove } from "expo-router";
import { useState } from "react";

/** What the ask before a draft goes says, in the panel's words. */
export const DISCARD_WORDS = {
  QUESTION: "Discard draft?",
  DISCARD: "Discard draft",
} as const;

/** What the ask before an edit of words already saved goes says, as iOS's own editors ask it. */
export const DISCARD_CHANGES_WORDS = {
  QUESTION: "Discard changes?",
  DISCARD: "Discard changes",
} as const;

/** What keeps a sheet's draft, its words typed and pictures attached: whether it asks before they go, and its answers. */
export interface KeptWords {
  /** Whether the sheet holds a draft, words typed or a picture attached, which its close asks about first. */
  readonly drafted: boolean;
  /** Whether the sheet asks whether to discard its draft, after a Cancel or a swipe down. */
  readonly asking: boolean;
  /** Lets the sheet go, its draft with it, as the ask's Discard draft does. */
  readonly discard: () => void;
  /** Keeps the sheet and its draft, as the ask's Cancel does. */
  readonly stay: () => void;
  /** Lets the sheet go without asking, as a start taken does. */
  readonly release: () => void;
}

/**
 * Keeps a sheet's draft while it holds one, words typed or a picture
 * attached, as Mail keeps a draft: the swipe down is held, and Cancel or a
 * swipe asks first whether to discard it. Note that a swipe the system held
 * comes back as a removal the stack prevented, so one ask answers both.
 */
export function useKeptWords(drafted: boolean): KeptWords {
  const [letGo, setLetGo] = useState(false);
  const [leave, setLeave] = useState<(() => void) | undefined>(undefined);
  const disable = usePreventRemove(drafted && !letGo, ({ repeat }) => setLeave(() => repeat));

  return {
    drafted,
    asking: leave !== undefined,
    discard: () => {
      setLetGo(true);
      setLeave(undefined);
      leave?.();
    },
    stay: () => setLeave(undefined),
    release: () => {
      setLetGo(true);
      disable();
    },
  };
}
