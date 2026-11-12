import { chipBase64, sizeLabel } from "@repo/features/attachment-model";
import { DESCRIPTION_FILE_TYPE } from "@repo/features/description-attachment-wire";
import {
  ATTACHMENT_CHIP_HOVER,
  ATTACHMENT_CHIP_STATE,
  AttachmentChip,
  type AttachmentChipState,
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  dataUrlMediaType,
  isVideoDataUrl,
  PictureStandIn,
  PictureTile,
  VideoPlayer,
} from "@repo/ui";
import { PICTURE_STATE, type PictureState } from "@repo/ui/picture-read";
import { FileTypeIcon } from "./tasks/file-type-icon.js";

/**
 * picture-block.tsx -- a picture drawn in written words: its own block, at its own size up to the column's, its caption under it, a press opening it over the window.
 *
 * While its bytes are read it is a quiet box on the section's fill with the
 * window's spinner; a picture this reader cannot reach, or whose bytes are
 * gone, is its alt text and says it is not available, as a tile of a set
 * says it (`@repo/ui`'s `PictureStandIn`); one whose read did not land this
 * time stands in the box it was read in, the gone picture's glyph, a short
 * line, and Retry where the spinner stood. A gone picture
 * is plain words, never a `role="img"` named by its alt, which would hide the
 * "not available" beside it and leave an empty alt with no name at all. The screen recording masks a
 * picture's address, so it draws empty there (`session-replay.ts`). A video an agent recorded plays in its place instead
 * (`@repo/ui`'s `VideoPlayer`), with the player's own controls, Full screen
 * among them, since a press on a video plays it; what a press on a picture
 * opens is its Expand. A PDF a description keeps as it keeps a picture is
 * drawn as its file, a chip with its name, its alt text, and its size,
 * whose press opens it over the window, where its pages are drawn. Nothing here knows whose picture it is; the place
 * drawing one hands its state and what a press does.
 */

/**
 * A picture in written words: its own block, at its own width up to the
 * column's, standing apart from the words around it. A place that stands it
 * otherwise, in a row or under a version's mark, says so in its own sheet.
 */
export const PICTURE_BLOCK_CLASS = "picture-block my-block-gap block w-fit max-w-full";

/** The frame, `@repo/ui`'s Card, hugging the picture. */
export const PICTURE_FRAME_CLASS = "picture-frame w-fit max-w-full";

/** The picture, no taller than a screenful's worth, at its own shape. */
export const PICTURE_IMAGE_CLASS =
  "picture-image block h-auto max-h-picture-most max-w-full object-contain";

/** While the bytes are read: a quiet box of a screenshot's shape. */
export const PICTURE_PENDING_CLASS =
  "picture-pending grid aspect-screenshot w-picture-stand-in max-w-full cursor-default place-items-center";

/** A picture from outside the app, a link to it never fetched, marked by a glyph a step under its words' size. */
export const OUTSIDE_GLYPH_CLASS = "mr-[0.25em] size-picture-glyph align-[-0.12em]";

/** A picture this reader cannot reach, or whose bytes are gone: its words, at a stand-in's width. */
const PICTURE_MISSING_CLASS =
  "picture-frame picture-missing w-picture-stand-in max-w-full cursor-default p-card-snug";

/** Its caption under it in the secondary ink, which may run wider than a skinny picture, whose frame still hugs the picture. */
const PICTURE_CAPTION_CLASS =
  "picture-caption mt-item-gap block text-picture-caption text-muted-foreground";

/** Where a caption typed in place stands, the field setting the caption's type and ink itself. */
const PICTURE_CAPTION_FIELD_CLASS = "picture-caption mt-item-gap block";

/** Whether a `data:` URL a picture read answered holds a PDF, drawn as its file rather than a picture. */
export function isPdfDataUrl(dataUrl: string): boolean {
  return dataUrlMediaType(dataUrl) === DESCRIPTION_FILE_TYPE.PDF;
}

/** The name a PDF's chip draws its type's icon by, which reads the type off its extension. */
function pdfIconName(name: string): string {
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

/** A PDF where a picture stands: its file's chip, its name and size, a press opening it once it is kept. */
export function PdfFile({
  url,
  name,
  onOpen,
  state = ATTACHMENT_CHIP_STATE.READY,
}: {
  url: string;
  name: string;
  onOpen?: (() => void) | undefined;
  /** Where the file stands: kept, or on its way up from the editor, or failed to go. */
  state?: AttachmentChipState;
}): React.JSX.Element {
  const base64 = chipBase64({ name, mediaType: DESCRIPTION_FILE_TYPE.PDF, url });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a picture stands inside its paragraph's `p`, which holds no `ul`, so the chip's list is a span.
    <span className="picture-file flex" role="list" aria-label="Attached file">
      <AttachmentChip
        name={name}
        icon={<FileTypeIcon name={pdfIconName(name)} />}
        detail={sizeLabel(base64)}
        onOpen={onOpen}
        state={state}
        // Note that a failed chip says its file's name, since it hangs no card that would name it, and the failure's words stand under it.
        failure={state === ATTACHMENT_CHIP_STATE.FAILED ? name : undefined}
        // Note that it hangs no card, because a card would cover the description's words and say only what the chip does.
        hover={ATTACHMENT_CHIP_HOVER.NONE}
      />
    </span>
  );
}

/** The picture's own block, by where its read stands. */
export function PictureBlock({
  ref,
  state,
  alt,
  caption,
  captionField,
  onOpen,
}: {
  /** The block's own element, as the place drawing it may need to find it among others. */
  ref?: React.Ref<HTMLSpanElement> | undefined;
  state: PictureState;
  /** The picture's description, as its Markdown's alt text gives it; empty where it gives none. */
  alt: string;
  /** The words drawn under it, as its Markdown's title gives them; none where it gives none. */
  caption: string | undefined;
  /** The caption typed in place, as an editor draws it, standing where `caption` would; none where the caption is only read. */
  captionField?: React.ReactNode;
  /** Opens the picture over the window; without one, the picture is drawn with no press to it. */
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const read =
    caption === undefined || caption === "" ? null : (
      <span className={PICTURE_CAPTION_CLASS}>{caption}</span>
    );

  // Note that a caption typed in place stands where the read one would, so the editor draws the picture as the text does.
  const said =
    captionField === undefined || captionField === null ? (
      read
    ) : (
      <span className={PICTURE_CAPTION_FIELD_CLASS}>{captionField}</span>
    );

  // A PDF stands as its file, which a press opens over the window.
  if (state.kind === PICTURE_STATE.READY && isPdfDataUrl(state.url)) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind} data-file="">
        <PdfFile url={state.url} name={alt === "" ? "PDF" : alt} onOpen={onOpen} />
        {said}
      </span>
    );
  }

  // A video plays where it stands, and what a press on a picture opens is its Expand.
  if (state.kind === PICTURE_STATE.READY && isVideoDataUrl(state.url)) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind} data-video="">
        <VideoPlayer dataUrl={state.url} label={alt} onExpand={onOpen} />
        {said}
      </span>
    );
  }

  // A picture with nothing to open on a press is drawn as itself, no button.
  if (state.kind === PICTURE_STATE.READY && onOpen === undefined) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
        <Card
          as={CARD_ELEMENT.SPAN}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.FLUSH}
          className={PICTURE_FRAME_CLASS}
        >
          <img
            className={PICTURE_IMAGE_CLASS}
            src={state.url}
            alt={alt}
            decoding="async"
            draggable={false}
          />
        </Card>
        {said}
      </span>
    );
  }

  if (state.kind === PICTURE_STATE.READY) {
    const open = onOpen;

    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
        <PictureTile
          name={alt}
          onOpen={(event) => {
            // Note that the press stops here, because a click into a section opens its editor.
            event.stopPropagation();
            open?.();
          }}
        >
          <Card
            as={CARD_ELEMENT.SPAN}
            corner={CARD_CORNER.CONTROL}
            padding={CARD_PADDING.FLUSH}
            className={PICTURE_FRAME_CLASS}
          >
            <img
              className={PICTURE_IMAGE_CLASS}
              src={state.url}
              alt={alt}
              decoding="async"
              draggable={false}
            />
          </Card>
        </PictureTile>
        {said}
      </span>
    );
  }

  if (state.kind === PICTURE_STATE.READING) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
        <Card
          as={CARD_ELEMENT.SPAN}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.FLUSH}
          className={`picture-frame ${PICTURE_PENDING_CLASS}`}
        >
          <PictureStandIn state={PICTURE_STATE.READING} words={alt} />
        </Card>
        {said}
      </span>
    );
  }

  if (state.kind === PICTURE_STATE.FAILED) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
        <Card
          as={CARD_ELEMENT.SPAN}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.FLUSH}
          className={`picture-frame ${PICTURE_PENDING_CLASS}`}
        >
          <PictureStandIn
            state={PICTURE_STATE.FAILED}
            words={alt}
            onRetry={state.retry}
            failure={state.failure}
          />
        </Card>
        {said}
      </span>
    );
  }

  return (
    <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
      <Card
        as={CARD_ELEMENT.SPAN}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.NONE}
        dashed
        className={PICTURE_MISSING_CLASS}
      >
        <PictureStandIn state={PICTURE_STATE.MISSING} words={alt} />
      </Card>
      {said}
    </span>
  );
}
