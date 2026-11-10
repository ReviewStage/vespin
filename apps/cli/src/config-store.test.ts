/**
 * config-store.test.ts -- the default workspace forgotten after a leave or delete only where it names the workspace left.
 */

import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { configuredWorkspace, forgetWorkspace, keepWorkspace } from "./config-store.js";

const ORIGIN = "https://preview.example.test";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Note that the regression this catches is a leave or delete that keeps a default naming a
// workspace the member is no longer in, which every later command is refused under, or that
// clears a default naming another workspace.
it.effect("forgets the default workspace only where it names the workspace left", () =>
  Effect.gen(function* () {
    vi.stubEnv("XDG_CONFIG_HOME", yield* temporaryDirectoryScoped("vespin-cli-"));
    yield* keepWorkspace(ORIGIN, "ws-acme");

    yield* forgetWorkspace(ORIGIN, { id: "ws-other", slug: "other" });
    const kept = yield* configuredWorkspace(ORIGIN);
    yield* forgetWorkspace(ORIGIN, { id: "ws-acme", slug: "acme" });
    const forgotten = yield* configuredWorkspace(ORIGIN);

    assert.equal(kept, "ws-acme");
    assert.equal(forgotten, undefined);
  }).pipe(Effect.provide(NodeServices.layer)),
);
