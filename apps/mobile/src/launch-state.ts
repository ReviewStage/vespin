// launch-state.ts -- whether this launch began in the background or has spent any time there since, when it last came to the front since, and when it first came active, watched from the bundle's first run, before expo-router loads the screens.

import { AppState } from "react-native";
import { sinceLaunch } from "./launch-phases.js";

/**
 * Whether this launch began in the background, a push or a Live Activity's
 * wake, or went there since. Note that only `background` marks it, since a
 * launch from a tap can still read `inactive` while iOS finishes launching
 * it, and that it's read here, which the entry loads first, since a screen's
 * module runs only once its route first draws, which a launch woken in the
 * background can reach hours later, once it's brought forward.
 */
let leftFront = AppState.currentState === "background";

/** Whether this launch began in the background, which nothing after the bundle's first run changes. */
const beganAway = leftFront;

/** Whether the app has been in the background since it last came active, so its next coming active is a return to the front. */
let awayNow = leftFront;

/** How long after the launch's start the app last came to the front from the background (`sinceLaunch`); none before it has, or where the runtime keeps no start. */
let frontAt: number | undefined;

/**
 * How long after the launch's start the app first came active (`sinceLaunch`),
 * or when the bundle first ran where it already was; none before it has.
 * Note that a launch from a tap can stand `inactive` for as long as a
 * system alert covers it, so this is counted beside the launch rather than
 * in it.
 */
let activeAt = AppState.currentState === "active" ? sinceLaunch() : undefined;

AppState.addEventListener("change", (state) => {
  if (state === "active") activeAt ??= sinceLaunch();

  if (state === "background") {
    leftFront = true;
    awayNow = true;
  } else if (state === "active" && awayNow) {
    awayNow = false;
    frontAt = sinceLaunch();
  }
});

/** Whether this launch began in the background, the system having woken the app with nothing on screen, as a push does. */
export function launchBeganAway(): boolean {
  return beganAway;
}

/** Whether this launch has been in the background at any point since the bundle first ran. */
export function launchLeftFront(): boolean {
  return leftFront;
}

/** How long after the launch's start the app last came to the front from the background; none while it is still away, or where the runtime keeps no start. */
export function launchFrontAt(): number | undefined {
  return awayNow ? undefined : frontAt;
}

/** How long after the launch's start the app first came active; none before it has, or where the runtime keeps no start. */
export function launchActiveAt(): number | undefined {
  return activeAt;
}
