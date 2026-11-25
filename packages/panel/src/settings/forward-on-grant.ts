/**
 * forward-on-grant.ts -- the app comes back to the front once a grant the developer was sent to System Settings for lands.
 *
 * Allow… or Open System Settings, pressed while a permission it watches is
 * missing, opens a grant flow: the developer is in macOS's pane, and the
 * next reading that a missing grant is now allowed brings the app forward
 * (`focusPanel`) and ends the flow, leaving System Settings open behind.
 * The flow also ends as the window takes focus again, since the developer
 * came back on their own, so a grant read with no flow open moves nothing.
 */

import { useCallback, useEffect, useRef } from "react";
import { appPlatform } from "../app-platform.js";

/** A press that sends the developer to macOS, its answer handed back as it was. */
type GrantPress = () => Promise<void> | void;

/** A grant flow, as its presses open it. */
interface GrantFlow {
  /** Wraps a press that sends the developer to grant a watched permission, opening the flow as it runs where one is missing. */
  readonly sent: (press: GrantPress) => GrantPress;
}

/**
 * The flow over the grants given, each whether macOS allows it now, in an
 * order that holds from one render to the next.
 */
export function useForwardOnGrant(allowed: readonly boolean[]): GrantFlow {
  const flowOpen = useRef(false);
  const before = useRef(allowed);
  const missing = allowed.includes(false);

  // Note that the readings are compared on every render, because the caller's array is fresh each time and a flip is all that counts.
  useEffect(() => {
    const landed = allowed.some((now, index) => now && before.current[index] === false);
    before.current = allowed;

    if (!landed || !flowOpen.current) return;
    flowOpen.current = false;
    appPlatform().focusPanel();
  });

  useEffect(() => {
    const returned = () => {
      flowOpen.current = false;
    };

    window.addEventListener("focus", returned);

    return () => window.removeEventListener("focus", returned);
  }, []);

  // Note that a press with every grant allowed opens no flow, because what it changes in System Settings can only be a grant taken back.
  const sent = useCallback(
    (press: GrantPress): GrantPress =>
      missing
        ? () => {
            flowOpen.current = true;

            return press();
          }
        : press,
    [missing],
  );

  return { sent };
}
