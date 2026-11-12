import type { ReactNode } from "react";
import { cssCustomProperties } from "../../css.js";
import { AlertIcon, RetryIcon } from "../../icons/lucide-glyphs.js";
import type { ReportedFailure, Unreported } from "../../reported-failure.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { FailureCopy } from "../failure-copy/failure-copy.js";
import { SPINNER_INK, SPINNER_SIZE, Spinner, SpinnerRing } from "../spinner/spinner.js";

/**
 * upload-cover.tsx -- a file's upload drawn on the file itself: a veil over its picture with the wait, or the failure and what mends it, standing on it.
 *
 * Every place a file goes up draws its state here, on the thing that is
 * going up, never on a line beside it, so a picture laid into a
 * description, a chip in a message, and a picture named in a line's words
 * read as one object waiting. The cover is the veil a player's controls
 * stand on (`--ui-color-veil`), the same in either theme, since what is
 * under it is the picture's, laid over its caller's box, which holds the
 * picture and is placed for it (`position: relative`), its corners
 * followed.
 *
 * It comes at the three sizes a file stands at:
 *
 * - `BLOCK`, a picture standing in written words: while it goes up, the
 *   window's spinner at its middle and the meter along its foot, filling
 *   to `progress` where its caller can say how far the bytes have gone and
 *   sweeping where it cannot; failed, a card at its middle on the ground a
 *   menu floats on, so it reads on any picture: the failure's glyph and its
 *   sentence, then Retry, Copy details, and Remove, each a real button
 *   named for the file. A refusal Retry cannot mend is drawn without one.
 * - `CHIP`, a thumbnail in a chip (`AttachmentChip`): the spinner, or a
 *   failure's Retry glyph, at the thumbnail's middle; the chip says the
 *   rest, its meter and its face's press, so the cover says nothing to a
 *   reader.
 * - `PILL`, a picture's thumbnail on a line of words (`AttachmentRef`):
 *   the spinner alone, said by the line it stands in.
 *
 * A file that is up stands as it is: its caller draws no cover.
 */

/** Where a file's upload stands while it is covered: on its way up, or failed. */
export const UPLOAD_COVER_STATE = {
  UPLOADING: "uploading",
  FAILED: "failed",
} as const;

export type UploadCoverState = (typeof UPLOAD_COVER_STATE)[keyof typeof UPLOAD_COVER_STATE];

/** What the cover stands on: a picture in written words, a chip's thumbnail, or a pill's. */
export const UPLOAD_COVER_SIZE = {
  BLOCK: "block",
  CHIP: "chip",
  PILL: "pill",
} as const;

export type UploadCoverSize = (typeof UPLOAD_COVER_SIZE)[keyof typeof UPLOAD_COVER_SIZE];

/** Where a meter stands: along a chip's foot, inside its hairline, or a picture's. */
export const UPLOAD_METER_PLACE = {
  CHIP: "chip",
  BLOCK: "block",
} as const;

export type UploadMeterPlace = (typeof UPLOAD_METER_PLACE)[keyof typeof UPLOAD_METER_PLACE];

const WORDS = {
  RETRY: "Retry",
  REMOVE: "Remove",
} as const;

/** The veil over the caller's box, following its corners; a block's lays its wait or its failure out in a column at its middle. */
const COVER =
  "ui-upload-cover pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-[inherit] bg-veil text-on-veil";

/** A block's failure stands inside the veil's edge, so its card never meets the picture's. */
const BLOCK_FAILED = "p-ui-12";

/**
 * The failure's card, on the ground a menu floats on, so its words and
 * presses read in the window's own inks on any picture: its glyph and
 * sentence, then its presses, in a column a narrow picture wraps. It takes
 * the pointer, though the veil around it lets it through to the picture.
 */
const FAILED_CARD =
  "ui-upload-cover-card pointer-events-auto flex max-w-full flex-col items-center gap-ui-6 rounded-control border border-border-strong bg-popover px-ui-12 pt-ui-8 pb-ui-4 text-center text-popover-foreground shadow-menu";

const FAILED_WORDS =
  "ui-upload-cover-words m-0 flex max-w-full items-start gap-icon-gap text-caption [&>svg]:mt-ui-2 [&>svg]:size-control-icon [&>svg]:flex-none [&>svg]:text-danger";

const ACTIONS = "ui-upload-cover-actions flex flex-wrap justify-center gap-ui-4";

/** A chip's thumbnail holds its glyph at the small spinner's size. */
const CHIP_GLYPH = "inline-flex size-spinner-small [&_svg]:size-full";

/** A pill's thumbnail holds a ring a hair under its own size. */
const PILL_RING = "inline-flex size-[70%]";

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

/** A block's failure on its veil: why, then Retry where it can mend it, Copy details, and Remove. */
function BlockFailure({
  name,
  failure,
  words,
  onRetry,
  onRemove,
}: {
  name: string;
  failure: ReportedFailure | Unreported;
  words: ReactNode;
  onRetry: (() => void) | undefined;
  onRemove: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <span className={`${COVER} ${BLOCK_FAILED}`} data-state={UPLOAD_COVER_STATE.FAILED}>
      <span className={FAILED_CARD}>
        <span className={FAILED_WORDS} role="alert">
          <AlertIcon />
          <span>{words}</span>
        </span>
        <span className={ACTIONS}>
          {onRetry === undefined ? null : (
            <Button
              variant={BUTTON_VARIANT.QUIET}
              icon={<RetryIcon />}
              turns
              label={`Retry ${name}`}
              onClick={onRetry}
            >
              {WORDS.RETRY}
            </Button>
          )}
          <FailureCopy failure={failure} />
          {onRemove === undefined ? null : (
            <Button variant={BUTTON_VARIANT.QUIET} label={`Remove ${name}`} onClick={onRemove}>
              {WORDS.REMOVE}
            </Button>
          )}
        </span>
      </span>
    </span>
  );
}

/**
 * A picture in written words covered while it goes up or after it failed:
 * the wait at its middle and its meter, or why it failed and what mends it.
 * It lays itself over its caller's box, which is placed for it.
 */
export function UploadCover(
  props:
    | {
        size: typeof UPLOAD_COVER_SIZE.BLOCK;
        state: typeof UPLOAD_COVER_STATE.UPLOADING;
        /** The file's name, which its wait is said by. */
        name: string;
        /** How far the bytes have gone, in percent, where the transport can say; the meter sweeps without it. */
        progress?: number | undefined;
      }
    | {
        size: typeof UPLOAD_COVER_SIZE.BLOCK;
        state: typeof UPLOAD_COVER_STATE.FAILED;
        /** The file's name, which its presses are named by. */
        name: string;
        /** The failure as the app reports it, or what names it as none to report, as `ErrorState` takes it. */
        failure: ReportedFailure | Unreported;
        /** Why it failed, in a sentence. */
        children: ReactNode;
        /** Sends it again; none where a refusal says nothing a second try would change. */
        onRetry?: (() => void) | undefined;
        /** Takes it out of what it was laid into. */
        onRemove?: (() => void) | undefined;
      }
    | {
        size: typeof UPLOAD_COVER_SIZE.CHIP;
        state: UploadCoverState;
      }
    | {
        size: typeof UPLOAD_COVER_SIZE.PILL;
        state: typeof UPLOAD_COVER_STATE.UPLOADING;
      },
): React.JSX.Element {
  if (props.size === UPLOAD_COVER_SIZE.BLOCK && props.state === UPLOAD_COVER_STATE.FAILED) {
    return (
      <BlockFailure
        name={props.name}
        failure={props.failure}
        words={props.children}
        onRetry={props.onRetry}
        onRemove={props.onRemove}
      />
    );
  }

  if (props.size === UPLOAD_COVER_SIZE.BLOCK) {
    return (
      <span className={COVER} data-state={UPLOAD_COVER_STATE.UPLOADING}>
        <Spinner
          label={`Uploading ${props.name}`}
          size={SPINNER_SIZE.REGION}
          ink={SPINNER_INK.ON_VEIL}
        />
        <UploadMeter name={props.name} progress={props.progress} place={UPLOAD_METER_PLACE.BLOCK} />
      </span>
    );
  }

  // Note that a chip's and a pill's cover say nothing to a reader, because the chip's meter and face, and the pill's line, already do.
  return (
    <span className={COVER} data-state={props.state} aria-hidden="true">
      {props.size === UPLOAD_COVER_SIZE.PILL ? (
        <span className={PILL_RING}>
          <SpinnerRing />
        </span>
      ) : (
        <span className={CHIP_GLYPH}>
          {props.state === UPLOAD_COVER_STATE.FAILED ? <RetryIcon /> : <SpinnerRing />}
        </span>
      )}
    </span>
  );
}
