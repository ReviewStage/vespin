/**
 * message.tsx -- one turn of a conversation, and the bar of actions in the line under it, shown while the pointer or the keyboard is on the turn and, on a screen with no hover, once the turn is tapped.
 *
 * A transcript of hundreds of turns would be a column of buttons if every
 * turn's actions stood at rest, so a `MessageActions` bar inside a
 * `MessageFrame` stays hidden, and takes no pointer, until the pointer rests
 * on the turn or the keyboard is on one of its actions. A
 * screen with no hover has none to show them by, so a frame that
 * `revealActionsOnTap` shows them at a tap on the turn, anywhere but a
 * control of its own, and hides them at another. The screen is asked at the
 * tap, never kept, so a mouse changes nothing, and a press that ends a
 * selection of the turn's words leaves them be. The turn's own look, who
 * said it and where it stands in the column, is its caller's.
 *
 * The bar's actions are drawn once the frame the turn was first drawn in has
 * painted, or at once where the pointer or the focus comes onto the turn
 * first, since the bar is hidden at rest and a transcript opened draws
 * many turns at once. Until then each action stands as a box the size of
 * the compact icon button it waits to be (`HeldMessageAction`), so the line
 * under the turn stands as it will.
 *
 * The reveal is drawn in the Tailwind theme's utilities: the frame is the
 * group its bar answers (`group/message`), the pointer's rest counting only
 * where there is a hover, a tap's only where there is none, and a bar whose
 * action holds a hover card standing (`Tooltip` marks it described) while
 * the pointer crosses onto the card, off the turn.
 */

import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  startTransition,
  useContext,
  useEffect,
  useState,
} from "react";
import { afterPaint } from "../../after-paint.js";

/** What a tap may land on in a turn that is a control of its own, which a tap works rather than showing the turn's actions. */
const OWN_CONTROL =
  "a, button, summary, input, textarea, select, label, [role='button'], [role='tab']";

/** The media query a screen with no hover answers, the one message.css shows a tapped turn's actions under. */
const NO_HOVER = "(hover: none)";

/** The turn, the group its actions answer. */
const FRAME = "ui-message group/message";

/** The bar, hidden and taking no pointer until the turn, its keyboard, or its hover card asks it up, its marks spaced on a coarse pointer so their finger-wide presses never overlap. */
const ACTIONS =
  "ui-message-actions pointer-events-none flex flex-none items-center gap-ui-2 pointer-coarse:gap-ui-20 opacity-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit focus-within:pointer-events-auto focus-within:opacity-100 has-[[aria-describedby]]:pointer-events-auto has-[[aria-describedby]]:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 no-hover:group-data-[actions-shown=true]/message:pointer-events-auto no-hover:group-data-[actions-shown=true]/message:opacity-100";

/** An action waiting to be drawn: the box of the compact icon button it stands in for (`icon-compact`), drawn nothing in. */
const HELD_ACTION = "ui-message-action-held inline-flex size-6 flex-none";

/** Whether the actions of the turn around are drawn yet; outside a `MessageFrame`, always. */
const ActionsDrawnContext = createContext(true);

/** Whether a turn's actions are drawn, and what draws them at once. */
interface ActionsDrawn {
  readonly drawn: boolean;
  readonly draw: () => void;
}

/**
 * Whether a turn's actions are drawn: once the frame it was first drawn in
 * has painted, in a transition, so drawing them gives way to the reader; or
 * at once, from `draw`, where the pointer or the focus comes onto the turn.
 */
function useActionsDrawn(): ActionsDrawn {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (drawn) return undefined;

    return afterPaint(() => startTransition(() => setDrawn(true)));
  }, [drawn]);

  return { drawn, draw: () => setDrawn(true) };
}

/**
 * One turn, holding its words and its actions. `className` is the caller's
 * skin for the turn; the frame draws nothing of its own but the reveal.
 */
export function MessageFrame({
  revealActionsOnTap = false,
  className,
  children,
  onFocus,
  onPointerEnter,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "className" | "onClick"> & {
  /** Whether a tap on a screen with no hover shows the turn's actions, and another hides them. */
  revealActionsOnTap?: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  const [actionsShown, setActionsShown] = useState(false);
  const actions = useActionsDrawn();

  const tap = (event: React.MouseEvent<HTMLDivElement>) => {
    // Note that a tap draws the turn's actions, as a pointer coming onto it does, so the bar it shows holds them.
    actions.draw();

    // A tap spent on something of the turn's own, a control or a hint it opened, shows nothing more.
    if (event.defaultPrevented) return;

    if (event.target instanceof Element && event.target.closest(OWN_CONTROL) !== null) return;

    if (window.getSelection()?.isCollapsed === false) return;

    if (!window.matchMedia(NO_HOVER).matches) return;
    setActionsShown((shown) => !shown);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a tap stands in for the hover a finger lacks; the keyboard reaches the actions themselves, which show while they hold it.
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above, the keyboard needs no key here, since focusing an action shows the bar.
    <div
      {...props}
      className={className === undefined ? FRAME : `${FRAME} ${className}`}
      data-actions-shown={actionsShown ? "true" : undefined}
      onClick={revealActionsOnTap ? tap : undefined}
      // Note that the focus coming onto the turn draws its actions at once, so a turn the keyboard is on never lacks them.
      onFocus={(event) => {
        actions.draw();
        onFocus?.(event);
      }}
      onPointerEnter={(event) => {
        actions.draw();
        onPointerEnter?.(event);
      }}
    >
      <ActionsDrawnContext value={actions.drawn}>{children}</ActionsDrawnContext>
    </div>
  );
}

/**
 * One action of a turn's bar, drawn once the turn's actions are
 * (`MessageFrame`), and until then a box the size of the compact icon
 * button it stands in for, which says nothing to a reader. An action that
 * draws nothing says so before it is held, as it would after.
 */
export function HeldMessageAction({ children }: { children: ReactNode }): ReactNode {
  return useContext(ActionsDrawnContext) ? children : <span className={HELD_ACTION} aria-hidden />;
}

/**
 * The actions on a turn, set in the line under it (`MessageLine`) beside who
 * sent it and when. Hidden, the bar takes no pointer, so the words above it
 * stay selectable.
 */
export function MessageActions({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className={ACTIONS}>{children}</div>;
}
