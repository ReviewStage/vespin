import { cssCustomProperties } from "../../css.js";
import { StopIcon } from "../../icons/lucide-glyphs.js";
import { PICTURE_STATE, type PictureState } from "../../picture-read.js";
import { APP_ICON_SIZE, AppIcon } from "../app-icon/app-icon.js";
import { IconButton } from "../button/button.js";
import { CARD_CORNER, CARD_LOOK, CARD_PADDING, CARD_SHADOW, Card } from "../card/card.js";
import { OneLine } from "../one-line/one-line.js";
import { PictureTile } from "../picture-tile/picture-tile.js";
import { SPINNER_SIZE, SpinnerRing } from "../spinner/spinner.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { WorkingMark } from "../working-mark/working-mark.js";

/**
 * app-window-stack.tsx -- the apps an agent is using on the developer's Mac, as a small stack of their windows floating over its box, the one in use on top.
 *
 * The app on top stands as a card: its newest window at its own shape, a
 * phone's tall and a Mac's wide, at most a small window's size, and under
 * it the app's icon and name, the working mark while the agent is in it,
 * how many other apps it used, and Stop. A press on the window opens it
 * full size, where the caller lets the viewer walk the other apps' windows
 * too; a window narrower than the line under it stands at its middle, on a
 * quiet ground, as a phone's does. The other apps stand behind it as the edges of cards, each peeking
 * out above the one before it, at most two, as a deck does, so the stack
 * says how many there are without taking the room. A window not read yet
 * holds its place at its shape with a spinner, and an app whose window the
 * agent never read stands as its icon alone. Its place over the box is the
 * caller's (`className`), and the stack is left out of the screen
 * recording, since a window can hold anything on the developer's screen.
 *
 * It is drawn in Tailwind utilities over the theme, its cards `Card`s.
 */

/** Each card behind the top, by its depth: lifted out above the one before it and a little smaller. */
const BEHIND_CLASS = [
  "-translate-y-app-window-peek scale-95",
  "-translate-y-app-window-peek-twice scale-90",
] as const;

/** The room over the top card the cards behind it peek into, by how many there are. */
const PEEK_ROOM = ["", "pt-app-window-peek", "pt-app-window-peek-twice"] as const;

/** An app in the stack: its name, its icon's address, and its newest window, where the agent read one. */
export interface StackedApp {
  readonly name: string;
  readonly iconSrc?: string | undefined;
  readonly window?:
    | { readonly state: PictureState; readonly width: number; readonly height: number }
    | undefined;
}

/** How many other apps are in the stack, in words. */
function othersWords(count: number): string {
  return count === 1 ? "+1 app" : `+${String(count)} apps`;
}

/** The window on top, at its own shape: its picture, a spinner while it is read, or the app's icon where it is gone or none was read. */
function WindowFace({ app }: { app: StackedApp }): React.JSX.Element {
  const window = app.window;
  if (window?.state.kind === PICTURE_STATE.READY) {
    return (
      <img
        className="ui-app-window block h-auto max-h-app-window-tall w-auto max-w-app-window-wide"
        src={window.state.url}
        width={window.width}
        height={window.height}
        alt=""
      />
    );
  }
  return (
    <span
      className="ui-app-window-stand-in flex h-app-window-tall max-w-app-window-wide items-center justify-center bg-muted aspect-picture"
      style={cssCustomProperties({
        "--ui-picture-ratio": window === undefined ? 1 : window.width / window.height,
      })}
    >
      {window?.state.kind === PICTURE_STATE.READING ? (
        <SpinnerRing size={SPINNER_SIZE.REGION} />
      ) : (
        <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.CARD} />
      )}
    </span>
  );
}

export function AppWindowStack({
  label,
  apps,
  using,
  onOpen,
  onStop,
  stopping = false,
  className,
}: {
  /** What the stack is named to a reader. */
  label: string;
  /** The apps, the one on top first; nothing is drawn for none. */
  apps: readonly StackedApp[];
  /** Whether the agent is in the app on top now, which wears the working mark. */
  using: boolean;
  /** Opens the window on top full size. */
  onOpen: () => void;
  /** Stops the agent; none where the reader may not. */
  onStop?: (() => void) | undefined;
  /** Whether a Stop is under way. */
  stopping?: boolean | undefined;
  /** Its owner's class, to place it and nothing else. */
  className?: string | undefined;
}): React.JSX.Element | null {
  const [top, ...others] = apps;
  if (top === undefined) return null;
  const behind = BEHIND_CLASS.slice(0, others.length);
  return (
    <section
      className={`ui-app-window-stack ph-no-capture grid w-fit ${PEEK_ROOM[behind.length] ?? ""} ${className ?? ""}`}
      aria-label={label}
    >
      {behind.map((depth) => (
        <Card
          key={depth}
          look={CARD_LOOK.RAISED}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.NONE}
          shadow={CARD_SHADOW.SOFT}
          className={`ui-app-window-behind col-start-1 row-start-1 ${depth}`}
        >
          {null}
        </Card>
      ))}
      <Card
        look={CARD_LOOK.RAISED}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.FLUSH}
        shadow={CARD_SHADOW.SOFT}
        className="ui-app-window-top relative col-start-1 row-start-1"
      >
        <span className="ui-app-window-ground flex justify-center bg-muted">
          <PictureTile name={top.name} onOpen={onOpen}>
            <WindowFace app={top} />
          </PictureTile>
        </span>
        <span className="flex min-w-0 items-center gap-icon-gap px-ui-8 py-ui-4">
          <AppIcon src={top.iconSrc} />
          <OneLine className="min-w-0 flex-1">
            <Text variant={TEXT_VARIANT.CAPTION}>{top.name}</Text>
          </OneLine>
          {using ? <WorkingMark /> : null}
          {others.length === 0 ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {othersWords(others.length)}
            </Text>
          )}
          {onStop === undefined ? null : (
            <IconButton
              icon={<StopIcon />}
              label="Stop"
              busy={stopping}
              busyLabel="Stopping"
              onClick={onStop}
            />
          )}
        </span>
      </Card>
    </section>
  );
}
