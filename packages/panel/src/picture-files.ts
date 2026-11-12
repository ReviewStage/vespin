/**
 * picture-files.ts -- which picked, pasted, or dropped files are pictures, a HEIC photo among them however the system typed it, and which a description keeps beside them, a PDF.
 *
 * Every place a picture is taken in tells one by `isPictureFile`, the
 * message box, feedback, and the description's editor alike, so a photo
 * off an iPhone is taken by all of them or none. Kept free of every other
 * import, because the description's editor, which loads as a bundle of its
 * own, reads it too.
 */

/** The types a HEIC or HEIF photo is given, which Chromium has no decoder for. */
const HEIC_TYPES: ReadonlySet<string> = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

/** A HEIC or HEIF photo's name, for a system that gave it no type. */
const HEIC_NAME = /\.hei[cf]$/iu;

/** Whether a file is a HEIC or HEIF photo, by its type or, where it has none, its name. */
export function isHeicFile(file: { readonly type: string; readonly name: string }): boolean {
  return HEIC_TYPES.has(file.type) || (file.type === "" && HEIC_NAME.test(file.name));
}

/** Whether a file is a picture: an image's type, or a HEIC photo by its name. */
export function isPictureFile(file: { readonly type: string; readonly name: string }): boolean {
  return file.type.startsWith("image/") || isHeicFile(file);
}

/** The picture files among whatever was picked, pasted, or dropped, in their given order. */
export function imageFiles(list: ArrayLike<File> | null | undefined): File[] {
  if (!list) return [];

  return Array.from(list).filter(isPictureFile);
}

/** The type a PDF is given. */
const PDF_TYPE = "application/pdf";

/** A PDF's name, for a system that gave it no type. */
const PDF_NAME = /\.pdf$/iu;

/** Whether a file is a PDF, by its type or, where it has none, its name. */
export function isPdfUpload(file: { readonly type: string; readonly name: string }): boolean {
  return file.type === PDF_TYPE || (file.type === "" && PDF_NAME.test(file.name));
}

/** The files a description keeps among whatever was picked, pasted, or dropped: its pictures and its PDFs, in their given order. */
export function descriptionFiles(list: ArrayLike<File> | null | undefined): File[] {
  if (!list) return [];

  return Array.from(list).filter((file) => isPictureFile(file) || isPdfUpload(file));
}
