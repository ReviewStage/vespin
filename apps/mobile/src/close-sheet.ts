// close-sheet.ts -- closing a sheet or a pushed form only once its text fields have let go of the keyboard.

import { releaseFields } from "@repo/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import type { KeptWords } from "./use-kept-words.js";

/**
 * Closes the screen once every field holding the keyboard has let it go
 * (`releaseFields`), since a SwiftUI form that drops a focused field's row as
 * its screen closes ends the app. Every screen whose form holds a field
 * closes through it, on Cancel and after a save alike.
 *
 * Note that a screen closes once: a second press while its fields let go is
 * let pass, because it would otherwise go back a second time, past the sheet
 * to the screen under it. The latch lets go only where the screen's draft
 * held the close and asks whether to discard it (`kept.asking`), so Cancel
 * answers again once the person keeps the draft. And the back is skipped
 * where the screen has already gone, such as by a swipe during the wait.
 */
export function useCloseSheet(kept?: Pick<KeptWords, "asking">): () => void {
  const router = useRouter();
  const closing = useRef(false);
  const standing = useRef(true);
  const asking = kept?.asking ?? false;

  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);

  useEffect(() => {
    if (asking) closing.current = false;
  }, [asking]);

  return useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    void releaseFields().then(() => {
      if (standing.current) router.back();
    });
  }, [router]);
}

/**
 * Closes the sheet as `useCloseSheet` does, once its fields let go of the
 * keyboard, and then runs `after`, such as opening the page a sheet made,
 * so the page is pushed on the tabs rather than inside the sheet closing.
 * Nothing runs where the sheet has already gone.
 */
export function useCloseSheetThen(): (after: () => void) => void {
  const router = useRouter();
  const standing = useRef(true);

  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);

  return useCallback(
    (after) => {
      void releaseFields().then(() => {
        if (!standing.current) return;
        router.back();
        after();
      });
    },
    [router],
  );
}
