import { expect, test } from "vitest";
import { settledPaging } from "./settled-paging.js";

/**
 * settled-paging.test.ts -- a run's end the view told before the list began
 * paging still reads the page after the first, as a child's effect runs
 * before its parent's.
 */

/** Lets every answer asked so far land, each through the paging's chain of thens. */
async function landed(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

test("a run's end told before the list pages reads the next page once the first lands, though nothing tells it again", async () => {
  // Each page asked, by the cursor it reads past: the first answers a page after it, the second none.
  const asked: (string | undefined)[] = [];

  const paging = settledPaging<string>((_scope, before) => {
    asked.push(before);

    return Promise.resolve(before === undefined ? { next: "page-2" } : {});
  });

  paging.onDrawn(true);
  paging.onRunEnd(true);
  paging.show("workspace-acme");
  await landed();

  expect(asked).toEqual([undefined, "page-2"]);
});
