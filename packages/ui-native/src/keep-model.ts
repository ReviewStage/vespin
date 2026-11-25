/**
 * keep-model.ts -- what a person may do with a picture, a recording, a sound clip, or a file a message carried: copy it, save it to Photos, or share it, as iOS offers for each kind, read from the bytes the app holds.
 *
 * The panel's viewer copies and saves only a file whose bytes the window
 * holds (`heldBytes` in `@repo/panel`'s `attachment-viewer.tsx`), never one
 * drawn from an address, and this holds the same: a picture is kept only
 * from its `data:` address or the file the app wrote it to under its caches,
 * named by its type's extension, and a recording or a file only from the
 * file the app wrote, a recording drawn from the service's address
 * downloaded to one as it is kept. Photos takes a picture the system decodes and an
 * MP4, never a WebM or an SVG, and the pasteboard takes a picture the system
 * decodes or a text file's words, never a sound clip; anything may be shared.
 */

import { Predicate } from "effect";
import { GLYPH, type Glyph } from "./glyph.js";

/** What is kept: a picture, a recording, a sound clip, or any other file a message carried. */
export const KEPT_KIND = {
  PICTURE: "picture",
  VIDEO: "video",
  SOUND: "sound",
  FILE: "file",
} as const;

export type KeptKind = (typeof KEPT_KIND)[keyof typeof KEPT_KIND];

/** What a person may do with it, in the order a menu offers them, as Photos orders its own. */
export const KEEP_ACT = {
  COPY: "copy",
  SAVE_TO_PHOTOS: "save-to-photos",
  SHARE: "share",
} as const;

export type KeepAct = (typeof KEEP_ACT)[keyof typeof KEEP_ACT];

/** A picture, a recording, a sound clip, or a file, by where its bytes are and what it is named. */
export type Kept =
  | {
      readonly kind: typeof KEPT_KIND.PICTURE;
      /** The address it is drawn from: a `data:` address holding its bytes, the file the app wrote it to (`file://`, named by its type's extension), or a web address. */
      readonly source: string;
      /** What it shows, which names the file it is shared as. */
      readonly name: string;
    }
  | {
      readonly kind: typeof KEPT_KIND.VIDEO;
      /** The file the app wrote it to, named by its type's extension (`cachedPlayed`), or the service's address with the header its read carries, which the app downloads as it is kept and lets go of after. */
      readonly source: string | RemoteVideo;
      readonly name: string;
      /** Whether the system's player can play one held by its address, so it is an MP4, which Photos takes. */
      readonly plays?: boolean;
    }
  | {
      readonly kind: typeof KEPT_KIND.SOUND;
      /** The file the app wrote it to, named by its type's extension (`cachedPlayed`). */
      readonly source: string;
      readonly name: string;
    }
  | {
      readonly kind: typeof KEPT_KIND.FILE;
      /** The file the app wrote it to, under its own name (`cachedFile`). */
      readonly source: string;
      readonly name: string;
      readonly mediaType: string;
    };

/** A recording held by the service's address, with the header its read carries, which is never logged or kept. */
export interface RemoteVideo {
  readonly uri: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

/** A picture's bytes as its `data:` address holds them. */
export interface HeldPicture {
  readonly mediaType: string;
  readonly base64: string;
  /** The extension a file of it is named with. */
  readonly extension: string;
}

/** The extension each picture type the system decodes is written under; a type missing here is not decoded, so neither copied nor saved. */
const DECODED_PICTURE_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

/** The extension a picture the system does not decode is shared under. */
const SHARED_PICTURE_EXTENSION: ReadonlyMap<string, string> = new Map([["image/svg+xml", "svg"]]);

/** Every extension a picture is written under (`pictureExtension`), so a file written for one is found again by its name alone. */
export const PICTURE_FILE_EXTENSIONS: readonly string[] = [
  ...DECODED_PICTURE_EXTENSION.values(),
  ...SHARED_PICTURE_EXTENSION.values(),
];

/** The scheme of a file the app wrote. */
const FILE_SCHEME = "file://";

/** What a file's extension is made of; anchored at both ends, so it is checked in one pass. */
const FILE_EXTENSION = /^[a-z0-9]+$/iu;

/** A picture's `data:` address: its type, then its bytes in base64 up to any fragment. */
const PICTURE_DATA = /^data:(image\/[a-z0-9.+-]+);base64,([^#]+)/iu;

/** The extension of the one recording kind Photos takes. */
const PHOTOS_VIDEO_EXTENSION = ".mp4";

/** What a text file's type starts with, whose words are copied. */
const TEXT_TYPE = "text/";

/** What each act is called in a menu, as iOS's own menus name them. */
export const KEEP_WORDS = {
  [KEEP_ACT.COPY]: "Copy",
  [KEEP_ACT.SAVE_TO_PHOTOS]: "Save to Photos",
  [KEEP_ACT.SHARE]: "Share…",
} as const satisfies Record<KeepAct, string>;

/** The glyph each act leads with in a menu: the panel's own for Copy and Save, and iOS's own Share. */
export const KEEP_SYMBOL = {
  [KEEP_ACT.COPY]: GLYPH.COPY,
  [KEEP_ACT.SAVE_TO_PHOTOS]: GLYPH.SAVE,
  [KEEP_ACT.SHARE]: GLYPH.SHARE,
} as const satisfies Record<KeepAct, Glyph>;

/** A picture's bytes from its `data:` address; none for a web address, or a type no file can be named for. */
export function heldPicture(source: string): HeldPicture | undefined {
  const match = PICTURE_DATA.exec(source);

  if (match === null) return undefined;
  const mediaType = (match[1] ?? "").toLowerCase();

  const extension =
    DECODED_PICTURE_EXTENSION.get(mediaType) ?? SHARED_PICTURE_EXTENSION.get(mediaType);

  return extension === undefined ? undefined : { mediaType, base64: match[2] ?? "", extension };
}

/** The extension a picture of `mediaType` is written under, so a file of it is read as one; none for a type no file can be named for. */
export function pictureExtension(mediaType: string): string | undefined {
  const type = mediaType.toLowerCase();

  return DECODED_PICTURE_EXTENSION.get(type) ?? SHARED_PICTURE_EXTENSION.get(type);
}

/**
 * A file address's extension: after the last dot of its last segment, before any query or fragment.
 * Note that we cut by index rather than with one regular expression, because an unanchored
 * one backtracks on a long run of dots.
 */
function fileExtension(source: string): string | undefined {
  const cut = source.search(/[?#]/u);
  const path = cut === -1 ? source : source.slice(0, cut);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1);

  return FILE_EXTENSION.test(extension) ? extension : undefined;
}

/** Whether a picture's extension names a type the system decodes, which may be copied and saved as well as shared. */
function decodedExtension(extension: string): boolean {
  return [...DECODED_PICTURE_EXTENSION.values()].includes(extension.toLowerCase());
}

/** What may be done with a picture: nothing for one drawn from a web address, sharing alone for one the system does not decode. */
function pictureActs(source: string): readonly KeepAct[] {
  const extension = source.startsWith(FILE_SCHEME)
    ? fileExtension(source)
    : heldPicture(source)?.extension;

  if (extension === undefined) return [];

  if (!decodedExtension(extension)) {
    return [...SHARED_PICTURE_EXTENSION.values()].includes(extension.toLowerCase())
      ? [KEEP_ACT.SHARE]
      : [];
  }

  return [KEEP_ACT.COPY, KEEP_ACT.SAVE_TO_PHOTOS, KEEP_ACT.SHARE];
}

/** What may be done with a kept thing, in its menu's order. */
export function keepActs(kept: Kept): readonly KeepAct[] {
  switch (kept.kind) {
    case KEPT_KIND.PICTURE:
      return pictureActs(kept.source);
    case KEPT_KIND.VIDEO:
      return (
        Predicate.isString(kept.source)
          ? kept.source.toLowerCase().endsWith(PHOTOS_VIDEO_EXTENSION)
          : kept.plays === true
      )
        ? [KEEP_ACT.SAVE_TO_PHOTOS, KEEP_ACT.SHARE]
        : [KEEP_ACT.SHARE];
    // Note that a clip is only shared, since neither Photos nor the pasteboard holds one.
    case KEPT_KIND.SOUND:
      return [KEEP_ACT.SHARE];
    case KEPT_KIND.FILE:
      return kept.mediaType.startsWith(TEXT_TYPE)
        ? [KEEP_ACT.COPY, KEEP_ACT.SHARE]
        : [KEEP_ACT.SHARE];
  }
}
