import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LINK_PREVIEW_PICTURE_TYPE,
  LINK_PREVIEW_REFUSAL,
  type LinkPreviewAnswer,
} from "@repo/features/link-preview-wire";
import { Effect } from "effect";
import {
  HOP_FAILURE,
  type HopAnswer,
  type HopFailure,
  type HopRequest,
  readLinkPreview,
} from "./link-preview-read.js";

/**
 * link-preview-read.test.ts -- a page is read for a link's card only at an
 * address the service reads, a web page's over HTTPS: a plaintext address,
 * another scheme, a credential, or another port is refused before anything
 * is sent, as is an address the transport refuses as inside a network, as
 * the page or as a redirect; a page that is no HTML or sends the reader
 * round too often has no preview; and a page that answers says its title,
 * description, site, icon, and picture, each carried as the type its bytes
 * are. A scripted web stands in for the transport; the transport's own
 * refusals are `node-link-reach.test.ts`'s. Synthetic hosts throughout.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

/** A page's HTML answer. */
function html(body: string, type = "text/html; charset=utf-8"): Response {
  return new Response(body, { status: 200, headers: { "content-type": type } });
}

/** A redirect to `location`. */
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/** An image answer, of the type the server claims, whatever the bytes are. */
function picture(bytes: Uint8Array<ArrayBuffer>, type: string): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": type } });
}

/** What the transport answers for an address the script refuses as inside a network. */
const REFUSED = Symbol("refused");

/** The web as a test scripts it: what each address answers, or that the transport refuses it. */
interface ScriptedWeb {
  readonly answers: Readonly<Record<string, (() => Response) | typeof REFUSED>>;
}

/** One hop as the fake transport saw it: where it was sent, and with what headers. */
interface SentHop {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** The preview read over the scripted web, with every hop the transport was asked to send, in order. */
const readOver = (href: string, web: ScriptedWeb) =>
  Effect.gen(function* () {
    const sent: SentHop[] = [];
    const connect = ({ url, headers, maxBytes }: HopRequest) =>
      Effect.promise(async (): Promise<HopAnswer | HopFailure> => {
        sent.push({ url: url.href, headers });
        const answer = web.answers[url.href];
        if (answer === undefined) return HOP_FAILURE.UNREAD;
        if (answer === REFUSED) return HOP_FAILURE.REFUSED;
        const response = answer();
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          bytes: bytes.subarray(0, maxBytes),
          cut: bytes.byteLength > maxBytes,
        };
      });
    const answer: LinkPreviewAnswer = yield* readLinkPreview(href, connect);
    return { answer, sent };
  });

const PAGE = "https://docs.example.com/guide";

/** An address the read refuses: what the script answers along the way, and the hops it was asked for before refusing. */
interface RefusedAddress {
  readonly name: string;
  readonly href: string;
  readonly answers?: ScriptedWeb["answers"];
  readonly asked?: readonly string[];
}

const REFUSED_ADDRESSES: readonly RefusedAddress[] = [
  { name: "a scheme that is not the web's", href: "ftp://files.example.com/readme" },
  { name: "a plaintext web address", href: "http://docs.example.com/guide?token=abc" },
  { name: "a credential in the address", href: "https://user:secret@docs.example.com/" },
  { name: "a port that is not the web's", href: "https://docs.example.com:8443/" },
  {
    name: "an address the transport refuses as inside a network",
    href: "https://intranet.example.com/",
    answers: { "https://intranet.example.com/": REFUSED },
    asked: ["https://intranet.example.com/"],
  },
  {
    name: "a redirect to an address the transport refuses",
    href: "https://docs.example.com/go",
    answers: {
      "https://docs.example.com/go": () => redirect("https://169.254.169.254/"),
      "https://169.254.169.254/": REFUSED,
    },
    asked: ["https://docs.example.com/go", "https://169.254.169.254/"],
  },
  {
    name: "a redirect to a plaintext address",
    href: "https://docs.example.com/plain",
    answers: { "https://docs.example.com/plain": () => redirect("http://docs.example.com/") },
    asked: ["https://docs.example.com/plain"],
  },
];

it.effect.each(REFUSED_ADDRESSES)(
  "$name is refused, and nothing else is sent",
  ({ href, answers = {}, asked = [] }) =>
    Effect.gen(function* () {
      const { answer, sent } = yield* readOver(href, { answers });

      assert.deepEqual(answer, { refused: LINK_PREVIEW_REFUSAL.ADDRESS });
      assert.deepEqual(
        sent.map(({ url }) => url),
        asked,
      );
    }),
);

it.effect.each([
  {
    name: "a page that is no HTML",
    answers: {
      [PAGE]: () => new Response("{}", { headers: { "content-type": "application/json" } }),
    },
  },
  {
    name: "a page that answers an error",
    answers: {
      [PAGE]: () => new Response("gone", { status: 404, headers: { "content-type": "text/html" } }),
    },
  },
  {
    name: "a page that sends the reader round too often",
    answers: {
      [PAGE]: () => redirect(`${PAGE}/1`),
      [`${PAGE}/1`]: () => redirect(`${PAGE}/2`),
      [`${PAGE}/2`]: () => redirect(`${PAGE}/3`),
      [`${PAGE}/3`]: () => redirect(`${PAGE}/4`),
      [`${PAGE}/4`]: () => html("<title>Too far</title>"),
    },
  },
])("$name has no preview", ({ answers }) =>
  Effect.gen(function* () {
    const { answer } = yield* readOver(PAGE, { answers });

    assert.deepEqual(answer, { refused: LINK_PREVIEW_REFUSAL.UNREAD });
  }),
);

it.effect(
  "a page says its title, description, site, icon, and picture, each picture as the type its bytes are, read with no credential",
  () =>
    Effect.gen(function* () {
      const { answer, sent } = yield* readOver(PAGE, {
        answers: {
          [PAGE]: () =>
            html(`<!doctype html><html><head>
              <meta charset="utf-8">
              <title>Guide &amp; reference</title>
              <meta property="og:title" content="The guide &mdash; Example Docs">
              <meta name="description" content="Everything about the thing.">
              <meta property="og:site_name" content="Example Docs">
              <link rel="icon" href="/static/icon.png">
              <meta property="og:image" content="https://cdn.example.com/guide.jpg">
            </head><body><p>Hello</p></body></html>`),
          "https://docs.example.com/static/icon.png": () => picture(PNG, "image/png"),
          // Note that the server misnames the picture's type; its bytes say what it is.
          "https://cdn.example.com/guide.jpg": () => picture(JPEG, "application/octet-stream"),
        },
      });

      assert.deepEqual(answer, {
        preview: {
          url: PAGE,
          title: "The guide — Example Docs",
          description: "Everything about the thing.",
          siteName: "Example Docs",
          icon: {
            type: LINK_PREVIEW_PICTURE_TYPE.PNG,
            base64: Buffer.from(PNG).toString("base64"),
          },
          image: {
            type: LINK_PREVIEW_PICTURE_TYPE.JPEG,
            base64: Buffer.from(JPEG).toString("base64"),
          },
        },
      });
      for (const { headers } of sent) {
        assert.equal(headers.cookie, undefined);
        assert.equal(headers.authorization, undefined);
      }
    }),
);
