/**
 * working-mark.tsx -- the one mark an agent at work wears: two pixels chasing each other round the edge of a small grid, in the gray ink around it.
 *
 * Every place that says an agent is working draws this mark. It stands inside
 * the 16px icon seat: eight 3px cells lapped round a 3×3 grid, 2px apart,
 * two pixels and the fainter tail behind each lit on them. The cells draw its
 * still frame, mid-lap, so a still mark always lights four cells and reads
 * as working. While endless loops run, its stylesheet hides them and plays
 * the lap instead, each pixel stepping a cell five times a second
 * (`working-mark.css`). Note that the lap runs no React and no timer, and
 * that it is an animated image the compositor steps, not keyframes, because
 * a running keyframe animation ticks on every vsync: a stepped lap of
 * `transform` keyframes cost the renderer several times what the image does
 * (`scripts/loop-frames.ts`, whose frames follow the geometry below). The
 * mark itself is decorative; the seat it stands in names it. Its side is
 * 16px unless a container sets `--ui-working-mark-size`.
 *
 * It is drawn in the Tailwind theme's utilities: every cell is placed and
 * sized in percentages of the mark's side, so the grid scales with the side
 * and a glyph's seat around it never stretches it.
 */

/**
 * The pixels the still mark lights: each chaser and the fainter tail one
 * cell behind it, with the track cell it stands on.
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

/** The `transform` that sets a pixel on the track cell at `index`, from the first cell it is drawn on. */
function cellTransform(index: number): string {
  const [column, row] = TRACK[index % TRACK.length] ?? TRACK[0];
  // Note that a percentage in `translate` is of the pixel's own side, so one step is a pitch in cells.
  const step = (cells: number) => `${Number(((cells * PITCH * 100) / CELL).toFixed(3))}%`;

  return `translate(${step(column)}, ${step(row)})`;
}

/** The lit pixels, each on its cell of the lap. */
function WorkingDots(): React.JSX.Element {
  return (
    <>
      {WORKING_DOTS.map(({ dot, restsOn, tail }) => (
        <span
          key={dot}
          className={`ui-working-mark-dot absolute rounded-avatar-tile bg-current${tail ? " opacity-60" : ""}`}
          data-dot={dot}
          style={{ ...cellStyle(0, 0), transform: cellTransform(restsOn) }}
        />
      ))}
    </>
  );
}

/** The mark, hidden from a reader, since the seat it stands in says it. */
export function WorkingMark(): React.JSX.Element {
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
      <WorkingDots />
    </span>
  );
}
