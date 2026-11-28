import { fileName } from "@repo/features/code-ref-words";
import { fileFolder } from "./file-ref-model.js";
import { FileTypeIcon } from "./file-type-icon.js";

/**
 * file-look.tsx -- how a row names a file: its type's icon, its name, its folder, and the path a search finds it by.
 *
 * Note that the look stands apart from the file's card and reference
 * (`file-ref.tsx`), because a tab's look (`tab-look.tsx`) and ⌘K read it
 * alone, and the card reaches the window's mentions, which draw tabs' looks
 * in turn.
 */

/** A file as a row names it, in a menu, the summary, or ⌘K: its type's icon, its name, its folder after the name, and the whole path a search finds it by. */
export interface FileLook {
  readonly icon: React.JSX.Element;
  readonly label: string;
  readonly detail: string | undefined;
  readonly terms: readonly string[];
}

/** How a file is named in a row, and its tab's icon and name the same. */
export function fileLook(path: string): FileLook {
  const name = fileName(path);

  return {
    icon: <FileTypeIcon name={name} />,
    label: name,
    detail: fileFolder(path),
    terms: [path],
  };
}
