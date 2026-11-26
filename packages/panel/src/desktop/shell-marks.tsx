/**
 * shell-marks.tsx -- what the pages drawn in the shell say of themselves, worn on the shell as attributes its stylesheet reads, rather than a `:has()` over what it draws.
 *
 * A `:has()` on the shell reads what any page under it draws, so Chromium
 * checks it again whenever an element is added or taken away anywhere under
 * the shell, each check a walk of the shell's tree: every line an agent
 * wrote into its transcript walked the window several times over. So a page
 * says what the shell's stylesheet reads by a mark it holds while it stands
 * (`useShellMark`), and the shell wears each mark held as an attribute of
 * its own (`useShellMarks`). Note that a mark is held by a layout effect, so
 * it lands before the window paints, and that a page kept hidden, as the
 * Inbox between visits (`desktop-shell.tsx`'s `KeptPage`), holds none, since
 * React lets go of a hidden page's effects.
 */

import {
  createContext,
  type RefCallback,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";

/** What a page says of itself to the shell, by the attribute the shell wears it as. */
export const SHELL_MARK = {
  /** A task's or an agent's page stands in the shell's main: a page with tabs, the Inbox's aside. */
  TASK_PAGE: "data-task-page",
  /** The agents' row stands across a task's page. */
  AGENTS_ROW: "data-agents-row",
  /** A side panel stands, beside its page or over it. */
  SIDE_PANEL: "data-side-panel",
  /** A side panel fills the window. */
  FULL_SCREEN_PANEL: "data-full-screen-panel",
} as const;

export type ShellMark = (typeof SHELL_MARK)[keyof typeof SHELL_MARK];

/** Holds a mark on the shell until the answer lets it go; nothing where no shell is drawn. */
type HoldMark = (mark: ShellMark) => () => void;

/** What the shell wears its marks by: the ref its element takes, and the door its pages hold marks through. */
interface ShellMarksHolder {
  readonly ref: RefCallback<HTMLElement>;
  readonly hold: HoldMark;
}

const ShellMarksContext = createContext<HoldMark>(() => () => undefined);

/**
 * The marks the pages under the shell hold, worn on the element `ref` takes,
 * each as its attribute for as long as any page holds it. Note that the
 * marks are counted apart from the element and worn again as it is taken,
 * because React lays a page's effects before it hands its shell the element
 * they stand in, so a shell drawn with its page, as one coming back from
 * Settings is, hears its page's marks before it has an element to wear them
 * on; and that they are written onto the element itself, as `stage-room.ts`
 * writes the room, so a page coming or going draws the shell no more than
 * it did.
 */
export function useShellMarks(): ShellMarksHolder {
  const held = useRef(new Map<ShellMark, number>());
  const element = useRef<HTMLElement | null>(null);

  // Wears `mark` on the element as the pages hold it now: none where none does.
  const wear = useCallback((mark: ShellMark) => {
    const shell = element.current;

    if (shell === null) return;
    const count = held.current.get(mark) ?? 0;

    if (count > 0) shell.setAttribute(mark, "");
    else shell.removeAttribute(mark);
  }, []);

  const ref = useCallback<RefCallback<HTMLElement>>(
    (shell) => {
      element.current = shell;

      for (const mark of held.current.keys()) wear(mark);

      return () => {
        element.current = null;
      };
    },
    [wear],
  );

  const hold = useCallback<HoldMark>(
    (mark) => {
      held.current.set(mark, (held.current.get(mark) ?? 0) + 1);
      wear(mark);

      return () => {
        held.current.set(mark, (held.current.get(mark) ?? 1) - 1);
        wear(mark);
      };
    },
    [wear],
  );

  return { ref, hold };
}

/** Hands the pages under the shell the door they hold their marks through (`useShellMarks`). */
export function ShellMarks({
  hold,
  children,
}: {
  hold: HoldMark;
  children: React.ReactNode;
}): React.JSX.Element {
  return <ShellMarksContext value={hold}>{children}</ShellMarksContext>;
}

/** Holds `mark` on the shell while the caller stands; none where `mark` is none. */
export function useShellMark(mark: ShellMark | undefined): void {
  const hold = useContext(ShellMarksContext);

  useLayoutEffect(() => (mark === undefined ? undefined : hold(mark)), [hold, mark]);
}
