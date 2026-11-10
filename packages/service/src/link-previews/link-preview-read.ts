/**
 * link-preview-read.ts -- a web page read for the card a plain link hangs: what its head says of it, and its icon and picture, each fetched by the service within its bounds and never from inside a network.
 *
 * Every address is held to `link-address.ts` before a byte is sent: the
 * page's, each redirect's, and each picture's, so a page on the internet
 * that redirects into a network, or names its picture there, answers
 * nothing of what stands inside. A host is resolved once per hop through
 * the resolver handed in, every address it resolves to must be public, and
 * the connection is then made to those very addresses (`HopTransport`),
 * never by resolving the name again, so a resolver that answers a public
 * address to the check and a private one to the connection (DNS rebinding)
 * reaches nothing: the name stays what the server is asked for, its TLS
 * name and its `Host` header, and only where the socket goes is pinned.
 * Redirects are followed by hand, a few at most, so each hop is held the
 * same way. No cookie or credential is sent, only the plain headers below,
 * and the whole read is held to a deadline, the page's bytes to a bound
 * past which the head is taken as whole, and each picture to its own
 * bound, past which it is left out. A picture is carried only as the type
 * its bytes sniff as, never as the type the server named. A page that is
 * no HTML, answers an error, redirects too often, or takes too long has no
 * preview.
 */

import {
  LINK_PREVIEW_BOUNDS,
  LINK_PREVIEW_PICTURE_TYPE,
  LINK_PREVIEW_REFUSAL,
  type LinkPreview,
  type LinkPreviewAnswer,
  type LinkPreviewPicture,
  type LinkPreviewPictureType,
} from "@repo/features/link-preview-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Duration, Effect, Option } from "effect";
import { allPublic, ipLiteralOf, webPageAddressOf } from "./link-address.js";
import { charsetOf, HEAD_MAX_BYTES, pageHeadOf } from "./link-preview-html.js";

/** The addresses a host name resolves to, every one of them; none where it resolves to nothing or the resolver failed. */
export type AddressResolver = (hostname: string) => Effect.Effect<readonly string[]>;

/** One hop as the transport is asked for it: the address, the checked addresses the socket may go to and no other, the headers, and the most bytes to read. */
export interface HopRequest {
  readonly url: URL;
  /** The addresses the guard admitted for the address's host, the only ones a connection may be made to. */
  readonly addresses: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
  readonly maxBytes: number;
}

/** What one hop answered: its status and headers, and its bytes read up to the bound, with whether more stood past them. */
export interface HopAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly bytes: Uint8Array;
  readonly cut: boolean;
}

/** How one hop is sent: to one of the checked addresses alone, following no redirect itself, sending no credential; none where the connection or the read failed. */
export type HopTransport = (request: HopRequest) => Effect.Effect<HopAnswer | undefined>;

/** What a read reaches the world through: the resolver its hosts are checked by, and the transport that connects to what the check admitted. */
export interface LinkPreviewReach {
  readonly resolve: AddressResolver;
  readonly connect: HopTransport;
}

/** How far and how long a read goes. */
const LINK_PREVIEW_READ = {
  /** The most redirects followed before the page is taken as unread. */
  MAX_REDIRECTS: 3,
  /** How long the page itself may take, redirects included. */
  PAGE_DEADLINE: Duration.seconds(5),
  /** How long each picture may take; one past it is left out. */
  PICTURE_DEADLINE: Duration.seconds(3),
  /** Who the service says it is to the pages it reads. */
  USER_AGENT: `${PRODUCT_NAME} link preview (+https://vespin.dev)`,
} as const;

/** What a page is asked for, and what a picture is. */
const ACCEPT = {
  PAGE: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  PICTURE:
    "image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,image/*;q=0.5",
} as const;

/** The media types a page is read as. */
const HTML_TYPES: ReadonlySet<string> = new Set(["text/html", "application/xhtml+xml"]);

/** The statuses that send the reader elsewhere, each with a `location`. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const ASCII = new TextEncoder();

/** The bytes each picture type opens with. */
const SIGNATURES: readonly (readonly [LinkPreviewPictureType, (bytes: Uint8Array) => boolean])[] = [
  [LINK_PREVIEW_PICTURE_TYPE.PNG, (bytes) => opensWith(bytes, [0x89, 0x50, 0x4e, 0x47])],
  [LINK_PREVIEW_PICTURE_TYPE.JPEG, (bytes) => opensWith(bytes, [0xff, 0xd8, 0xff])],
  [LINK_PREVIEW_PICTURE_TYPE.GIF, (bytes) => opensWith(bytes, [...ASCII.encode("GIF8")])],
  [
    LINK_PREVIEW_PICTURE_TYPE.WEBP,
    (bytes) =>
      opensWith(bytes, [...ASCII.encode("RIFF")]) &&
      opensWith(bytes.subarray(8), [...ASCII.encode("WEBP")]),
  ],
  [LINK_PREVIEW_PICTURE_TYPE.ICO, (bytes) => opensWith(bytes, [0x00, 0x00, 0x01, 0x00])],
];

function opensWith(bytes: Uint8Array, opening: readonly number[]): boolean {
  return opening.every((byte, at) => bytes[at] === byte);
}

/** The type a picture's bytes sniff as; none for bytes of no type the card draws. */
function pictureTypeOf(bytes: Uint8Array): LinkPreviewPictureType | undefined {
  return SIGNATURES.find(([, opens]) => opens(bytes))?.[0];
}

/** Why a read answered nothing: the address was refused, or the page was not read. */
const READ_OUTCOME = {
  REFUSED: "refused",
  UNREAD: "unread",
} as const;

/** What one address answered: its final address and the hop's answer, or why not. */
type Reached =
  | { readonly outcome: "answered"; readonly url: URL; readonly answer: HopAnswer }
  | { readonly outcome: typeof READ_OUTCOME.REFUSED }
  | { readonly outcome: typeof READ_OUTCOME.UNREAD };

const REFUSED = { outcome: READ_OUTCOME.REFUSED } as const;
const UNREAD = { outcome: READ_OUTCOME.UNREAD } as const;

/** The media type a `content-type` names, its parameters left off. */
function mediaTypeOf(header: string | undefined): string | undefined {
  return header?.split(";")[0]?.trim().toLowerCase();
}

/** The charset a `content-type` names, where it names one. */
function charsetParameterOf(header: string | undefined): string | undefined {
  return /;\s*charset\s*=\s*["']?([\w-]+)/iu.exec(header ?? "")?.[1]?.toLowerCase();
}

/** The addresses the guard admits for an address's host: the literal itself, or every address the name resolves to where all are public; none where any is not. */
function admittedAddresses(
  url: URL,
  reach: LinkPreviewReach,
): Effect.Effect<readonly string[] | undefined> {
  const literal = ipLiteralOf(url.hostname);
  if (literal !== undefined) return Effect.succeed([literal]);
  return Effect.map(reach.resolve(url.hostname), (addresses) =>
    allPublic(addresses) ? addresses : undefined,
  );
}

/**
 * One address answered, following redirects by hand up to the bound, each
 * hop's host resolved once, checked, and connected to at the checked
 * addresses alone, and the body read within `maxBytes`. A hop the guard
 * refuses is the whole read refused; a hop that fails, redirects nowhere
 * the guard admits as a web address, or runs past the bound of redirects
 * is unread.
 */
const reached = Effect.fnUntraced(function* (
  start: URL,
  accept: string,
  maxBytes: number,
  reach: LinkPreviewReach,
): Effect.fn.Return<Reached> {
  let url = start;
  for (let hop = 0; hop <= LINK_PREVIEW_READ.MAX_REDIRECTS; hop += 1) {
    const addresses = yield* admittedAddresses(url, reach);
    if (addresses === undefined) return REFUSED;
    const answer = yield* reach.connect({
      url,
      addresses,
      headers: {
        "user-agent": LINK_PREVIEW_READ.USER_AGENT,
        accept,
        "accept-language": "en",
      },
      maxBytes,
    });
    if (answer === undefined) return UNREAD;
    const location = answer.headers.location;
    if (REDIRECT_STATUSES.has(answer.status) && location !== undefined) {
      // Note that a redirect target is read against the hop it came from, as a browser reads it, then held as any address asked for is.
      const next = URL.canParse(location, url)
        ? webPageAddressOf(new URL(location, url).href)
        : undefined;
      if (next === undefined) return REFUSED;
      url = next;
      continue;
    }
    return { outcome: "answered", url, answer };
  }
  return UNREAD;
});

/** A page's bytes as its words, in the charset its headers or its head name, else UTF-8. */
function decoded(bytes: Uint8Array, contentType: string | undefined): string {
  const label = charsetParameterOf(contentType) ?? charsetOf(bytes) ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** The picture at an address, within `maxBytes` and of a type the card draws; none otherwise, or where it took too long. */
function pictureAt(
  address: string | undefined,
  maxBytes: number,
  reach: LinkPreviewReach,
): Effect.Effect<LinkPreviewPicture | undefined> {
  const url = address === undefined ? undefined : webPageAddressOf(address);
  if (url === undefined) return Effect.succeed(undefined);
  const read = Effect.map(
    reached(url, ACCEPT.PICTURE, maxBytes, reach),
    (reach): LinkPreviewPicture | undefined => {
      if (reach.outcome !== "answered" || reach.answer.cut) return undefined;
      const { status, bytes } = reach.answer;
      if (status < 200 || status >= 300 || bytes.byteLength === 0) return undefined;
      const type = pictureTypeOf(bytes);
      return type === undefined
        ? undefined
        : { type, base64: Buffer.from(bytes).toString("base64") };
    },
  );
  return Effect.map(Effect.timeoutOption(read, LINK_PREVIEW_READ.PICTURE_DEADLINE), (picture) =>
    Option.getOrUndefined(picture),
  );
}

/**
 * The preview of the page at `href`: what its head says of it and its
 * pictures, or why it has none. An address the guard refuses, as the page
 * or as a redirect, is refused; a page unread in time, not HTML, or
 * answering an error is unread. The pictures are read after the page,
 * both at once, each within its own deadline and left out where it fails.
 */
export const readLinkPreview = /* @__PURE__ */ Effect.fn("web/linkPreview")(function* (
  href: string,
  reach: LinkPreviewReach,
): Effect.fn.Return<LinkPreviewAnswer> {
  const url = webPageAddressOf(href);
  if (url === undefined) return { refused: LINK_PREVIEW_REFUSAL.ADDRESS };
  const page = yield* Effect.timeoutOption(
    reached(url, ACCEPT.PAGE, HEAD_MAX_BYTES, reach),
    LINK_PREVIEW_READ.PAGE_DEADLINE,
  );
  if (Option.isNone(page)) return { refused: LINK_PREVIEW_REFUSAL.UNREAD };
  const read = page.value;
  if (read.outcome === READ_OUTCOME.REFUSED) return { refused: LINK_PREVIEW_REFUSAL.ADDRESS };
  if (read.outcome === READ_OUTCOME.UNREAD) return { refused: LINK_PREVIEW_REFUSAL.UNREAD };
  const { status, headers, bytes } = read.answer;
  const html = mediaTypeOf(headers["content-type"]);
  if (status < 200 || status >= 300 || html === undefined || !HTML_TYPES.has(html)) {
    return { refused: LINK_PREVIEW_REFUSAL.UNREAD };
  }
  const head = pageHeadOf(decoded(bytes, headers["content-type"]), read.url);
  const [icon, image] = yield* Effect.all(
    [
      pictureAt(head.iconUrl, LINK_PREVIEW_BOUNDS.MAX_ICON_BYTES, reach),
      pictureAt(head.imageUrl, LINK_PREVIEW_BOUNDS.MAX_IMAGE_BYTES, reach),
    ],
    { concurrency: "unbounded" },
  );
  const preview: LinkPreview = {
    url: href,
    ...(head.title === undefined ? undefined : { title: head.title }),
    ...(head.description === undefined ? undefined : { description: head.description }),
    ...(head.siteName === undefined ? undefined : { siteName: head.siteName }),
    ...(icon === undefined ? undefined : { icon }),
    ...(image === undefined ? undefined : { image }),
  };
  return { preview };
});
