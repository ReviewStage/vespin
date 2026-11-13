import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "@repo/runtime/testing";
import { build } from "vite";
import { test } from "vitest";
import { skewProtection } from "../scripts/skew-protection";

/**
 * skew-protection.test.ts -- a build for a deployment names that deployment
 * on every address it writes for a chunk, a stylesheet, or a font, a chunk's
 * own imports of another among them, while each lazy import's preload list
 * stands as it would without it.
 */

const DEPLOYMENT = "dpl_Skew123";

/** A page whose entry lazily imports two chunks, which share a third, one of them with a stylesheet and its font. */
const FIXTURE = {
  "index.html": '<!doctype html><script type="module" src="./main.js"></script>',
  "main.js": 'console.log(() => import("./lazy.js"), () => import("./other.js"));\n',
  "lazy.js":
    'import "./lazy.css";\nimport { shared } from "./shared.js";\nexport const lazy = () => shared();\n',
  "other.js": 'import { shared } from "./shared.js";\nexport const other = () => shared();\n',
  "shared.js": 'export const shared = () => document.title + "x".repeat(64);\n',
  "lazy.css": "@font-face { font-family: f; src: url(./font.woff2); }\n.lazy { color: red; }\n",
  "font.woff2": "wOF2".repeat(4096),
} as const;

/** The fixture built for `DEPLOYMENT`, every file it emits as text by its name. */
async function builtFor(root: string): Promise<ReadonlyMap<string, string>> {
  await Promise.all(
    Object.entries(FIXTURE).map(([name, text]) => writeFile(join(root, name), text)),
  );

  const built = await build({
    root,
    logLevel: "silent",
    configFile: false,
    plugins: [skewProtection(DEPLOYMENT)],
    build: { write: false, minify: false, assetsInlineLimit: 0 },
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

test("a deployment's build names it on every chunk, stylesheet, and font address, and keeps the preloads", async (t) => {
  const files = await builtFor(await temporaryDirectory(t, "skew-protection-"));
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

  // The entry's import of the lazy chunk still preloads the chunk it shares and its stylesheet.
  const entry = [...files].find(([name]) => /^assets\/index-.*\.js$/u.test(name))?.[1] ?? "";
  const shared = emitted.find((name) => /^assets\/shared-.*\.js$/u.test(name)) ?? "";
  const sheet = emitted.find((name) => name.endsWith(".css")) ?? "";

  assert.match(entry, /__vite__mapDeps/u);
  assert.ok(entry.includes(`"/${shared}?dpl=${DEPLOYMENT}"`), "shared chunk preloaded");
  assert.ok(entry.includes(`"/${sheet}?dpl=${DEPLOYMENT}"`), "stylesheet preloaded");
});
