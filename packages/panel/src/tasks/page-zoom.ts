import {
  PAGE_ZOOM_ACTUAL,
  type PageZoomKey,
  pageZoomAfter,
  pageZoomAnswerSchema,
  pageZoomPinched,
  pageZoomTell,
} from "@repo/features/page-zoom";
import { Option, Schema } from "effect";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * page-zoom.ts -- the size a page's tab draws its page at: held by the tab, stepped by its menu, by ⌘+, ⌘−, and ⌘0 pressed in the page, and by a pinch over it, and handed to the frame (`@repo/features/page-zoom`).
 *
 * The size is the tab's, so it outlives a reload, a version stepped to, and
 * the source shown in the page's place: each new document the frame loads
 * asks for it, and is answered from the frame drawn alone. A key or a pinch
 * is taken only from that frame too, and asks for nothing but a size of the
 * page's own, held within the page zoom's bounds.
 */

/** Reads a message the frame posted as the zoom's, nothing for anything else the page posts. */
const readZoom = Schema.decodeUnknownOption(pageZoomAnswerSchema);

/** The page's size in `frame`, and a step of it the menu takes. */
export function usePageZoom(frame: RefObject<HTMLIFrameElement | null>): {
  readonly zoom: number;
  readonly press: (key: PageZoomKey) => void;
} {
  const [zoom, setZoom] = useState(PAGE_ZOOM_ACTUAL);
  const latest = useRef(zoom);
  useLayoutEffect(() => {
    latest.current = zoom;
  }, [zoom]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(pageZoomTell(zoom), "*");
  }, [frame, zoom]);
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined || event.source !== framed) return;
      const answer = readZoom(event.data);
      if (Option.isNone(answer)) return;
      const message = answer.value;
      if ("ask" in message) return framed.postMessage(pageZoomTell(latest.current), "*");
      if ("key" in message) return setZoom((was) => pageZoomAfter(was, message.key));
      setZoom((was) => pageZoomPinched(was, message.pinch));
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, [frame]);
  return { zoom, press: (key) => setZoom((was) => pageZoomAfter(was, key)) };
}
