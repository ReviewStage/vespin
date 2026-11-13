/**
 * call-card.tsx -- the standing call as a small card: the name of what it is about, the way back to it, and the call bar under them.
 *
 * One card, drawn in whichever one place the call is not otherwise on
 * screen: at the foot of the column at a window's left while the window
 * shows anything but the call's agent, in the window's corner while that
 * column is folded, and alone in a floating window while no window of the
 * app has the keyboard. It carries no words of the conversation, and decides
 * nothing: every press is handed back to its owner, which holds the call.
 */

import type { AnimationEvent } from "react";
import { ReturnIcon } from "../../icons/lucide-glyphs.js";
import { IconButton } from "../button/button.js";
import { KeepFocus } from "../keep-focus/keep-focus.js";
import { OneLine } from "../one-line/one-line.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";
import { CallBar, type CallMuteState, type CallStatus } from "./call-controls.js";

/** What the card is named for a reader. */
const CALL_CARD_LABEL = "Call";

/** Where a card is drawn, which decides how its way back is hinted and whether a press takes the focus. */
export const CALL_CARD_SURFACE = {
  /** At the foot of the column at a window's left. */
  SIDEBAR: "sidebar",
  /** In a window's bottom-left corner, while that column is folded. */
  FLOATING: "floating",
  /** Alone in the floating window, over whatever app is in front. */
  WINDOW: "window",
} as const;

export type CallCardSurface = (typeof CALL_CARD_SURFACE)[keyof typeof CALL_CARD_SURFACE];

/** The way back's name, for a reader and its hover: what it opens. */
function returnLabel(name: string): string {
  return `Open ${name}`;
}

/**
 * The card rises in as a menu does and leaves the same way, and takes no
 * press on its way out. Alone in the floating window, which shows and hides
 * it whole, it neither rises nor leaves, its shadow keeps within the room
 * the window leaves it, and on the Mac the whole card drags the window but
 * its buttons, which each answer their press.
 */
const CARD =
  "ui-call-card flex flex-col gap-ui-4 rounded-ui-14 border border-border-strong bg-popover px-ui-12 py-ui-8 text-label text-foreground shadow-menu animate-call-card-in data-[surface=sidebar]:mb-ui-8 data-[leaving=true]:pointer-events-none data-[leaving=true]:animate-call-card-out data-[surface=window]:w-call-window-card data-[surface=window]:animate-none data-[surface=window]:shadow-toast-dismiss in-data-[ui-profile=desktop]:data-[surface=window]:[-webkit-app-region:drag] in-data-[ui-profile=desktop]:data-[surface=window]:[&_button]:[-webkit-app-region:no-drag]";

/**
 * The card's head: what the call is about by name, its task's or its
 * agent's where it has no task, cut short on one line, and the way back to
 * it beside the name. The floating window is too small to hold a tooltip,
 * so there the system's own hint names what the button opens.
 */
function CallCardHead({
  name,
  titled,
  onReturn,
}: {
  name: string;
  titled: boolean;
  onReturn: () => void;
}): React.JSX.Element {
  const label = returnLabel(name);
  const button = <IconButton icon={<ReturnIcon />} label={label} onClick={onReturn} />;

  return (
    <div className="ui-call-card-head flex min-w-0 items-center gap-tight-gap">
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} className="min-w-0 flex-1">
        <OneLine>{name}</OneLine>
      </Text>
      {titled ? (
        <span className="ui-call-card-return flex" title={label}>
          {button}
        </span>
      ) : (
        <Tooltip label={label}>{button}</Tooltip>
      )}
    </div>
  );
}

/**
 * The card as drawn from what it is handed: the call's task by name, with
 * the way back beside it, over the call bar itself, the same component an
 * agent's own page draws, so its status, its mutes, and its end are the
 * bar's in every word, glyph, and color, and restyling the bar restyles the
 * card. There is no ×: End call is the way to put a call away, and a live
 * call nobody can see is what the card is for. In the floating window a
 * press acts without taking the focus (`KeepFocus`), so the next drag never
 * finds a button holding it. A card `leaving` slides out, and says so
 * (`onLeft`) once it has, so its dock can let it go.
 */
export function CallCard({
  name,
  status,
  microphone,
  speaker,
  surface,
  onReturn,
  onEnd,
  leaving = false,
  onLeft,
}: {
  /** The call's task by name, or its agent's where it has no task. */
  name: string;
  /** The call bar's two lines; absent while the voice names none. */
  status: CallStatus | undefined;
  microphone: CallMuteState;
  speaker: CallMuteState;
  surface: CallCardSurface;
  /** Opens what the call is about. */
  onReturn: () => void;
  onEnd: () => void;
  /** Whether the card is on its way out, which it slides through before it is gone. */
  leaving?: boolean | undefined;
  onLeft?: (() => void) | undefined;
}): React.JSX.Element {
  const left = (event: AnimationEvent<HTMLElement>) => {
    if (leaving && event.target === event.currentTarget) onLeft?.();
  };

  const inWindow = surface === CALL_CARD_SURFACE.WINDOW;

  const body = (
    <>
      <CallCardHead name={name} titled={inWindow} onReturn={onReturn} />
      {/* A block of its own, as an agent's page holds it, so the bar spans the card. */}
      <div>
        <CallBar
          status={status}
          microphone={microphone}
          speaker={speaker}
          onEnd={onEnd}
          titled={inWindow}
        />
      </div>
    </>
  );

  return (
    <section
      className={CARD}
      aria-label={CALL_CARD_LABEL}
      data-surface={surface}
      data-leaving={String(leaving)}
      onAnimationEnd={left}
    >
      {/* Note that the box is drawn as its children alone, so the card lays them out either way. */}
      {inWindow ? <KeepFocus className="contents">{body}</KeepFocus> : body}
    </section>
  );
}
