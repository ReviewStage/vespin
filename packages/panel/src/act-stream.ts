import { followStream, type OpenedStream } from "@repo/host/follow-stream";
import { rendererFork } from "./renderer-runtime.js";

/**
 * act-stream.ts -- one stream the window holds open on its act port until the window lets it go, followed on the renderer's services (`@repo/host/follow-stream`).
 *
 * `live-reads.ts` is its only importer, and the lint rule
 * `vespin/no-follow-outside-host-read` refuses any other: it holds every
 * read a surface shows open through here.
 */

/** Follows a stream on the renderer's services until the stop handed back is called. */
export function streamFrom<View>(
  open: () => Promise<OpenedStream<View>>,
  take: (view: View) => void,
): () => void {
  return rendererFork(followStream(open, take));
}
