import { cssCustomProperties } from "../../css.js";
import { PICTURE_STATE, type PictureState } from "../../picture-read.js";
import { APP_ICON_SIZE, AppIcon } from "../app-icon/app-icon.js";
import { CARD_CORNER, CARD_LOOK, CARD_PADDING, CARD_SHADOW, Card } from "../card/card.js";
import { PictureStandIn } from "../picture-set/picture-set.js";
import { PictureTile } from "../picture-tile/picture-tile.js";
import { SPINNER_SIZE, SpinnerRing } from "../spinner/spinner.js";

/**
 * app-window-stack.tsx -- the windows of the apps an agent is using on the developer's Mac, as a small stack floating over its box, the one in use on top.
 *
 * The app on top stands as a card of its newest window at its own shape, a
 * phone's tall and a Mac's wide, at most a small window's size, on the
 * surface a dock's card stands on. A press on it opens it full size, where
 * the caller lets the viewer walk the other apps' windows too; a window
 * narrower than the card stands at its middle, on a quiet ground, as a
 * phone's does. The other apps stand behind it as the edges of cards, each
 * peeking out above the one before it, at most two, as a deck does, so the
 * stack says how many there are without taking the room. A window not read
 * yet holds its place at its shape with a spinner, one whose read did not
 * land holds it with Retry and is no press, as a failed tile is, and an app
 * whose window the agent never read stands as its icon alone. What names the apps, and
 * Stop, is the caller's row under it; its place over the box is the caller's
 * (`className`), and the stack is left out of the screen recording, since a
 * window can hold anything on the developer's screen.
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

/** The window on top, at its own shape: its picture, a spinner while it is read, Retry where the read did not land, or the app's icon where it is gone or none was read. */
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

export function AppWindowStack({
  label,
  apps,
  onOpen,
  className,
}: {
  /** What the stack is named to a reader. */
  label: string;
  /** The apps, the one on top first; nothing is drawn for none. */
  apps: readonly StackedApp[];
  /** Opens the window on top full size. */
  onOpen: () => void;
  /** Its owner's class, to place it and nothing else. */
  className?: string | undefined;
}): React.JSX.Element | null {
  const [top, ...others] = apps;

  if (top === undefined) return null;
  const behind = BEHIND_CLASS.slice(0, others.length);
  // Note that a window whose read did not land is no press, since its Retry stands on it and the viewer holds no window it could not read.
  const failed = top.window?.state.kind === PICTURE_STATE.FAILED;

  return (
    <section
      className={`ui-app-window-stack ph-no-capture grid w-fit ${PEEK_ROOM[behind.length] ?? ""} ${className ?? ""}`}
      aria-label={label}
    >
      {behind.map((depth) => (
        <Card
          key={depth}
          look={CARD_LOOK.SURFACE}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.NONE}
          shadow={CARD_SHADOW.SOFT}
          className={`ui-app-window-behind col-start-1 row-start-1 ${depth}`}
        >
          {null}
        </Card>
      ))}
      <Card
        look={CARD_LOOK.SURFACE}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.FLUSH}
        shadow={CARD_SHADOW.SOFT}
        className="ui-app-window-top relative col-start-1 row-start-1"
      >
        <span className="ui-app-window-ground flex min-w-app-window-least justify-center bg-muted">
          {failed ? (
            <WindowFace app={top} />
          ) : (
            <PictureTile name={top.name} onOpen={onOpen}>
              <WindowFace app={top} />
            </PictureTile>
          )}
        </span>
      </Card>
    </section>
  );
}
