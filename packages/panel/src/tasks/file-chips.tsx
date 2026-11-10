import { chipBase64, type FileChip } from "@repo/features/attachment-model";
import { fileMarkers, isPictureName } from "@repo/features/file-marker";
import { FileRef, PictureRef } from "@repo/ui";
import { createContext, type ReactNode, useState } from "react";
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

/** A file's pill: a picture's thumbnail, or any other file's type, and its open where its bytes are here. */
export function WordFileChip({
  name,
  file,
  onOpen,
}: {
  name: string;
  /** The file, where the message holds one of that name. */
  file: FileChip | undefined;
  onOpen: (name: string) => void;
}): React.JSX.Element {
  const here = file !== undefined && (chipBase64(file) !== "" || file.url !== "");
  const open = here ? () => onOpen(name) : undefined;
  // Note that a file whose type is not here yet is drawn by its name, a picture's as a picture's.
  const picture = file === undefined ? isPictureName(name) : file.mediaType.startsWith("image/");
  return picture ? (
    <PictureRef name={name} image={here ? file.url : undefined} onOpen={open} />
  ) : (
    <FileRef name={name} glyph={<FileTypeIcon name={name} />} onOpen={open} />
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
export function filesInWords(files: readonly FileChip[], words: string): readonly FileChip[] {
  const named = [...new Set(fileMarkers(words).map((marker) => marker.name))];
  return named.flatMap((name) => {
    const file = files.find((each) => namedBy(each, name));
    return file === undefined ? [] : [file];
  });
}

/**
 * The files among a message's that its words name, each drawn where its
 * marker stands as its chip and opening over the window, walking them in the
 * order the words name them, and the names of those it draws in place, which
 * its files' row leaves out; nothing where the words name none, as every
 * message written before markers.
 */
export function useWordFiles(
  files: readonly FileChip[],
  words: string,
): {
  readonly files: WordFiles | undefined;
  readonly inWords: ReadonlySet<string>;
  readonly viewer: ReactNode;
} {
  const placed = filesInWords(files, words);
  const viewer = useWordFileViewer(placed.filter((file) => file.url !== ""));
  const inWords = new Set(placed.map((file) => file.name));
  if (placed.length === 0) return { files: undefined, inWords, viewer: viewer.viewer };
  return {
    files: {
      names: inWords,
      chip: (name) => (
        <WordFileChip
          name={name}
          file={placed.find((file) => file.name === name)}
          onOpen={viewer.open}
        />
      ),
    },
    inWords,
    viewer: viewer.viewer,
  };
}
