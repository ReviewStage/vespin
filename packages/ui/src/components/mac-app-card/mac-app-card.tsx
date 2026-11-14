import type { ReactNode } from "react";
import { STATUS_TONE } from "../../status-tone.js";
import { APP_ICON_SIZE, AppIcon } from "../app-icon/app-icon.js";
import {
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardRow,
} from "../hover-card/hover-card.js";

/**
 * mac-app-card.tsx -- the card every chip naming an app on a machine hangs: the app by its icon, name, and bundle id, the machine it is on, and whether that machine lets agents use it unasked.
 *
 * An `@` mention of an app and the app's chip over the stack of the apps an
 * agent is using hang this one card, so the app reads the same wherever the
 * pointer rests on it. Its head is the app's icon and name, its bundle id
 * under the name, and in its corner that the agent is in it now, where it
 * is. Under the head, the machine it is on, as the chip every place names
 * that machine by (the caller's, which hangs that machine's own card), and
 * whether the machine always allows it or asks each time, which only the
 * machine's owner is told, since that is their setting. A row the caller
 * knows nothing for is left out.
 */

/** What the card says. */
const WORDS = {
  IN_USE: "In use",
  MACHINE: "Machine",
  ALLOWED: "Allowed",
  ALWAYS: "Always",
  ASK_EACH_TIME: "Ask each time",
} as const;

export function MacAppCard({
  name,
  bundleId,
  iconSrc,
  inUse = false,
  machine,
  alwaysAllowed,
}: {
  name: string;
  /** The app's bundle id, the line under its name; none for an app with none, or one not known. */
  bundleId?: string | undefined;
  /** The address of the app's icon; a screen's glyph stands in where there is none. */
  iconSrc?: string | undefined;
  /** Whether the agent is in the app now. */
  inUse?: boolean | undefined;
  /** The chip of the machine the app is on; none where it is not known. */
  machine?: ReactNode;
  /** Whether the app's machine lets agents use it without asking; none where the reader is not its owner, or it is not known. */
  alwaysAllowed?: boolean | undefined;
}): React.JSX.Element {
  return (
    <HoverCard data-mac-app-card="">
      <HoverCardHead
        glyph={<AppIcon src={iconSrc} size={APP_ICON_SIZE.LINE} />}
        name={name}
        sub={bundleId === undefined || bundleId === name ? undefined : bundleId}
        corner={inUse ? WORDS.IN_USE : undefined}
        cornerTone={inUse ? STATUS_TONE.WORKING : undefined}
      />
      {machine === undefined ? null : (
        <HoverCardRow look={HOVER_CARD_ROW_LOOK.DETAIL} label={WORDS.MACHINE} end={machine} />
      )}
      {alwaysAllowed === undefined ? null : (
        <HoverCardRow
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          label={WORDS.ALLOWED}
          end={alwaysAllowed ? WORDS.ALWAYS : WORDS.ASK_EACH_TIME}
        />
      )}
    </HoverCard>
  );
}
