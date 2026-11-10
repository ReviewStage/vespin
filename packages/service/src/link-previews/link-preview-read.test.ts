import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LINK_PREVIEW_PICTURE_TYPE,
  LINK_PREVIEW_REFUSAL,
  type LinkPreviewAnswer,
} from "@repo/features/link-preview-wire";
import { Effect } from "effect";
import { type HopAnswer, type HopRequest, readLinkPreview } from "./link-preview-read.js";

/**
 * link-preview-read.test.ts -- a page is read for a link's card only where
 * its address, every redirect's, and every picture's stand on the public
 * internet over HTTPS: a plaintext address, a private, loopback, link-local, or metadata address, in IPv4
 * or IPv6, mapped or not, a host that resolves to one, and a redirect into
 * one are refused before a byte is sent there; a connection goes only to
 * the addresses the check saw, the name resolved once per hop, so a name
 * that answers public to the check and private to the connection reaches
 * nothing private; a page that is no HTML or
 * sends the reader round too often has no preview; and a page that answers
 * says its title, description, site, icon, and picture, each carried as the
 * type its bytes are. A scripted web and a scripted resolver; synthetic
 * hosts throughout.
 */

/** The one public address every host resolves to unless the script says otherwise. */
const PUBLIC_ADDRESS = "93.184.216.34";

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

/** The web as a test scripts it: what each address answers, and what each host resolves to, one answer per ask where several are scripted, the last repeating. */
interface ScriptedWeb {
  readonly answers: Readonly<Record<string, () => Response>>;
  readonly resolves?: Readonly<Record<string, readonly string[] | readonly (readonly string[])[]>>;
}

/** One hop as the fake transport saw it: where it was sent, and the addresses it was allowed to connect to. */
interface SentHop {
  readonly url: string;
  readonly addresses: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
}

/** Whether a scripted resolution is one answer per ask rather than one answer. */
function perAsk(
  scripted: readonly string[] | readonly (readonly string[])[],
): scripted is readonly (readonly string[])[] {
  return scripted.length > 0 && typeof scripted[0] !== "string";
}

/** The preview read over the scripted web, with every hop the transport was asked to send, in order, and how often each host was resolved. */
const readOver = (href: string, web: ScriptedWeb) =>
  Effect.gen(function* () {
    const sent: SentHop[] = [];
    const resolved = new Map<string, number>();
    const resolve = (hostname: string) => {
      const asked = resolved.get(hostname) ?? 0;
      resolved.set(hostname, asked + 1);
      const scripted = web.resolves?.[hostname] ?? [PUBLIC_ADDRESS];
      if (!perAsk(scripted)) return Effect.succeed(scripted);
      return Effect.succeed(scripted[Math.min(asked, scripted.length - 1)] ?? []);
    };
    const connect = ({ url, addresses, headers, maxBytes }: HopRequest) =>
      Effect.promise(async (): Promise<HopAnswer | undefined> => {
        sent.push({ url: url.href, addresses, headers });
        const answer = web.answers[url.href];
        if (answer === undefined) return undefined;
        const response = answer();
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          bytes: bytes.subarray(0, maxBytes),
          cut: bytes.byteLength > maxBytes,
        };
      });
    const answer: LinkPreviewAnswer = yield* readLinkPreview(href, { resolve, connect });
    return { answer, sent, resolved };
  });

const PAGE = "https://docs.example.com/guide";

it.effect.each([
  { name: "a scheme that is not the web's", href: "ftp://files.example.com/readme" },
  { name: "a plaintext web address", href: "http://docs.example.com/guide?token=abc" },
  { name: "a credential in the address", href: "https://user:secret@docs.example.com/" },
  { name: "a port that is not the web's", href: "https://docs.example.com:8443/" },
  { name: "a loopback name", href: "https://localhost/admin" },
  { name: "a bare name with no dot", href: "https://intranet/" },
  { name: "a loopback IPv4 address", href: "https://127.0.0.1/" },
  { name: "a loopback IPv6 address", href: "https://[::1]/" },
  { name: "a private IPv4 address", href: "https://10.0.0.5/" },
  { name: "a private IPv4 address in 172.16/12", href: "https://172.31.255.1/" },
  { name: "a private IPv4 address in 192.168/16", href: "https://192.168.1.1/" },
  { name: "the cloud metadata address", href: "https://169.254.169.254/latest/meta-data/" },
  { name: "the cloud metadata address in IPv6", href: "https://[fd00:ec2::254]/latest/meta-data/" },
  { name: "a private IPv4 address mapped into IPv6", href: "https://[::ffff:10.0.0.1]/" },
  { name: "a link-local IPv6 address", href: "https://[fe80::1]/" },
  { name: "the unspecified address", href: "https://0.0.0.0/" },
  {
    name: "a host that resolves to a private address",
    href: "https://intranet.example.com/",
    resolves: { "intranet.example.com": ["10.1.2.3"] },
  },
  {
    name: "a host that resolves to a private address among public ones",
    href: "https://mixed.example.com/",
    resolves: { "mixed.example.com": [PUBLIC_ADDRESS, "192.168.0.9"] },
  },
  {
    name: "a redirect to the cloud metadata address",
    href: "https://docs.example.com/go",
    answers: { "https://docs.example.com/go": () => redirect("https://169.254.169.254/") },
  },
  {
    name: "a redirect to a host that resolves to a private address",
    href: "https://docs.example.com/hop",
    answers: { "https://docs.example.com/hop": () => redirect("https://internal.example.com/") },
    resolves: { "internal.example.com": ["192.168.0.9"] },
  },
])("$name is refused, and nothing is sent there", ({ href, answers = {}, resolves }) =>
  Effect.gen(function* () {
    const { answer, sent } = yield* readOver(href, {
      answers,
      ...(resolves === undefined ? undefined : { resolves }),
    });

    assert.deepEqual(answer, { refused: LINK_PREVIEW_REFUSAL.ADDRESS });
    // Only the scripted redirects were asked; the refused address itself never was.
    assert.deepEqual(
      sent.map(({ url }) => url),
      Object.keys(answers),
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
      for (const { headers, addresses } of sent) {
        assert.equal(headers.cookie, undefined);
        assert.equal(headers.authorization, undefined);
        assert.deepEqual(addresses, [PUBLIC_ADDRESS]);
      }
    }),
);

it.effect(
  "a host that resolves public to the check and private to a later ask is connected to at the checked address alone, resolved once per hop",
  () =>
    Effect.gen(function* () {
      const flipping = "https://flip.example.com/";
      const { answer, sent, resolved } = yield* readOver(flipping, {
        answers: { [flipping]: () => html("<title>Flipped</title>") },
        resolves: { "flip.example.com": [[PUBLIC_ADDRESS], ["10.0.0.1"]] },
      });

      assert.ok("preview" in answer && answer.preview.title === "Flipped");
      // The page's hop went to the public address the check saw, and the private answer the name gave next was never connected to: the icon's hop, which resolves afresh, saw it and was refused instead.
      assert.equal(resolved.get("flip.example.com"), 2);
      assert.deepEqual(
        sent.map(({ url, addresses }) => ({ url, addresses })),
        [{ url: flipping, addresses: [PUBLIC_ADDRESS] }],
      );
      assert.equal(answer.preview.icon, undefined);
    }),
);
