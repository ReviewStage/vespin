// @vitest-environment jsdom

import assert from "node:assert/strict";
import { test } from "vitest";
import { assetUrl } from "./app-platform.js";
import { fakeAppPlatform } from "./testing/app-platform.js";

/**
 * The panel's static files resolve from the asset base its shell names, not
 * from the document's own address, which on the web is a route such as
 * `/<workspace>/plan/<id>` rather than the folder the files are served from.
 */

const BASE = "https://app.example/assets/panel/";

test("a voice's clip resolves from the asset base the shell names", () => {
  window.history.replaceState(null, "", "/acme/plan/0b805267");
  fakeAppPlatform({ assetBase: () => BASE });

  assert.equal(assetUrl("voices/alloy.m4a"), `${BASE}voices/alloy.m4a`);
});
