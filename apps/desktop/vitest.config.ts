import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Streamdown's import of `rehype-raw` answered with the module that loads
 * the parser on demand, as the panel's build table (`@repo/panel/build-table`)
 * answers it in the bundle, so a test draws a reply as the panel does.
 * Streamdown is inlined so that its imports are resolved here at all.
 */
const MARKDOWN_HTML_PARSER = fileURLToPath(
  new URL("../../packages/panel/src/markdown-html-parser.ts", import.meta.url),
);

export default defineConfig({
  plugins: [
    {
      name: "markdown-html-parser-on-demand",
      enforce: "pre",
      resolveId: (source, importer) =>
        source === "rehype-raw" && importer !== MARKDOWN_HTML_PARSER
          ? MARKDOWN_HTML_PARSER
          : undefined,
    },
  ],
  test: {
    name: "desktop",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: [
      "../../packages/wire/src/testing/file-time-cap.ts",
      "../../packages/wire/src/testing/duplicate-keys.ts",
      "../../packages/panel/src/testing/resize-observer.ts",
      "../../packages/panel/src/testing/match-media.ts",
    ],
    server: { deps: { inline: ["streamdown"] } },
    // Note that `electron`'s entry downloads its binary on import where none is installed, as CI installs none, so a test names a dist of its own and never reaches the network; no test launches the binary.
    env: {
      ELECTRON_OVERRIDE_DIST_PATH: fileURLToPath(
        new URL("./node_modules/.no-electron", import.meta.url),
      ),
    },
  },
});
