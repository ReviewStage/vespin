// package-config.test.mjs -- the bundle's end-to-end flag is never baked into a Developer ID build, which every release is.

import { expect, test } from "vitest";
import { e2eBuildDefine } from "./package-config.mjs";

test("a Developer ID build that asks to be the end-to-end build is refused rather than built", () => {
  expect(() =>
    e2eBuildDefine({ APP_E2E_BUILD: "1", APP_CODESIGN_IDENTITY: "Developer ID Application: Test" }),
  ).toThrow(/cannot be an end-to-end build/);
});
