import {
  INBOX_FILE_TYPE,
  INBOX_OPTION_MEDIA,
  type InboxOption,
  type InboxOptionFile,
  type InboxOptionMedia,
  type InboxOptionPage,
  knownOptionMedia,
} from "@repo/features/inbox-wire";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import {
  ExternalIcon,
  OPTION_MEDIA_KIND,
  OptionMedia,
  type OptionMediaLine,
  PAGE_THUMB_SIZE,
  PageThumb,
  PictureSet,
  PictureSetTile,
} from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { useRef } from "react";
import { appPlatform } from "../app-platform.js";
import { useInboxPictureThumb } from "./inbox-pictures.js";
import { PAGE_SANDBOX } from "./page-pane.js";
import { PAGE_ROOM, usePageTheme } from "./page-theme.js";
import { useOpenLink, useOpenPlace } from "./use-open-link.js";

/**
 * inbox-option-media.tsx -- what an option of an Inbox `decide` carries, drawn on its card: its pictures as thumbnails, and a line each for its recordings, pages, and live addresses.
 *
 * The pictures and recordings are the item's own files, read as its
 * pictures are and counted among them (`inbox-pictures.tsx`), so a press
 * on any opens the item's one viewer at it, named for its option, and the
 * arrow keys walk on through the next option's. A page is drawn small as
 * its card draws it, at the version the agent showed, and opens its tab; an
 * address opens in the browser and is never framed here, since a page from
 * outside the app would run in the reader's session. A kind this build
 * does not know is left out.
 */

/** Whether an option's file is a recording, which its line plays in the viewer, rather than a still. */
function isRecording(file: InboxOptionFile): boolean {
  return file.mediaType === INBOX_FILE_TYPE.WEBM;
}

/** What a file is called in the viewer and read aloud: its option's label and its caption, or its place among the option's files. */
function fileWords(label: string, file: InboxOptionFile, at: number): string {
  return `${label} · ${file.caption ?? `${at + 1}`}`;
}

/** One picture of an option, a thumbnail opening the item's viewer at it. */
function OptionPicture({ file, words }: { file: InboxOptionFile; words: string }) {
  const thumb = useInboxPictureThumb(file.attachmentId, words);
  return (
    <PictureSetTile
      ref={thumb?.anchor}
      state={thumb?.state ?? { kind: PICTURE_STATE.READING }}
      words={words}
      onOpen={thumb?.open}
    />
  );
}

/** What opens the item's viewer at each recording, by its attachment, as its thumb last drew it. */
type RecordingOpeners = Map<string, () => void>;

/**
 * A recording's thumb: its first frame once its bytes are read, holding its
 * place among the item's pictures, and leaving what opens the viewer at it
 * for its line's press. Note that the thumb counts the recording among the
 * item's pictures, not the line, because the line is drawn by `@repo/ui`.
 */
function RecordingThumb({
  file,
  words,
  openers,
}: {
  file: InboxOptionFile;
  words: string;
  openers: RecordingOpeners;
}) {
  const thumb = useInboxPictureThumb(file.attachmentId, words);
  if (thumb === undefined) openers.delete(file.attachmentId);
  else openers.set(file.attachmentId, thumb.open);
  const video = thumb?.state.kind === PICTURE_STATE.READY ? thumb.state.url : undefined;
  return (
    <span ref={thumb?.anchor} className="inline-flex">
      <PageThumb size={PAGE_THUMB_SIZE.ROW} video={video} />
    </span>
  );
}

/** A page's thumb: the version the agent showed, drawn small as its tab draws it. */
function PageRowThumb({ page }: { page: InboxOptionPage }) {
  const frame = useRef<HTMLIFrameElement>(null);
  usePageTheme(frame, PAGE_ROOM.OWN);
  return (
    <PageThumb
      size={PAGE_THUMB_SIZE.ROW}
      frameRef={frame}
      frame={{
        title: `${page.title} preview`,
        src: appPlatform().pageFrameUrl({
          ...page.place,
          pageId: page.pageId,
          version: page.version,
        }),
        sandbox: PAGE_SANDBOX,
      }}
    />
  );
}

/** One recording's line, read and opened as a picture of the item. */
function recordingLine(
  file: InboxOptionFile,
  words: string,
  openers: RecordingOpeners,
): OptionMediaLine {
  return {
    id: file.attachmentId,
    kind: OPTION_MEDIA_KIND.RECORDING,
    title: file.caption ?? words,
    thumb: <RecordingThumb file={file} words={words} openers={openers} />,
    onOpen: () => openers.get(file.attachmentId)?.(),
  };
}

/** The media of one option as its card draws it, or nothing where it carries none this build draws. */
export function OptionCardMedia({ option }: { option: InboxOption }): React.JSX.Element | null {
  const openPlace = useOpenPlace();
  const openLink = useOpenLink();
  const openers = useRef<RecordingOpeners>(new Map()).current;
  const media = knownOptionMedia(option);
  const files = media.filter(
    (piece): piece is InboxOptionFile => piece.type === INBOX_OPTION_MEDIA.FILE,
  );
  const pictures = files.filter((file) => !isRecording(file));
  const lines = media.flatMap((piece: InboxOptionMedia): OptionMediaLine[] => {
    switch (piece.type) {
      case INBOX_OPTION_MEDIA.FILE:
        return isRecording(piece)
          ? [recordingLine(piece, fileWords(option.label, piece, files.indexOf(piece)), openers)]
          : [];
      case INBOX_OPTION_MEDIA.PAGE:
        return [
          {
            id: piece.pageId,
            kind: OPTION_MEDIA_KIND.PAGE,
            title: piece.title,
            thumb: <PageRowThumb page={piece} />,
            onOpen: () =>
              openPlace?.({
                kind: LINK_DESTINATION.PAGE,
                ...("taskId" in piece.place
                  ? { planId: piece.place.taskId }
                  : { agentId: piece.place.agentId }),
                pageId: piece.pageId,
              }),
          },
        ];
      case INBOX_OPTION_MEDIA.LINK:
        return [
          {
            id: piece.url,
            kind: OPTION_MEDIA_KIND.LINK,
            title: piece.label ?? piece.url,
            thumb: <PageThumb size={PAGE_THUMB_SIZE.ROW} glyph={<ExternalIcon />} />,
            onOpen: () => openLink(piece.url),
          },
        ];
      default:
        return [];
    }
  });
  if (pictures.length === 0 && lines.length === 0) return null;
  return (
    <OptionMedia
      label={option.label}
      pictures={
        pictures.length === 0 ? undefined : (
          <PictureSet label={`${option.label} pictures`} count={pictures.length} thumbnails>
            {pictures.map((file) => (
              <OptionPicture
                key={file.attachmentId}
                file={file}
                words={fileWords(option.label, file, files.indexOf(file))}
              />
            ))}
          </PictureSet>
        )
      }
      lines={lines}
    />
  );
}
