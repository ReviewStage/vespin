import { expect, it } from "vitest";
import { FILE_VIEWED_STATE, PULL_REQUEST_WRITE_OUTCOME } from "./pull-request-write-wire.js";
import { type MarkAnswer, ViewedMarkStore, viewedIn } from "./viewed-marks.js";

/**
 * viewed-marks.test.ts -- a press on a file's mark draws at once and settles with GitHub: presses made while one is out fold into the last, a refused mark goes back with its refusal to say, and a read never undoes a press still out.
 */

const TAKEN: MarkAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
const REFUSED: MarkAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED };
const UNANSWERED: MarkAnswer = { failure: "unanswered" };

/** Marks whose sends wait until the test answers them, each send kept in order with its file and the mark it asked for. */
function heldMarks() {
  const sent: { path: string; viewed: boolean; answer: (answer: MarkAnswer) => void }[] = [];

  const marks = new ViewedMarkStore((path, viewed) => {
    const held = Promise.withResolvers<MarkAnswer>();
    sent.push({ path, viewed, answer: held.resolve });

    return held.promise;
  }, UNANSWERED);

  marks.take({
    outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
    files: [{ path: "a.ts", state: FILE_VIEWED_STATE.UNVIEWED }],
  });

  return { marks, sent };
}

/** Lets every answer already given be heard. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// Note that the regression this catches is a refusal leaving the box ticked though GitHub holds the file unviewed.
it("draws a press at once, and puts a mark GitHub refused back with the refusal to say", async () => {
  const { marks, sent } = heldMarks();

  const settles = marks.toggle("a.ts");
  expect(viewedIn(marks.snapshot(), "a.ts")).toBe(true);

  sent[0]?.answer(REFUSED);
  expect(await settles).toBe(false);
  expect(viewedIn(marks.snapshot(), "a.ts")).toBe(false);
  expect(marks.snapshot().said).toEqual(REFUSED);
});

// Note that the regression this catches is a quick run of presses each sent at once, which GitHub may settle out of order.
it("folds the presses made while one is out into the last, sent once the one out is answered", async () => {
  const { marks, sent } = heldMarks();

  void marks.toggle("a.ts");
  void marks.toggle("a.ts");
  void marks.toggle("a.ts");
  expect(sent.map((each) => each.viewed)).toEqual([true]);

  sent[0]?.answer(TAKEN);
  await settle();
  // The three presses end on viewed, which GitHub now holds, so nothing more is sent.
  expect(sent).toHaveLength(1);
  expect(viewedIn(marks.snapshot(), "a.ts")).toBe(true);

  void marks.toggle("a.ts");
  void marks.toggle("a.ts");
  sent[1]?.answer(TAKEN);
  await settle();
  // The press out unmarked it, and the one after it asks for viewed again, so that goes next.
  expect(sent.map((each) => each.viewed)).toEqual([true, false, true]);
});

// Note that the regression this catches is a read that landed while a press was out unticking the box the member just ticked.
it("keeps a press still out over a read that landed before GitHub answered it", () => {
  const { marks } = heldMarks();

  void marks.toggle("a.ts");
  marks.take({
    outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
    files: [{ path: "a.ts", state: FILE_VIEWED_STATE.UNVIEWED }],
  });

  expect(viewedIn(marks.snapshot(), "a.ts")).toBe(true);
});
