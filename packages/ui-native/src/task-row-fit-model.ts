// task-row-fit-model.ts -- how many of a task row's lesser end marks stand aside so its name reads whole, as Mail's rows give up their marks before the sender's name.

/** What a row knows of a mark it may let go: its width with the gap before it, as last drawn, none before it has been, and whether it stands aside now. */
export interface SparedMarkFit {
  readonly width: number | undefined;
  readonly dropped: boolean;
}

/** What a row measured of its line, its marks given in the order it lets them go. */
export interface RowFit {
  /** The name's whole width, as it would stand uncut. */
  readonly name: number;
  /** The room the name has with the marks as they stand now. */
  readonly room: number;
  readonly marks: readonly SparedMarkFit[];
}

/** How far short of its whole width a name may fall and still read whole, in points, since measured widths round. */
const ROUNDING = 1;

/** How much more room than a mark aside takes a row must have to take it back, in points, so a width measured a little short never sets the mark coming and going. */
const TAKE_BACK_SLACK = 8;

/**
 * How many of a row's lesser marks stand aside, the first of `marks` first:
 * the fewest that let its name read whole, or every one where even that
 * leaves it cut. The room each mark already aside gave the name is taken off by
 * its width, so the answer holds whatever stands aside now, and a row given
 * more room takes its marks back, once it has a little more than they take.
 */
export function sparedMarksDropped(fit: RowFit): number {
  const cost = (mark: SparedMarkFit) => (mark.width ?? 0) + (mark.dropped ? TAKE_BACK_SLACK : 0);
  // Note that the room with every mark standing is the room now less what the marks aside gave the name.
  let room = fit.marks.reduce((left, mark) => (mark.dropped ? left - cost(mark) : left), fit.room);
  let dropped = 0;

  while (dropped < fit.marks.length && fit.name > room + ROUNDING) {
    const mark = fit.marks[dropped];

    room += mark === undefined ? 0 : cost(mark);
    dropped += 1;
  }

  return dropped;
}
