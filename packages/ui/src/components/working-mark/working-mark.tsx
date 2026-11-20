import { useCallback, useRef } from "react";
import { useMotionHeld } from "../../use-motion-held.js";
import { useOnBeat } from "../time/time-clock.js";

/**
 * working-mark.tsx -- the one mark an agent at work wears: two pixels chasing each other round the edge of a small grid, in the gray ink around it.
 *
 * Every place that says an agent is working draws this mark. It stands inside
 * the 16px icon seat: eight 3px cells lapped round a 3×3 grid, 2px apart.
 * Each pixel steps to the next cell on the one 200ms beat every mark shares
 * (`useOnBeat`), lapping the eight cells in 1.6s, so the motion is stepped
 * frames of `transform` alone and costs the window a frame only when a pixel
 * moves. Note that the cells are HTML elements, not SVG shapes, because a
 * style write on an SVG shape invalidates SVG layout on every beat, where a
 * `transform` on an HTML box invalidates no layout at all. Note that the beat writes the pixels'
 * `transform`s straight onto them rather than rendering the mark again, so a
 * step runs no React; and that it is no CSS animation, because Chromium's
 * compositor runs a stepped loop on every vsync, which measured dearer than
 * the beat and is twice as dear again at 120Hz. Reduced motion and a capture
 * run hold it (`useMotionHeld`) on its resting frame, chosen to show the
 * chase mid-lap rather than its first, so a still mark always lights four
 * cells and reads as working. The mark itself
 * is decorative; the seat it stands in names it. Its side is 16px unless a
 * container sets `--ui-working-mark-size`.
 *
 * It is drawn in the Tailwind theme's utilities: every cell is placed and
 * sized in percentages of the mark's side, so the grid scales with the side
 * and a glyph's seat around it never stretches it.
 */

/**
 * The pixels that move: each chaser and the fainter tail one cell behind it,
 * with the track cell it rests on when still and steps on from.
 */
const WORKING_DOTS = [
  { dot: "lead", restsOn: 1, tail: false },
  { dot: "lead-tail", restsOn: 0, tail: true },
  { dot: "trail", restsOn: 5, tail: false },
  { dot: "trail-tail", restsOn: 4, tail: true },
] as const;

/** One cell's side, in CSS pixels. */
const CELL = 3;

/** One step from a cell to the next, cell and gap, in CSS pixels. */
const PITCH = 5;

/** The mark's side, in CSS pixels: the 16px icon seat. */
const SIDE = 16;

/** Where the first cell starts, from the mark's corner: the grid centered in the side. */
const INSET = (SIDE - (2 * PITCH + CELL)) / 2;

/** The cells of the track, in the order the chasers lap them. */
const TRACK = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
] as const;

/** A cell's box in the mark, in percentages of its side, so the grid scales with the side. */
function cellStyle(column: number, row: number): React.CSSProperties {
  const percent = (pixels: number) => `${(pixels / SIDE) * 100}%`;

  return {
    left: percent(INSET + column * PITCH),
    top: percent(INSET + row * PITCH),
    width: percent(CELL),
    height: percent(CELL),
  };
}

/** The `transform` that sets a pixel on the track cell at `index`, lapping past the last, from the first cell it is drawn on. */
function cellTransform(index: number): string {
  const [column, row] = TRACK[index % TRACK.length] ?? TRACK[0];
  // Note that a percentage in `translate` is of the pixel's own side, so one step is a pitch in cells.
  const step = (cells: number) => `${Number(((cells * PITCH * 100) / CELL).toFixed(3))}%`;

  return `translate(${step(column)}, ${step(row)})`;
}

/** The moving pixels, on their resting cells until a beat moves them. */
function WorkingDots({
  dotRefs,
}: {
  readonly dotRefs?: React.RefObject<(HTMLSpanElement | null)[]>;
}): React.JSX.Element {
  return (
    <>
      {WORKING_DOTS.map(({ dot, restsOn, tail }, index) => (
        <span
          key={dot}
          ref={
            dotRefs === undefined
              ? undefined
              : (cell) => {
                  dotRefs.current[index] = cell;
                }
          }
          className={`ui-working-mark-dot absolute rounded-avatar-tile bg-current${tail ? " opacity-60" : ""}`}
          data-dot={dot}
          style={{ ...cellStyle(0, 0), transform: cellTransform(restsOn) }}
        />
      ))}
    </>
  );
}

/** The moving pixels stepping on the shared beat, each beat writing their `transform`s itself. */
function LappingDots(): React.JSX.Element {
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const step = useCallback((beat: number) => {
    WORKING_DOTS.forEach(({ restsOn }, index) => {
      const cell = dotRefs.current[index];

      if (cell) cell.style.transform = cellTransform(restsOn + beat);
    });
  }, []);

  useOnBeat(step);

  return <WorkingDots dotRefs={dotRefs} />;
}

/** The mark, hidden from a reader, since the seat it stands in says it. */
export function WorkingMark(): React.JSX.Element {
  // Note that a held mark never reads the beat at all, and one already standing stops as the setting changes.
  const held = useMotionHeld();

  return (
    <span
      className="ui-working-mark relative inline-block size-working-mark flex-none align-middle"
      aria-hidden="true"
    >
      {TRACK.map(([column, row], index) => (
        <span
          key={index}
          className="ui-working-mark-track absolute rounded-avatar-tile bg-current opacity-30"
          style={cellStyle(column, row)}
        />
      ))}
      {held ? <WorkingDots /> : <LappingDots />}
    </span>
  );
}
