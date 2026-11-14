import type { ReactNode } from "react";
import { MinimizeIcon } from "../../icons/lucide-glyphs.js";
import { PICTURE_STATE, type PictureState } from "../../picture-read.js";
import { AgentPointer, type AgentPointerKind } from "../agent-pointer/agent-pointer.js";
import { APP_ICON_SIZE, AppIcon } from "../app-icon/app-icon.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import { CARD_CORNER, CARD_LOOK, CARD_PADDING, CARD_SHADOW, Card } from "../card/card.js";
import { CardPress } from "../card-press/card-press.js";
import { CHIP_LOOK, CHIP_SIZE, Chip, ChipName, StaticChip } from "../chip/chip.js";
import { Menu, useMenu } from "../menu/menu.js";
import { PictureStandIn } from "../picture-set/picture-set.js";
import { PICTURE_TILE_FACE, PictureTile } from "../picture-tile/picture-tile.js";
import { SPINNER_SIZE, SpinnerRing } from "../spinner/spinner.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";
import { WorkingMark } from "../working-mark/working-mark.js";

/**
 * app-window-stack.tsx -- the apps an agent is using on the developer's Mac, as a stack of their windows floating over its box, or minimized to a pill.
 *
 * The app in front stands as a window: a title bar over the newest window
 * the agent read of it. Every title in the stack, the front's and each one
 * behind it, says the same two things: the app, by its icon and name, and
 * the working mark where the agent is in it now. The front's name is a chip
 * that looks the same on every device and hangs the app's card where the
 * caller hands one (`MacAppCard`); on the Mac the agent uses, where the
 * caller hands `onShowApp`, a press on it brings that app's own window
 * forward. The window stands in a frame of one size whatever its shape,
 * centered on a quiet ground, so the stack keeps still as the apps change,
 * and the picture runs to the card's edge, the card's corner rounding it. A
 * press on the picture opens it full size, where the caller lets the viewer
 * walk the other apps' windows too. A window not read yet holds the frame
 * with a spinner, one whose read did not land holds it with Retry and is no
 * press, and an app whose window the agent never read stands as its icon.
 * Where the agent's cursor stands over the window in front, its pointer
 * (`AgentPointer`) is drawn over the picture at that spot, gliding as the
 * agent moves it, as its cursor does on the Mac; the picture may lag a press
 * or two behind it, until the agent reads the window again.
 *
 * The other apps stand behind it as cards peeking out above it, stepping in
 * from the edge as a deck does, at most two: the one used last nearest as
 * its title, a press bringing it forward, and either the next as its title
 * too or, where more stand, the rest as a pile of their icons, a press
 * listing them and a choice bringing one forward. Minimize puts the stack
 * down to its pill (`AppStackPill`), the same pile and the app the agent is
 * in, which brings it back. What stops the turn is the box's own Stop.
 *
 * Its place over the box is the caller's (`className`), as is its width in
 * a narrow room (`--ui-app-window-width`, the frame's own where unset), and
 * it is left out of the screen recording, since a window can hold anything
 * on the developer's screen. It is drawn in Tailwind utilities over the
 * theme, its cards `Card`s.
 */

/** What the stack says. */
const WORDS = {
  MINIMIZE: "Minimize",
  SHOW_ON_MAC: (name: string) => `Show ${name} on your Mac`,
  FORWARD: (name: string) => `Bring ${name} forward`,
  MORE: "More apps this turn",
  MORE_COUNT: (count: number) => `${String(count)} more apps`,
  RESTORE: "Show the apps' windows",
  APPS_COUNT: (count: number) => `${String(count)} apps`,
} as const;

/** How many cards stand behind the window in front: past it, the deepest holds the rest as a pile. */
const MOST_BEHIND = 2;

/** Each icon of a pile by where it stands: the first on top, each after it overlapping the one before and under it. */
const PILE_PLACE = [
  "z-3",
  "z-2 -ms-actor-overlap",
  "z-1 -ms-actor-overlap",
  "-ms-actor-overlap",
] as const;

/** Each card behind the front window, by its depth from it: stepping in from the edge, the deeper the further. */
const BEHIND_INSET = ["mx-app-window-peek", "mx-app-window-peek-twice"] as const;

/** The agent's pointer over an app's window: where it stands as a share of the window from its top left, what it does there, the move it stands at, and whether it shows, as it does while the agent works. */
export interface StackedPointer {
  readonly x: number;
  readonly y: number;
  readonly kind: AgentPointerKind;
  readonly move: string;
  readonly shown: boolean;
}

/** An app in the stack: what tells it apart from every other, such as its bundle id, its name, its icon's address, and its newest window, where the agent read one, with the agent's pointer where it stands over that window. Note that two apps may share a name, so the stack knows each by its id and only shows its name. */
export interface StackedApp {
  readonly id: string;
  readonly name: string;
  readonly iconSrc?: string | undefined;
  readonly window?:
    | {
        readonly state: PictureState;
        readonly width: number;
        readonly height: number;
        readonly pointer?: StackedPointer | undefined;
      }
    | undefined;
  /** The card its name's chip hangs (`MacAppCard`); none where the caller has none. */
  readonly card?: ReactNode;
}

/** Apps as a pile of their icons, at most four, each overlapping the one before it, the first on top. */
function IconPile({ apps }: { apps: readonly StackedApp[] }): React.JSX.Element {
  return (
    <span className="ui-app-icon-pile inline-flex items-center" aria-hidden="true">
      {apps.slice(0, PILE_PLACE.length).map((app, at) => (
        <span key={app.id} className={`relative inline-flex ${PILE_PLACE[at] ?? ""}`}>
          <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.LINE} />
        </span>
      ))}
    </span>
  );
}

/** The window in front, in its frame: its picture, a spinner while it is read, Retry where the read did not land, or the app's icon where none was read. */
function WindowFace({ app }: { app: StackedApp }): React.JSX.Element {
  const window = app.window;

  if (window?.state.kind === PICTURE_STATE.READY) {
    const pointer = window.pointer;

    // Note that the pointer stands over the picture alone, which the tile's face hugs and positions.
    return (
      <>
        <img
          className="ui-app-window block h-auto max-h-app-window-tall w-auto max-w-full"
          src={window.state.url}
          width={window.width}
          height={window.height}
          alt=""
        />
        {pointer === undefined ? null : (
          <AgentPointer
            x={pointer.x}
            y={pointer.y}
            kind={pointer.kind}
            move={pointer.move}
            shown={pointer.shown}
          />
        )}
      </>
    );
  }

  return (
    <span className="ui-app-window-stand-in flex h-app-window-tall items-center justify-center px-block-gap">
      {window?.state.kind === PICTURE_STATE.READING ? (
        <SpinnerRing size={SPINNER_SIZE.REGION} />
      ) : window?.state.kind === PICTURE_STATE.FAILED ? (
        <PictureStandIn
          state={PICTURE_STATE.FAILED}
          words={app.name}
          onRetry={window.state.retry}
          failure={window.state.failure}
        />
      ) : (
        <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.CARD} />
      )}
    </span>
  );
}

/** The app's icon and name, the same chip on every device, hanging the app's card; a press brings its own window forward where the caller can. */
function AppName({
  app,
  onShowApp,
}: {
  app: StackedApp;
  onShowApp: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const face = (
    <>
      <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.LINE} />
      <ChipName>{app.name}</ChipName>
    </>
  );

  if (onShowApp === undefined) {
    return (
      <Tooltip label={app.name} card={app.card}>
        <StaticChip look={CHIP_LOOK.TOOLBAR} size={CHIP_SIZE.COMPACT}>
          {face}
        </StaticChip>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={app.name} card={app.card}>
      <Chip
        look={CHIP_LOOK.TOOLBAR}
        size={CHIP_SIZE.COMPACT}
        aria-label={WORDS.SHOW_ON_MAC(app.name)}
        onClick={() => onShowApp(app.id)}
      >
        {face}
      </Chip>
    </Tooltip>
  );
}

/** A card peeking out above the one in front of it, stepping in from the edge by its depth. */
function Behind({
  depth,
  children,
}: {
  depth: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card
      look={CARD_LOOK.SURFACE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.SOFT}
      className={`ui-app-window-behind relative -mb-app-window-peek ${BEHIND_INSET[depth] ?? ""}`}
    >
      {children}
    </Card>
  );
}

/** An app behind the window in front, as its title: a press brings it forward. */
function BehindTitle({
  app,
  using,
  depth,
  onPick,
}: {
  app: StackedApp;
  using: boolean;
  depth: number;
  onPick: (id: string) => void;
}): React.JSX.Element {
  return (
    <Behind depth={depth}>
      <CardPress label={WORDS.FORWARD(app.name)} onPress={() => onPick(app.id)}>
        <span className="flex min-w-0 items-center gap-ui-6 pt-ui-4 pb-ui-12 ps-ui-8 pe-ui-8">
          <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.LINE} />
          <Text
            variant={TEXT_VARIANT.LABEL}
            tone={using ? TEXT_TONE.DEFAULT : TEXT_TONE.MUTED}
            truncate
          >
            {app.name}
          </Text>
          {using ? <WorkingMark /> : null}
        </span>
      </CardPress>
    </Behind>
  );
}

/** The apps past the stack's room, as one card of their icons piled: a press lists them, a choice brings one forward. */
function BehindPile({
  apps,
  using,
  depth,
  onPick,
}: {
  apps: readonly StackedApp[];
  using: string | undefined;
  depth: number;
  onPick: (id: string) => void;
}): React.JSX.Element {
  const menu = useMenu(true);

  return (
    <Behind depth={depth}>
      <span className="flex items-center gap-ui-6 pt-ui-4 pb-ui-12 ps-ui-4 pe-ui-4">
        <Chip look={CHIP_LOOK.TOOLBAR} size={CHIP_SIZE.COMPACT} chevron {...menu.trigger()}>
          <IconPile apps={apps} />
          <ChipName>{WORDS.MORE_COUNT(apps.length)}</ChipName>
        </Chip>
        {apps.some((app) => app.id === using) ? <WorkingMark /> : null}
      </span>
      {menu.drawn === undefined ? null : (
        <Menu
          label={WORDS.MORE}
          menu={menu.drawn}
          groups={[
            apps.map((app) => ({
              key: app.id,
              label: app.name,
              icon: <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.LINE} />,
              tag: app.id === using ? <WorkingMark /> : undefined,
              onSelect: () => onPick(app.id),
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </Behind>
  );
}

export function AppWindowStack({
  label,
  apps,
  shown,
  using,
  onPick,
  onOpen,
  onMinimize,
  onShowApp,
  className,
}: {
  /** What the stack is named to a reader. */
  label: string;
  /** The apps, the one used last first; nothing is drawn for none. */
  apps: readonly StackedApp[];
  /** The app in front, by its id; the one used last where it names none of them. */
  shown?: string | undefined;
  /** The app the agent is in now, by its id; none while it is in none, or done. */
  using?: string | undefined;
  /** Brings an app forward, by its id. */
  onPick: (id: string) => void;
  /** Opens the window in front full size. */
  onOpen: () => void;
  /** Puts the stack down to its pill. */
  onMinimize: () => void;
  /** Brings an app's own window forward on the Mac, by its id; none where the reader is not at that Mac. */
  onShowApp?: ((id: string) => void) | undefined;
  /** Its owner's class, to place it and nothing else. */
  className?: string | undefined;
}): React.JSX.Element | null {
  const front = apps.find((app) => app.id === shown) ?? apps[0];

  if (front === undefined) return null;
  const others = apps.filter((app) => app !== front);
  // Note that past two apps behind, the nearest keeps its title and the rest pile into the deepest card.
  const titled = others.length > MOST_BEHIND ? others.slice(0, MOST_BEHIND - 1) : others;
  const piled = others.slice(titled.length);
  // Note that a window whose read did not land is no press, since its Retry stands on it and the viewer holds no window it could not read.
  const failed = front.window?.state.kind === PICTURE_STATE.FAILED;

  return (
    <section
      className={`ui-app-window-stack ph-no-capture flex w-(--ui-app-window-width,var(--spacing-app-window-wide)) max-w-full flex-col ${className ?? ""}`}
      aria-label={label}
    >
      {piled.length === 0 ? null : (
        <BehindPile apps={piled} using={using} depth={titled.length} onPick={onPick} />
      )}
      {titled.toReversed().map((app, at) => (
        <BehindTitle
          key={app.id}
          app={app}
          using={app.id === using}
          depth={titled.length - 1 - at}
          onPick={onPick}
        />
      ))}
      <Card
        look={CARD_LOOK.SURFACE}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.FLUSH}
        shadow={CARD_SHADOW.SOFT}
        className="ui-app-window-front relative"
      >
        <div className="flex min-w-0 items-center gap-ui-4 border-b border-border p-ui-4">
          <AppName app={front} onShowApp={onShowApp} />
          {front.id === using ? <WorkingMark /> : null}
          <span className="flex-1" />
          <IconButton
            icon={<MinimizeIcon />}
            label={WORDS.MINIMIZE}
            size={BUTTON_SIZE.COMPACT}
            onClick={onMinimize}
          />
        </div>
        <span className="ui-app-window-ground flex h-app-window-tall items-center justify-center bg-muted">
          {failed ? (
            <WindowFace app={front} />
          ) : (
            <PictureTile name={front.name} face={PICTURE_TILE_FACE.FLUSH} onOpen={onOpen}>
              <WindowFace app={front} />
            </PictureTile>
          )}
        </span>
      </Card>
    </section>
  );
}

/**
 * The stack minimized: the apps' icons piled, the one the agent is in first
 * and named, with the working mark; once the agent is done, how many apps
 * the turn used, or the one it used alone. A press brings the stack back.
 */
export function AppStackPill({
  apps,
  using,
  onRestore,
  className,
}: {
  /** The apps, the one used last first; nothing is drawn for none. */
  apps: readonly StackedApp[];
  /** The app the agent is in now, by its id; none while it is in none, or done. */
  using?: string | undefined;
  onRestore: () => void;
  /** Its owner's class, to place it and nothing else. */
  className?: string | undefined;
}): React.JSX.Element | null {
  const named = apps.find((app) => app.id === using) ?? apps[0];

  if (named === undefined) return null;
  const pile = [named, ...apps.filter((app) => app !== named)];

  const words =
    using !== undefined || apps.length === 1 ? named.name : WORDS.APPS_COUNT(apps.length);

  return (
    <span className={`ui-app-stack-pill ph-no-capture inline-flex ${className ?? ""}`}>
      <Chip look={CHIP_LOOK.PILL} aria-label={WORDS.RESTORE} onClick={onRestore}>
        <IconPile apps={pile} />
        <ChipName>{words}</ChipName>
        {using === undefined ? null : <WorkingMark />}
      </Chip>
    </span>
  );
}
