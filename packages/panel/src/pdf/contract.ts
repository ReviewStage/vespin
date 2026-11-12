import type { PdfPagesProps } from "@repo/ui/pdf-pages";

/**
 * contract.ts -- what the panel and the PDF bundle say to each other: the component that draws a PDF's pages, and the worker it reads them in.
 *
 * pdf.js is too large for the bundle every window parses, so a PDF's pages
 * are drawn by a bundle of their own (`pdf.js`, built from `./index.ts`) that
 * the file viewer loads the first time a PDF is opened
 * (`../tasks/attachment-viewer.tsx`, through `../bundle-loader.ts`). That
 * bundle exports one module, `pdf`, and this file is the whole of what the
 * two share. Nothing here imports a value, so the panel carries none of
 * pdf.js.
 */

/** What the PDF bundle's entry exports. */
export interface PdfModule {
  /** A PDF's pages, `@repo/ui`'s, read in the worker `worker` answers. */
  readonly PdfPages: (props: PdfPagesProps) => React.JSX.Element;
  /** The worker pdf.js reads every PDF in, started the first time it is asked for and kept for the window's life; none where the build carried no worker, as under a test. */
  readonly worker: () => Worker | undefined;
}
