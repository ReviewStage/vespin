/**
 * client-parity.test.ts -- the iOS column offers no act the iOS host refuses, so a row cannot say the app does what its port turns away.
 *
 * `compose-mobile.ts` answers every platform kind with
 * `refusedPlatformProcedures` alone, so each is a gap on iOS until the app
 * answers one itself, and this test with it.
 */

import { describe, expect, it } from "vitest";
import { refusedPlatformProcedures } from "../act-port/index.js";
import { CLIENT_PARITY } from "./client-parity.js";

describe("CLIENT_PARITY", () => {
  it("offers on iOS no platform kind, which the iOS host refuses", () => {
    const refused = refusedPlatformProcedures();

    const offered = Object.entries(CLIENT_PARITY).flatMap(([kind, row]) =>
      kind in refused && row.ios.offered ? [kind] : [],
    );

    expect(offered).toEqual([]);
  });
});
