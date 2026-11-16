/**
 * install.test.ts -- a `vespin` Homebrew installed told apart from one npm installed.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { installKind } from "./install.js";

const PACKAGE = ["libexec", "lib", "node_modules", "vespin"] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

/** The kind of install a bundle at `prefix`'s npm package folder reads as. */
function kindUnder(root: string, ...prefix: string[]) {
  const folder = join(root, ...prefix, ...PACKAGE);
  const bundle = join(folder, "vespin.mjs");
  mkdirSync(folder, { recursive: true });
  writeFileSync(bundle, "");
  vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, bundle]);

  return installKind();
}

// Note that the regression this catches is Homebrew's keg, which holds the npm package, read
// as an npm install, so `vespin update` tells a brew user to run `npm i -g` over it.
it.effect("reads a bundle in Homebrew's keg as Homebrew's and one in npm's prefix as npm's", () =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("vespin-install-");

    assert.equal(kindUnder(root, "Cellar", "vespin", "0.3.0"), "homebrew");
    assert.equal(kindUnder(root, "usr", "local"), "npm");
  }).pipe(Effect.provide(NodeServices.layer)),
);
