// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PortTable, PortTableCell, PortTableRow } from "./port-table.js";

/**
 * port-table.test.ts -- each port's cells sit under the head of the place
 * they reach, so a reader hears a cell as that place's.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` on the page and hands back what it was drawn into. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));

  return container;
}

test("each port's cells sit under their place's head, the port heading its line", () => {
  const container = draw(
    createElement(PortTable, {
      label: "Ports",
      portLabel: "Port",
      columns: [
        { key: "mac", icon: null, label: "This Mac" },
        { key: "team", icon: null, label: "Team link" },
      ],
      children: createElement(PortTableRow, {
        port: 5173,
        detail: "vite dev",
        children: [
          createElement(PortTableCell, { key: "mac", children: "Open" }),
          createElement(PortTableCell, { key: "team", children: "Share" }),
        ],
      }),
    }),
  );

  const heads = [...container.querySelectorAll("th[scope='col']")].map((head) => head.textContent);
  const line = container.querySelector("tbody tr");
  expect(heads).toEqual(["Port", "This Mac", "Team link"]);
  expect(line?.querySelector("th[scope='row']")?.textContent).toBe("5173vite dev");
  expect([...(line?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent)).toEqual([
    "Open",
    "Share",
  ]);
});
