import { type ReactNode, useState } from "react";
import { AlertIcon, CheckIcon, RemoveIcon, RetryIcon } from "../../icons/lucide-glyphs.js";
import { pulseOnPress } from "../../press-pulse.js";
import { isReported, type ReportedFailure, type Unreported } from "../../reported-failure.js";
import { useFailureDetails } from "../failure-copy/failure-copy.js";
import { FILE_TEXT_EXTENT, FileText } from "../file-text/file-text.js";
import { HoverCard, HoverCardHead } from "../hover-card/hover-card.js";
import { motionKey as motionKeyAttribute } from "../list-motion/list-motion.js";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";
import { SPINNER_SIZE, Spinner, SpinnerRing } from "../spinner/spinner.js";
import { Tooltip } from "../tooltip/hint.js";
import {
  UPLOAD_COVER_SIZE,
  UPLOAD_COVER_STATE,
  UploadCover,
} from "../upload-cover/upload-cover.js";
import { UPLOAD_METER_PLACE, UploadMeter } from "../upload-cover/upload-meter.js";

/**
 * attachment-chip.tsx -- a file coming along with a message or a note, as a chip: its thumbnail, or its type's glyph, its name, and its size.
 *
 * A picture is its thumbnail alone, at the chip's height and its own shape,
 * held between a narrow and a wide bound past which it is cropped, so a tall
 * phone capture stands narrow beside a wide one, as a filmstrip draws them;
 * any other file is the glyph its caller
 * draws for its type, its name ending in an ellipsis at the chip's end, and what more
 * the caller says of it (its size). The chip's face is the press that opens
 * the file where `onOpen` is given, named "Open <name>"; a file with nothing
 * to open is drawn the same, pressing nothing. Where `onRemove` is given the
 * chip carries its way off on its corner, a real button named
 * "Remove <name>", unavailable while `removeDisabled` holds, which its
 * caller answers at once, so the file is off on the press. A chip with a way
 * off was added to what it comes along with, so it springs in as it arrives;
 * its exit is the list's that draws it, a `ListMotion` following it by its
 * `motionKey`, which plays its arrival in its place, since its caller has
 * already let it go.
 *
 * A file whose bytes are still read stands as a thumbnail's place holding
 * the spinner, said to a reader as reading the file. One that failed to
 * come stands as its caller's glyph for the failure (a picture gone), with
 * why in words where the caller says (`failure`, "Not kept") and what more
 * it says of it (its size). Neither opens anything.
 *
 * A file on its way up is drawn as it will stand, with the upload's cover
 * on it (`UploadCover`): a picture under the veil with the spinner at its
 * middle, any other file the spinner in its glyph's place, and the meter
 * along its foot, filling to `progress` where its caller can say how far
 * the bytes have gone, and sweeping where it cannot, as a send that carries
 * its files inside one request cannot. It opens nothing until it is up. One
 * that goes up while drawn takes a check that springs in on its corner and,
 * after a beat, fades, so a file seen going up is seen landing; one drawn
 * up already stands still.
 *
 * One whose upload failed and may go again (`onRetry`) is still drawn as
 * it would stand, a picture under the veil with Retry's glyph on it, any
 * other file the failure's glyph, its name, and "Retry": its face is then
 * the press that sends it again, named "Retry <name>", and its way off on
 * its corner takes it off, why it failed hanging as its hint. The failure is
 * said shown as it stands, as every failure the app says in place is.
 *
 * A file that is here hangs its card while the pointer rests on the chip, unless
 * its caller asks for none (`ATTACHMENT_CHIP_HOVER.NONE`), as a PDF standing
 * among a description's words does, whose card would cover them: its
 * glyph, its whole name, and what more the chip says of it, as every other
 * chip hangs its kind's card, and under them the head of a text file's words
 * where the caller hands them (`peek`), faded at the card's foot. A file not
 * here yet, or gone, hangs its name in a pill instead, since there is no more to say.
 *
 * A chip is one item of a list its caller draws and names, so the caller
 * owns the row's layout; the chip takes no class or style.
 *
 * It is drawn in Tailwind utilities over the theme, with no shadcn/ui base:
 * shadcn's badge takes no press and its button is a control's box, while a
 * chip is a thumbnail's frame holding two presses, its face and its way off.
 * `attachment-chip.css` keeps the motions it arrives, waits, and lands in.
 */

const WORDS = {
  RETRY: "Retry",
} as const;

/** Where a chip's file stands: here to open, still read, on its way up, or failed to come. */
export const ATTACHMENT_CHIP_STATE = {
  READY: "ready",
  LOADING: "loading",
  UPLOADING: "uploading",
  FAILED: "failed",
} as const;

export type AttachmentChipState =
  (typeof ATTACHMENT_CHIP_STATE)[keyof typeof ATTACHMENT_CHIP_STATE];

/** What a chip hangs while the pointer rests on it: its file's card, or nothing, where it stands among words the card would cover and its face already says all the card would. */
export const ATTACHMENT_CHIP_HOVER = {
  CARD: "card",
  NONE: "none",
} as const;

export type AttachmentChipHover =
  (typeof ATTACHMENT_CHIP_HOVER)[keyof typeof ATTACHMENT_CHIP_HOVER];

/**
 * The chip: as tall as a thumbnail, at most its longest, in a hairline that
 * strengthens while the pointer is on its face, a press; a thumbnail's width
 * where it holds a wait or a failure, and its picture's where it holds one.
 */
const CHIP =
  "ui-attachment-chip group/attachment-chip relative flex h-attachment-chip max-w-attachment-chip-max rounded-ui-8 border border-border bg-surface transition-[border-color] duration-(--ui-duration-hover) ease-motion-exit [@media(hover:hover)]:has-[button.ui-attachment-chip-face:hover]:border-border-strong data-[image=true]:not-data-[picture=true]:w-attachment-chip-thumb";

/**
 * The face, the press that opens the file where it is one, washed under the
 * pointer as a row is, and a hair inside the chip's edge; a thumbnail's place
 * holds a picture, or a wait or a failure's glyph at its middle.
 */
const FACE =
  "ui-attachment-chip-face m-0 flex min-w-0 flex-[1_1_auto] items-center gap-ui-8 rounded-attachment-chip-face border-0 bg-transparent py-0 pr-ui-12 pl-attachment-chip-lead text-left text-muted-foreground [font-family:inherit] [font-style:inherit] [font-weight:inherit] leading-[inherit] text-caption-inline transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit [&>svg]:size-icon-16 [&>svg]:flex-none group-data-[image=true]/attachment-chip:justify-center group-data-[image=true]/attachment-chip:p-0";

/** The face as a press: the pointer's hand, and the strong fill under it, a picture brightening with it. */
const FACE_PRESS = "group/attachment-face cursor-press hover:bg-fill-strong";

/**
 * The way off. Note that the disc is 18px but the button is 24px, because a
 * chip's corner carries no more disc than that and the pointer still needs a
 * 24px target over it: a transparent border is hit like the rest of the
 * button, and the ground is clipped inside it. The app's reset draws the
 * ring; it stands inside the target, close round the disc.
 */
const REMOVE =
  "ui-attachment-chip-remove absolute -top-attachment-chip-remove-out -right-attachment-chip-remove-out m-0 flex size-attachment-chip-remove items-center justify-center rounded-ui-full border-3 border-transparent bg-background bg-clip-padding p-0 text-muted-foreground shadow-attachment-chip-disc transition-[color] duration-(--ui-duration-hover) ease-motion-exit focus-visible:outline-offset-[calc(-1*var(--ui-focus-ring-width))] hover:not-disabled:text-foreground disabled:opacity-disabled [&_svg]:size-ui-8";

/** A landed file's check on the chip's corner, in the done ink on the way off's disc. */
const LANDED =
  "ui-attachment-chip-landed pointer-events-none absolute -right-ui-6 -bottom-ui-6 flex size-ui-16 items-center justify-center rounded-ui-full bg-background text-complete shadow-attachment-chip-disc [&_svg]:size-attachment-chip-check [&_svg]:text-inherit";

/** What a chip's face holds for its file as it stands. */
function ChipFace({
  state,
  name,
  image,
  icon,
  detail,
  failure,
  retries,
}: {
  state: AttachmentChipState;
  name: string;
  image: string | undefined;
  icon: ReactNode;
  detail: string | undefined;
  failure: string | undefined;
  /** Whether a failed upload's face is its Retry. */
  retries: boolean;
}): React.JSX.Element {
  if (state === ATTACHMENT_CHIP_STATE.LOADING) {
    return <Spinner label={`Reading ${name}`} size={SPINNER_SIZE.INLINE} />;
  }

  const uploading = state === ATTACHMENT_CHIP_STATE.UPLOADING;
  const drawn = state === ATTACHMENT_CHIP_STATE.READY || uploading || retries;

  if (drawn && image !== undefined) {
    const picture = (
      <img
        className="block h-full w-auto min-w-attachment-chip-picture-min max-w-attachment-chip-picture-max rounded-attachment-chip-face object-cover transition-[filter] duration-(--ui-duration-hover) ease-motion-exit group-hover/attachment-face:brightness-112"
        src={image}
        alt={name}
      />
    );

    if (state === ATTACHMENT_CHIP_STATE.READY) return picture;

    return (
      <span className="relative block h-full rounded-attachment-chip-face">
        {picture}
        <UploadCover
          size={UPLOAD_COVER_SIZE.CHIP}
          state={uploading ? UPLOAD_COVER_STATE.UPLOADING : UPLOAD_COVER_STATE.FAILED}
        />
      </span>
    );
  }

  // A file going up holds the spinner in its glyph's place, and one that failed and may go again the failure's glyph, its name, and Retry.
  if (uploading || retries) {
    return (
      <>
        {uploading ? (
          <span className="inline-flex size-icon-16 flex-none" aria-hidden="true">
            <SpinnerRing />
          </span>
        ) : (
          <span
            className="inline-flex flex-none text-danger [&>svg]:size-icon-16"
            aria-hidden="true"
          >
            <AlertIcon />
          </span>
        )}
        <ClippedLine
          className="ui-attachment-chip-name overflow-hidden whitespace-nowrap text-foreground"
          as={ONE_LINE_ELEMENT.SPAN}
          end={ONE_LINE_END.ELLIPSIS}
          words={name}
        >
          {name}
        </ClippedLine>
        {uploading ? (
          detail === undefined ? null : (
            <span className="ui-attachment-chip-detail flex-none">{detail}</span>
          )
        ) : (
          <span className="ui-attachment-chip-retry inline-flex flex-none items-center gap-ui-4 font-emphasis text-foreground [&>svg]:size-ui-12">
            <RetryIcon />
            {WORDS.RETRY}
          </span>
        )}
      </>
    );
  }

  const words = state === ATTACHMENT_CHIP_STATE.FAILED ? failure : name;

  return (
    <>
      {icon}
      {words === undefined ? null : (
        <ClippedLine
          className="ui-attachment-chip-name overflow-hidden whitespace-nowrap text-foreground"
          as={ONE_LINE_ELEMENT.SPAN}
          end={ONE_LINE_END.ELLIPSIS}
          words={words}
        >
          {words}
        </ClippedLine>
      )}
      {detail === undefined ? null : (
        <span className="ui-attachment-chip-detail flex-none">{detail}</span>
      )}
    </>
  );
}

/** Whether the chip's file went up while it was drawn: true from the render that sees it land. */
function useLanded(state: AttachmentChipState): boolean {
  const [was, setWas] = useState(state);
  const [landed, setLanded] = useState(false);

  // Note that the change is taken in the render that sees it, so the check
  // springs in on the frame the meter goes.
  if (state !== was) {
    setWas(state);
    setLanded(was === ATTACHMENT_CHIP_STATE.UPLOADING && state === ATTACHMENT_CHIP_STATE.READY);
  }

  return landed;
}

/** A file as a chip: a thumbnail or a glyph and name, with its open and its way off where given. */
export function AttachmentChip({
  name,
  image,
  icon,
  detail,
  onOpen,
  onRemove,
  removeDisabled,
  state = ATTACHMENT_CHIP_STATE.READY,
  progress,
  failure,
  onRetry,
  reported,
  lands = true,
  motionKey,
  peek,
  hover = ATTACHMENT_CHIP_HOVER.CARD,
}: {
  /** The file's name, which names the chip, its open, and its way off. */
  name: string;
  /** The address of the picture to draw as its thumbnail, for a picture with bytes to draw. */
  image?: string | undefined;
  /** The glyph for a file drawn by name, its type's. */
  icon?: ReactNode;
  /** What more the chip says of a file drawn by name, after it (its size). */
  detail?: string | undefined;
  /** Opens the file; a chip without it presses nothing. */
  onOpen?: (() => void) | undefined;
  /** Takes the file off; a chip without it has no way off. */
  onRemove?: (() => void) | undefined;
  /** Whether the way off stands unavailable, while what the file is for is busy. */
  removeDisabled?: boolean | undefined;
  /** Where the file stands; a chip still read, uploading, or failed opens nothing. */
  state?: AttachmentChipState;
  /** How far an upload has come, in percent, where its transport can say; an uploading chip without it sweeps. */
  progress?: number | undefined;
  /** Why a failed file is not there, in words ("Not kept"); its glyph alone says so where none is given. One that may go again hangs it as its hint. */
  failure?: string | undefined;
  /** Sends a failed upload again, the chip's face its press; a failure with none is only said. */
  onRetry?: (() => void) | undefined;
  /** A failed upload's failure as the app reports it, said shown as the chip stands, as `ErrorState` takes it. */
  reported?: ReportedFailure | Unreported | undefined;
  /** Whether a file seen going up takes its check as it stands up; off where the request it goes up in may fail and leave it standing as it was. */
  lands?: boolean | undefined;
  /** The key a `ListMotion` around its list follows it by, which plays its arrival and its exit. */
  motionKey?: string | undefined;
  /** The head of a text file's words, which its card shows under its name; none for a file with no words to show. */
  peek?: string | undefined;
  /** What it hangs on hover: its card, as every list of files does, or nothing. */
  hover?: AttachmentChipHover;
}): React.JSX.Element {
  const ready = state === ATTACHMENT_CHIP_STATE.READY;
  const uploading = state === ATTACHMENT_CHIP_STATE.UPLOADING;
  const retries = state === ATTACHMENT_CHIP_STATE.FAILED && onRetry !== undefined;
  const landed = useLanded(state);
  useFailureDetails(retries && isReported(reported) ? reported : undefined);

  const face = (
    <ChipFace
      state={state}
      name={name}
      image={image}
      icon={icon}
      detail={detail}
      failure={failure}
      retries={retries}
    />
  );

  // A thumbnail's place: a picture, a wait, or a failure with no words.
  const picture = (ready || uploading || retries) && image !== undefined;

  const thumbnail =
    picture ||
    state === ATTACHMENT_CHIP_STATE.LOADING ||
    (state === ATTACHMENT_CHIP_STATE.FAILED &&
      !retries &&
      failure === undefined &&
      detail === undefined);

  // The card wears what the chip does: the thumbnail of a picture, else the file's glyph.
  const glyph =
    image === undefined ? icon : <img className="rounded-ui-6 object-cover" src={image} alt="" />;

  const card = ready ? (
    <HoverCard data-attachment-card="">
      <HoverCardHead glyph={glyph} name={name} sub={detail} />
      {peek === undefined ? null : (
        <FileText text={peek} label={name} extent={FILE_TEXT_EXTENT.PEEK} />
      )}
    </HoverCard>
  ) : undefined;

  const chip = (
    <li
      className={CHIP}
      data-image={thumbnail ? "true" : undefined}
      data-picture={picture ? "true" : undefined}
      data-removable={onRemove === undefined ? undefined : "true"}
      {...(motionKey === undefined ? {} : motionKeyAttribute(motionKey))}
      data-state={state}
    >
      {retries ? (
        <button
          type="button"
          className={`${FACE} ${FACE_PRESS}`}
          aria-label={`Retry ${name}`}
          onClick={pulseOnPress(onRetry)}
        >
          {face}
        </button>
      ) : onOpen === undefined || !ready ? (
        <span className={FACE}>{face}</span>
      ) : (
        <button
          type="button"
          className={`${FACE} ${FACE_PRESS}`}
          aria-label={`Open ${name}`}
          onClick={pulseOnPress(onOpen)}
        >
          {face}
        </button>
      )}
      {uploading ? (
        <UploadMeter name={name} progress={progress} place={UPLOAD_METER_PLACE.CHIP} />
      ) : null}
      {landed && lands ? (
        <span className={LANDED} aria-hidden="true">
          <CheckIcon />
        </span>
      ) : null}
      {onRemove === undefined ? null : (
        <button
          type="button"
          className={REMOVE}
          aria-label={`Remove ${name}`}
          disabled={removeDisabled === true}
          onClick={pulseOnPress(onRemove)}
        >
          <RemoveIcon />
        </button>
      )}
    </li>
  );

  // Note that a failure that may go again hangs why as its hint wherever it stands, since its face says Retry instead.
  if (retries) return <Tooltip label={failure ?? name}>{chip}</Tooltip>;

  return hover === ATTACHMENT_CHIP_HOVER.NONE ? (
    chip
  ) : (
    <Tooltip label={name} card={card}>
      {chip}
    </Tooltip>
  );
}
