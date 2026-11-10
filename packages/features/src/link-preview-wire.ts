import { Schema as EffectSchema } from "effect";

/**
 * link-preview-wire.ts -- what the service says of a web page a plain link in the app's words names, for the card the link hangs: its title, its description, its site's name, and its favicon and picture where the page names them.
 *
 * `POST /api/link-previews { url }` is asked for a page as the member
 * rests the pointer on a link to it, and the service, never the member's own
 * machine, reads the page's `<head>` and answers what it says of itself:
 * its `<title>` or Open Graph title, its description, its site's name, and
 * its icon and Open Graph picture, each picture's bytes in base64 under
 * the type they sniff as, so the window draws it from a `data:` URL of its
 * own and loads nothing from a third party. A page the service may not
 * read (`LINK_PREVIEW_REFUSAL.ADDRESS`): one not on the web over HTTPS, or
 * at an address inside a network rather than on the internet; one it could not
 * read in time, that is no HTML, or that answered nothing is `UNREAD`. The
 * bounds are the policy, held here alone so moving one is one edit: a page
 * says each thing in at most so many characters, and a picture past its
 * bound is left out rather than carried.
 */

export const LINK_PREVIEW_BOUNDS = {
  /** The most characters an address asked for may spell. */
  MAX_URL_CHARS: 2_048,
  /** The most characters of a page's title the preview says; a longer one is cut. */
  MAX_TITLE_CHARS: 200,
  /** The most characters of a page's description the preview says; a longer one is cut. */
  MAX_DESCRIPTION_CHARS: 400,
  /** The most characters of a site's name the preview says; a longer one is cut. */
  MAX_SITE_NAME_CHARS: 100,
  /** The most bytes a page's icon is carried at; a larger one is left out. */
  MAX_ICON_BYTES: 64_000,
  /** The most bytes a page's picture is carried at; a larger one is left out. */
  MAX_IMAGE_BYTES: 600_000,
} as const;

/** The one field a preview is asked by, in the body. */
export const LINK_PREVIEW_QUERY = {
  URL: "url",
} as const;

/** The types a page's icon or picture may be, each sniffed from its bytes and drawn from a `data:` URL the window makes. */
export const LINK_PREVIEW_PICTURE_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  GIF: "image/gif",
  ICO: "image/x-icon",
} as const;

export type LinkPreviewPictureType =
  (typeof LINK_PREVIEW_PICTURE_TYPE)[keyof typeof LINK_PREVIEW_PICTURE_TYPE];

/** Why a page has no preview: its address is none the service reads, or the page could not be read. */
export const LINK_PREVIEW_REFUSAL = {
  /** The address is not an HTTPS web page's, or names a host inside a network rather than on the internet. */
  ADDRESS: "address",
  /** The page did not answer in time, answered no HTML, or answered an error. */
  UNREAD: "unread",
} as const;

/** The address asked for, as the body carries it: a bounded string the service reads as a URL. */
export const linkPreviewUrlSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(LINK_PREVIEW_BOUNDS.MAX_URL_CHARS),
);

/** A page's icon or picture: its bytes in base64 under the type they sniffed as. */
const linkPreviewPictureSchema = EffectSchema.Struct({
  type: EffectSchema.Literals(Object.values(LINK_PREVIEW_PICTURE_TYPE)),
  base64: EffectSchema.String,
});

export type LinkPreviewPicture = typeof linkPreviewPictureSchema.Type;

/** What a page says of itself, each part where it says one. */
const linkPreviewSchema = EffectSchema.Struct({
  /** The page's address as it was asked for. */
  url: linkPreviewUrlSchema,
  title: EffectSchema.optionalKey(EffectSchema.String),
  description: EffectSchema.optionalKey(EffectSchema.String),
  siteName: EffectSchema.optionalKey(EffectSchema.String),
  icon: EffectSchema.optionalKey(linkPreviewPictureSchema),
  image: EffectSchema.optionalKey(linkPreviewPictureSchema),
});

export type LinkPreview = typeof linkPreviewSchema.Type;

/** A page's preview (POST): what it says of itself, or why it has none. */
export const linkPreviewAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ preview: linkPreviewSchema }),
  EffectSchema.Struct({ refused: EffectSchema.Literals(Object.values(LINK_PREVIEW_REFUSAL)) }),
]);

export type LinkPreviewAnswer = typeof linkPreviewAnswerSchema.Type;
