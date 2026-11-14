/**
 * call-card.tsx -- the standing call as a small card: the agent it is with as its chip, which is the way back to it, its task's name, and the call bar under them.
 *
 * One card, drawn in whichever one place the call is not otherwise on
 * screen: at the foot of the column at a window's left while the window
 * shows anything but the call's agent, in the window's corner while that
 * column is folded, and alone in a floating window while no window of the
 * app has the keyboard. It carries no words of the conversation, and decides
 * nothing: every press is handed back to its owner, which holds the call.
 */

import type { AnimationEvent, ReactNode } from "react";
import {
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_LOOK,
  CARD_PADDING,
  CARD_SHADOW,
  Card,
} from "../card/card.js";
import { INLINE_REF_LOOK, InlineRef } from "../inline-ref/inline-ref.js";
import { KeepFocus } from "../keep-focus/keep-focus.js";
import { OneLine } from "../one-line/one-line.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { CallBar, type CallLevels, type CallMuteState, type CallStatus } from "./call-controls.js";

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

/** The chip's press, for a reader: what it opens. */
function openLabel(name: string): string {
  return `Open ${name}`;
}

/** The agent a call is with, as its owner hands it: the name it goes by, and its tile, wearing where its work stands, as every place naming an agent draws it. */
export interface CallAgent {
  readonly name: string;
  readonly tile: ReactNode;
}

/**
 * The card rises in as a menu does and leaves the same way, and takes no
 * press on its way out. Alone in the floating window, which shows and hides
 * it whole, it neither rises nor leaves, its shadow keeps within the room
 * the window leaves it, and on the Mac the whole card drags the window but
 * its buttons, which each answer their press. Its ground, edge, corner,
 * and shadow are a raised `Card`'s, at a dialog's corner on a menu's
 * shadow.
 */
const CARD =
  "ui-call-card flex flex-col gap-ui-4 px-ui-12 py-ui-8 text-label text-foreground animate-call-card-in data-[surface=sidebar]:mb-ui-8 data-[leaving=true]:pointer-events-none data-[leaving=true]:animate-call-card-out data-[surface=window]:w-call-window-card data-[surface=window]:animate-none data-[surface=window]:shadow-toast-dismiss in-data-[ui-profile=desktop]:data-[surface=window]:[-webkit-app-region:drag] in-data-[ui-profile=desktop]:data-[surface=window]:[&_button]:[-webkit-app-region:no-drag]";

/**
 * The card's head, read as a row of the agents' list: the agent's chip, its
 * tile and its name as one press that opens it, and the call's task by name
 * under it, both cut short on one line. The floating window is too small to
 * hold a tooltip, so there the system's own hint names the agent whole.
 */
function CallCardHead({
  agent,
  taskName,
  titled,
  onReturn,
}: {
  agent: CallAgent;
  taskName: string | undefined;
  titled: boolean;
  onReturn: () => void;
}): React.JSX.Element {
  return (
    <div className="ui-call-card-head flex min-w-0 flex-col gap-ui-2">
      <span className="ui-call-card-agent flex min-w-0" title={titled ? agent.name : undefined}>
        <InlineRef
          look={INLINE_REF_LOOK.WASH}
          glyph={agent.tile}
          label={agent.name}
          pressLabel={openLabel(agent.name)}
          onPress={onReturn}
          hint={titled ? false : undefined}
        />
      </span>
      {taskName === undefined ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} className="min-w-0">
          <OneLine>{taskName}</OneLine>
        </Text>
      )}
    </div>
  );
}

/**
 * The card as drawn from what it is handed: the agent's chip, which is the
 * way back to it, over the call's task by name, over the call bar: the
 * agent's line or the call's stage at the left, and the mutes and End
 * call at the right. There is no ×: End call is the way to put a call away, and a live
 * call nobody can see is what the card is for. In the floating window a
 * press acts without taking the focus (`KeepFocus`), so the next drag never
 * finds a button holding it. A card `leaving` slides out, and says so
 * (`onLeft`) once it has, so its dock can let it go.
 */
export function CallCard({
  agent,
  taskName,
  status,
  microphone,
  speaker,
  levels,
  surface,
  onReturn,
  onEnd,
  leaving = false,
  onLeft,
}: {
  agent: CallAgent;
  /** The call's task by name; none where its task is not listed. */
  taskName: string | undefined;
  /** The call bar's line; absent while the call names none. */
  status: CallStatus | undefined;
  microphone: CallMuteState;
  speaker: CallMuteState;
  /** The call's levels, which ring the mutes as each voice speaks; none draws them still, as the floating window, which holds no audio, does. */
  levels?: CallLevels | undefined;
  surface: CallCardSurface;
  /** Opens the call's agent, the chip's press. */
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
      <CallCardHead agent={agent} taskName={taskName} titled={inWindow} onReturn={onReturn} />
      {/* A block of its own, as an agent's page holds it, so the bar spans the card. */}
      <div>
        <CallBar
          status={status}
          microphone={microphone}
          speaker={speaker}
          levels={levels}
          onEnd={onEnd}
          titled={inWindow}
        />
      </div>
    </>
  );

  return (
    <Card
      as={CARD_ELEMENT.SECTION}
      look={CARD_LOOK.RAISED}
      corner={CARD_CORNER.DIALOG}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.MENU}
      className={CARD}
      aria-label={CALL_CARD_LABEL}
      data-surface={surface}
      data-leaving={String(leaving)}
      onAnimationEnd={left}
    >
      {/* Note that the box is drawn as its children alone, so the card lays them out either way. */}
      {inWindow ? <KeepFocus className="contents">{body}</KeepFocus> : body}
    </Card>
  );
}
