import type { AgentAttachment } from "@repo/features/agent-wire";
import {
  ATTACHMENT_VIEW,
  attachmentText,
  attachmentView,
  chipBase64,
  type FileChip,
  linesLabel,
  peekOf,
  sizeLabel,
} from "@repo/features/attachment-model";
import {
  ALIGN,
  ATTACHMENT_CHIP_STATE,
  AttachmentChip,
  GAP,
  Inline,
  LAYOUT_ELEMENT,
} from "@repo/ui";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { AttachmentViewer, type ViewerAction } from "./attachment-viewer.js";
import { FileTypeIcon } from "./file-type-icon.js";

/**
 * attached-file-chips.tsx -- the files on a message as a row of chips: in the message box, each with its way off, and over the developer's bubble in the transcript.
 *
 * An image is its thumbnail; any other file is its type's icon as the file
 * tree draws it (`file-type-icon.tsx`), its name, and its size, as every
 * chat app draws one, a text file its count of lines instead, with the head
 * of its words in the card its chip hangs. Both read the file's bytes from a `data:` URL, the one the
 * message box made or the one the service kept on the developer's row, so a
 * transcript read back after a restart draws the same row. A press on a chip
 * opens its file over the window (`attachment-viewer.tsx`), walking the
 * message's files from there; a chip's way off in the box takes it off
 * without opening it, at once, so a message sent the moment after carries
 * nothing it took off, and the chips after it close over it at once. The box's chips are
 * followed by the file each stands for: `attachmentChips` answers one chip
 * for each file the box holds, the same chip each time it is asked, and the
 * row names each by an id it mints for that chip, since two files the box
 * holds may carry the same name and bytes. An image the service kept beside the transcript is
 * named on its row by the picture's id rather than carried as bytes
 * (`@repo/features/message-files`'s `messageFileChips`), and the transcript reads it through the agent's
 * pictures (`agent-pictures.tsx`'s `MessageFileChips`). A file the service
 * kept no bytes of, one the retired runtime staged in the sandbox before the row was
 * written, is drawn by its name alone, with nothing to open and nothing to
 * walk to.
 *
 * A line's files go up inside the one request that sends it, which says
 * nothing of how far its bytes have gone, so a line still on its way draws
 * its files going up without a share (`uploading`), and each takes its
 * check as the line's row lands.
 */

/** The chip drawn for each file a message box holds, so the box's row follows a file by its chip. */
const BOX_CHIPS = new WeakMap<AgentAttachment, FileChip>();

/** The files the message box holds, as chips: the same chip for a file each time. */
export function attachmentChips(attachments: readonly AgentAttachment[]): FileChip[] {
  return attachments.map((file) => {
    const known = BOX_CHIPS.get(file);

    if (known !== undefined) return known;

    const chip = {
      name: file.name,
      mediaType: file.mediaType,
      // Note that a file whose bytes are not here yet, a comment's kept by its edit, is drawn by its name alone.
      url: file.data === "" ? "" : `data:${file.mediaType};base64,${file.data}`,
    };

    BOX_CHIPS.set(file, chip);

    return chip;
  });
}

/** A text file's words, or nothing where its bytes spell no base64, so a row read back with a damaged file still draws, its chip saying its size. */
function wordsOf(base64: string): string | undefined {
  try {
    return attachmentText(base64);
  } catch {
    return undefined;
  }
}

/** One file's chip in a row: its thumbnail or its type's icon, its name and size, its open, and its way off where the row has one. */
function FileChipOf({
  file,
  onOpen,
  onRemove,
  uploading = false,
}: {
  file: FileChip;
  onOpen: (() => void) | undefined;
  onRemove: (() => void) | undefined;
  /** Whether the file is on its way up with the line it came on. */
  uploading?: boolean;
}): React.JSX.Element {
  const base64 = chipBase64(file);
  const view = base64 === "" ? ATTACHMENT_VIEW.OTHER : attachmentView(file);
  const thumbnail = view === ATTACHMENT_VIEW.IMAGE;

  // Note that a text file's words are read once for its file, since a chip draws again on every keystroke of the box it stands in.
  const text = useMemo(
    () => (view === ATTACHMENT_VIEW.TEXT ? wordsOf(base64) : undefined),
    [view, base64],
  );

  return (
    <AttachmentChip
      name={file.name}
      image={thumbnail ? file.url : undefined}
      icon={<FileTypeIcon name={file.name} />}
      detail={base64 === "" ? undefined : text === undefined ? sizeLabel(base64) : linesLabel(text)}
      peek={text === undefined ? undefined : peekOf(text)}
      onOpen={base64 === "" ? undefined : onOpen}
      onRemove={onRemove}
      state={uploading ? ATTACHMENT_CHIP_STATE.UPLOADING : ATTACHMENT_CHIP_STATE.READY}
    />
  );
}

/** The message box's row: each file's chip keyed by an id minted for its file, so a file taken off leaves the others' chips standing as they were. */
function BoxFileChips({
  files,
  onRemove,
  onOpen,
}: {
  files: readonly FileChip[];
  onRemove: (index: number) => void;
  onOpen: (file: FileChip) => void;
}): ReactNode {
  const [ids] = useState(() => new WeakMap<FileChip, string>());
  const minted = useRef(0);

  const idOf = (file: FileChip): string => {
    const known = ids.get(file);

    if (known !== undefined) return known;
    minted.current += 1;
    const id = String(minted.current);
    ids.set(file, id);

    return id;
  };

  return (
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.CONTROL}
      align={ALIGN.STRETCH}
      className="attached-files"
      aria-label="Attached files"
      hidden={files.length === 0}
    >
      {files.map((file, index) => (
        <FileChipOf
          key={idOf(file)}
          file={file}
          onOpen={() => onOpen(file)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </Inline>
  );
}

export function AttachedFileChips({
  files,
  onRemove,
  uploading = false,
  action,
}: {
  files: readonly FileChip[];
  /** Takes one file off the message, by its place; nothing in the transcript, whose files are sent. */
  onRemove?: ((index: number) => void) | undefined;
  /** Whether the files are on their way up with the line they came on. */
  uploading?: boolean;
  /** One more thing the viewer offers for a picture, a video, or a PDF shown, such as adding it to the task's description; nothing in the message box. */
  action?: ViewerAction | undefined;
}): ReactNode {
  // The file open over the window, by its place among those that carry bytes.
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const openable = files.filter((file) => chipBase64(file) !== "");
  const open = (file: FileChip) => setViewing(openable.indexOf(file));

  const viewer =
    viewing === undefined ? null : (
      <AttachmentViewer
        files={openable}
        at={viewing}
        onAt={setViewing}
        onClose={() => setViewing(undefined)}
        action={onRemove === undefined ? action : undefined}
      />
    );

  if (onRemove !== undefined) {
    return (
      <>
        <BoxFileChips files={files} onRemove={onRemove} onOpen={open} />
        {viewer}
      </>
    );
  }

  if (files.length === 0) return null;

  return (
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.CONTROL}
      align={ALIGN.STRETCH}
      className="attached-files"
      aria-label="Attached files"
    >
      {files.map((file, index) => (
        <FileChipOf
          key={`${String(index)}-${file.name}`}
          file={file}
          onOpen={() => open(file)}
          onRemove={undefined}
          uploading={uploading}
        />
      ))}
      {viewer}
    </Inline>
  );
}
