// window-back.ts -- whether the window's Back has a page to pop, read from the router's root navigation state.

/** The slot expo-router stands its root navigator under, the one route of the state `useRootNavigationState` answers (expo-router's `INTERNAL_SLOT_NAME`). */
const ROOT_SLOT = "__root";

/** The app's own group under the root (`app/(app)`), whose stack the tabs and the sheets stand in, beside an iPad's split view. */
const APP_ROUTE = "(app)";

/** The app stack's route the tabs stand under (`app/(app)/_layout.tsx`); any other route in front is a sheet or a signed-out screen. */
const TABS_ROUTE = "(tabs)";

/** A navigator's state, as far as Back reads it: the route in front, and each route's own navigator. */
export type NavigatorState = {
  readonly index?: number;
  readonly routes: readonly NavigatorRoute[];
};

type NavigatorRoute = { readonly name: string; readonly state?: NavigatorState };

/** The route a navigator stands in front, or none before it has one. */
function focusedRoute(state: NavigatorState | undefined): NavigatorRoute | undefined {
  return state?.routes[state.index ?? 0];
}

/**
 * The tabs' route, while the tabs stand in front of the app's root stack
 * rather than a sheet or a signed-out screen; none otherwise. Note that the
 * root state's one route is expo-router's own slot, with the app's own group
 * under it and the app's stack under that, so the stack is read two levels in.
 */
export function tabsInFront(root: NavigatorState | undefined): NavigatorRoute | undefined {
  const slot = focusedRoute(root);
  const top = slot?.name === ROOT_SLOT ? focusedRoute(slot.state) : slot;
  const front = top?.name === APP_ROUTE ? focusedRoute(top.state) : top;

  return front?.name === TABS_ROUTE ? front : undefined;
}

/**
 * Whether the tab shown has pushed a page over its root, which the window's
 * Back pops. Note that this reads the tab's own stack rather than
 * `router.canGoBack()`, because the tab bar answers Back too, by going to the
 * first tab (NativeTabs' `initialRoute` back behavior), so Back from the
 * Tasks or Search list would have jumped to the Inbox.
 */
export function tabStackBacks(tabs: NavigatorRoute): boolean {
  const stack = focusedRoute(tabs.state)?.state;

  return (stack?.index ?? 0) > 0;
}
