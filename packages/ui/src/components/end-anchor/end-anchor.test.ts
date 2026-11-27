// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, createRef, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { relayout as reportResize } from "../../testing/resize-observer.js";
import { type EndAnchor, useEndAnchor } from "./end-anchor.js";

/**
 * end-anchor.test.ts -- a log opens at its end and keeps to it whatever
 * grows or moves it, until the reader scrolls away by their own input; then
 * nothing moves it, until the reader reaches its end again or asks to go
 * back. jsdom lays nothing out, so the box's heights are stood in for, and
 * its size is heard as a test says it changed.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** Reports a resize to every observer, as the window does once a layout has changed. */
function relayout(): void {
  act(() => reportResize());
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A box `view` pixels tall over `length` pixels of lines, which a test lengthens, scrolling where it is written to. */
interface LaidOut {
  length: number;
  readonly view: number;
}

/** Lays `box` out as `laid` says, its scroll held within its reach. */
function layOut(box: HTMLElement, laid: LaidOut): void {
  let top = 0;
  Object.defineProperty(box, "clientHeight", { configurable: true, get: () => laid.view });
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => laid.length });
  Object.defineProperty(box, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (to: number) => {
      top = Math.max(0, Math.min(to, laid.length - laid.view));
    },
  });
}

/** Scrolls `box` to `top` and lets it hear the scroll, as the browser does a frame later. */
function scrollTo(box: HTMLElement, top: number): void {
  box.scrollTop = top;
  heardScroll(box);
}

/** Lets `box` hear its scroll as it stands. */
function heardScroll(box: HTMLElement): void {
  act(() => {
    box.dispatchEvent(new Event("scroll"));
  });
}

/** A log drawn: its box, how it is laid out, and its anchor as it last drew. */
interface DrawnLog {
  readonly box: HTMLElement;
  readonly laid: LaidOut;
  readonly anchor: () => EndAnchor;
}

/** Draws a log of 2000px of lines in a 600px box. */
function drawLog(): DrawnLog {
  const laid: LaidOut = { length: 2000, view: 600 };
  let latest: EndAnchor | undefined;
  const scroller = createRef<HTMLDivElement>();

  // Note that the box is laid out once, as it is first drawn, so a draw after keeps where it scrolled to.
  const holdBox = (element: HTMLDivElement | null) => {
    if (element !== null && scroller.current !== element) layOut(element, laid);
    scroller.current = element;
  };

  function Log() {
    const content = useRef<HTMLDivElement>(null);
    latest = useEndAnchor({ scroller, content });

    return createElement("div", { ref: holdBox }, createElement("div", { ref: content }));
  }

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Log)));
  const box = container.firstElementChild;
  assert.ok(box instanceof HTMLElement, "the log's box");

  return { box, laid, anchor: () => latest ?? assert.fail("the anchor") };
}

test("a log opens at its end and keeps to it as its lines grow and as anything but the reader moves it", () => {
  const { box, laid } = drawLog();
  relayout();
  assert.equal(box.scrollTop, 1400, "it opens at its end once laid out");

  laid.length = 2600;
  relayout();
  assert.equal(box.scrollTop, 2000, "lines growing keep it at its end");

  // Note that a scroll with no input of the reader's behind it, as a router restoring a place it kept, is put back.
  scrollTo(box, 300);
  assert.equal(box.scrollTop, 2000, "a scroll the reader did not make is undone");
});

test("a log the reader scrolls away from stays where they left it until they reach its end again or ask to go back", () => {
  const { box, laid, anchor } = drawLog();
  relayout();

  act(() => {
    box.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
  });
  scrollTo(box, 1000);
  assert.equal(anchor().stuck, false, "a wheel turned up lets go of the end");

  laid.length = 2600;
  relayout();
  assert.equal(box.scrollTop, 1000, "lines growing leave the reader where they read");

  scrollTo(box, 2000);
  assert.equal(anchor().stuck, true, "reaching the end keeps to it again");
  laid.length = 3000;
  relayout();
  assert.equal(box.scrollTop, 2400);

  act(() => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
  });
  scrollTo(box, 1500);
  assert.equal(anchor().stuck, false, "a key that scrolls up lets go too");
  act(() => anchor().stick());
  assert.equal(box.scrollTop, 2400, "asking to go back takes it to its end");
  assert.equal(anchor().stuck, true);
});
