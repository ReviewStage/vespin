import { ENTITY_KIND } from "@repo/features/entity-kind";
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
  OPTION_MEDIA_KIND,
  OptionMedia,
  type OptionMediaPiece,
  PAGE_THUMB_FIT,
  PageThumb,
} from "@repo/ui";
import { GLYPH, ImageOffIcon } from "@repo/ui/icons";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { useRef } from "react";
import { appPlatform } from "../app-platform.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { useInboxPictureThumb } from "./inbox-pictures.js";
import { PAGE_SANDBOX } from "./page-pane.js";
import { PAGE_ROOM, usePageTheme } from "./page-theme.js";
import { useOpenLink, useOpenPlace } from "./use-open-link.js";

/**
 * inbox-option-media.tsx -- what an option of an Inbox `decide` carries, drawn on its card: every picture, recording, page, and live address as an equal tile with its caption.
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

/** Whether an option's file is a recording, which the viewer plays, rather than a still. */
function isRecording(file: InboxOptionFile): boolean {
  return file.mediaType === INBOX_FILE_TYPE.WEBM;
}

/** What a file is called in the viewer and read aloud: its option's label and its caption, or its place among the option's files. */
function fileWords(label: string, file: InboxOptionFile, at: number): string {
  return `${label} · ${file.caption ?? `${at + 1}`}`;
}

/** What an address is called where its agent gave it no words: its host, as a reader knows a site by. Note that the wire admits an https address alone, so it always reads. */
function addressWords(url: string): string {
  return new URL(url).host;
}

/** What opens the item's viewer at each of an option's files, by its attachment, as its thumb last drew it. */
type FileOpeners = Map<string, () => void>;

/**
 * A picture's or a recording's thumb: the picture, or the recording's first
 * frame, whole on the thumb's ground once its bytes are read, and a gone
 * picture's glyph where they could not be, holding its place among the
 * item's pictures so the viewer walks it with the rest, and leaving what
 * opens the viewer at it for its tile's press. Note that the thumb counts
 * the file among the item's pictures, not the tile, because the tile is
 * drawn by `@repo/ui`.
 */
function FileThumb({
  file,
  words,
  openers,
}: {
  file: InboxOptionFile;
  words: string;
  openers: FileOpeners;
}) {
  const thumb = useInboxPictureThumb(file.attachmentId, words);
  if (thumb === undefined) openers.delete(file.attachmentId);
  else openers.set(file.attachmentId, thumb.open);
  const url = thumb?.state.kind === PICTURE_STATE.READY ? thumb.state.url : undefined;
  const gone =
    thumb?.state.kind === PICTURE_STATE.FAILED || thumb?.state.kind === PICTURE_STATE.MISSING;
  return (
    <span ref={thumb?.anchor} className="block">
      <PageThumb
        fit={PAGE_THUMB_FIT.CONTAIN}
        image={isRecording(file) ? undefined : url}
        video={isRecording(file) ? url : undefined}
        glyph={gone ? <ImageOffIcon /> : undefined}
      />
    </span>
  );
}

/** A page's thumb: the version the agent showed, drawn small as its tab draws it. */
function PageFrameThumb({ page }: { page: InboxOptionPage }) {
  const frame = useRef<HTMLIFrameElement>(null);
  usePageTheme(frame, PAGE_ROOM.OWN);
  return (
    <PageThumb
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

/** The doors an option's tiles open through: the viewer at a file, a page's tab, and the browser. */
interface PieceDoors {
  readonly openers: FileOpeners;
  readonly openPage: (page: InboxOptionPage) => void;
  readonly openLink: (url: string) => void;
}

/** One piece of an option's media as its tile: its kind, its caption, its thumb, and what a press opens. */
function pieceOf(
  option: InboxOption,
  piece: InboxOptionMedia,
  at: number,
  doors: PieceDoors,
): OptionMediaPiece {
  switch (piece.type) {
    case INBOX_OPTION_MEDIA.FILE: {
      const words = fileWords(option.label, piece, at);
      return {
        id: piece.attachmentId,
        kind: isRecording(piece) ? OPTION_MEDIA_KIND.RECORDING : OPTION_MEDIA_KIND.PICTURE,
        caption: piece.caption,
        thumb: <FileThumb file={piece} words={words} openers={doors.openers} />,
        onOpen: () => doors.openers.get(piece.attachmentId)?.(),
      };
    }
    case INBOX_OPTION_MEDIA.PAGE:
      return {
        id: piece.pageId,
        kind: OPTION_MEDIA_KIND.PAGE,
        caption: piece.title,
        thumb: <PageFrameThumb page={piece} />,
        mark: <EntityGlyph kind={ENTITY_KIND.PAGE} />,
        onOpen: () => doors.openPage(piece),
      };
    case INBOX_OPTION_MEDIA.LINK:
      return {
        id: piece.url,
        kind: OPTION_MEDIA_KIND.LINK,
        caption: piece.label ?? addressWords(piece.url),
        thumb: <PageThumb glyph={<GLYPH.OPEN_EXTERNALLY />} />,
        onOpen: () => doors.openLink(piece.url),
      };
  }
}

/** The media of one option as its card draws it, one tile each, or nothing where it carries none this build draws. */
export function OptionCardMedia({ option }: { option: InboxOption }): React.JSX.Element | null {
  const openPlace = useOpenPlace();
  const openLink = useOpenLink();
  const openers = useRef<FileOpeners>(new Map()).current;
  const doors: PieceDoors = {
    openers,
    openLink,
    openPage: (page) =>
      openPlace?.({
        kind: LINK_DESTINATION.PAGE,
        ...("taskId" in page.place
          ? { planId: page.place.taskId }
          : { agentId: page.place.agentId }),
        pageId: page.pageId,
      }),
  };
  const pieces = knownOptionMedia(option).map((piece, at) => pieceOf(option, piece, at, doors));
  return <OptionMedia label={option.label} pieces={pieces} />;
}
