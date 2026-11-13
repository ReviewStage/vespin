import {
  type FrameBox,
  PAGE_PICK_ACT,
  PAGE_PICK_TYPE,
  type PagePickAsk,
  pagePickAnswerSchema,
} from "@repo/features/page-pick";
import {
  PAGE_FIT,
  PAGE_FIT_PENDING,
  type PageFit,
  pageFitAfter,
  pageSizeSchema,
} from "@repo/features/page-size";
import type { PagePlace } from "@repo/features/page-wire";
import { replyOf } from "@repo/features/reply-quote";
import { PAGE_EMBED_HEIGHT, PageEmbed, type PageEmbedHeight, usePressAway } from "@repo/ui";
import { Option, Schema } from "effect";
import { type ReactNode, type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { readKept, writeKept } from "../kept-storage.js";

import { PAGE_SANDBOX, useFrameLinks } from "./page-pane.js";
import { PAGE_ROOM, usePageTheme } from "./page-theme.js";
import { pressPlace, ReplyPress, roomAround, useReplyDoor } from "./reply-to-selection.js";

/**
 * shown-page.tsx -- a page an agent showed, drawn where it is told of: under the transcript row of the call that showed it, and under an Inbox thread's line naming it.
 *
 * The page is drawn live, at the version named, in the frame its tab draws
 * it in (`page-pane.tsx`): from the same address, under the same sandbox,
 * its links out opened outside it as the tab opens them. The frame stands as
 * tall as the page reports it is, or at a screenful where the page only ever
 * fills its frame (`@repo/features/page-size`), heard from that frame alone
 * and only in that message's shape, and loads only as it nears the screen.
 * The row drawn above it opens it in its own tab. A line naming a page draws its newest version, read with its
 * row (`lone-link-card.tsx`).
 *
 * Words selected in the page offer Reply over them, as words selected in
 * the transcript around it do (`reply-to-selection.tsx`), and a press lays
 * them into the message box as a quote, the agent's or the Inbox item's,
 * wherever a box stands to take them (`useReplyDoor`). No selection in the frame reaches this window, so the
 * frame says the words and where they stand (`@repo/features/page-pick`),
 * heard from that frame alone; Reply goes as they go, as a press lands
 * anywhere else in the window, in another frame included, or as another
 * frame says words of its own, each telling its frame to let its words go,
 * and as the frame loads again, whose new document holds none. Note that the words are the
 * page's own word, since its scripts share the frame with ours: the worst a
 * page that lies does is offer a quote of itself, which the box shows before
 * anything is sent.
 */

const readSize = Schema.decodeUnknownOption(pageSizeSchema);

/** How many page versions' fits the window keeps across launches, the newest fitted kept. */
const KEPT_FITS = 500;

/** A page version's fit as the window keeps it: never pending, since only a fit heard is kept. */
const keptFitSchema = Schema.Struct({
  page: Schema.String,
  version: Schema.Number,
  fit: Schema.Union([
    Schema.Struct({ kind: Schema.Literal(PAGE_FIT.CONTENT), height: Schema.Number }),
    Schema.Struct({ kind: Schema.Literal(PAGE_FIT.FILLS) }),
  ]),
});

/** The fits kept, oldest fitted first, under one key (`kept-storage.ts`). */
const KEPT = {
  name: "app.shownPageFits",
  schema: Schema.fromJsonString(Schema.Array(keptFitSchema)),
} as const;

/**
 * How each page's versions were last fitted, by page then version, oldest
 * fitted first, so a frame drawn again stands at the height it last stood at;
 * read from the window's storage as it is first asked, so a page fitted
 * before the app last closed opens at its height too. Note that a transcript
 * draws only the rows near the view, so a row holding a page is let go and
 * drawn again as the reader scrolls past it: started at the stand-in's
 * height, the page grows once its frame loads, and TanStack Virtual, which
 * leaves the scroll where it stands as a row at the view's top resizes while
 * the reader scrolls up, as it chooses to, draws that growth as a jump. A row
 * drawn at its real height gives it nothing to move.
 */
let fitted: Map<string, Map<number, PageFit>> | undefined;

/** The fits known, read from storage the first time they are asked for. */
function fittedNow(): Map<string, Map<number, PageFit>> {
  if (fitted !== undefined) return fitted;
  const known = new Map<string, Map<number, PageFit>>();

  for (const kept of readKept(KEPT.name, KEPT.schema, [])) {
    const versions = known.get(kept.page) ?? new Map<number, PageFit>();
    versions.set(kept.version, kept.fit);
    known.set(kept.page, versions);
  }

  fitted = known;

  return known;
}

/** Notes a page version's fit, newest last, and keeps the newest `KEPT_FITS` of them; one already noted as it is keeps nothing. */
function noteFit(
  pageId: string,
  version: number,
  fit: Exclude<PageFit, { kind: typeof PAGE_FIT.PENDING }>,
): void {
  const known = fittedNow();
  const was = known.get(pageId)?.get(version);

  if (
    was !== undefined &&
    was.kind === fit.kind &&
    (was.kind !== PAGE_FIT.CONTENT || fit.kind !== PAGE_FIT.CONTENT || was.height === fit.height)
  )
    return;
  // Note that a page fitted again moves to the end, so the oldest fitted is the first let go.
  const versions = known.get(pageId) ?? new Map<number, PageFit>();
  versions.delete(version);
  versions.set(version, fit);
  known.delete(pageId);
  known.set(pageId, versions);

  const entries = [...known].flatMap(([page, kept]) =>
    [...kept].flatMap(([at, each]) =>
      each.kind === PAGE_FIT.PENDING ? [] : [{ page, version: at, fit: each }],
    ),
  );

  writeKept(KEPT.name, KEPT.schema, entries.slice(-KEPT_FITS));
}

/** Reads a message a frame posted as the words selected in it, nothing for anything else a page posts. */
const readPick = Schema.decodeUnknownOption(pagePickAnswerSchema);

/** The height the frame stands at for how the page is fitted. */
function embedHeight(fit: PageFit): PageEmbedHeight {
  if (fit.kind === PAGE_FIT.CONTENT) return { kind: PAGE_EMBED_HEIGHT.CONTENT, height: fit.height };

  if (fit.kind === PAGE_FIT.FILLS) return { kind: PAGE_EMBED_HEIGHT.FILL };

  return { kind: PAGE_EMBED_HEIGHT.STAND_IN };
}

/** How the page in `frame` is fitted, from the heights it reports against the frame's own; as it was last fitted, or pending, until it has. */
function useFrameFit(
  frame: RefObject<HTMLIFrameElement | null>,
  pageId: string,
  version: number,
): PageFit {
  const [fit, setFit] = useState<PageFit>(
    () => fittedNow().get(pageId)?.get(version) ?? PAGE_FIT_PENDING,
  );

  useEffect(() => {
    if (fit.kind !== PAGE_FIT.PENDING) noteFit(pageId, version, fit);
  }, [fit, pageId, version]);
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const framed = frame.current;

      if (framed === null || framed.contentWindow === null || event.source !== framed.contentWindow)
        return;
      const size = readSize(event.data);

      if (Option.isNone(size)) return;
      const frameHeight = framed.getBoundingClientRect().height;
      setFit((last) => pageFitAfter(last, size.value.height, frameHeight));
    };

    window.addEventListener("message", hear);

    return () => window.removeEventListener("message", hear);
  }, [frame]);

  return fit;
}

/** Words selected in a frame that Reply quotes: the words, and where they stand in the frame's viewport. */
interface FrameSelected {
  readonly quote: string;
  readonly box: FrameBox;
}

/** Tells the page in `frame` to let its words selected go. */
function unselect(frame: RefObject<HTMLIFrameElement | null>): void {
  const ask: PagePickAsk = { type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.UNSELECT };
  frame.current?.contentWindow?.postMessage(ask, "*");
}

/**
 * Reply over words selected in the page in `frame`, which `onReply` lays
 * into the message box; nothing while none are.
 */
function FrameReply({
  frame,
  onReply,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  onReply: (reply: string) => void;
}): ReactNode {
  const [selected, setSelected] = useState<FrameSelected | undefined>(undefined);
  const [, redraw] = useReducer((drawn: number) => drawn + 1, 0);
  const layer = useRef<HTMLDivElement>(null);
  const shown = selected !== undefined;

  const letGo = () => {
    setSelected(undefined);
    unselect(frame);
  };

  // The frame says its words as they are selected, and that none are once they go; another frame's words, or a press in it, take Reply from this one's.
  useEffect(() => {
    const element = frame.current;

    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;

      if (framed === null || framed === undefined) return;
      const said = readPick(event.data);

      if (Option.isNone(said)) return;
      const words = "selected" in said.value ? said.value.selected : undefined;

      if (event.source === framed && words !== undefined) {
        setSelected(words === null ? undefined : { quote: words.quote, box: words.box });
      } else if (event.source !== framed && (words != null || "pressed" in said.value)) {
        setSelected(undefined);
        unselect(frame);
      }
    };

    // Note that a frame loading again, a reload or another version, holds a new document, whose words selected are none.
    const loaded = () => setSelected(undefined);
    window.addEventListener("message", hear);
    element?.addEventListener("load", loaded);

    return () => {
      window.removeEventListener("message", hear);
      element?.removeEventListener("load", loaded);
    };
  }, [frame]);

  // Once offered, Reply follows the frame as the window scrolls, and hides with its pane.
  useEffect(() => {
    if (!shown) return undefined;
    // Note that hiding a pane moves nothing, so its `hidden` attribute is watched for itself.
    const hiding = new MutationObserver(redraw);
    hiding.observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
    document.addEventListener("scroll", redraw, true);
    window.addEventListener("resize", redraw);

    return () => {
      hiding.disconnect();
      document.removeEventListener("scroll", redraw, true);
      window.removeEventListener("resize", redraw);
    };
  }, [shown]);

  // A press anywhere else in the window lets the words go, as it lets go words selected in the window itself.
  usePressAway(layer, () => undefined, { onPressAway: shown ? letGo : undefined });

  const framed = frame.current;

  if (selected === undefined || framed === null || framed.closest("[hidden]") !== null) return null;
  const at = framed.getBoundingClientRect();
  const { box } = selected;

  return (
    <ReplyPress
      place={pressPlace(
        {
          left: at.left + box.left,
          top: at.top + box.top,
          right: at.left + box.right,
          bottom: at.top + box.bottom,
        },
        roomAround(framed),
      )}
      onReply={() => {
        letGo();
        onReply(replyOf(selected.quote));
      }}
      layer={layer}
    />
  );
}

/** One version of a page, drawn live in the words that tell of it, in a frame of its own. */
function PageVersionFrame({
  pageId,
  version,
  title,
  src,
}: {
  pageId: string;
  version: number;
  title: string;
  src: string;
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  useFrameLinks(frame);
  usePageTheme(frame, PAGE_ROOM.WORDS);
  const fit = useFrameFit(frame, pageId, version);
  const replyDoor = useReplyDoor();

  return (
    <div className="my-block-gap">
      <PageEmbed
        frameRef={frame}
        height={embedHeight(fit)}
        frame={{ title, src, sandbox: PAGE_SANDBOX, lazy: true }}
      />
      {replyDoor === undefined ? null : <FrameReply frame={frame} onReply={replyDoor} />}
    </div>
  );
}

/**
 * One version of a page, drawn live in the words that tell of it. Note that
 * each page and version is drawn in a frame of its own, keyed by its
 * address, because a frame navigated to another one may still hear the last
 * document's height after it changed, and its fit would be taken for the new.
 */
export function ShownPage({
  place,
  pageId,
  version,
  title,
}: {
  place: PagePlace;
  pageId: string;
  version: number;
  title: string;
}): React.JSX.Element {
  const src = appPlatform().pageFrameUrl({ ...place, pageId, version });

  return <PageVersionFrame key={src} pageId={pageId} version={version} title={title} src={src} />;
}
