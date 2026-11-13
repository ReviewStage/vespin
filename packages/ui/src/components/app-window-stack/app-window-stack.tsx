import { useId } from "react";
import { cssCustomProperties } from "../../css.js";
import { MinimizeIcon } from "../../icons/lucide-glyphs.js";
import { PICTURE_STATE, type PictureState } from "../../picture-read.js";
import { APP_ICON_SIZE, AppIcon } from "../app-icon/app-icon.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import { CARD_CORNER, CARD_LOOK, CARD_PADDING, CARD_SHADOW, Card } from "../card/card.js";
import { CardPress } from "../card-press/card-press.js";
import { CHIP_LOOK, CHIP_SIZE, Chip, ChipName, StaticChip } from "../chip/chip.js";
import { MENU_ITEM_MARK, Menu, useMenu } from "../menu/menu.js";
import { PictureStandIn } from "../picture-set/picture-set.js";
import { PICTURE_TILE_FACE, PictureTile } from "../picture-tile/picture-tile.js";
import { SPINNER_SIZE, SpinnerRing } from "../spinner/spinner.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { WorkingMark } from "../working-mark/working-mark.js";

/**
 * app-window-stack.tsx -- the apps an agent is using on the developer's Mac, as a stack of their windows floating over its box, or minimized to a pill.
 *
 * The app in front stands as a window: a title bar over the newest window
 * the agent read of it. The title bar says "Using" and the working mark
 * while the agent's newest call is on that app, "Used" once the agent is
 * done, and names the app by a chip that is the same on every device; on
 * the Mac the agent uses, where the caller hands `onShowApp`, the chip
 * brings that app's own window forward. The window stands in a frame of one
 * size whatever its shape, centered on a quiet ground, so the stack keeps
 * still as the apps change, and the picture runs to the card's edge, the
 * card's corner rounding it. A press on the picture opens it full size,
 * where the caller lets the viewer walk the other apps' windows too. A
 * window not read yet holds the frame with a spinner, one whose read did
 * not land holds it with Retry and is no press, and an app whose window the
 * agent never read stands as its icon.
 *
 * The other apps stand behind it, the ones used last nearest, each as its
 * title peeking out above the window in front of it, stepping in from the
 * edge as a deck does: its icon, its name, and what the agent last did in
 * it, or "Using" and the mark where the agent is in it now. A press on a
 * title brings that app forward. At most two stand behind; the rest are in
 * the title bar's "+N" menu, a choice there bringing that app forward too.
 * Minimize puts the stack down to its pill (`AppStackPill`), which brings it
 * back. What stops the turn is the box's own Stop.
 *
 * Its place over the box is the caller's (`className`), as is its width in
 * a narrow room (`--ui-app-window-width`, the frame's own where unset), and
 * it is left out of the screen recording, since a window can hold anything
 * on the developer's screen. It is drawn in Tailwind utilities over the
 * theme, its cards `Card`s.
 */

/** What the stack says. */
const WORDS = {
  USING: "Using",
  USED: "Used",
  MINIMIZE: "Minimize",
  SHOW_ON_MAC: (name: string) => `Show ${name} on your Mac`,
  FORWARD: (name: string) => `Bring ${name} forward`,
  MORE: "More apps this turn",
  USING_NOW: "Using now",
  RESTORE: "Show the apps' windows",
  USED_APPS: (count: number) => `Used ${String(count)} apps`,
  MORE_COUNT: (count: number) => `+${String(count)}`,
} as const;

/** How many apps stand behind the window in front; the rest are in its "+N" menu. */
const MOST_BEHIND = 2;

/** Each title behind the front window, by its depth: stepping in from the edge, the deeper the further. */
const BEHIND_INSET = ["mx-app-window-peek", "mx-app-window-peek-twice"] as const;

/** An app in the stack: its name, its icon's address, its newest window where the agent read one, and what the agent last did in it. */
export interface StackedApp {
  readonly name: string;
  readonly iconSrc?: string | undefined;
  readonly window?:
    | { readonly state: PictureState; readonly width: number; readonly height: number }
    | undefined;
  readonly detail?: string | undefined;
}

/** The window in front, in its frame: its picture, a spinner while it is read, Retry where the read did not land, or the app's icon where none was read. */
function WindowFace({ app }: { app: StackedApp }): React.JSX.Element {
  const window = app.window;

  if (window?.state.kind === PICTURE_STATE.READY) {
    return (
      <img
        className="ui-app-window block h-auto max-h-app-window-tall w-auto max-w-full"
        src={window.state.url}
        width={window.width}
        height={window.height}
        alt=""
      />
    );
  }

  return (
    <span className="ui-app-window-stand-in flex h-app-window-tall items-center justify-center aspect-picture"
      style={cssCustomProperties({
        "--ui-picture-ratio": window === undefined ? 1 : window.width / window.height,
      })}
    >
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

/** The app's icon and name, the same chip on every device; a press brings its own window forward where the caller can. */
function AppName({
  app,
  onShowApp,
}: {
  app: StackedApp;
  onShowApp: ((name: string) => void) | undefined;
}): React.JSX.Element {
  const face = (
    <>
      <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.LINE} />
      <ChipName>{app.name}</ChipName>
    </>
  );

  if (onShowApp === undefined) {
    return (
      <StaticChip look={CHIP_LOOK.TOOLBAR} size={CHIP_SIZE.COMPACT}>
        {face}
      </StaticChip>
    );
  }

  return (
    <Chip
      look={CHIP_LOOK.TOOLBAR}
      size={CHIP_SIZE.COMPACT}
      aria-label={WORDS.SHOW_ON_MAC(app.name)}
      onClick={() => onShowApp(app.name)}
    >
      {face}
    </Chip>
  );
}

/** "+N": a menu of the apps the stack has no room to stand behind, a choice bringing that app forward. */
function MoreApps({
  apps,
  using,
  onPick,
}: {
  apps: readonly StackedApp[];
  using: string | undefined;
  onPick: (name: string) => void;
}): React.JSX.Element {
  const menu = useMenu(true);

  return (
    <>
      <Chip look={CHIP_LOOK.TOOLBAR} size={CHIP_SIZE.COMPACT} chevron {...menu.trigger()}>
        <ChipName>{WORDS.MORE_COUNT(apps.length)}</ChipName>
      </Chip>
      {menu.drawn === undefined ? null : (
        <Menu
          label={WORDS.MORE}
          menu={menu.drawn}
          groups={[
            apps.map((app) => ({
              key: app.name,
              label: app.name,
              icon: <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.LINE} />,
              detail: app.name === using ? WORDS.USING_NOW : app.detail,
              onSelect: () => onPick(app.name),
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** An app behind the window in front: its title peeking out above it, the whole title a press that brings the app forward. */
function BehindTitle({
  app,
  using,
  depth,
  onPick,
}: {
  app: StackedApp;
  using: boolean;
  depth: number;
  onPick: (name: string) => void;
}): React.JSX.Element {
  return (
    <Card
      look={CARD_LOOK.SURFACE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.SOFT}
      className={`ui-app-window-behind relative -mb-ui-8 ${BEHIND_INSET[depth] ?? ""}`}
    >
      <CardPress label={WORDS.FORWARD(app.name)} onPress={() => onPick(app.name)}>
        <span className="flex min-w-0 items-center gap-ui-6 pt-ui-4 pb-ui-12 ps-ui-8 pe-ui-8">
          <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.LINE} />
          <Text variant={TEXT_VARIANT.LABEL} tone={using ? undefined : TEXT_TONE.MUTED} truncate>
            {using ? `${WORDS.USING} ${app.name}` : app.name}
          </Text>
          {using ? <WorkingMark /> : null}
          {using || app.detail === undefined ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
              {app.detail}
            </Text>
          )}
        </span>
      </CardPress>
    </Card>
  );
}

export function AppWindowStack({
  label,
  apps,
  shown,
  using,
  working,
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
  /** The app in front, by its name; the one used last where it names none of them. */
  shown?: string | undefined;
  /** The app the agent's newest call is on, by its name; none while it is in none. */
  using?: string | undefined;
  /** Whether the agent is at work, which says "Using" or "Used". */
  working: boolean;
  /** Brings an app forward, by its name. */
  onPick: (name: string) => void;
  /** Opens the window in front full size. */
  onOpen: () => void;
  /** Puts the stack down to its pill. */
  onMinimize: () => void;
  /** Brings an app's own window forward on the Mac, by its name; none where the reader is not at that Mac. */
  onShowApp?: ((name: string) => void) | undefined;
  /** Its owner's class, to place it and nothing else. */
  className?: string | undefined;
}): React.JSX.Element | null {
  const titleId = useId();
  const front = apps.find((app) => app.name === shown) ?? apps[0];

  if (front === undefined) return null;
  const others = apps.filter((app) => app !== front);
  const behind = others.slice(0, MOST_BEHIND);
  const more = others.slice(MOST_BEHIND);
  const inUse = working && front.name === using;
  // Note that a window whose read did not land is no press, since its Retry stands on it and the viewer holds no window it could not read.
  const failed = front.window?.state.kind === PICTURE_STATE.FAILED;

  return (
    <section
      className={`ui-app-window-stack ph-no-capture flex w-(--ui-app-window-width,var(--spacing-app-window-wide)) max-w-full flex-col ${className ?? ""}`}
      aria-label={label}
    >
      {behind.toReversed().map((app, at) => (
        <BehindTitle
          key={app.name}
          app={app}
          using={working && app.name === using}
          depth={behind.length - 1 - at}
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
        <div
          id={titleId}
          className="flex min-w-0 items-center gap-ui-4 border-b border-border py-ui-4 ps-ui-8 pe-ui-4"
        >
          {inUse || !working ? (
            <Text variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
              {working ? WORDS.USING : WORDS.USED}
            </Text>
          ) : null}
          <AppName app={front} onShowApp={onShowApp} />
          {inUse ? <WorkingMark /> : null}
          <span className="flex-1" />
          {more.length === 0 ? null : (
            <MoreApps apps={more} using={working ? using : undefined} onPick={onPick} />
          )}
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
 * The stack minimized: the app in use and the working mark, and how many
 * others stand in the stack, or, once the agent is done, how many apps the
 * turn used; a press brings the stack back.
 */
export function AppStackPill({
  apps,
  using,
  working,
  onRestore,
  className,
}: {
  /** The apps, the one used last first; nothing is drawn for none. */
  apps: readonly StackedApp[];
  /** The app the agent's newest call is on, by its name; none while it is in none. */
  using?: string | undefined;
  working: boolean;
  onRestore: () => void;
  /** Its owner's class, to place it and nothing else. */
  className?: string | undefined;
}): React.JSX.Element | null {
  const [last] = apps;

  if (last === undefined) return null;
  const inUse = working && last.name === using;
  const others = apps.length - 1;

  const words = inUse
    ? `${WORDS.USING} ${last.name}`
    : working || others === 0
      ? `${working ? "" : `${WORDS.USED} `}${last.name}`
      : WORDS.USED_APPS(apps.length);

  return (
    <span className={`ui-app-stack-pill ph-no-capture inline-flex ${className ?? ""}`}>
      <Chip look={CHIP_LOOK.PILL} aria-label={WORDS.RESTORE} onClick={onRestore}>
        <AppIcon src={last.iconSrc} size={APP_ICON_SIZE.LINE} />
        <ChipName>{words}</ChipName>
        {inUse ? <WorkingMark /> : null}
        {working && others > 0 ? <ChipName>{WORDS.MORE_COUNT(others)}</ChipName> : null}
      </Chip>
    </span>
  );
}

export { MENU_ITEM_MARK as APP_STACK_MENU_MARK };
