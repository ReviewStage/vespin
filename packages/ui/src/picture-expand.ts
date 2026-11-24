import { useLayoutEffect, useRef, useState } from "react";
import { MOTION_TOKEN, tokenTiming } from "./motion-timing.js";

/**
 * picture-expand.ts -- a picture opened from its tile grows from the tile's own rect into the viewer, and shrinks back into it as the viewer closes.
 *
 * A tile notes the picture it was pressed on (`notePictureOrigin`) for as
 * long as the frame the press landed in, and the viewer that opens in that
 * frame takes it (`usePictureExpand`), handing what it answers to its
 * dialog (`Dialog`'s `expand`). As the card first stands, a copy of the
 * picture alone, drawn over the dimmed window, is moved and scaled from the
 * tile to where the card's picture stands, by transform alone, its corners
 * the tile's as it leaves; the card fades in around it on the same beat,
 * its own picture hidden until the copy lands on it. The tile's own picture
 * stands hidden meanwhile, so one picture is seen to travel rather than
 * two. Put away, the copy plays back into the tile while the card and the
 * dimmed window fade, before it is taken out.
 *
 * Note that the copy flies rather than the card, because the viewer's card
 * fills the window: a window-sized layer scaled on every frame is drawn
 * again at each scale, and on a large display Chromium could not draw it
 * in time, so the flight showed the card in pieces, or nothing, until it
 * landed. The copy is no larger than the picture, and the card only fades.
 *
 * Where there is nothing to grow from or go back to, it stands down and the
 * dialog opens and closes as it does for everything else: under reduced
 * motion or a capture run, which zero the duration it reads; a viewer not
 * opened from a tile; a tile that has unmounted or scrolled out of sight by
 * the close; and a viewer walked on to another picture than the one opened.
 */

/** The duration and easing a flight plays on, those of a dialog rising into place. */
const FLIGHT_DURATION = MOTION_TOKEN.DURATION_FAST;
const FLIGHT_EASING = MOTION_TOKEN.SPRING_FAST;

/** The picture inside the card that lands over the tile: the viewer's zoomed picture. */
const PICTURE_SELECTOR = ".ui-zoom-image";

/** What the card wears while it flies, which stands its own entrance down (`dialog.tsx`). */
const EXPANDING_ATTRIBUTE = "data-expanding";

/** The picture a tile was pressed on, until the frame the press landed in has passed. */
let pressed: HTMLElement | undefined;

/** A rect of the window as an element stands in it. */
interface Box {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** A pixel length's number, none where it is none. */
function pixels(value: string): number {
  const length = Number.parseFloat(value);

  return Number.isFinite(length) ? length : 0;
}

/** Whether any of `box` is drawn inside `room`. */
function overlaps(box: Box, room: Pick<Box, "top" | "right" | "bottom" | "left">): boolean {
  return (
    box.bottom > room.top && box.top < room.bottom && box.right > room.left && box.left < room.right
  );
}

/**
 * Whether `face` is still drawn where it can be seen: in the window, with
 * size, and not scrolled out of any box around it that clips what stands
 * past its edges.
 */
function inSight(face: HTMLElement): boolean {
  const box = face.getBoundingClientRect();

  if (box.width <= 0 || box.height <= 0) return false;
  const view = { top: 0, left: 0, right: innerWidth, bottom: innerHeight };

  if (!overlaps(box, view)) return false;

  for (let around = face.parentElement; around !== null; around = around.parentElement) {
    if (getComputedStyle(around).overflow === "visible") continue;

    if (!overlaps(box, around.getBoundingClientRect())) return false;
  }

  return true;
}

/** The poses the copy flies between, where the card's picture stands, which the copy is laid out over. */
interface Flight {
  readonly shown: Box;
  readonly tile: Keyframe;
  readonly landed: Keyframe;
}

/**
 * The flight between `face`, the tile's picture, and `picture`, the card's
 * as it stands: the copy laid out over the card's picture, moved and scaled
 * from its top-left corner so it lies over the tile, rounded as the tile is
 * there, and clipped where it lands to what of the picture its frame shows,
 * as a zoomed picture is. None where either has no size yet.
 */
function flightOf(face: HTMLElement, picture: HTMLElement): Flight | undefined {
  const tile = face.getBoundingClientRect();
  const shown = picture.getBoundingClientRect();

  if (tile.width <= 0 || tile.height <= 0 || shown.width <= 0 || shown.height <= 0) {
    return undefined;
  }

  const frame = (picture.parentElement ?? picture).getBoundingClientRect();
  const scaleX = tile.width / shown.width;
  const scaleY = tile.height / shown.height;
  const x = tile.left - shown.left;
  const y = tile.top - shown.top;
  // Note that the clip is the copy's own measure, before its scale, so the
  // tile's corner is drawn at its own size once the copy is scaled down.
  const top = Math.max(frame.top - shown.top, 0);
  const right = Math.max(shown.right - frame.right, 0);
  const bottom = Math.max(shown.bottom - frame.bottom, 0);
  const left = Math.max(frame.left - shown.left, 0);
  const corner = pixels(getComputedStyle(face).borderTopLeftRadius);

  return {
    shown,
    tile: {
      transform: `translate(${String(x)}px, ${String(y)}px) scale(${String(scaleX)}, ${String(scaleY)})`,
      clipPath: `inset(0px round ${String(corner / scaleX)}px / ${String(corner / scaleY)}px)`,
    },
    landed: {
      transform: "none",
      clipPath: `inset(${String(top)}px ${String(right)}px ${String(bottom)}px ${String(left)}px round 0px)`,
    },
  };
}

/**
 * A copy of `picture` laid out at `shown`, over everything the dimmed window
 * `room` holds, taking no press, for the flight to move. Note that it stands
 * in the page's body rather than the window, because the window fades as the
 * viewer is put away while the copy flies on whole.
 */
function copyOf(picture: HTMLImageElement, room: HTMLElement, shown: Box): HTMLImageElement {
  const copy = document.createElement("img");
  copy.src = picture.currentSrc === "" ? picture.src : picture.currentSrc;
  copy.alt = "";
  copy.draggable = false;
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, {
    position: "fixed",
    top: `${String(shown.top)}px`,
    left: `${String(shown.left)}px`,
    width: `${String(shown.width)}px`,
    height: `${String(shown.height)}px`,
    margin: "0",
    maxWidth: "none",
    maxHeight: "none",
    objectFit: "fill",
    pointerEvents: "none",
    transformOrigin: "0 0",
    zIndex: getComputedStyle(room).zIndex,
  });
  document.body.append(copy);

  return copy;
}

/**
 * Notes `face`, the picture a tile was pressed on, as what the viewer the
 * press opens grows from. It is forgotten once the frame has passed, so a
 * press that opened nothing leaves nothing for a later viewer to take.
 */
export function notePictureOrigin(face: HTMLElement): void {
  pressed = face;
  requestAnimationFrame(() => {
    if (pressed === face) pressed = undefined;
  });
}

/** What a viewer hands its dialog to grow from a tile and go back into it. */
export interface PictureExpand {
  /** Plays the growth onto the card as it first stands, once; the dialog calls it. */
  readonly grow: (card: HTMLElement) => void;
  /** Puts the viewer away: back into its tile, then `done`, or `done` at once where it cannot go back. */
  readonly close: (done: () => void) => void;
}

/**
 * The flight of a viewer opened from a tile, taken as it first draws.
 * `onOpened` says whether it still shows the picture it was opened on,
 * which alone goes back into the tile.
 */
export function usePictureExpand(onOpened: boolean): PictureExpand {
  const [face] = useState(() => pressed);
  const card = useRef<HTMLElement | null>(null);
  const grown = useRef(false);
  const closing = useRef(false);
  // Stops a wait for the viewer's picture to load, the card shown as every card is.
  const stopWaiting = useRef<(() => void) | undefined>(undefined);
  // Lands a growth still flying at once: the copy taken out and the card's picture shown.
  const land = useRef<(() => void) | undefined>(undefined);
  // The copy flying now, which goes with the viewer whenever it goes.
  const flying = useRef<HTMLImageElement | undefined>(undefined);

  // The tile's picture stands hidden while its own is shown over it, and
  // comes back as soon as the viewer shows another or is gone. Note that a
  // wait for the picture opened on ends as the viewer walks off it, because
  // the picture it waits on is taken out and never loads, and a growth still
  // flying lands, because the picture it flies to is no longer shown.
  useLayoutEffect(() => {
    if (!onOpened) {
      stopWaiting.current?.();
      land.current?.();
    }

    if (face !== undefined && grown.current) face.style.visibility = onOpened ? "hidden" : "";
  }, [face, onOpened]);
  useLayoutEffect(
    () => () => {
      flying.current?.remove();

      if (face !== undefined && grown.current) face.style.visibility = "";
    },
    [face],
  );

  // Flies the copy from the tile while the card fades in around it, or lets
  // the card's own entrance play where the picture cannot be measured, which
  // taking the attribute off replays.
  const fly = (
    standing: HTMLElement,
    picture: HTMLImageElement,
    tile: HTMLElement,
    timing: KeyframeAnimationOptions,
  ) => {
    const flight = tile.isConnected ? flightOf(tile, picture) : undefined;

    if (flight === undefined) {
      standing.removeAttribute(EXPANDING_ATTRIBUTE);

      return;
    }

    grown.current = true;

    if (onOpened) tile.style.visibility = "hidden";
    const copy = copyOf(picture, standing.parentElement ?? standing, flight.shown);
    flying.current = copy;
    picture.style.visibility = "hidden";
    standing.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    const growing = copy.animate([flight.tile, flight.landed], timing);

    land.current = () => {
      land.current = undefined;
      flying.current = undefined;
      growing.cancel();
      copy.remove();
      picture.style.visibility = "";
    };

    growing.onfinish = () => land.current?.();
  };

  const grow = (standing: HTMLElement) => {
    if (card.current !== null || face === undefined || !face.isConnected) return;
    card.current = standing;
    const timing = tokenTiming(standing, FLIGHT_DURATION, FLIGHT_EASING);

    if (timing === undefined) return;
    // Note that the attribute goes on before the card is measured, so the
    // measure is of the card as it stands rather than mid-entrance.
    standing.setAttribute(EXPANDING_ATTRIBUTE, "true");
    const picture = standing.querySelector(PICTURE_SELECTOR);

    if (!(picture instanceof HTMLImageElement)) {
      standing.removeAttribute(EXPANDING_ATTRIBUTE);

      return;
    }

    if (picture.complete) {
      fly(standing, picture, face, timing);

      return;
    }

    // Note that a picture the viewer has yet to decode has no size to fly
    // to, so the card stands unseen until it has one, then flies; one that
    // fails to load opens as every card does.
    const waiting = standing.animate([{ opacity: 0 }, { opacity: 0 }], { fill: "forwards" });

    const stop = () => {
      stopWaiting.current = undefined;
      picture.removeEventListener("load", settle);
      picture.removeEventListener("error", settle);
      waiting.cancel();
    };

    const settle = (event: Event) => {
      stop();

      if (event.type === "load" && !closing.current) fly(standing, picture, face, timing);
      else standing.removeAttribute(EXPANDING_ATTRIBUTE);
    };

    stopWaiting.current = () => {
      stop();
      standing.removeAttribute(EXPANDING_ATTRIBUTE);
    };

    picture.addEventListener("load", settle);
    picture.addEventListener("error", settle);
  };

  const close = (done: () => void) => {
    if (closing.current) return;
    // A growth still flying lands first, so the close flies from where the picture stands.
    land.current?.();
    const standing = card.current;
    const picture = standing?.querySelector(PICTURE_SELECTOR);
    // Note that the tile is asked about as the close lands, because it may
    // have unmounted or scrolled away while the picture stood over it.
    const tile = grown.current && onOpened && face?.isConnected && inSight(face) ? face : undefined;

    const timing =
      standing === null ? undefined : tokenTiming(standing, FLIGHT_DURATION, FLIGHT_EASING);

    const flight =
      tile !== undefined && picture instanceof HTMLImageElement
        ? flightOf(tile, picture)
        : undefined;

    if (
      standing === null ||
      !(picture instanceof HTMLImageElement) ||
      tile === undefined ||
      timing === undefined ||
      flight === undefined
    ) {
      done();

      return;
    }

    closing.current = true;
    const room = standing.parentElement ?? standing;
    const copy = copyOf(picture, room, flight.shown);
    flying.current = copy;
    picture.style.visibility = "hidden";
    const back = { ...timing, fill: "forwards" } as const;
    room.animate([{ opacity: 1 }, { opacity: 0 }], back);
    const shrinking = copy.animate([flight.landed, flight.tile], back);
    shrinking.onfinish = () => {
      tile.style.visibility = "";
      done();
      copy.remove();
    };
  };

  return { grow, close };
}
