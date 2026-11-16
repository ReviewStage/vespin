/**
 * skew-protection.ts -- every built file's address in the web's build names the deployment it was built for, so Vercel answers a tab's chunks from the deployment that tab loaded.
 *
 * Each build names its chunks by their contents (`assets/[name]-[hash].js`),
 * and a deployment serves only its own, so a tab left open across a deploy
 * asks the newer one for names it never had, and every page it has not
 * loaded yet fails (`src/app/stale-build.ts`). Vercel's Skew Protection
 * answers a request that carries `?dpl=<deployment id>` from that deployment,
 * for as long as the project's maximum age lets it, so every address the
 * build writes carries the id of the deployment it was built for: those in
 * the pages' markup, in a chunk's preload list, and in a stylesheet, through
 * Vite's `renderBuiltUrl`, and each chunk's own imports of another chunk,
 * which Rollup writes relative to the chunk, rewritten once the chunks are
 * named. Note that the query is added after the names are hashed, so a
 * chunk's name still moves only with its contents.
 *
 * Vite's preload helper, which loads a lazy chunk's stylesheets before the
 * chunk, tells a stylesheet by its address ending in `.css`, which no address
 * with the query does, so it would preload the sheet as a script and draw the
 * page without it. The helper is rewritten to read the address's path, and a
 * Vite whose helper no longer reads as this expects fails the build rather
 * than shipping pages without their styles.
 *
 * A build with no id, anywhere but a Vercel build with Skew Protection on,
 * writes its addresses as it would without this.
 */

import type { Plugin } from "vite";

/** The query Vercel reads a deployment's id from. */
const DEPLOYMENT_QUERY = "dpl";

/** Vite's preload helper's module, and how it tells a stylesheet from a chunk. */
const PRELOAD_HELPER = "\0vite/preload-helper.js";
const HELPER_STYLESHEET_TEST = 'dep.endsWith(".css")';

// Note that the helper has made `dep` absolute by then, so it parses alone.
const PATH_STYLESHEET_TEST = 'new URL(dep).pathname.endsWith(".css")';

/** A string written in a chunk: its quote, and its words. */
const QUOTED = /(["'`])(\.\/[^"'`\s]+?\.js)\1/g;

/** The base name of a file the bundle names, `assets/x-H.js` → `x-H.js`. */
function baseName(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf("/") + 1);
}

/**
 * Every `"./x-H.js"` in `code` that names one of `chunks`, which sit beside
 * it, with the deployment's query added; every other string is left as it was.
 */
function withDeploymentImports(code: string, chunks: ReadonlySet<string>, query: string): string {
  return code.replace(QUOTED, (whole, quote: string, specifier: string) =>
    chunks.has(specifier.slice(2)) ? `${quote}${specifier}${query}${quote}` : whole,
  );
}

/**
 * The web's build with every address it writes naming deployment `id`, or
 * as it is where there is none. Note that a public file, which no build
 * renames, is left unpinned, so the latest deployment answers it.
 */
export function skewProtection(id: string | undefined): Plugin {
  const query =
    id === undefined || id === "" ? "" : `?${DEPLOYMENT_QUERY}=${encodeURIComponent(id)}`;

  return {
    name: "skew-protection",
    apply: "build",
    config() {
      if (query === "") return undefined;

      return {
        experimental: {
          renderBuiltUrl: (fileName, { type }) =>
            type === "asset" ? `/${fileName}${query}` : undefined,
        },
      };
    },
    transform(code, id) {
      if (query === "" || id !== PRELOAD_HELPER) return undefined;

      if (!code.includes(HELPER_STYLESHEET_TEST))
        throw new Error(`Vite's preload helper no longer tests ${HELPER_STYLESHEET_TEST}`);

      return { code: code.replaceAll(HELPER_STYLESHEET_TEST, PATH_STYLESHEET_TEST), map: null };
    },
    // Note that this runs after Vite's own pass, which reads these imports to list each chunk's preloads.
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (query === "") return;

        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          // Rollup writes a chunk's imports relative to it, and every chunk stands in one folder.
          const chunks = new Set([...output.imports, ...output.dynamicImports].map(baseName));

          if (chunks.size > 0) output.code = withDeploymentImports(output.code, chunks, query);
        }
      },
    },
  };
}
