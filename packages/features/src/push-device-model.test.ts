import { describe, expect, it } from "vitest";
import { pushStandingText } from "./push-device-model.js";

/**
 * What a phone's Settings says of its pushes: a failing run is said with its
 * reason even where a push reached Apple before it, a phone a push reached
 * is working, and one none reached says so. Synthetic instants throughout.
 */

const DELIVERED_AT = Date.UTC(2026, 10, 10, 8, 0);
const FAILING_SINCE = Date.UTC(2026, 10, 10, 9, 0);

describe("pushStandingText", () => {
  it.each([
    {
      standing: {
        lastDeliveredAt: DELIVERED_AT,
        failingSince: FAILING_SINCE,
        failureReason: "BadTopic",
      },
      said: /^Failing since .+ \(BadTopic\)$/,
    },
    {
      standing: { lastDeliveredAt: DELIVERED_AT, failingSince: null, failureReason: null },
      said: /^Working$/,
    },
    {
      standing: { lastDeliveredAt: null, failingSince: null, failureReason: null },
      said: /^None sent yet$/,
    },
  ])("says $said", ({ standing, said }) => {
    expect(pushStandingText(standing)).toMatch(said);
  });
});
