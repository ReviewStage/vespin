/**
 * call-window-card.tsx -- the floating call window's root: the card of the call the document carries, and nothing else.
 *
 * The window holds no call of its own. It draws the call the panel holding
 * it told the Mac (`voiceCall` on the document), through the same props as
 * the panel's own docked card (`callCardOf`), and each press is an act main
 * hands to that panel, which answers it as a press of its own card; the
 * way back main answers itself, bringing that panel forward on the call's
 * agent. With no call standing it draws nothing, as main hides it then.
 */

import { VOICE_CALL_PRESS, type VoiceCallPress } from "@repo/features/voice-wire";
import { ACT_KIND } from "@repo/host/acts";
import { tellAct } from "@repo/panel/act";
import { type CallCardPresses, callCardOf } from "@repo/panel/call/call-card-of";
import { appStateQuery, selectVoiceCall } from "@repo/panel/use-app-state";
import { CALL_CARD_SURFACE, CallCard } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";

/** Tells main of one press on the card. */
function press(sent: VoiceCallPress): void {
  tellAct(ACT_KIND.VOICE_CALL_PRESS, { press: sent });
}

const PRESSES: CallCardPresses = {
  setMicrophoneMuted: (muted) => press({ press: VOICE_CALL_PRESS.MICROPHONE, muted }),
  setSpeakerMuted: (muted) => press({ press: VOICE_CALL_PRESS.SPEAKER, muted }),
  end: () => press({ press: VOICE_CALL_PRESS.END }),
  open: () => press({ press: VOICE_CALL_PRESS.OPEN }),
};

export function CallWindowCard(): React.JSX.Element | null {
  const call = useQuery({ ...appStateQuery, select: selectVoiceCall }).data;

  if (call === undefined || call === null) return null;

  return <CallCard {...callCardOf(call, PRESSES)} surface={CALL_CARD_SURFACE.WINDOW} />;
}
