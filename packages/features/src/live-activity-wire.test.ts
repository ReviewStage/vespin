import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { liveActivityContentStateSchema } from "./live-activity-wire.js";

/**
 * The content state as the bytes ActivityKit hands the widget's Swift
 * `AgentsActivityAttributes.ContentState` (`apps/mobile/modules/live-activity/ios/`),
 * whose keys and types the expected JSON is written from: a renamed key, or
 * an instant sent as anything but epoch milliseconds, is a widget that stops
 * decoding. Synthetic ids throughout.
 */
describe("liveActivityContentStateSchema", () => {
  it("encodes to the JSON the widget decodes", () => {
    const encoded = Schema.encodeSync(liveActivityContentStateSchema)({
      running: 2,
      waiting: 1,
      agents: [
        {
          id: "agent-1",
          title: "Fix the refresh",
          step: "Editing session-store.ts",
          startedAt: 1_762_794_528_000,
        },
        { id: "agent-2", title: "Resend invites", step: null, startedAt: 1_762_794_000_000 },
      ],
    });
    expect(JSON.parse(JSON.stringify(encoded))).toStrictEqual({
      running: 2,
      waiting: 1,
      agents: [
        {
          id: "agent-1",
          title: "Fix the refresh",
          step: "Editing session-store.ts",
          startedAt: 1762794528000,
        },
        { id: "agent-2", title: "Resend invites", step: null, startedAt: 1762794000000 },
      ],
    });
  });
});
