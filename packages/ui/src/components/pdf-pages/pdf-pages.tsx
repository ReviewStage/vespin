import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  PDFWorker,
  type RenderTask,
  TextLayer,
} from "pdfjs-dist";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { useNearView } from "../../near-view.js";
import { PdfPagesSkeleton } from "./pdf-pages-skeleton.js";
import { PdfColumn, PdfSheet } from "./pdf-sheet.js";

/**
 * pdf-pages.tsx -- a PDF's pages drawn by pdf.js, each into its sheet as it comes near the screen, fitted to the column's width, its words selectable over it.
 *
 * pdf.js reads the file in a worker its caller starts and hands in, since
 * only the caller knows where its window admits a worker from; the window's
 * policy admits one from a `blob:` alone, so the panel starts it from the
 * worker's text its build carries. The file's bytes are handed over as they
 * are, never fetched, because the policy refuses a fetch, and pdf.js is told
 * to draw a font the file leaves out from the system's own, since it may
 * fetch none of its own; it compiles nothing, so the policy's refusal of
 * `eval` costs it nothing.
 *
 * The column holds a sheet for every page at the first page's shape, each
 * taking its own once it is read, so the scrollbar stands for the whole file
 * from the first. A page is drawn only while its sheet stands within a
 * screenful of what the column shows (`useNearView`), at the sheet's width
 * in the screen's own pixels, and drawn again as that width changes; once it
 * goes away its canvas is let go, so a long file holds a few pages' pixels
 * however far it is read. A new drawing replaces the last only once it is
 * whole, so a page never blinks while the column is resized. Over the
 * canvas stands pdf.js's text layer: the page's words, invisible, where they
 * are printed, so a reader selects and copies them as on the page. Note that
 * a block stands under the words and is raised over the whole page while a
 * drag selects, as pdf.js's own viewer does, because a drag passing over the
 * gap between two lines would otherwise reach past every word to the page's
 * end and select them all.
 *
 * While the file opens it stands as the placeholder (`PdfPagesSkeleton`),
 * and a file pdf.js cannot open, a broken or a locked one, stands as what
 * its caller hands for it (`refused`).
 *
 * This module carries pdf.js, so it is a subpath of its own
 * (`@repo/ui/pdf-pages`), out of the barrel, loaded only by the bundle that
 * draws a PDF.
 */

/** How the file stands: opening, open, or refused. */
const OPENED = {
  OPENING: "opening",
  OPEN: "open",
  REFUSED: "refused",
} as const;

/** How the file stands, an open one with its document and its first page's shape. */
type Opened =
  | { readonly kind: typeof OPENED.OPENING }
  | {
      readonly kind: typeof OPENED.OPEN;
      readonly document: PDFDocumentProxy;
      readonly ratio: number;
    }
  | { readonly kind: typeof OPENED.REFUSED };

/** Where a file stands before it is read. */
const OPENING: Opened = { kind: OPENED.OPENING };

/** A file's bytes, read from its base64. */
function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** A page's width over its height, read at its own size. */
function ratioOf(page: PDFPageProxy): number {
  const box = page.getViewport({ scale: 1 });

  return box.width / box.height;
}

/** Gives a canvas's pixels back before it is let go, since a detached canvas holds them until it is collected. */
function emptied(holder: HTMLElement): void {
  for (const canvas of holder.querySelectorAll("canvas")) {
    canvas.width = 0;
    canvas.height = 0;
  }

  holder.replaceChildren();
}

/** How wide an element stands, followed as it changes; 0 until it is placed. */
function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (element === null) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);

      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  return width;
}

/**
 * One page's sheet: blank until it comes near, then its page drawn at the
 * sheet's width with its words over it, let go again once it goes away.
 */
function PdfPage({
  document: pdf,
  number,
  ratio,
}: {
  document: PDFDocumentProxy;
  number: number;
  ratio: number;
}): React.JSX.Element {
  const [placeNear, view] = useNearView();
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
  const [canvasHolder, setCanvasHolder] = useState<HTMLDivElement | null>(null);
  const [textHolder, setTextHolder] = useState<HTMLDivElement | null>(null);
  const [pageRatio, setPageRatio] = useState(ratio);
  const [scale, setScale] = useState(1);
  const width = useWidth(sheet);

  const place = useCallback(
    (element: HTMLElement | null) => {
      placeNear(element);
      setSheet(element);
    },
    [placeNear],
  );

  useEffect(() => {
    if (!view.near || canvasHolder === null || textHolder === null || width === 0) {
      return undefined;
    }

    let left = false;
    let render: RenderTask | undefined;
    let words: TextLayer | undefined;

    const draw = async () => {
      const page = await pdf.getPage(number);

      if (left) return;
      setPageRatio(ratioOf(page));
      const fitted = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const pixels = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.className = "ui-pdf-canvas";
      canvas.width = Math.floor(fitted.width * pixels);
      canvas.height = Math.floor(fitted.height * pixels);
      render = page.render({
        canvas,
        viewport: fitted,
        transform: pixels === 1 ? undefined : [pixels, 0, 0, pixels, 0, 0],
      });
      await render.promise;

      if (left) return;
      emptied(canvasHolder);
      canvasHolder.append(canvas);
      // The words stand where the page prints them, at the scale the page was drawn at, in the page's own unit.
      setScale(fitted.scale * fitted.userUnit);
      const layer = document.createElement("div");
      layer.className = "ui-pdf-text";
      words = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport: fitted,
      });
      await words.render();

      if (left) return;
      // A block under the words, raised over the whole page while a drag selects, so the gaps between lines hold the selection where it is.
      const end = document.createElement("div");
      end.className = "ui-pdf-text-end";
      layer.append(end);
      textHolder.replaceChildren(layer);
    };

    // Note that a draw cut short by the page going away or the width changing rejects, and is left there.
    draw().catch(() => undefined);

    return () => {
      left = true;
      render?.cancel();
      words?.cancel();
    };
  }, [view.near, canvasHolder, textHolder, width, pdf, number]);

  // A press in the page's words starts a selection, and the press let go anywhere ends it.
  useEffect(() => {
    if (textHolder === null) return undefined;
    const start = () => textHolder.setAttribute("data-selecting", "true");
    const stop = () => textHolder.removeAttribute("data-selecting");
    textHolder.addEventListener("pointerdown", start);
    document.addEventListener("pointerup", stop);

    return () => {
      textHolder.removeEventListener("pointerdown", start);
      document.removeEventListener("pointerup", stop);
    };
  }, [textHolder]);

  // A page gone away lets its pixels and its words go; its sheet keeps its shape.
  useEffect(() => {
    if (view.near || canvasHolder === null || textHolder === null) return;
    emptied(canvasHolder);
    textHolder.replaceChildren();
  }, [view.near, canvasHolder, textHolder]);

  return (
    <PdfSheet ratio={pageRatio} sheetRef={place} label={`Page ${String(number)}`}>
      <div ref={setCanvasHolder} className="ui-pdf-pixels" />
      <div
        ref={setTextHolder}
        className="ui-pdf-words"
        style={cssCustomProperties({ "--total-scale-factor": String(scale) })}
      />
    </PdfSheet>
  );
}

/** What `PdfPages` is handed: the file's bytes, its name, the worker pdf.js reads it in, and what stands where it cannot. */
export interface PdfPagesProps {
  /** The file's bytes in base64. */
  readonly base64: string;
  /** The file's name, which the column is named for to a reader. */
  readonly label: string;
  /** The worker pdf.js reads the file in, started by the caller from pdf.js's worker script; one serves every file the window opens. */
  readonly worker: Worker;
  /** What stands where pdf.js cannot open the file. */
  readonly refused: ReactNode;
}

/** A PDF's pages, each drawn as it comes near the screen; the placeholder while it opens, and `refused` where it cannot be. */
export function PdfPages({ base64, label, worker, refused }: PdfPagesProps): React.JSX.Element {
  const [opened, setOpened] = useState<Opened>(OPENING);

  useEffect(() => {
    let left = false;
    let task: ReturnType<typeof getDocument> | undefined;

    // Note that bytes that are no base64, or a document pdf.js refuses to start on, are refused as a file it cannot open is.
    const opening = (async () => {
      task = getDocument({
        data: bytesOf(base64),
        worker: PDFWorker.create({ port: worker }),
        useSystemFonts: true,
      });
      const document = await task.promise;
      const first = await document.getPage(1);

      if (!left) setOpened({ kind: OPENED.OPEN, document, ratio: ratioOf(first) });
    })();

    opening.catch(() => {
      if (!left) setOpened({ kind: OPENED.REFUSED });
    });

    return () => {
      left = true;
      setOpened(OPENING);
      void task?.destroy();
    };
  }, [base64, worker]);

  if (opened.kind === OPENED.REFUSED) return <>{refused}</>;

  if (opened.kind === OPENED.OPENING) return <PdfPagesSkeleton label={label} />;

  return (
    <PdfColumn label={label}>
      {Array.from({ length: opened.document.numPages }, (_, at) => (
        <PdfPage key={at} document={opened.document} number={at + 1} ratio={opened.ratio} />
      ))}
    </PdfColumn>
  );
}
