// close-sheet.ts -- closing a sheet or a pushed form only once its text fields have let go of the keyboard.

import { releaseFields } from "@repo/ui-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";

/** How a screen leaves: back down its stack, or the whole sheet at once. */
export const CLOSE_SHEET = { BACK: "back", DISMISS: "dismiss" } as const;

type CloseSheet = (typeof CLOSE_SHEET)[keyof typeof CLOSE_SHEET];

/**
 * Closes the screen once every field holding the keyboard has let it go
 * (`releaseFields`), since a SwiftUI form that drops a focused field's row as
 * its screen closes ends the app. Every screen whose form holds a field
 * closes through it, on Cancel and after a save alike.
 */
export function useCloseSheet(how: CloseSheet = CLOSE_SHEET.BACK): () => void {
  const router = useRouter();

  return useCallback(() => {
    void releaseFields().then(() => {
      if (how === CLOSE_SHEET.DISMISS) router.dismiss();
      else router.back();
    });
  }, [router, how]);
}
