import path from "node:path";
import { expect, test } from "vitest";
import { electronBuilderSignOptions } from "./electron-builder-hooks.mjs";

const APP_PATH = "/tmp/release-builder/mac-arm64/Vespin.app";

/** What electron-builder hands `mac.sign`: the app and its own per-file options. */
const HANDED_OVER = {
  app: APP_PATH,
  optionsForFile: () => ({ entitlements: "/tmp/entitlements.plist", hardenedRuntime: true }),
};

const NESTED_CODE = path.join(
  APP_PATH,
  "Contents/Frameworks/Electron Framework.framework/Electron Framework",
);

test("a Developer ID release signs the app bundle, and nothing nested in it, with a requirement accepting either team", () => {
  const options = electronBuilderSignOptions(HANDED_OVER, ["AAAA111111", "BBBB222222"]);

  expect(options.optionsForFile(APP_PATH)).toEqual({
    entitlements: "/tmp/entitlements.plist",
    hardenedRuntime: true,
    requirements:
      '=designated => identifier "dev.vespin.app" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and (certificate leaf[subject.OU] = "AAAA111111" or certificate leaf[subject.OU] = "BBBB222222")',
  });
  expect(options.optionsForFile(NESTED_CODE).requirements).toBeUndefined();
});

test("an ad-hoc package keeps codesign's own requirement", () => {
  const options = electronBuilderSignOptions(HANDED_OVER, undefined);

  expect(options.optionsForFile(APP_PATH).requirements).toBeUndefined();
});
