import assert from "node:assert/strict";
import type { WireBoundaryInput } from "@repo/wire";
import { Schema } from "effect";
import { test } from "vitest";
import {
  PAGE_FIT,
  PAGE_FIT_PENDING,
  PAGE_SIZE_SCRIPT,
  type PageFit,
  pageFitAfter,
  pageSizeSchema,
} from "./page-size.js";
import {
  PAGE_THEME_SCHEME,
  PAGE_THEME_SCRIPT,
  type PageTheme,
  pageThemeMessage,
} from "./page-theme.js";

/**
 * page-size.test.ts -- a page drawn in words is drawn as tall as its content,
 * and a page that only ever fills its frame is drawn at a screenful rather
 * than at the stand-in it was first framed at, without swinging between them;
 * and a page reports its height only once it wears the window's theme, so a
 * frame loaded again never stands a moment at its unthemed height.
 */

const STAND_IN = 240;
const SCREENFUL = 640;
const PAGE_HEIGHT = 480;

const isSize = Schema.is(pageSizeSchema);

/** The fit after each report, the frame standing at the height the fit before it drew. */
function fitsOver(reports: ReadonlyArray<(frame: number) => number>): PageFit[] {
  const fits: PageFit[] = [];
  let fit = PAGE_FIT_PENDING;
  let frame = STAND_IN;

  for (const report of reports) {
    fit = pageFitAfter(fit, report(frame), frame);
    fits.push(fit);
    frame =
      fit.kind === PAGE_FIT.CONTENT
        ? fit.height
        : fit.kind === PAGE_FIT.FILLS
          ? SCREENFUL
          : STAND_IN;
  }

  return fits;
}

type FramedPageResult = { posted: WireBoundaryInput[]; handTheme: () => void };

/**
 * A page's window running the height and theme scripts, laid out
 * `PAGE_HEIGHT` tall: an event target for its own events and a parent that
 * keeps what is posted to it. Answers what it posted, and a way to hand it
 * the window's theme.
 */
function framedPage(): FramedPageResult {
  const posted: WireBoundaryInput[] = [];
  const page = new EventTarget();
  const parent = { postMessage: (data: WireBoundaryInput) => posted.push(data) };

  const document = {
    readyState: "complete",
    head: null,
    body: null,
    documentElement: {
      firstChild: null,
      getBoundingClientRect: () => ({ height: PAGE_HEIGHT }),
      insertBefore: () => undefined,
    },
    createElement: () => ({ textContent: "" }),
  };

  for (const script of [PAGE_SIZE_SCRIPT, PAGE_THEME_SCRIPT]) {
    new Function("document", "parent", "addEventListener", "dispatchEvent", script)(
      document,
      parent,
      page.addEventListener.bind(page),
      page.dispatchEvent.bind(page),
    );
  }

  const theme: PageTheme = {
    scheme: PAGE_THEME_SCHEME.DARK,
    // SAFETY: nothing under test reads a variable of the theme.
    variables: {} as PageTheme["variables"],
    inset: "",
    narrowInset: "",
  };

  const handTheme = () => {
    const data = pageThemeMessage(theme);
    page.dispatchEvent(Object.assign(new Event("message"), { source: parent, data }));
  };

  return { posted, handTheme };
}

test("a page fills a screenful when it only ever reports its frame's height, and its content's height otherwise", () => {
  const fills = { kind: PAGE_FIT.FILLS };
  // A `100vh` page answers whatever frame it stands in.
  assert.deepEqual(fitsOver([(frame) => frame, (frame) => frame]), [fills, fills]);
  // A tall page is as tall as its words, however its frame stood.
  assert.deepEqual(fitsOver([() => 1900, () => 1900]), [
    { kind: PAGE_FIT.CONTENT, height: 1900 },
    { kind: PAGE_FIT.CONTENT, height: 1900 },
  ]);
  // A page whose words match the stand-in by chance settles at its own height, never back at a screenful.
  assert.deepEqual(fitsOver([() => STAND_IN, () => STAND_IN, () => STAND_IN]), [
    fills,
    { kind: PAGE_FIT.CONTENT, height: STAND_IN },
    { kind: PAGE_FIT.CONTENT, height: STAND_IN },
  ]);
});

test("a page reports its height only once it wears the window's theme", () => {
  const { posted, handTheme } = framedPage();
  assert.deepEqual(posted.filter(isSize), []);
  handTheme();
  assert.deepEqual(posted.filter(isSize), [{ type: "app-page-size", height: PAGE_HEIGHT }]);
});
