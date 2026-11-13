// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { STATUS_TONE } from "../../status-tone.js";
import { TRACK_NODE_LOOK, TrackList, TrackRow } from "./track-list.js";

/**
 * track-list.test.ts -- a track is a list as any list is, named by its
 * label, its rows read by their words in order and pressed as rows are,
 * while the rail's nodes are hidden from a reader.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("a track is a list named by its label whose rows read by their titles in order and open on a press, its nodes hidden from a reader", () => {
  const pressed: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(TrackList, {
        label: "acme/relay",
        children: [
          createElement(TrackRow, {
            key: "checking",
            node: { tone: STATUS_TONE.WORKING },
            title: "Rename the billing job",
            onPress: () => pressed.push("checking"),
          }),
          createElement(TrackRow, {
            key: "waiting",
            node: { look: TRACK_NODE_LOOK.HOLLOW },
            title: "Retry webhook deliveries",
            onPress: () => pressed.push("waiting"),
          }),
        ],
      }),
    ),
  );

  const list =
    container.querySelector('[aria-label="acme/relay"]') ?? assert.fail("the list is named");

  const rows = [...list.querySelectorAll("li")];

  assert.equal(list.tagName, "UL");
  assert.deepEqual(
    rows.map((row) => row.querySelector(".ui-list-row-title")?.textContent),
    ["Rename the billing job", "Retry webhook deliveries"],
  );
  assert.equal(
    rows.every((row) => row.querySelector('[aria-hidden="true"].ui-track-node') !== null),
    true,
  );

  const press = rows[1]?.querySelector("button") ?? assert.fail("the row is a press");
  act(() => press.click());
  assert.deepEqual(pressed, ["waiting"]);
});
