/**
 * stale-build.ts -- a tab left open across a deploy moves onto the build the origin serves now: on the next page it goes to once a newer build is live, or, where a chunk failed first, through a toast's Reload.
 *
 * Every surface the panel draws on demand, a route, a `React.lazy` tab, or a side
 * bundle (`bundle-loader.ts`), is a chunk the build names by its hash, and a
 * deployment serves only its own: once a newer one is live, an older tab's
 * chunks answer 404, and every import of one it has not loaded yet fails for
 * good, Retry included, since the browser keeps a failed module for the
 * document's life (`lazy-boundary.tsx`). A phone's tab lives for days in
 * the background while production deploys many times an hour, so it meets
 * this most.
 *
 * So the tab reads the panel's page as the origin serves it now each time
 * it comes back to the foreground, and where the entry script that page
 * names is no longer this tab's, the next page the developer goes to,
 * pressed or through Back and Forward, loads as a new document at that
 * address rather than in place: they asked for a new page there, so a load
 * then interrupts nothing, where it would land while they read or type at
 * any other moment. A replace is the panel's own, never theirs, so it moves
 * nothing, and a tab holding unsaved work goes on in place.
 *
 * What is left is a chunk that failed before the tab knew, such as a
 * prefetch of a page never pressed for. Vite's preload helper, which wraps
 * every `import()` the build writes, says each such failure on the window
 * as `vite:preloadError` before the import rejects, so the one listener the
 * tab's root stands (`web-host.ts`) hears every lazy surface's, and leaves
 * the failure to reach the surface as it would without it. Whatever failed
 * the chunk, a deploy or a dropped connection, only a new document mends it,
 * so the tab offers a reload, in a toast whose Reload leaves through the
 * tab's own way out (`page-leave.ts`), so the panel's own question about
 * unsaved work stands before it. Offline, nothing is offered, since a reload
 * would trade the surface's own Reload for the browser's error page. The
 * desktop loads its chunks from the app's own files, so only the web's root
 * listens.
 */

import { PANEL_PATH } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { showToast } from "@repo/panel/toast";
import { STATUS_TONE } from "@repo/ui";
import type { RouterHistory } from "@tanstack/react-router";
import { Effect, Option } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { PageLeave } from "./page-leave";

/** What Vite's preload helper dispatches on the window where a chunk, or a stylesheet it brings, failed to load. */
export const PRELOAD_ERROR = "vite:preloadError";

/** What the toast says; a deploy or a dropped connection alike. */
const PART_DID_NOT_LOAD = `Part of ${PRODUCT_NAME} could not load`;

/** The entry script a page names, whose hashed address names the build it is from. */
const ENTRY_SCRIPT = /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["']/iu;

/** How the tab's history moved: a press, Back, Forward, or the panel's own replace. */
export type HistoryMove = Parameters<
  Parameters<RouterHistory["subscribe"]>[0]
>[0]["action"]["type"];

/** What the move onto the live build needs of the tab, which a test stands in for. */
export interface StaleBuildTab {
  /** The entry script this tab was loaded with, or none where its page names none. */
  readonly build: string | undefined;
  /** The address of the panel's page as the origin serves it now. */
  readonly livePage: string;
  /** Whether the browser has a connection, without which a reload trades the surface's Reload for the browser's error page. */
  readonly online: () => boolean;
  /** The tab's way out, which asks first while a page or a description holds unsaved work, and whether it would. */
  readonly leave: Pick<PageLeave, "leave" | "holdsWork">;
  /** The tab's reload, at the address its history stands at. */
  readonly reload: () => void;
  /** Asks before reloading, with what Reload does and what the ask sent away unanswered does. */
  readonly askReload: (reload: () => void, dismissed: () => void) => void;
}

/** What the tab's root hands each event that bears on its build. */
export interface StaleBuild {
  /** The tab came back to the foreground: reads whether a newer build is live. */
  readonly returned: Effect.Effect<void, never, HttpClient.HttpClient>;
  /** The tab's history moved: loads the new page as a new document where a newer build is live. */
  readonly moved: (move: HistoryMove) => void;
  /** A chunk failed to load: asks to reload. */
  readonly failedChunk: () => Effect.Effect<void>;
}

/** The entry script a page's markup names, or none. */
function entryScriptOf(html: string): string | undefined {
  return ENTRY_SCRIPT.exec(html)?.[1];
}

/** The entry script the panel's page names as the origin serves it now, past the browser's cache, or none where it could not be read. */
function liveBuild(
  livePage: string,
): Effect.Effect<Option.Option<string>, never, HttpClient.HttpClient> {
  return HttpClient.get(livePage).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.text),
    Effect.map((html) => Option.fromNullishOr(entryScriptOf(html))),
    Effect.provideService(FetchHttpClient.RequestInit, { cache: "no-store" }),
    Effect.orElseSucceed(() => Option.none()),
  );
}

/**
 * The tab's answers to its build falling behind. Note that once the tab
 * reloads onto the live build, a chunk the page it is leaving still fails
 * asks nothing, and that the toast is asked once until it is answered, so
 * a burst of failures, a chunk and its stylesheet, stands one toast, while
 * an ask dismissed, or a Reload the developer stayed from at the panel's or
 * the browser's question, leaves the next failure asked about again, since a
 * failed chunk's own Retry never mends it.
 */
export function staleBuild(tab: StaleBuildTab): StaleBuild {
  let newerLive = false;
  let reloading = false;
  let asking = false;

  const returned = Effect.suspend(() => {
    const build = tab.build;
    if (build === undefined || newerLive) return Effect.void;
    return Effect.map(liveBuild(tab.livePage), (live) => {
      if (Option.isSome(live) && live.value !== build) newerLive = true;
    });
  });

  const moved = (move: HistoryMove): void => {
    if (!newerLive || reloading || move === "REPLACE") return;
    if (!tab.online() || tab.leave.holdsWork()) return;
    reloading = true;
    tab.reload();
  };

  const answered = (): void => {
    asking = false;
  };
  const reload = (): void => {
    answered();
    tab.leave.leave(tab.reload);
  };
  const failedChunk = () =>
    Effect.sync(() => {
      if (reloading || asking || !tab.online()) return;
      asking = true;
      tab.askReload(reload, answered);
    });

  return { returned, moved, failedChunk };
}

/** This tab, over its own window, document, history, and way out. */
export function staleBuildTab(
  leave: StaleBuildTab["leave"],
  history: RouterHistory,
): StaleBuildTab {
  return {
    build: document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? undefined,
    livePage: new URL(PANEL_PATH, location.origin).href,
    online: () => navigator.onLine !== false,
    leave,
    // Note that the history writes a step into the address after it tells of it, so it is written first, or the reload would load the page being left.
    reload: () => {
      history.flush();
      location.reload();
    },
    askReload: (reload, dismissed) =>
      showToast({
        words: PART_DID_NOT_LOAD,
        tone: STATUS_TONE.ATTENTION,
        action: { label: "Reload", onPress: reload },
        persists: true,
        onDismiss: dismissed,
      }),
  };
}
