/**
 * use-page-focused.ts -- whether the window's page is visible and focused, as the document says.
 *
 * Not while the window is hidden, minimized, or behind another app's, or its
 * browser tab is in the background; read anew as the document says it was
 * shown, hidden, focused, or blurred.
 */

import { useSyncExternalStore } from "react";

/** Hears the window's page shown, hidden, focused, or blurred. */
function onFocusChange(changed: () => void): () => void {
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("focus", changed);
  window.addEventListener("blur", changed);
  return () => {
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("focus", changed);
    window.removeEventListener("blur", changed);
  };
}

/** Whether the window's page is visible and focused. */
export function usePageFocused(): boolean {
  return useSyncExternalStore(
    onFocusChange,
    () => document.visibilityState === "visible" && document.hasFocus(),
  );
}
