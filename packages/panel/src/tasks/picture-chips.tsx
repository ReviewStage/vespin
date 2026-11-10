import { chipBase64, type FileChip } from "@repo/features/attachment-model";
import { isPictureName, pictureMarkers } from "@repo/features/picture-marker";
import { PictureRef } from "@repo/ui";
import { createContext, type ReactNode, useState } from "react";
import { AttachmentViewer } from "./attachment-viewer.js";

/**
 * picture-chips.tsx -- the pictures a message names in its words (`@repo/features/picture-marker`), each drawn where its marker stands as its pill, and the viewer a press opens it in.
 *
 * The message box draws each marker of a picture it holds as the picture's
 * chip (`agent-composer.tsx`), and the transcript draws each marker of a
 * sent message's picture the same way (`skill-chip.tsx`'s `SentWords`), so
 * a message reads the same written and sent: the picture's thumbnail and its
 * name, its card hanging it larger while the pointer rests on it, and a
 * press opening it over the window as every attachment opens
 * (`attachment-viewer.tsx`), walking the message's pictures in the order its
 * words name them.
 */

/** The pictures a sent message names in its words: the names whose markers are drawn as chips, and each chip, by its name. */
export interface WordPictures {
  readonly names: ReadonlySet<string>;
  readonly chip: (name: string) => ReactNode;
}

/** The pictures of the sent message drawn under it, which its words draw in place (`SentWords`); none outside a message, or for one whose words name none. */
export const WordPicturesContext = createContext<WordPictures | undefined>(undefined);

/** A picture's pill: its thumbnail where its bytes are here, and its open where they are. */
export function PictureChip({
  name,
  file,
  onOpen,
}: {
  name: string;
  /** The picture's file, where the message holds one of that name. */
  file: FileChip | undefined;
  onOpen: (name: string) => void;
}): React.JSX.Element {
  const here = file !== undefined && (chipBase64(file) !== "" || file.url !== "");
  return (
    <PictureRef
      name={name}
      image={here ? file.url : undefined}
      onOpen={here ? () => onOpen(name) : undefined}
    />
  );
}

/** The viewer a message's pictures open in: open one by its name, walking `files` from it, and the viewer while one is open. */
export function usePictureViewer(files: readonly FileChip[]): {
  readonly open: (name: string) => void;
  readonly viewer: ReactNode;
} {
  // The picture open, by its name, so a picture taken off meanwhile closes it rather than opening its neighbor.
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

/**
 * The pictures among a message's files that its words name, each drawn
 * where its marker stands as its chip and opening over the window, walking
 * them in the order the words name them, and the names of those it draws
 * in place, which its files' row leaves out; nothing where the words name
 * none, as every message written before markers.
 */
export function useWordPictures(
  files: readonly FileChip[],
  words: string,
): {
  readonly pictures: WordPictures | undefined;
  readonly inWords: ReadonlySet<string>;
  readonly viewer: ReactNode;
} {
  const named = [...new Set(pictureMarkers(words).map((marker) => marker.name))];
  const placed = named.flatMap((name) => {
    const file = files.find(
      (each) => each.name === name && isPictureName(name) && each.mediaType.startsWith("image/"),
    );
    return file === undefined ? [] : [file];
  });
  const viewer = usePictureViewer(placed.filter((file) => file.url !== ""));
  const inWords = new Set(placed.map((file) => file.name));
  if (placed.length === 0) return { pictures: undefined, inWords, viewer: viewer.viewer };
  return {
    pictures: {
      names: inWords,
      chip: (name) => (
        <PictureChip
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
