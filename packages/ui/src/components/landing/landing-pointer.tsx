import { type RefObject, useLayoutEffect, useState } from "react";
import { cssCustomProperties } from "../../css.js";

/**
 * landing-pointer.tsx -- the pointer a scene's story moves and presses with, so a reader's eye can follow where the story clicks.
 *
 * A scene says what its pointer aims at each beat, by a selector for an
 * element in its own markup, and the pointer moves to the middle of that
 * element as the scene draws it. Where the scene aims at nothing the
 * pointer rests in the scene's lower right; where what it aimed at is
 * gone, as a page it pressed on gives way to the next, it stays where it
 * pressed. It moves across and down on two boxes eased apart, so its path
 * bows as a hand's does, and dips as it presses. A picture, never a
 * control: no reader is told of it.
 */

/** A point in a scene, in pixels from its top left. */
type Point = { readonly x: number; readonly y: number };

/** Where the pointer rests while a story aims at nothing, as shares of the scene's width and height. */
const REST = { X: 0.82, Y: 0.84 } as const;

/** The farthest into a wide target the pointer goes, so it lands on a row's words rather than its middle. */
const REACH_PX = 120;

/**
 * Where the pointer stands in `scene` aiming at `target`, a selector in the
 * scene's markup, or nothing to rest; nothing before the scene is first
 * measured. Note that we measure after each `beat` draws, because what it
 * aims at moves as the scene changes.
 */
export function usePointer(
  scene: RefObject<HTMLElement | null>,
  target: string | null,
  beat: number,
): Point | null {
  const [point, setPoint] = useState<Point | null>(null);

  // Note that the place is read before the scene paints, so the pointer first stands where it aims rather than gliding in from the corner.
  useLayoutEffect(() => {
    const root = scene.current;

    if (!root) return;
    const box = root.getBoundingClientRect();

    if (target === null) {
      setPoint({ x: box.width * REST.X, y: box.height * REST.Y });

      return;
    }

    const found = root.querySelector(target);

    // Note that a target gone, the page it was on given way, keeps the pointer where it pressed.
    if (found === null) return;
    const rect = found.getBoundingClientRect();

    setPoint({
      x: rect.left - box.left + Math.min(rect.width / 2, REACH_PX),
      y: rect.top - box.top + rect.height / 2,
    });
  }, [scene, target, beat]);

  return point;
}

/** The pointer: an arrow at `point`, pressing where `pressed`, drawn once the scene has been measured. A picture, never a control. */
export function DemoPointer({
  point,
  pressed,
}: {
  point: Point | null;
  pressed: boolean;
}): React.JSX.Element | null {
  if (point === null) return null;

  return (
    <span
      className="ui-landing-pointer"
      aria-hidden="true"
      style={cssCustomProperties({
        "--ui-landing-pointer-x": `${point.x}px`,
        "--ui-landing-pointer-y": `${point.y}px`,
      })}
    >
      <span className="ui-landing-pointer-down">
        <svg
          className="ui-landing-pointer-arrow"
          viewBox="0 0 16 20"
          aria-hidden="true"
          focusable="false"
          data-pressed={pressed || undefined}
        >
          <path d="M1 1v15.5l4.2-4.1 2.9 6.6 2.6-1.1-2.9-6.5H14L1 1z" />
        </svg>
      </span>
    </span>
  );
}
