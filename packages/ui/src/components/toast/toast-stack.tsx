import { Toast as BaseToast, type ToastManager, type ToastObject } from "@base-ui/react/toast";
import type { ReactNode } from "react";
import { ANNOUNCE, Announcer, useAnnounce } from "../announcer/announcer.js";

/**
 * toast-stack.tsx -- the toasts standing, in the window's bottom-right corner, as Base UI's toast viewport keeps them over one manager.
 *
 * The manager is the stack's state: whoever shows toasts adds, updates, and
 * closes them on it, from inside React or out (`createToastManager`), and
 * the stack draws each one it keeps, newest first, through the `children`
 * the host hands it, each a `Toast`. Base UI holds the rest: each toast's
 * hold and its pause while the pointer is over the stack or focus is in it,
 * how many stand at once (`limit`), the ones past it kept aside until there
 * is room, and each toast's place. The viewport is a landmark over whatever
 * docks at the window's foot, taking no pointer itself, so only a toast with
 * something to press stands in the way of what is under it.
 *
 * What each toast says reaches assistive tech through the window's one pair
 * of live regions, the `Announcer` the stack mounts beside it, rather than
 * the viewport's own, which is kept quiet: what was done or is asked
 * politely, and what was refused as an alert, each said once the words the
 * host hands it change. Note that the window's regions are the ones a modal
 * dialog leaves a reader hearing, and that one voice keeps a toast from
 * being read twice.
 *
 * It is portaled to the body with its `Announcer`, or to `container` where
 * the host stands it somewhere of its own, as a catalog frames it.
 */

/** How many toasts stand at once; the ones past it wait aside, drawn but hidden, until there is room. */
const TOAST_LIMIT = 3;

/** The toasts the stack's manager keeps, each carrying the host's own `Data`. */
export type StandingToast<Data extends object> = ToastObject<Data>;

/** The stack's state, which whoever shows toasts adds to, updates, and closes. */
export type ToastStackManager<Data extends object> = ToastManager<Data>;

/** A manager for one stack's toasts, usable from outside React. */
export function createToastManager<Data extends object>(): ToastStackManager<Data> {
  return BaseToast.createToastManager<Data>();
}

/** The toasts the manager keeps, newest first, each drawn by `draw`. */
function Standing<Data extends object>({
  draw,
}: {
  draw: (toast: StandingToast<Data>) => ReactNode;
}): ReactNode {
  const { toasts } = BaseToast.useToastManager<Data>();
  return toasts.map(draw);
}

/** The stack, named as a landmark, its manager's toasts each drawn by `children`, and the window's `Announcer`, told what the newest toasts say. */
export function ToastStack<Data extends object>({
  manager,
  label,
  polite,
  alert,
  container,
  children,
}: {
  /** The stack's state, as `createToastManager` made it. */
  manager: ToastStackManager<Data>;
  /** What the stack is called, as a landmark among the window's regions. */
  label: string;
  /** What the polite region says: what was done or is asked, or nothing. */
  polite: string;
  /** What the alert region says: what was refused, or nothing. */
  alert: string;
  /** Where the stack is portaled, where not to the body. */
  container?: HTMLElement | null | undefined;
  /** Draws one toast the manager keeps, as a `Toast`. */
  children: (toast: StandingToast<Data>) => ReactNode;
}): React.JSX.Element {
  useAnnounce(ANNOUNCE.POLITE, polite);
  useAnnounce(ANNOUNCE.ALERT, alert);
  return (
    <BaseToast.Provider toastManager={manager} limit={TOAST_LIMIT}>
      <BaseToast.Portal container={container}>
        <BaseToast.Viewport
          className="ui-toast-stack pointer-events-none fixed z-toast"
          aria-label={label}
          aria-live="off"
        >
          <Standing draw={children} />
        </BaseToast.Viewport>
        <Announcer />
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
