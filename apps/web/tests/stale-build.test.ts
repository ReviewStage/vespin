import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect } from "effect";
import { expect } from "vitest";
import { pageLeave } from "../src/app/page-leave";
import { type StaleBuildTab, staleBuild } from "../src/app/stale-build";

/**
 * stale-build.test.ts -- a tab whose build fell behind loads the next page
 * it goes to as a new document, but for a replace or while work stands; a
 * chunk that failed to load asks once to reload and never reloads unasked,
 * asks nothing offline, and its Reload goes through the panel's own
 * question while work stands.
 */

/** This tab's entry script, as its page names it. */
const BUILD = "/assets/app-Old00000.js";

/** The panel's page as the origin serves it, naming the entry script given. */
function servedNaming(entry: string) {
  return fakeHttpClientLayer(
    () => new Response(`<!doctype html><script type="module" crossorigin src="${entry}"></script>`),
  );
}

/** A tab online or not, its reloads, asks, and each ask's dismissal kept. */
function tabWith(options: { online?: boolean } = {}) {
  const leave = pageLeave(new EventTarget());
  const seen = { reloads: 0, asks: [] as (() => void)[], dismisses: [] as (() => void)[] };
  const tab: StaleBuildTab = {
    build: BUILD,
    livePage: "https://vespin.test/app",
    online: () => options.online ?? true,
    leave,
    reload: () => {
      seen.reloads += 1;
    },
    askReload: (reload, dismissed) => {
      seen.asks.push(reload);
      seen.dismisses.push(dismissed);
    },
  };
  const build = staleBuild(tab);
  return { answer: build.failedChunk, build, leave, seen };
}

it.effect(
  "once a newer build is live, the next page pressed for loads as a new document, and a replace before it does not",
  () =>
    Effect.gen(function* () {
      const tab = tabWith();

      tab.build.moved("PUSH");
      yield* tab.build.returned.pipe(Effect.provide(servedNaming("/assets/app-New00000.js")));
      tab.build.moved("REPLACE");
      expect(tab.seen.reloads).toBe(0);

      tab.build.moved("PUSH");
      expect(tab.seen.reloads).toBe(1);
      // The page being left fails its chunks as it goes, which asks nothing.
      yield* tab.answer();
      expect(tab.seen.asks).toEqual([]);
    }),
);

it.effect("a tab still on the live build, or holding unsaved work, moves in place", () =>
  Effect.gen(function* () {
    const current = tabWith();
    yield* current.build.returned.pipe(Effect.provide(servedNaming(BUILD)));
    current.build.moved("PUSH");

    const holding = tabWith();
    holding.leave.unsavedDescriptionWords(true);
    yield* holding.build.returned.pipe(Effect.provide(servedNaming("/assets/app-New00000.js")));
    holding.build.moved("BACK");

    expect([current.seen.reloads, holding.seen.reloads]).toEqual([0, 0]);
  }),
);

it.effect(
  "a chunk that fails asks to reload rather than reloading, and its stylesheet failing beside it does not ask again",
  () =>
    Effect.gen(function* () {
      const tab = tabWith();

      yield* tab.answer();
      yield* tab.answer();

      expect(tab.seen.reloads).toBe(0);
      expect(tab.seen.asks).toHaveLength(1);
      tab.seen.asks[0]?.();
      expect(tab.seen.reloads).toBe(1);
    }),
);

it.effect("a chunk that fails offline asks nothing", () =>
  Effect.gen(function* () {
    const tab = tabWith({ online: false });

    yield* tab.answer();

    expect(tab.seen.asks).toEqual([]);
  }),
);

it.effect("a tab holding unsaved work reloads through the panel's own question", () =>
  Effect.gen(function* () {
    const tab = tabWith();
    const leaveAsked: (() => void)[] = [];
    tab.leave.unsavedWork((leave) => leaveAsked.push(leave));

    yield* tab.answer();
    tab.seen.asks[0]?.();
    expect(tab.seen.reloads).toBe(0);
    leaveAsked[0]?.();
    expect(tab.seen.reloads).toBe(1);
  }),
);

it.effect(
  "a Reload the developer stayed from at the browser's question leaves the next failure asked about again",
  () =>
    Effect.gen(function* () {
      const tab = tabWith();
      tab.leave.unsavedDescriptionWords(true);

      yield* tab.answer();
      tab.seen.asks[0]?.();
      // The browser asked about the description's words before reloading, and the developer stayed.
      expect(tab.seen.reloads).toBe(1);

      yield* tab.answer();
      expect(tab.seen.asks).toHaveLength(2);
    }),
);

it.effect("an ask dismissed leaves the next failure asked about again", () =>
  Effect.gen(function* () {
    const tab = tabWith();

    yield* tab.answer();
    tab.seen.dismisses[0]?.();
    yield* tab.answer();

    expect(tab.seen.asks).toHaveLength(2);
    expect(tab.seen.reloads).toBe(0);
  }),
);
