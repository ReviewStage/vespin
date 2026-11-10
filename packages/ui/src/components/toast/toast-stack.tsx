import { Toast as BaseToast, type ToastManager, type ToastObject } from "@base-ui/react/toast";
import { Duration } from "effect";
import type { ReactNode } from "react";
import { TOAST_HOLD } from "./toast.js";

/**
 * toast-stack.tsx -- the toasts standing, in the window's bottom-right corner, as Base UI's toast viewport keeps them over one manager.
 *
 * The manager is the stack's state: whoever shows toasts adds, updates, and
 * closes them on it, from inside React or out (`createToastManager`), and
 * the stack draws each one it keeps, newest first, through the `children`
 * the host hands it, each a `Toast`. Base UI holds the rest: each toast's
 * hold and its pause while the pointer is over the stack or focus is in it,
 * how many stand at once (`limit`), the ones past it kept aside until there
 * is room, each toast's place, and its words said aloud through the
 * viewport's live regions, one the host adds with `priority: "high"` said
 * urgently from its `title` and `description`. The viewport is a landmark
 * over whatever docks at the window's foot, taking no pointer itself, so only
 * a toast with something to press stands in the way of what is under it.
 *
 * It is portaled to the body, or to `container` where the host stands it
 * somewhere of its own, as a catalog frames it.
 */

/** How many toasts stand at once; the ones past it wait aside, drawn but hidden, until there is room. */
const TOAST_LIMIT = 3;

/** The kinds of toast Base UI tells apart: one saying work is under way, which holds no timer until it is updated into what came of it. */
export const TOAST_TYPE = {
  WORKING: "loading",
} as const;

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

/** The stack, named as a landmark, its manager's toasts each drawn by `children`. */
export function ToastStack<Data extends object>({
  manager,
  label,
  container,
  children,
}: {
  /** The stack's state, as `createToastManager` made it. */
  manager: ToastStackManager<Data>;
  /** What the stack is called, as a landmark among the window's regions. */
  label: string;
  /** Where the stack is portaled, where not to the body. */
  container?: HTMLElement | null | undefined;
  /** Draws one toast the manager keeps, as a `Toast`. */
  children: (toast: StandingToast<Data>) => ReactNode;
}): React.JSX.Element {
  return (
    <BaseToast.Provider
      toastManager={manager}
      limit={TOAST_LIMIT}
      timeout={Duration.toMillis(TOAST_HOLD)}
    >
      <BaseToast.Portal container={container}>
        <BaseToast.Viewport
          className="ui-toast-stack pointer-events-none fixed z-toast"
          aria-label={label}
        >
          <Standing draw={children} />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
