import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import type { ActSender } from "@repo/host/act-port";
import { type TestActPort, testActPort } from "@repo/host/act-port/testing";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { macAppProcedures } from "./mac-app-acts";

/**
 * An app an agent uses brought forward as main carries it: a panel's press
 * brings the app it names to the front, and any other window is refused,
 * since a page must not open apps on the Mac. Synthetic names throughout.
 */

/** Every act port a fixture opened, closed once its test is done. */
const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

// SAFETY: the rows read a sender by identity alone; one inert object is one window.
const panelOf = (): ActSender<WebContents> => ({
  sender: {} as WebContents,
  panel: true,
});

it.effect("a panel brings the app it names forward, and any other window is refused", () =>
  Effect.gen(function* () {
    const shown: string[] = [];
    const actPort = testActPort(macAppProcedures({ showApp: (id) => void shown.push(id) }));
    ports.push(actPort);
    const show = { kind: ACT_KIND.MAC_APP_SHOW, payload: { bundleId: "com.example.notes" } };

    const other = yield* actPort.perform(show, { ...panelOf(), panel: false });
    assert.ok("refused" in other);
    yield* actPort.perform(show, panelOf());

    assert.deepEqual(shown, ["com.example.notes"]);
  }),
);
