import { describe, expect, it } from "vitest";
import { threadRuns } from "./thread-group-model.js";

const MINUTE = 60 * 1000;

/** A message by `name`, the agent where `agent`, `minutes` into the thread, named by `id`. */
function message(id: string, name: string, minutes: number, agent = false, writerId?: string) {
  return { id, writer: { name, agent, id: writerId }, at: minutes * MINUTE };
}

describe("threadRuns", () => {
  it.each([
    [
      "one writer's messages close together stand in one run",
      [
        message("a", "Relay", 0, true),
        message("b", "Relay", 2, true),
        message("c", "Relay", 4, true),
      ],
      [["a", "b", "c"]],
    ],
    [
      "another writer starts a run",
      [message("a", "Relay", 0, true), message("b", "Ada", 1), message("c", "Relay", 2, true)],
      [["a"], ["b"], ["c"]],
    ],
    [
      "the same writer back after more than five minutes starts a run",
      [message("a", "Ada", 0), message("b", "Ada", 5), message("c", "Ada", 11)],
      [["a", "b"], ["c"]],
    ],
    [
      "two members of one name are two writers where their ids differ",
      [message("a", "Alex", 0, false, "u1"), message("b", "Alex", 1, false, "u2")],
      [["a"], ["b"]],
    ],
    [
      "a member named as the agent is still another writer",
      [message("a", "Relay", 0, true), message("b", "Relay", 1)],
      [["a"], ["b"]],
    ],
  ])("%s", (_case, messages, runs) => {
    expect(threadRuns(messages).map((run) => run.map((each) => each.id))).toEqual(runs);
  });
});
