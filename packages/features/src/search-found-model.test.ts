import { expect, test } from "vitest";
import { rankedBySearch, taskSearchSubject } from "./search-found-model.js";
import { TASK_STATUS, type TaskSummary } from "./task-wire.js";

/**
 * search-found-model.test.ts -- a search ranks the tasks it finds by what
 * their rows say, not by the list's order: a key typed whole first, then a
 * name the words begin, then a name they only start a word of, then a
 * repository they name; a task they do not answer is left out.
 */

/** A task of the Acme workspace, numbered `number`, in `repository`. */
function task(name: string, number: number, repository: string | null): TaskSummary {
  return {
    id: `task-${number}`,
    workspaceId: "workspace-acme",
    number,
    name,
    createdAt: 0,
    updatedAt: 0,
    repository,
    status: TASK_STATUS.TODO,
    ownerId: "user-ada",
  };
}

test("a search ranks its tasks by what their rows say, best first", () => {
  // Listed newest first, as the Tasks list orders them, which is the order a tie keeps.
  const tasks = [
    task("Digest email", 1, "acme/rounding"),
    task("Fix ledger rounding", 2, "acme/ledger"),
    task("Weekly digest", 3, "acme/mail"),
    task("Rounding errors in totals", 4, "acme/ledger"),
    task("Round two", 42, "acme/web"),
  ];

  const names = (query: string) =>
    rankedBySearch(tasks, query, (each) => taskSearchSubject(each, "Acme")).map(
      (each) => each.name,
    );

  expect(names("rounding")).toEqual([
    "Rounding errors in totals",
    "Fix ledger rounding",
    "Digest email",
  ]);
  expect(names("acme-42")).toEqual(["Round two"]);
  expect(names("")).toEqual([]);
});
