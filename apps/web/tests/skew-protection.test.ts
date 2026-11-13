import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { temporaryDirectory } from "@repo/runtime/testing";
import { JSDOM } from "jsdom";
import { build } from "vite";
import { afterEach, test, vi } from "vitest";
import { skewProtection } from "../scripts/skew-protection";

/**
 * skew-protection.test.ts -- a build for a deployment names that deployment
 * on every address it writes for a chunk, a stylesheet, or a font, a chunk's
 * own imports of another among them, while a lazy import still preloads the
 * chunks it needs and links its stylesheet as a stylesheet. The build runs
 * against a document of its own, as a tab runs it; note that the build
 * itself cannot run under jsdom, whose `TextEncoder` esbuild refuses.
 */

const DEPLOYMENT = "dpl_Skew123";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A page whose entry lazily imports two chunks, which share a third, one of them with a stylesheet and its font. */
const FIXTURE = {
  "index.html": '<!doctype html><script type="module" src="./main.js"></script>',
  "main.js":
    'document.addEventListener("open-lazy", () => import("./lazy.js"));\ndocument.addEventListener("open-other", () => import("./other.js"));\n',
  "lazy.js":
    'import "./lazy.css";\nimport { shared } from "./shared.js";\nexport const lazy = () => shared();\n',
  "other.js": 'import { shared } from "./shared.js";\nexport const other = () => shared();\n',
  "shared.js": 'export const shared = () => document.title + "x".repeat(64);\n',
  "lazy.css": "@font-face { font-family: f; src: url(./font.woff2); }\n.lazy { color: red; }\n",
  "font.woff2": "wOF2".repeat(4096),
} as const;

/** The fixture built for `DEPLOYMENT` into `root`'s `dist`, every file it emits as text by its name. */
async function builtFor(root: string): Promise<ReadonlyMap<string, string>> {
  await Promise.all(
    Object.entries(FIXTURE).map(([name, text]) => writeFile(join(root, name), text)),
  );

  const built = await build({
    root,
    logLevel: "silent",
    configFile: false,
    plugins: [skewProtection(DEPLOYMENT)],
    // Note that the modulepreload polyfill, which fetches each preload itself, is left out, since this document fetches nothing.
    build: { minify: false, assetsInlineLimit: 0, modulePreload: { polyfill: false } },
  });

  // One unwatched build of one environment answers one output.
  const output = Array.isArray(built) ? built[0] : built;

  assert.ok(output !== undefined && "output" in output);

  return new Map(
    output.output.map((file) => [
      file.fileName,
      file.type === "chunk" ? file.code : String(file.source),
    ]),
  );
}

test("a deployment's build names it on every chunk, stylesheet, and font address, and a lazy import still links its stylesheet", async (t) => {
  const root = await temporaryDirectory(t, "skew-protection-");
  const files = await builtFor(root);
  const emitted = [...files.keys()].filter((name) => name.startsWith("assets/"));
  const text = [...files.values()].join("\n");

  // Each emitted file is named only as itself followed by the deployment's query.
  for (const name of emitted) {
    const base = name.slice("assets/".length);
    const named = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[^"'\`)\\s]*`, "gu");

    const mentions = text.match(named) ?? [];
    const unpinned = mentions.filter((mention) => mention !== `${base}?dpl=${DEPLOYMENT}`);

    assert.deepEqual(unpinned, [], name);
  }

  // Opening the lazy chunk links its stylesheet as one and preloads it and the chunk it shares as scripts, all by their pinned address.
  const entry = [...files.keys()].find((name) => /^assets\/index-.*\.js$/u.test(name)) ?? "";

  const { document, Event, MutationObserver } = new JSDOM("<!doctype html><head></head>").window;

  vi.stubGlobal("document", document);
  vi.stubGlobal("MutationObserver", MutationObserver);
  await import(/* @vite-ignore */ pathToFileURL(join(root, "dist", entry)).href);
  // Note that the stylesheet never loads in this document, so the import is opened and never awaited.
  document.dispatchEvent(new Event("open-lazy"));

  const linked = [...document.head.querySelectorAll("link")].map((link) => ({
    // Note that jsdom knows no `modulepreload`, so the helper preloads a script as `preload`.
    as: link.rel === "stylesheet" ? "stylesheet" : link.as,
    file: new URL(link.href).pathname
      .split("/")
      .pop()
      ?.replace(/-[\w-]+\./u, "."),
    pinned: new URL(link.href).searchParams.get("dpl"),
  }));

  assert.deepEqual(
    linked.sort((a, b) => String(a.file).localeCompare(String(b.file))),
    [
      { as: "stylesheet", file: "lazy.css", pinned: DEPLOYMENT },
      { as: "script", file: "lazy.js", pinned: DEPLOYMENT },
      { as: "script", file: "shared.js", pinned: DEPLOYMENT },
    ],
  );
});
