/**
 * context-menu.ts -- the props an element spreads to carry a menu a right-click or a long press opens, kept apart from `menu.tsx` so a row that carries one does not import the menu it opens.
 */

/**
 * The props of an element whose menu a right-click opens (`useMenu`'s
 * `contextMenu`), spread on it: the right-click's handler, the long press
 * that opens the same menu from a touch, and the mark that keeps the
 * system's own callout off it while held.
 */
export interface ContextMenuProps {
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onTouchEnd: (event: React.TouchEvent<HTMLElement>) => void;
  "data-long-press": "";
}

/**
 * The props of a control inside an element carrying a context menu that
 * keeps the menu its own press would otherwise open, as a row's switch
 * does: a right-click on it does not reach the row, and a long press that
 * starts on it never starts the row's hold.
 */
export const NO_CONTEXT_MENU = {
  "data-no-context-menu": "",
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => event.stopPropagation(),
} as const;

/** The handlers of the events a context menu hears that an element carrying it may hear for itself too. */
export interface ContextMenuCarrier<T extends HTMLElement> {
  onContextMenu?: React.MouseEventHandler<T> | undefined;
  onPointerDown?: React.PointerEventHandler<T> | undefined;
  onTouchEnd?: React.TouchEventHandler<T> | undefined;
}

/** Two handlers of one event, both heard, the carrier's first; whichever is given where one is not. */
function heardBoth<E>(
  own: ((event: E) => void) | undefined,
  menu: ((event: E) => void) | undefined,
): ((event: E) => void) | undefined {
  if (own === undefined || menu === undefined) return own ?? menu;

  return (event) => {
    own(event);
    menu(event);
  };
}

/**
 * The props an element spreads to carry a context menu beside handlers of
 * its own for the same events, as a card's press hears the same pointer:
 * each event heard by both, its own first; its own alone where it carries
 * no menu.
 */
export function withContextMenu<T extends HTMLElement>(
  contextMenu: ContextMenuProps | undefined,
  own: ContextMenuCarrier<T>,
): ContextMenuCarrier<T> & { "data-long-press"?: "" } {
  if (contextMenu === undefined) return own;

  return {
    "data-long-press": contextMenu["data-long-press"],
    onContextMenu: heardBoth(own.onContextMenu, contextMenu.onContextMenu),
    onPointerDown: heardBoth(own.onPointerDown, contextMenu.onPointerDown),
    onTouchEnd: heardBoth(own.onTouchEnd, contextMenu.onTouchEnd),
  };
}
