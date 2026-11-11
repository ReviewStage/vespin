/**
 * client-parity.test.ts -- the iOS column offers no act the iOS host refuses, so a row cannot say the app does what its port turns away.
 *
 * `compose-mobile.ts` answers every platform kind with
 * `refusedPlatformProcedures` but those `feedbackProcedures` answer, so
 * each other is a gap on iOS until the app answers it itself, and this test
 * with it.
 */

import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { describe, expect, it } from "vitest";
import { feedbackProcedures, refusedPlatformProcedures } from "../act-port/index.js";
import { CLIENT_PARITY } from "./client-parity.js";

describe("CLIENT_PARITY", () => {
  it("offers on iOS no platform kind, which the iOS host refuses", () => {
    // Note that the client the answered kinds are built over is never called, since nothing is sent.
    const answered = feedbackProcedures(
      HttpClient.make(() => Effect.die("Nothing is sent.")),
      "https://vespin.dev",
    );

    const refused = refusedPlatformProcedures();

    const offered = Object.entries(CLIENT_PARITY).flatMap(([kind, row]) =>
      kind in refused && !(kind in answered) && row.ios.offered ? [kind] : [],
    );

    expect(offered).toEqual([]);
  });
});
