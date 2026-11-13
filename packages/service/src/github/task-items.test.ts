import { describe, expect, it } from "vitest";
import { TASK_TICK, tickTaskItem } from "./task-items.js";

/**
 * A bot's status comment as such bots write one: an item in a quote, a
 * task-like line in an indented code block, one in a fence whose first
 * marker line carries words and so does not close it, and an item after
 * them all. GitHub renders two boxes.
 */
const STATUS = [
  "> [!IMPORTANT]",
  "> Use the checkbox below for a quick retry:",
  '> - [ ] <!-- {"checkboxId":"e9bb"} --> Trigger review',
  "",
  "    - [ ] indented code, not an item",
  "",
  "~~~md",
  "~~~ not a close",
  "- [ ] fenced code, not an item",
  "~~~",
  "",
  "- [x] **Autofix** · Keep fixing findings",
  "",
].join("\r\n");

describe("tickTaskItem", () => {
  it.each([
    {
      name: "ticks the first box, in a quote, by its place",
      index: 0,
      checked: true,
      changed: ["> - [ ] <!--", "> - [x] <!--"],
    },
    {
      name: "counts past code that is no box to the second",
      index: 1,
      checked: false,
      changed: ["- [x] **Autofix**", "- [ ] **Autofix**"],
    },
  ])("$name", ({ index, checked, changed: [from = "", to = ""] }) => {
    expect(tickTaskItem(STATUS, { index, count: 2, checked })).toEqual({
      kind: TASK_TICK.TICKED,
      body: STATUS.replace(from, to),
    });
  });

  it("writes nothing for a box already as asked, and refuses words whose boxes are not those the reader saw", () => {
    expect(tickTaskItem(STATUS, { index: 1, count: 2, checked: true })).toEqual({
      kind: TASK_TICK.ALREADY,
    });
    expect(tickTaskItem(STATUS, { index: 1, count: 3, checked: false })).toEqual({
      kind: TASK_TICK.CHANGED,
    });
  });
});
