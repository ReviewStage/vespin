/**
 * keyboard-modality.ts -- whether focus last moved by the keyboard, tracked outright rather than guessed.
 */

import { useEffect } from "react";

/** Input types whose arrows move a caret rather than focus. */
const CARET_INPUTS: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
]);

/** Whether `target` holds a caret, where the arrows move it within the words and focus stays put. */
function holdsCaret(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;

  if (target instanceof HTMLInputElement) return CARET_INPUTS.has(target.type);

  return target instanceof HTMLElement && target.isContentEditable;
}

/** Whether `event` is a key that moves focus: Tab anywhere, and an arrow outside words being typed. */
function movesFocus(event: KeyboardEvent): boolean {
  if (event.key === "Tab") return true;

  return event.key.startsWith("Arrow") && !holdsCaret(event.target);
}

/**
 * `:focus-visible` is a heuristic about how focus arrived, and in a window
 * the app focuses programmatically it guesses wrong: the engine can read the
 * window taking focus as keyboard modality and ring a control after a plain
 * press, most reliably the first time the window is ever focused. Modality
 * is tracked outright instead, on the root as `data-keyboard`, so a ring or
 * a keyboard-only hint is drawn only once someone has actually moved focus
 * with the keyboard. Note that an arrow in a field moves the caret, not
 * focus, so it marks nothing. Each window's root mounts it once.
 */
export function useKeyboardModality(): void {
  useEffect(() => {
    const root = document.documentElement;

    const keyboardMoved = (event: KeyboardEvent) => {
      if (!movesFocus(event)) return;
      root.dataset.keyboard = "true";
    };

    const pointerUsed = () => {
      delete root.dataset.keyboard;
    };

    // Capture: the flag has to be right before anything reacts to the event.
    window.addEventListener("keydown", keyboardMoved, true);
    window.addEventListener("pointerdown", pointerUsed, true);

    return () => {
      window.removeEventListener("keydown", keyboardMoved, true);
      window.removeEventListener("pointerdown", pointerUsed, true);
    };
  }, []);
}
