/**
 * lazy-surface.test.ts -- a surface whose chunk a prefetch already landed draws at once, with no frame of its fallback, and one whose chunk failed reloads the window from its Reload.
 */

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { lazySurface } from "./lazy-surface.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LOADING = "Loading the page";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const Page = ({ name }: { name: string }) => createElement("p", null, `Page of ${name}`);

test("a surface prefetched before its draw stands the page at once", async () => {
  // Note that the module is held back until the test lands it, as a slow chunk would be.
  const chunk = Promise.withResolvers<typeof Page>();
  const surface = lazySurface<{ name: string }>(() => chunk.promise);
  surface.prefetch();
  await act(async () => {
    chunk.resolve(Page);
  });
  // Note that the draw is not awaited, so a page that suspended once more would still stand its fallback here.
  act(() => root.render(createElement(surface.Surface, { name: "Ada", fallback: LOADING })));
  expect(host.textContent).toBe("Page of Ada");
});

test("a surface whose chunk failed says so with Reload, which reloads the window to read the chunk again", async () => {
  // Note that React says the failure its boundary caught on the console, as it would in the window.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const chunk = Promise.withResolvers<typeof Page>();
  const reloads: string[] = [];
  const surface = lazySurface<{ name: string }>(
    () => chunk.promise,
    () => reloads.push("window"),
  );
  await act(async () =>
    root.render(createElement(surface.Surface, { name: "Ada", fallback: LOADING })),
  );
  expect(host.textContent).toBe(LOADING);
  await act(async () => {
    chunk.reject(new TypeError("Failed to fetch dynamically imported module"));
  });
  const reload = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Reload",
  );
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  act(() => reload?.click());
  expect(reloads).toEqual(["window"]);
});
