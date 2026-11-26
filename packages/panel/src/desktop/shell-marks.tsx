/**
 * shell-marks.tsx -- what the pages drawn in the shell say of themselves, worn on the shell as attributes its stylesheet reads, rather than a `:has()` over what it draws.
 *
 * A `:has()` on the shell reads what any page under it draws, so Chromium
 * checks it again whenever an element is added or taken away anywhere under
 * the shell, each check a walk of the shell's tree: every line an agent
 * wrote into its transcript walked the window several times over. So a page
 * says what the shell's stylesheet reads by a mark it holds while it stands
 * (`useShellMark`), and the shell wears each mark held as an attribute of
 * its own (`ShellMarks`). Note that a mark is held by a layout effect, so it
 * lands before the window paints, and that a page kept hidden, as the Inbox
 * between visits (`desktop-shell.tsx`'s `KeptPage`), holds none, since React
 * lets go of a hidden page's effects.
 */

import { createContext, type RefObject, useCallback, useContext, useLayoutEffect } from "react";

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

const ShellMarksContext = createContext<HoldMark>(() => () => undefined);

/**
 * Wears the marks the pages under `shell` hold, each as its attribute for as
 * long as any page holds it. Note that the attributes are written onto the
 * element itself, as `stage-room.ts` writes the room, so a page coming or
 * going draws the shell no more than it did.
 */
export function ShellMarks({
  shell,
  children,
}: {
  shell: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}): React.JSX.Element {
  const hold = useCallback<HoldMark>(
    (mark) => {
      const element = shell.current;

      if (element === null) return () => undefined;
      const held = Number(element.getAttribute(mark) ?? 0) + 1;
      element.setAttribute(mark, String(held));

      return () => {
        const left = Number(element.getAttribute(mark) ?? 1) - 1;

        if (left > 0) element.setAttribute(mark, String(left));
        else element.removeAttribute(mark);
      };
    },
    [shell],
  );

  return <ShellMarksContext value={hold}>{children}</ShellMarksContext>;
}

/** Holds `mark` on the shell while the caller stands; none where `mark` is none. */
export function useShellMark(mark: ShellMark | undefined): void {
  const hold = useContext(ShellMarksContext);

  useLayoutEffect(() => (mark === undefined ? undefined : hold(mark)), [hold, mark]);
}
