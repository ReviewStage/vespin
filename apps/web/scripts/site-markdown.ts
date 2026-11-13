/**
 * site-markdown.ts -- the site's Markdown documents answered as modules of finished HTML: CHANGELOG.md's releases, PRIVACY.md's policy, and the guides under `guides/`, drawn by `src/site-markdown.tsx` when the site is built or served.
 *
 * A page imports `virtual:site/changelog-releases`,
 * `virtual:site/privacy-policy`, or `virtual:site/guides` and is handed
 * values, every release's, section's, and guide's HTML among them, so the renderer (`@repo/ui/markdown`) runs in
 * the build and never in a visitor's tab. The drawing module is TypeScript
 * that reaches the shared packages' sources, so it is loaded through a Vite
 * server of its own, which runs it as the SSR build runs the pages, and
 * closed after: a build draws every document through one such server at
 * its start, before Rollup transforms a module, and `vite` draws each when
 * its module loads. Each document is watched, so an edit to it reloads its
 * page under `vite`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin } from "vite";

/** What `src/site-markdown.tsx` answers, as this plugin reads it. */
type SiteMarkdown = typeof import("../src/site-markdown");

/** What a document is drawn as: the value its module answers. */
type SiteDrawing =
  | ReturnType<SiteMarkdown["parseReleases"]>
  | ReturnType<SiteMarkdown["policyOf"]>
  | ReturnType<SiteMarkdown["parseGuides"]>;

/** One Markdown file a document is read from: its name, and its words. */
interface SiteSource {
  readonly file: string;
  readonly words: string;
}

const resolveFile = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const DRAWING_MODULE = resolveFile("../src/site-markdown.tsx");

/** A document this answers: the file or folder it is read from, and how it is drawn. */
interface SiteDocument {
  /** A file, or a folder whose every `.md` file but its README is a source. */
  readonly path: string;
  readonly folder: boolean;
  readonly draw: (site: SiteMarkdown, sources: readonly SiteSource[]) => SiteDrawing;
}

/** The folder's README says how a guide is written, and is no guide. */
const FOLDER_README = "README.md";

/**
 * Whether a build carries draft guides: every build but production's, so a
 * draft is read on a Preview and never published.
 */
const DRAFTS = process.env.VERCEL_ENV !== "production";

/** The one source of a document read from a file. */
const onlyWords = (sources: readonly SiteSource[]) => sources[0]?.words ?? "";

/** Each module this answers, and its document. */
const SITE_DOCUMENTS = new Map<string, SiteDocument>([
  [
    "virtual:site/changelog-releases",
    {
      path: resolveFile("../../../CHANGELOG.md"),
      folder: false,
      draw: (site, sources) => site.parseReleases(onlyWords(sources)),
    },
  ],
  [
    "virtual:site/privacy-policy",
    {
      path: resolveFile("../../../PRIVACY.md"),
      folder: false,
      draw: (site, sources) => site.policyOf(onlyWords(sources)),
    },
  ],
  [
    "virtual:site/guides",
    {
      path: resolveFile("../guides"),
      folder: true,
      draw: (site, sources) => site.parseGuides(sources, DRAFTS),
    },
  ],
]);

/** The files a document is read from, in name order, so a build draws them the same every time. */
async function sourcesOf(document: SiteDocument): Promise<readonly SiteSource[]> {
  if (!document.folder)
    return [{ file: document.path, words: await readFile(document.path, "utf8") }];

  const files = (await readdir(document.path))
    .filter((file) => file.endsWith(".md") && file !== FOLDER_README)
    .sort();

  return Promise.all(
    files.map(async (file) => ({ file, words: await readFile(join(document.path, file), "utf8") })),
  );
}

/** Rollup's name for a module this answers, `\0`-led so no other plugin loads it. */
const RESOLVED_PREFIX = "\0";

/**
 * What the drawing module answers, run once through a Vite server of its own
 * that is closed once it has answered: the build's own way of running it,
 * which a test of the documents runs too. Note that the server reads no
 * config, so the panel's redirects (`panel-build.ts`), which answer the HTML
 * parser with a loader that draws HTML as text until it lands, never reach
 * the documents.
 */
export async function drawnBySite<Drawn>(draw: (site: SiteMarkdown) => Drawn): Promise<Drawn> {
  const server = await createServer({
    configFile: false,
    root: resolveFile(".."),
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: "automatic" },
  });

  try {
    // SAFETY: the module is `src/site-markdown.tsx`, whose exports this file's type names.
    const site = (await server.ssrLoadModule(DRAWING_MODULE)) as SiteMarkdown;

    return draw(site);
  } finally {
    await server.close();
  }
}

/** One site document drawn through a server of its own, with the files it was read from. */
async function drawnDocument(
  document: SiteDocument,
): Promise<{ drawing: SiteDrawing; sources: readonly SiteSource[] }> {
  const sources = await sourcesOf(document);

  return { drawing: await drawnBySite((site) => document.draw(site, sources)), sources };
}

/** Every site document drawn through one server, by the module that answers it. */
async function drawnDocuments(): Promise<Map<string, SiteDrawing>> {
  const documents = await Promise.all(
    [...SITE_DOCUMENTS].map(async ([id, document]) => ({
      id,
      document,
      sources: await sourcesOf(document),
    })),
  );

  return drawnBySite(
    (site) =>
      new Map(documents.map(({ id, document, sources }) => [id, document.draw(site, sources)])),
  );
}

/**
 * The plugin that answers each site document's module with its drawn values.
 * Note that a build draws every document in `buildStart`, because the server
 * runs on the build's own event loop: drawn beside Rollup's transforms, each
 * module the server fetches waits behind theirs, past the module runner's
 * fixed 60 s on a loaded machine. Served (`vite`, vitest), nothing transforms
 * beside it, so each document is drawn alone when its module loads, and one
 * that fails to draw fails only its own page.
 */
export function siteMarkdown(): Plugin {
  let building = false;
  let drawings: Map<string, SiteDrawing> | undefined;

  return {
    name: "site-markdown",
    configResolved(config) {
      building = config.command === "build";
    },
    async buildStart() {
      if (building) drawings = await drawnDocuments();
    },
    resolveId: (id) => (SITE_DOCUMENTS.has(id) ? `${RESOLVED_PREFIX}${id}` : undefined),
    async load(id) {
      const name = id.startsWith(RESOLVED_PREFIX) ? id.slice(RESOLVED_PREFIX.length) : undefined;
      const document = name === undefined ? undefined : SITE_DOCUMENTS.get(name);

      if (name === undefined || document === undefined) return undefined;
      const built = drawings?.get(name);

      if (built !== undefined) return `export default ${JSON.stringify(built)};`;
      const { drawing, sources } = await drawnDocument(document);

      // Note that a folder's files are watched each, because a watched folder
      // is read as an import of it; a guide added under `vite` shows once the
      // server restarts.
      for (const source of sources)
        this.addWatchFile(document.folder ? join(document.path, source.file) : source.file);

      return `export default ${JSON.stringify(drawing)};`;
    },
  };
}
