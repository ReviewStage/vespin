/**
 * task-items.ts -- a task item of GitHub Markdown ticked or cleared by its place among the words' task items, as GitHub's own checkbox edits the words it stands in.
 *
 * GitHub renders each task item (`- [ ]`, `- [x]`) of a comment as a
 * checkbox, in the order they are written, and ticking one rewrites that
 * item's marker in the comment's words. The tab names a box by that order,
 * so the words are read line by line here as GitHub's own task-list script
 * reads them: an item's marker is a list marker, after any quote markers,
 * then `[ ]`, `[x]`, or `[X]` and a space or the line's end, and nothing in
 * a fenced code block is an item.
 */

/** What ticking an item came to: the words with it ticked, the item already standing as asked, or no item at that place. */
export const TASK_TICK = {
  TICKED: "ticked",
  ALREADY: "already",
  MISSING: "missing",
} as const;

export type TaskTick =
  | { readonly kind: typeof TASK_TICK.TICKED; readonly body: string }
  | { readonly kind: typeof TASK_TICK.ALREADY }
  | { readonly kind: typeof TASK_TICK.MISSING };

/** A task item's line: its quote and list markers, then its box, whose mark is the second group. */
const TASK_ITEM = /^((?:[ \t]*>)*[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+\[)([ xX])(?=\](?:[ \t]|$))/u;

/** A fence's opening or closing line, after any quote markers: three or more backticks or tildes. */
const FENCE = /^(?:[ \t]*>)*[ \t]{0,3}(`{3,}|~{3,})/u;

/**
 * The words with the task item at `index` among them, the first 0, ticked
 * where `checked` asks or cleared. Line endings stand as written, so the
 * words change by that one mark alone.
 */
export function tickTaskItem(body: string, index: number, checked: boolean): TaskTick {
  const lines = body.split(/(?<=\n)/u);
  // The fence the words are inside, by its run of marks; none outside one.
  let fence: string | undefined;
  let counted = 0;

  for (const [at, line] of lines.entries()) {
    const fenced = FENCE.exec(line)?.[1];

    if (fenced !== undefined) {
      // A fence closes on a run of its own mark at least as long, and opens otherwise.
      if (fence === undefined) fence = fenced;
      else if (fenced[0] === fence[0] && fenced.length >= fence.length) fence = undefined;
      continue;
    }

    const item = fence === undefined ? TASK_ITEM.exec(line) : null;

    if (item === null) continue;

    if (counted < index) {
      counted += 1;
      continue;
    }

    const [, lead = "", mark = " "] = item;

    if ((mark !== " ") === checked) return { kind: TASK_TICK.ALREADY };
    lines[at] = `${lead}${checked ? "x" : " "}${line.slice(lead.length + 1)}`;

    return { kind: TASK_TICK.TICKED, body: lines.join("") };
  }

  return { kind: TASK_TICK.MISSING };
}
