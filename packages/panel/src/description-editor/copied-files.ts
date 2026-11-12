import { isPictureName } from "@repo/features/file-marker";
import type { CopiedFile } from "./contract.js";

/**
 * copied-files.ts -- a file's chip carried through the clipboard with its file: written out with the file's bytes in a data address, and read back in as the file it carried.
 *
 * A copy of the message box's words writes each file's chip into the
 * clipboard's HTML with the file in it, a picture as an image any editor
 * that takes HTML pastes as one, so a chip pasted into another box comes
 * with its file rather than as the words of its marker. Only a data address is read back: nothing pasted is ever
 * fetched.
 */

/** A data address carrying base64 bytes: its type, and the bytes. */
const DATA_ADDRESS = /^data:([^;,]+);base64,([A-Za-z0-9+/=]*)$/u;

/** The file written as a data address. */
export function dataAddress(file: CopiedFile): string {
  return `data:${file.mediaType};base64,${file.data}`;
}

/** The file a data address carries; nothing where the address carries no base64 bytes. */
export function copiedFileOf(address: string | null): CopiedFile | undefined {
  const match = DATA_ADDRESS.exec(address ?? "");
  const [, mediaType, data] = match ?? [];

  if (mediaType === undefined || data === undefined || data === "") return undefined;

  return { mediaType, data };
}

/** Whether two copies carry the same file. */
export function sameFile(first: CopiedFile, second: CopiedFile): boolean {
  return first.mediaType === second.mediaType && first.data === second.data;
}

/**
 * The file a chip carried, as a file handed to a box. Note that a picture
 * named as a box numbers one comes with no name, so the box it lands in
 * numbers it after its own pictures rather than beside one of the same name.
 */
export function fileOfCopy(file: CopiedFile, name: string): File {
  const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));

  return new File([bytes], isPictureName(name) ? "" : name, { type: file.mediaType });
}
