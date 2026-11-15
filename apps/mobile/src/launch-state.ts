// launch-state.ts -- whether this launch has spent any time in the background, watched from the bundle's first run, before expo-router loads the screens.

import { AppState } from "react-native";

/**
 * Whether this launch began in the background, a push or a Live Activity's
 * wake, or went there since. Note that only `background` marks it, since a
 * launch from a tap can still read `inactive` while iOS finishes launching
 * it, and that it's read here, which the entry loads first, since a screen's
 * module runs only once its route first draws, which a launch woken in the
 * background can reach hours later, once it's brought forward.
 */
let leftFront = AppState.currentState === "background";

if (!leftFront) {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state !== "background") return;
    leftFront = true;
    subscription.remove();
  });
}

/** Whether this launch has been in the background at any point since the bundle first ran. */
export function launchLeftFront(): boolean {
  return leftFront;
}
