import { expect, test } from "vitest";
import { SEARCH_FOUND_KIND } from "./search-found-model.js";
import { type RecentOpened, recentRows, withOpened } from "./search-recent-model.js";

/**
 * search-recent-model.test.ts -- Search's Recent lists what was last opened
 * newest first, each thing once however often it was opened, and only the
 * chosen workspace's that its lists still hold, so a task deleted or a
 * thread gone leaves no blank row and no gap in the few it shows.
 */

/** An opening of a task in `workspaceId`. */
function task(id: string, workspaceId = "acme"): RecentOpened {
  return { kind: SEARCH_FOUND_KIND.TASKS, id, workspaceId };
}

test("an opening goes to the top once, an earlier opening of it let go", () => {
  const thread: RecentOpened = { kind: SEARCH_FOUND_KIND.INBOX, id: "t1", workspaceId: "acme" };
  const kept = [task("a"), thread, task("b")];

  expect(withOpened(kept, task("b"))).toEqual([task("b"), task("a"), thread]);
});

test("Recent passes over another workspace's openings and those no list holds, then shows ten", () => {
  const ids = Array.from({ length: 14 }, (_, index) => `task-${index}`);
  const kept = [task("gone"), task("elsewhere", "globex"), ...ids.map((id) => task(id))];

  const rows = recentRows(kept, "acme", {
    task: (id) => (id === "gone" ? undefined : id),
    thread: () => undefined,
    agent: () => undefined,
  });

  expect(rows.map((row) => row.id)).toEqual(ids.slice(0, 10));
});
