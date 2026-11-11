import { PdfPages } from "@repo/ui/pdf-pages";
import type { PdfModule } from "./contract.js";

/**
 * index.ts -- the PDF bundle: `@repo/ui`'s PdfPages, which carries pdf.js, and the one worker pdf.js reads every PDF in.
 *
 * An entry of the renderer's build (`apps/desktop/scripts/build.mjs`; the
 * web's Vite splits it off the same `import()`), imported by the first PDF
 * opened (`../bundle-loader.ts`), so the bundle every window parses never
 * carries pdf.js. The window's policy admits a worker from a `blob:` alone,
 * on the desktop and the web alike, so the build hands this bundle the
 * text of pdf.js's worker (`PDF_WORKER`, `scripts/build-table.mjs`), as it
 * hands the diff bundle its highlighter's, and the worker is started from
 * it as a module, once, the first time a PDF is opened. Where the build
 * carried none, as under a test, there is no worker, and the viewer shows a
 * PDF by its icon as it shows one pdf.js cannot open.
 */

/**
 * The text of pdf.js's worker, set by the build (`scripts/build-table.mjs`);
 * a run that never went through the bundler has none.
 */
declare const PDF_WORKER: string | undefined;

/** The worker's text the build set; none where nothing built this bundle. */
function workerText(): string | undefined {
  try {
    // SAFETY: the bundler replaces this free identifier; a run that never
    // went through it has no such global, and reading one throws rather
    // than answering undefined.
    return PDF_WORKER;
  } catch {
    return undefined;
  }
}

let started: Worker | undefined;

/** The worker every PDF is read in, started from the build's text as a `blob:` the first time it is asked for. */
function worker(): Worker | undefined {
  if (started !== undefined) return started;
  const text = workerText();
  if (text === undefined || text.length === 0) return undefined;
  const address = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  started = new Worker(address, { type: "module", name: "pdf" });
  return started;
}

/** What the PDF bundle exports. */
export const pdf: PdfModule = { PdfPages, worker };
