/**
 * window-escape.ts -- the window's Escape stood beside a test's own tree, as the app stands it beside the shell (`window-escape.ts`).
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useWindowEscape } from "../window-escape.js";

/** The window's Escape with no sign-in waiting. */
function WindowEscape(): null {
  useWindowEscape(undefined);

  return null;
}

/** Stands the window's Escape until the root it answers is unmounted. */
export function standWindowEscape(): Root {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(createElement(WindowEscape)));

  return root;
}
