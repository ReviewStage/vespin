import { describe, expect, it } from "vitest";
import { TASK_TICK, tickTaskItem } from "./task-items.js";

/** A bot's status comment as such bots write one: an item in a quote, one in a fence, and one after both. */
const STATUS = [
  "> [!IMPORTANT]",
  "> Use the checkbox below for a quick retry:",
  '> - [ ] <!-- {"checkboxId":"e9bb"} --> Trigger review',
  "",
  "```md",
  "- [ ] not an item",
  "```",
  "",
  "- [x] **Autofix** · Keep fixing findings",
  "",
].join("\r\n");

describe("tickTaskItem", () => {
  it.each([
    {
      name: "ticks the first item, in a quote, by its place",
      index: 0,
      checked: true,
      changed: ["> - [ ] <!--", "> - [x] <!--"],
    },
    {
      name: "counts past a fenced block's lines to the second item",
      index: 1,
      checked: false,
      changed: ["- [x] **Autofix**", "- [ ] **Autofix**"],
    },
  ])("$name", ({ index, checked, changed: [from = "", to = ""] }) => {
    expect(tickTaskItem(STATUS, index, checked)).toEqual({
      kind: TASK_TICK.TICKED,
      body: STATUS.replace(from, to),
    });
  });

  it("writes nothing for an item already as asked, and refuses a place past the last item", () => {
    expect(tickTaskItem(STATUS, 1, true)).toEqual({ kind: TASK_TICK.ALREADY });
    expect(tickTaskItem(STATUS, 2, true)).toEqual({ kind: TASK_TICK.MISSING });
  });
});
