/**
 * task-items.ts -- a task item of GitHub Markdown ticked or cleared by its place among the words' task items, as GitHub's own checkbox edits the words it stands in.
 *
 * GitHub renders each task item (`- [ ]`, `- [x]`) of a comment as a
 * checkbox, in the order they are written, and ticking one rewrites that
 * item's mark in the comment's words. The tab names a box by that order and
 * says how many boxes it drew, so the words are read here as GitHub's
 * dialect parses them (`markdownTree`), whose task items are the boxes
 * GitHub renders, never a line in a code block, and a tick on words whose
 * items no longer number what the reader saw is refused rather than landing
 * on another item.
 */

import { markdownTree } from "@repo/features/markdown-tree";

/** What ticking an item came to: the words with it ticked, the item already standing as asked, or the words' items not those the reader saw. */
export const TASK_TICK = {
  TICKED: "ticked",
  ALREADY: "already",
  CHANGED: "changed",
} as const;

export type TaskTick =
  | { readonly kind: typeof TASK_TICK.TICKED; readonly body: string }
  | { readonly kind: typeof TASK_TICK.ALREADY }
  | { readonly kind: typeof TASK_TICK.CHANGED };

/** A node of the parsed words, as the walk reads it. */
type TreeNode = ReturnType<typeof markdownTree>["children"][number];

/** An item's opening as written, from its list marker to its box's mark, which is the first group. */
const ITEM_BOX = /^(?:[-+*]|\d{1,9}[.)])[ \t]+\[([ xX])\]/u;

/** Where each task item's mark stands in the words, in order, and whether it is ticked. */
function taskMarks(body: string): readonly { readonly at: number; readonly ticked: boolean }[] {
  const marks: { at: number; ticked: boolean }[] = [];

  const walk = (node: TreeNode): void => {
    const start = node.position?.start.offset;

    const ticked = node.type === "listItem" ? node.checked : undefined;

    if ((ticked === true || ticked === false) && start !== undefined) {
      const box = ITEM_BOX.exec(body.slice(start));

      // Note that the mark is the one character before the box's closing bracket.
      if (box !== null) marks.push({ at: start + box[0].length - 2, ticked });
    }

    if ("children" in node) for (const child of node.children) walk(child);
  };

  for (const node of markdownTree(body).children) walk(node);

  return marks;
}

/**
 * The words with the task item at `index` among them, the first 0, ticked
 * where `checked` asks or cleared, where they hold the `count` items the
 * reader saw. The words change by that one mark alone.
 */
export function tickTaskItem(
  body: string,
  tick: { readonly index: number; readonly count: number; readonly checked: boolean },
): TaskTick {
  const marks = taskMarks(body);
  const mark = marks[tick.index];

  if (marks.length !== tick.count || mark === undefined) return { kind: TASK_TICK.CHANGED };

  if (mark.ticked === tick.checked) return { kind: TASK_TICK.ALREADY };
  const written = `${body.slice(0, mark.at)}${tick.checked ? "x" : " "}${body.slice(mark.at + 1)}`;

  return { kind: TASK_TICK.TICKED, body: written };
}
