import { chipBase64, type FileChip } from "@repo/features/attachment-model";
import { fileMarkers, isPictureName } from "@repo/features/file-marker";
import { AttachmentRef } from "@repo/ui";
import { createContext, Fragment, type ReactNode, useState } from "react";
import { AttachmentViewer } from "./attachment-viewer.js";
import { FileTypeIcon } from "./file-type-icon.js";

/**
 * file-chips.tsx -- the files a message names in its words (`@repo/features/file-marker`), each drawn where its marker stands as its pill, and the viewer a press opens it in.
 *
 * The message box draws each marker of a file it holds as the file's chip
 * (`message-box.tsx`), and every surface that draws a sent message draws
 * each marker of its files the same way (`skill-chip.tsx`'s `SentWords`, a
 * comment's `CommentWords`), so a message reads the same written and sent: a
 * picture's thumbnail and its name, its card hanging it larger while the
 * pointer rests on it, and any other file's type as the file tree draws it
 * and its name; a press opens it over the window as every attachment opens
 * (`attachment-viewer.tsx`), walking the message's files in the order its
 * words name them.
 */

/** The files a sent message names in its words: the names whose markers are drawn as chips, and each chip, by its name. */
export interface WordFiles {
  readonly names: ReadonlySet<string>;
  readonly chip: (name: string) => ReactNode;
}

/** The files of the sent message drawn under it, which its words draw in place (`SentWords`); none outside a message, or for one whose words name none. */
export const WordFilesContext = createContext<WordFiles | undefined>(undefined);

/** Whether a file is the one a marker of the name names: a picture's marker an image of a picture's name, any other the file of that name. */
function namedBy(file: FileChip, name: string): boolean {
  if (file.name !== name) return false;

  return !isPictureName(name) || file.mediaType.startsWith("image/");
}

/** A file's pill: a picture's thumbnail, or any other file's type, and its open where its bytes are here; without `onOpen`, an inert pill hanging nothing, as a row's line draws it. */
export function WordFileChip({
  name,
  file,
  onOpen,
}: {
  name: string;
  /** The file, where the message holds one of that name. */
  file: FileChip | undefined;
  onOpen?: ((name: string) => void) | undefined;
}): React.JSX.Element {
  const here = file !== undefined && (chipBase64(file) !== "" || file.url !== "");
  const open = here && onOpen !== undefined ? () => onOpen(name) : undefined;
  // Note that a file whose type is not here yet is drawn by its name, a picture's as a picture's.
  const picture = file === undefined ? isPictureName(name) : file.mediaType.startsWith("image/");

  return (
    <AttachmentRef
      name={name}
      image={picture && here ? file.url : undefined}
      glyph={picture ? undefined : <FileTypeIcon name={name} />}
      onOpen={open}
      hint={onOpen !== undefined}
    />
  );
}

/**
 * One line of a message's words as plain words, a row's preview, in pieces:
 * its words, and each file its words name drawn where its marker stood as
 * its pill, as the thread draws the same message's: a picture's thumbnail
 * where its bytes are here, else its glyph, and its name. Note that the pill
 * presses nothing and hangs no card, because the row it stands in is the
 * press and hangs its own.
 */
export function LineWords({ pieces }: { pieces: readonly (string | FileChip)[] }): ReactNode {
  return pieces.map((piece, at) =>
    typeof piece === "string" ? (
      <Fragment key={at}>{piece}</Fragment>
    ) : (
      <WordFileChip key={at} name={piece.name} file={piece} />
    ),
  );
}

/** The viewer a message's files open in: open one by its name, walking `files` from it, and the viewer while one is open. */
export function useWordFileViewer(files: readonly FileChip[]): {
  readonly open: (name: string) => void;
  readonly viewer: ReactNode;
} {
  // The file open, by its name, so a file taken off meanwhile closes it rather than opening its neighbor.
  const [viewing, setViewing] = useState<string | undefined>(undefined);
  const at = viewing === undefined ? -1 : files.findIndex((file) => file.name === viewing);

  const viewer =
    at === -1 ? null : (
      <AttachmentViewer
        files={files}
        at={at}
        onAt={(next) => setViewing(files[next]?.name)}
        onClose={() => setViewing(undefined)}
      />
    );

  return { open: setViewing, viewer };
}

/** The files among a message's that its words name, in the order they first name each. */
function filesInWords(files: readonly FileChip[], words: string): readonly FileChip[] {
  const named = [...new Set(fileMarkers(words).map((marker) => marker.name))];

  return named.flatMap((name) => {
    const file = files.find((each) => namedBy(each, name));

    return file === undefined ? [] : [file];
  });
}

/** A message's files as its words draw them: those the words name, for the words to draw where each marker stands, the rest for the row over them, and the viewer a chip opens. */
export interface ShownWordFiles {
  /** The files the words name; nothing where they name none, as every message written before markers. */
  readonly named: WordFiles | undefined;
  /** The files the words name none of, in the order given: those sent before markers, or named only in code. */
  readonly beside: readonly FileChip[];
  /** Any of the files' chip by its name, as a box draws one the moment its marker goes in. */
  readonly chip: (name: string) => ReactNode;
  readonly viewer: ReactNode;
}

/**
 * A message's files as its words draw them: each file its words name drawn
 * where its marker stands as its chip, opening over the window and walking
 * them in the order the words name them, and every other file left for the
 * row over the words.
 */
export function useWordFiles(files: readonly FileChip[], words: string): ShownWordFiles {
  const placed = filesInWords(files, words);
  const viewer = useWordFileViewer(placed.filter((file) => file.url !== ""));

  const chip = (name: string) => (
    <WordFileChip
      name={name}
      file={files.find((file) => namedBy(file, name))}
      onOpen={viewer.open}
    />
  );

  return {
    named:
      placed.length === 0 ? undefined : { names: new Set(placed.map((file) => file.name)), chip },
    beside: files.filter((file) => !placed.includes(file)),
    chip,
    viewer: viewer.viewer,
  };
}
