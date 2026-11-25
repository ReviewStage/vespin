/**
 * forward-on-grant.ts -- the app comes back to the front once a grant the developer was sent to System Settings for lands.
 *
 * Allow… or Open System Settings, pressed while a permission it watches is
 * missing, opens a grant flow (`useGrantFlow`): the developer is in macOS's
 * pane, and the next reading that a missing grant is now allowed
 * (`useForwardOnGrant`) brings the app forward (`focusPanel`) and ends the
 * flow, leaving System Settings open behind. The flow also ends as the
 * window takes focus again, since the developer came back on their own, so a
 * grant read with no flow open moves nothing. While the flow is open its
 * readings must go on with the window covered, which the caller's query
 * does by polling in the background while `open` holds.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";

/** A press that sends the developer to macOS, its answer handed back as it was. */
type GrantPress = () => Promise<void> | void;

/** A grant flow, as its presses open it. */
interface GrantFlow {
  /** Whether the developer is in System Settings from one of the flow's presses. */
  readonly open: boolean;
  /** Wraps a press that sends the developer to grant a watched permission, opening the flow as it runs where one is missing. */
  readonly sent: (press: GrantPress, missing: boolean) => GrantPress;
  /** Ends the flow. */
  readonly close: () => void;
}

/** A flow no press has opened yet, closed again as the window takes focus. */
export function useGrantFlow(): GrantFlow {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    window.addEventListener("focus", close);

    return () => window.removeEventListener("focus", close);
  }, [close]);

  // Note that a press with every grant allowed opens no flow, because what it changes in System Settings can only be a grant taken back.
  const sent = useCallback(
    (press: GrantPress, missing: boolean): GrantPress =>
      missing
        ? () => {
            setOpen(true);

            return press();
          }
        : press,
    [],
  );

  return { open, sent, close };
}

/**
 * Brings the app forward where a grant given, each whether macOS allows it
 * now in an order that holds from one render to the next, flips to allowed
 * while the flow is open.
 */
export function useForwardOnGrant(flow: GrantFlow, allowed: readonly boolean[]): void {
  const before = useRef(allowed);

  // Note that the readings are compared on every render, because the caller's array is fresh each time and a flip is all that counts.
  useEffect(() => {
    const landed = allowed.some((now, index) => now && before.current[index] === false);
    before.current = allowed;

    if (!landed || !flow.open) return;
    flow.close();
    appPlatform().focusPanel();
  });
}
