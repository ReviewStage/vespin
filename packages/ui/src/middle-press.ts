/**
 * middle-press.ts -- a middle-button click, handed to the press it stands for: a link's own click, or a control's opening of its place in a tab of its own.
 *
 * A middle-click fires `auxclick`, never `click`, so a link whose press
 * opens the address itself (`preventDefault`, then the window's opener)
 * would otherwise be followed by the browser: in a browser tab of its own
 * at the raw address on the web, rather than where the window opens it,
 * and nowhere at all in the desktop's window, which opens no window of its
 * own. Handed the same press, a middle-click opens where a click does. A
 * press that leaves the following to the browser, as one that answers a
 * plain left click alone does, lets the browser open its tab as before.
 * Only the middle button is handed on, since another button's `auxclick`,
 * a right-click's where a browser sends one, is its menu's.
 *
 * A control that goes to a place with an address of its own but is no link,
 * a sidebar's place or a list's row, which a ⌘-click chooses rather than
 * opens, takes the middle-click a link takes as a press that opens its place
 * in a tab of its own (`middleOpensTab`), where its window can open one.
 */

import type { MouseEvent } from "react";

/** `MouseEvent.button` for the middle button, the wheel's press. */
const MIDDLE_BUTTON = 1;

/** A link's `onAuxClick`: its `press`, heard for the middle button alone. */
export function middlePressOf<Target extends Element>(
  press: (event: MouseEvent<Target>) => void,
): (event: MouseEvent<Target>) => void {
  return (event) => {
    if (event.button === MIDDLE_BUTTON) press(event);
  };
}

/** What a control that a middle-click opens in a tab of its own hears of the pointer. */
interface MiddleOpensTab<Target extends Element> {
  readonly onMouseDown: ((event: MouseEvent<Target>) => void) | undefined;
  readonly onAuxClick: ((event: MouseEvent<Target>) => void) | undefined;
}

/**
 * A control's `onMouseDown` and `onAuxClick` where a middle-click opens its
 * place in a tab of its own (`openInTab`): the middle button's going down
 * refused, because a browser off a Mac starts its autoscroll there on
 * anything but a link, and its click handed to `openInTab`. `down`, the
 * control's own `onMouseDown`, still hears every button; with no
 * `openInTab` it is all there is.
 */
export function middleOpensTab<Target extends Element>(
  openInTab: (() => void) | undefined,
  down?: ((event: MouseEvent<Target>) => void) | undefined,
): MiddleOpensTab<Target> {
  if (openInTab === undefined) return { onMouseDown: down, onAuxClick: undefined };
  return {
    onMouseDown: (event) => {
      if (event.button === MIDDLE_BUTTON) event.preventDefault();
      down?.(event);
    },
    onAuxClick: middlePressOf(openInTab),
  };
}
