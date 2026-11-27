/**
 * agent-notice-words.test.ts -- a lost connection's notice says the agent waits, then when its provider answered again.
 */

import { CONNECTION_LOST_PROVIDER } from "@repo/wire/ui-messages";
import { expect, it } from "vitest";
import { connectionLostCaption } from "./agent-notice-words.js";

const NOW = new Date(2026, 10, 27, 15, 0).getTime();

it("says the agent carries on while it waits, the time it came back once it did, and now for a return the clocks place ahead", () => {
  const notice = { provider: CONNECTION_LOST_PROVIDER.ANTHROPIC, restoredAt: null };

  expect(connectionLostCaption(notice, NOW)).toBe("Carries on when it's back");
  expect(
    connectionLostCaption({ ...notice, restoredAt: new Date(2026, 10, 27, 14, 5).getTime() }, NOW),
  ).toBe("Back at 2:05 PM");
  expect(connectionLostCaption({ ...notice, restoredAt: NOW + 60_000 }, NOW)).toBe("Back now");
});
