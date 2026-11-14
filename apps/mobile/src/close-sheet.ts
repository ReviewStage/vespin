// close-sheet.ts -- closing a sheet or a pushed form only once its text fields have let go of the keyboard.

import { releaseFields } from "@repo/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useRef } from "react";

/**
 * Closes the screen once every field holding the keyboard has let it go
 * (`releaseFields`), since a SwiftUI form that drops a focused field's row as
 * its screen closes ends the app. Every screen whose form holds a field
 * closes through it, on Cancel and after a save alike. Note that a screen
 * closes once: a second press while its fields let go is let pass, because
 * it would otherwise go back a second time, past the sheet to the screen
 * under it.
 */
export function useCloseSheet(): () => void {
  const router = useRouter();
  const closing = useRef(false);

  return useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    void releaseFields().then(() => router.back());
  }, [router]);
}
