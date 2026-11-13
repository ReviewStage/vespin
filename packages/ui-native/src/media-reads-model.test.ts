// media-reads-model.test.ts -- a picture or recording whose read failed is read again on its own after a pause, and let go after its tries until it is asked for again.

import { describe, expect, it } from "vitest";
import { mediaReads } from "./media-reads-model.js";

const RECORDING = "recording";
const SOURCE = "file:///Caches/agent-recording.mp4";

/** How many times a read is tried, the first among them, before it is let go until it is asked for again. */
const TRIES = 4;

/** Reads that fail `failing` times before answering, each landing and each last failure settling a promise the test awaits. */
function readsFailing(failing: number) {
  let tries = 0;
  const shown = new Map<string, string>();
  let settle: () => void = () => undefined;

  const reads = mediaReads({
    read: () => {
      tries += 1;

      return tries > failing ? Promise.resolve(SOURCE) : Promise.reject(new Error("not written"));
    },
    landed: (id, source) => {
      shown.set(id, source);
      settle();
    },
    failed: (_id, _cause, again) => {
      if (!again) settle();
    },
    pause: () => Promise.resolve(),
  });

  const settled = () =>
    new Promise<void>((resolve) => {
      settle = resolve;
    });

  return { reads, shown, settled };
}

describe("a page's media reads", () => {
  it("reads one whose read failed again on its own, with no second ask", async () => {
    const { reads, shown, settled } = readsFailing(1);
    const landing = settled();
    reads.ask([RECORDING]);
    await landing;
    expect(shown.get(RECORDING)).toBe(SOURCE);
  });

  it("lets one go after its tries fail, and reads it again once it is asked for again", async () => {
    const { reads, shown, settled } = readsFailing(TRIES);
    const givingUp = settled();
    reads.ask([RECORDING]);
    await givingUp;
    expect(shown.has(RECORDING)).toBe(false);
    const landing = settled();
    reads.ask([RECORDING]);
    await landing;
    expect(shown.get(RECORDING)).toBe(SOURCE);
  });
});
