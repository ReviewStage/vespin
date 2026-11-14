import { ComputerUseIcon, DisplayIcon } from "../../icons/lucide-glyphs.js";

/**
 * app-icon.tsx -- an app on the developer's Mac drawn by its own icon, as its bundle draws it in the Dock, or by a stand-in glyph where there is none to draw.
 *
 * An agent's call on an app, the ask that lets it, and the apps allowed
 * without asking each name the app by its icon, so the reader knows it at a
 * glance. The icon comes as an address the caller has, a `data:` address of
 * the PNG the Mac sent or a picture the window read; where it has none, or
 * none yet, a screen's glyph stands in its seat, at the same size, so the
 * line around it does not move as the picture lands. A call on an app no
 * icon is known for yet stands computer use's mark there instead, as the
 * Computer use switch wears it, since all it knows is that an app is used.
 * It is a picture of the app and no word of its own: the name beside it
 * says which app it is.
 */

export const APP_ICON_SIZE = {
  /** In a line's glyph seat, as a call's row draws its kind's icon. */
  LINE: "line",
  /** As a row's lead mark. */
  LEAD: "lead",
  /** As a card's mark, over the words it heads. */
  CARD: "card",
} as const;

export type AppIconSize = (typeof APP_ICON_SIZE)[keyof typeof APP_ICON_SIZE];

/** What stands in the icon's seat where there is no icon to draw: a screen, for an app, or computer use's mark, for a call on whatever app the agent uses. */
export const APP_ICON_STAND_IN = {
  APP: "app",
  COMPUTER_USE: "computer-use",
} as const;

export type AppIconStandIn = (typeof APP_ICON_STAND_IN)[keyof typeof APP_ICON_STAND_IN];

const STAND_IN = {
  [APP_ICON_STAND_IN.APP]: DisplayIcon,
  [APP_ICON_STAND_IN.COMPUTER_USE]: ComputerUseIcon,
} as const satisfies Record<AppIconStandIn, () => React.JSX.Element>;

const SEAT = {
  [APP_ICON_SIZE.LINE]: "size-icon-16",
  [APP_ICON_SIZE.LEAD]: "size-icon-20",
  [APP_ICON_SIZE.CARD]: "size-icon-40",
} as const satisfies Record<AppIconSize, string>;

export function AppIcon({
  src,
  size = APP_ICON_SIZE.LINE,
  standIn = APP_ICON_STAND_IN.APP,
}: {
  /** The icon's address, none where there is none to draw yet. */
  src?: string | undefined;
  size?: AppIconSize | undefined;
  /** What stands in its seat while there is no icon to draw. */
  standIn?: AppIconStandIn | undefined;
}): React.JSX.Element {
  const seat = SEAT[size];

  if (src === undefined) {
    const StandIn = STAND_IN[standIn];

    return (
      <span
        className={`ui-app-icon inline-flex flex-none ${seat} [&>svg]:size-full`}
        aria-hidden="true"
      >
        <StandIn />
      </span>
    );
  }

  return (
    <img
      className={`ui-app-icon block flex-none ${seat} object-contain`}
      src={src}
      alt=""
      aria-hidden="true"
    />
  );
}
