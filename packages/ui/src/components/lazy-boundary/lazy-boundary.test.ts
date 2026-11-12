/**
 * lazy-boundary.test.ts -- a lazy surface whose chunk failed reloads the window from Reload, and one whose module landed and then threw while drawing is drawn again in place, the window left standing.
 */

// @vitest-environment jsdom

import { act, createElement, lazy } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { LazyBoundary } from "./lazy-boundary.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("a surface whose module landed and then threw is drawn again in place on Reload, the window left standing", () => {
  // Note that React says the failure its boundary caught on the console, as it would in the window.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const broken = { now: true };

  const Page = () => {
    if (broken.now) throw new Error("The page could not draw.");

    return createElement("p", null, "The page");
  };

  const reloads: string[] = [];
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(LazyBoundary, {
        fallback: "Loading",
        loaded: () => true,
        reload: () => reloads.push("window"),
        children: createElement(Page),
      }),
    ),
  );

  const reload = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Reload",
  );

  broken.now = false;
  act(() => reload?.click());
  expect(host.textContent).toBe("The page");
  expect(reloads).toEqual([]);
  act(() => root.unmount());
  vi.restoreAllMocks();
});

test("a surface whose chunk failed reloads the window from Reload", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  const Page = lazy(() =>
    Promise.reject<{ default: () => React.JSX.Element }>(
      new TypeError("Failed to fetch dynamically imported module"),
    ),
  );

  const reloads: string[] = [];
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(LazyBoundary, {
        fallback: "Loading",
        loaded: () => false,
        reload: () => reloads.push("window"),
        children: createElement(Page),
      }),
    ),
  );

  const reload = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Reload",
  );

  act(() => reload?.click());
  expect(reloads).toEqual(["window"]);
  act(() => root.unmount());
  vi.restoreAllMocks();
});
