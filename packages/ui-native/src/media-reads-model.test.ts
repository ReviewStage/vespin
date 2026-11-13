// media-reads-model.test.ts -- a picture or recording whose read failed, or hung past its deadline, is read again on its own after a pause, and let go after its tries until it is asked for again.

import { describe, expect, it } from "vitest";
import { MEDIA_READ_DEADLINE_MS, MEDIA_READ_TRIES, mediaReads } from "./media-reads-model.js";

const RECORDING = "recording";
const SOURCE = "file:///Caches/agent-recording.mp4";

/** How one try of a read answers: it fails, it never answers, or it lands. */
const ANSWER = { FAILS: "fails", HANGS: "hangs", LANDS: "lands" } as const;

type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/** A promise that never settles, as a hung native write. */
const NEVER = new Promise<never>(() => undefined);

/** Lets every turn already queued run, so reads whose seams all answer at once have settled. */
function settledTurns(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Reads whose tries answer as `answers` says in turn, the last answer standing for every try after, every pause lapsing at once and a try's deadline only where `deadlineLapses`. */
function readsAnswering(answers: readonly Answer[], deadlineLapses = false) {
  let tries = 0;
  const shown = new Map<string, string>();

  const reads = mediaReads({
    read: () => {
      const answer = answers[Math.min(tries, answers.length - 1)];
      tries += 1;

      if (answer === ANSWER.HANGS) return NEVER;

      return answer === ANSWER.LANDS
        ? Promise.resolve(SOURCE)
        : Promise.reject(new Error("not written"));
    },
    landed: (id, source) => shown.set(id, source),
    failed: () => undefined,
    pause: (ms) => (ms === MEDIA_READ_DEADLINE_MS && !deadlineLapses ? NEVER : Promise.resolve()),
  });

  return { reads, shown };
}

describe("a page's media reads", () => {
  it("reads one whose read failed again on its own, with no second ask", async () => {
    const { reads, shown } = readsAnswering([ANSWER.FAILS, ANSWER.LANDS]);
    reads.ask([RECORDING]);
    await settledTurns();
    expect(shown.get(RECORDING)).toBe(SOURCE);
  });

  it("reads one whose read never answered again once its deadline passes", async () => {
    const { reads, shown } = readsAnswering([ANSWER.HANGS, ANSWER.LANDS], true);
    reads.ask([RECORDING]);
    await settledTurns();
    expect(shown.get(RECORDING)).toBe(SOURCE);
  });

  it("lets one go after its tries fail, and reads it again once it is asked for again", async () => {
    const { reads, shown } = readsAnswering([
      ...Array.from({ length: MEDIA_READ_TRIES }, () => ANSWER.FAILS),
      ANSWER.LANDS,
    ]);

    reads.ask([RECORDING]);
    await settledTurns();
    expect(shown.has(RECORDING)).toBe(false);
    reads.ask([RECORDING]);
    await settledTurns();
    expect(shown.get(RECORDING)).toBe(SOURCE);
  });
});
