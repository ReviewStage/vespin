import { cssCustomProperties } from "../../css.js";

/**
 * upload-meter.tsx -- an upload's meter, the hairline along a file's foot that fills as its bytes go up, or sweeps where no share is known.
 *
 * It is drawn by the upload's cover over a picture (`upload-cover.tsx`) and
 * along a chip's foot (`AttachmentChip`), and by nothing outside this
 * package, so it stands outside the barrel. Its sweep is
 * `upload-cover.css`'s.
 */

/** Where a meter stands: along a chip's foot, inside its hairline, or a picture's. */
export const UPLOAD_METER_PLACE = {
  CHIP: "chip",
  BLOCK: "block",
} as const;

export type UploadMeterPlace = (typeof UPLOAD_METER_PLACE)[keyof typeof UPLOAD_METER_PLACE];

/**
 * An upload's meter, a hairline along its box's foot in the working ink:
 * filled from its start to the share gone up on `transform`, so the bar
 * never changes size, and easing to each new share as a pane does rather
 * than springing past it; where no share is known, a third of the track
 * sweeps across it (`upload-cover.css`).
 */
const METER =
  "ui-upload-meter pointer-events-none absolute right-ui-4 bottom-ui-2 left-ui-4 h-attachment-chip-meter overflow-hidden rounded-ui-full bg-fill-strong data-[place=block]:right-ui-8 data-[place=block]:bottom-ui-6 data-[place=block]:left-ui-8";

const METER_FILL = "ui-upload-meter-fill block h-full rounded-ui-full bg-working";

const METER_SHARE =
  "origin-left [transform:scaleX(var(--ui-upload-share,0))] transition-transform duration-(--ui-duration-pane) ease-pane";

/** The share of an upload done, as a fraction held to 0–1, a value that is not a number read as none. */
function fractionOf(progress: number): number {
  if (!Number.isFinite(progress)) return 0;

  return Math.min(100, Math.max(0, progress)) / 100;
}

/** The meter along an upload's foot, named for the file: filled to its share where one is known, else sweeping. */
export function UploadMeter({
  name,
  progress,
  place,
}: {
  name: string;
  /** How far the bytes have gone, in percent; none where the transport cannot say. */
  progress: number | undefined;
  place: UploadMeterPlace;
}): React.JSX.Element {
  const fraction = progress === undefined ? undefined : fractionOf(progress);

  return (
    <span
      className={METER}
      role="progressbar"
      aria-label={`Uploading ${name}`}
      aria-valuemin={fraction === undefined ? undefined : 0}
      aria-valuemax={fraction === undefined ? undefined : 100}
      aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}
      data-indeterminate={fraction === undefined ? "true" : undefined}
      data-place={place}
    >
      <span
        className={fraction === undefined ? METER_FILL : `${METER_FILL} ${METER_SHARE}`}
        style={
          fraction === undefined
            ? undefined
            : cssCustomProperties({ "--ui-upload-share": fraction })
        }
      />
    </span>
  );
}
