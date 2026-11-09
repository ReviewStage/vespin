/**
 * link-preview-read.ts -- a web page read for the card a plain link hangs: what its head says of it, and its icon and picture, each fetched by the service within its bounds and never from inside a network.
 *
 * Every address is held to `link-address.ts` before a byte is sent: the
 * page's, each redirect's, and each picture's, so a page on the internet
 * that redirects into a network, or names its picture there, answers
 * nothing of what stands inside. A host is resolved through the resolver
 * handed in and every address it resolves to must be public. Redirects are
 * followed by hand, a few at most, so each hop is held the same way. No
 * cookie or credential is sent, only the plain headers below, and the whole
 * read is held to a deadline, the page's bytes to a bound past which the
 * head is taken as whole, and each picture to its own bound, past which it
 * is left out. A picture is carried only as the type its bytes sniff as,
 * never as the type the server named. A page that is no HTML, answers an
 * error, redirects too often, or takes too long has no preview.
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
import { Duration, Effect, Option, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { allPublic, ipLiteralOf, webPageAddressOf } from "./link-address.js";
import { charsetOf, HEAD_MAX_BYTES, pageHeadOf } from "./link-preview-html.js";

/** The addresses a host name resolves to, every one of them; none where it resolves to nothing or the resolver failed. */
export type AddressResolver = (hostname: string) => Effect.Effect<readonly string[]>;

/** What a read reaches the world through: the resolver its hosts are checked by. */
export interface LinkPreviewReach {
  readonly resolve: AddressResolver;
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

/** How the fetch underneath is told to send: following no redirect itself, since each hop is held here, and carrying no credential. */
const FETCH_INIT: RequestInit = { redirect: "manual", credentials: "omit", cache: "no-store" };

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

/** What one address answered: its final address, status, headers, and bytes within the bound, or why not. */
type Reached =
  | {
      readonly outcome: "answered";
      readonly url: URL;
      readonly status: number;
      readonly contentType: string | undefined;
      /** The bytes read, cut at the bound; whether they were cut. */
      readonly bytes: Uint8Array;
      readonly cut: boolean;
    }
  | { readonly outcome: typeof READ_OUTCOME.REFUSED }
  | { readonly outcome: typeof READ_OUTCOME.UNREAD };

/** What one hop answered: where it sends the reader, or its status, type, and bytes within the bound, none where the body failed to read. */
type HopAnswer =
  | { readonly redirect: string }
  | {
      readonly answered: { readonly bytes: Uint8Array; readonly cut: boolean } | undefined;
      readonly status: number;
      readonly contentType: string | undefined;
    };

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

/** The response's bytes up to `max`, and whether more stood past them; nothing where the body failed to read. */
function boundedBytes(
  response: HttpClientResponse.HttpClientResponse,
  max: number,
): Effect.Effect<{ readonly bytes: Uint8Array; readonly cut: boolean } | undefined> {
  const counted = response.stream.pipe(
    Stream.mapAccum(
      () => 0,
      (size: number, chunk: Uint8Array) => {
        const total = size + chunk.byteLength;
        return [total, [{ chunk, total }]] as const;
      },
    ),
    Stream.takeUntil(({ total }) => total > max),
    Stream.runCollect,
  );
  return Effect.map(
    Effect.option(counted),
    Option.match({
      onNone: () => undefined,
      onSome: (chunks) => {
        const total = chunks.at(-1)?.total ?? 0;
        const whole = new Uint8Array(Math.min(total, max));
        let at = 0;
        for (const { chunk } of chunks) {
          const room = whole.byteLength - at;
          if (room <= 0) break;
          whole.set(chunk.subarray(0, Math.min(room, chunk.byteLength)), at);
          at += Math.min(room, chunk.byteLength);
        }
        return { bytes: whole, cut: total > max };
      },
    }),
  );
}

/** Whether the host an address names may be read: a public literal, or a name every address of which resolves public. */
function hostAdmitted(url: URL, reach: LinkPreviewReach): Effect.Effect<boolean> {
  const literal = ipLiteralOf(url.hostname);
  if (literal !== undefined) return Effect.succeed(true);
  return Effect.map(reach.resolve(url.hostname), allPublic);
}

/**
 * One address answered, following redirects by hand up to the bound, each
 * hop's address held as the first was, and the body read within `maxBytes`.
 * A hop the guard refuses is the whole read refused; a hop that fails,
 * redirects nowhere the guard admits as a web address, or runs past the
 * bound of redirects is unread.
 */
const reached = Effect.fnUntraced(function* (
  start: URL,
  accept: string,
  maxBytes: number,
  reach: LinkPreviewReach,
): Effect.fn.Return<Reached, never, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  let url = start;
  for (let hop = 0; hop <= LINK_PREVIEW_READ.MAX_REDIRECTS; hop += 1) {
    if (!(yield* hostAdmitted(url, reach))) return REFUSED;
    const request = HttpClientRequest.get(url.href).pipe(
      HttpClientRequest.setHeaders({
        "user-agent": LINK_PREVIEW_READ.USER_AGENT,
        accept,
        "accept-language": "en",
      }),
    );
    const hopAnswer: HopAnswer | undefined = yield* Effect.scoped(
      Effect.flatMap(client.execute(request), (response): Effect.Effect<HopAnswer> => {
        const location = response.headers.location;
        if (REDIRECT_STATUSES.has(response.status) && location !== undefined) {
          return Effect.succeed({ redirect: location });
        }
        return Effect.map(boundedBytes(response, maxBytes), (body) => ({
          answered: body,
          status: response.status,
          contentType: response.headers["content-type"],
        }));
      }),
    ).pipe(Effect.orElseSucceed((): HopAnswer | undefined => undefined));
    if (hopAnswer === undefined) return UNREAD;
    if ("redirect" in hopAnswer) {
      // Note that a redirect target is read against the hop it came from, as a browser reads it, then held as any address asked for is.
      const next = URL.canParse(hopAnswer.redirect, url)
        ? webPageAddressOf(new URL(hopAnswer.redirect, url).href)
        : undefined;
      if (next === undefined) return REFUSED;
      url = next;
      continue;
    }
    if (hopAnswer.answered === undefined) return UNREAD;
    return {
      outcome: "answered",
      url,
      status: hopAnswer.status,
      contentType: hopAnswer.contentType,
      bytes: hopAnswer.answered.bytes,
      cut: hopAnswer.answered.cut,
    };
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
): Effect.Effect<LinkPreviewPicture | undefined, never, HttpClient.HttpClient> {
  const url = address === undefined ? undefined : webPageAddressOf(address);
  if (url === undefined) return Effect.succeed(undefined);
  const read = Effect.map(
    reached(url, ACCEPT.PICTURE, maxBytes, reach),
    (answer): LinkPreviewPicture | undefined => {
      if (answer.outcome !== "answered" || answer.cut) return undefined;
      if (answer.status < 200 || answer.status >= 300 || answer.bytes.byteLength === 0) {
        return undefined;
      }
      const type = pictureTypeOf(answer.bytes);
      return type === undefined
        ? undefined
        : { type, base64: Buffer.from(answer.bytes).toString("base64") };
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
): Effect.fn.Return<LinkPreviewAnswer, never, HttpClient.HttpClient> {
  const url = webPageAddressOf(href);
  if (url === undefined) return { refused: LINK_PREVIEW_REFUSAL.ADDRESS };
  const page = yield* Effect.timeoutOption(
    reached(url, ACCEPT.PAGE, HEAD_MAX_BYTES, reach),
    LINK_PREVIEW_READ.PAGE_DEADLINE,
  ).pipe(Effect.provideService(FetchHttpClient.RequestInit, FETCH_INIT));
  if (Option.isNone(page)) return { refused: LINK_PREVIEW_REFUSAL.UNREAD };
  const answer = page.value;
  if (answer.outcome === READ_OUTCOME.REFUSED) return { refused: LINK_PREVIEW_REFUSAL.ADDRESS };
  if (answer.outcome === READ_OUTCOME.UNREAD) return { refused: LINK_PREVIEW_REFUSAL.UNREAD };
  const html = mediaTypeOf(answer.contentType);
  if (answer.status < 200 || answer.status >= 300 || html === undefined || !HTML_TYPES.has(html)) {
    return { refused: LINK_PREVIEW_REFUSAL.UNREAD };
  }
  const head = pageHeadOf(decoded(answer.bytes, answer.contentType), answer.url);
  const [icon, image] = yield* Effect.all(
    [
      pictureAt(head.iconUrl, LINK_PREVIEW_BOUNDS.MAX_ICON_BYTES, reach),
      pictureAt(head.imageUrl, LINK_PREVIEW_BOUNDS.MAX_IMAGE_BYTES, reach),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.provideService(FetchHttpClient.RequestInit, FETCH_INIT));
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
