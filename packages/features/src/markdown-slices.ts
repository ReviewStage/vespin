/**
 * markdown-slices.ts -- a long document read as its tree a slice at a time: cut only where a new top-level block must begin, each slice parsed on its own with its places counted in the whole, so a page draws as slices land and no one parse holds the thread.
 *
 * A slice begins only at a heading or a rule standing at a line's start
 * after a blank line, outside fenced code, which CommonMark always reads as
 * a new top-level block: no list, quote, paragraph or fence runs across it.
 * A document whose blocks may reach across such a line is never cut: one
 * holding a link or footnote definition (`]:`), which a reference anywhere
 * resolves against, or an HTML block that may span blank lines.
 */

import type { Nodes, Root } from "mdast";
import { markdownTree } from "./markdown-tree.js";

/** About how many characters one slice holds: a parse of tens of milliseconds on a phone. */
const SLICE_MOST = 3000;

/** The byte-order mark a pasted body may open with, which the parse skips and counts no place for. */
const BYTE_ORDER_MARK = "\uFEFF";

/** What, held anywhere in a document, keeps it from being cut: a definition a reference resolves against, and the HTML blocks a blank line does not end. */
const UNCUT_MARKS = ["]:", "<!--", "<pre", "<script", "<style", "<textarea", "<?", "<![CDATA["];

/** A line a top-level block must begin at, where it stands after a blank line: a heading, or a rule. */
const BLOCK_OPENS = /^(#{1,6}(?:[ \t]|$)|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$)/;

/** A fence's opening or closing line: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Where each slice of `text` begins, the first at 0; one slice where it may not be cut or is short. */
export function markdownSliceStarts(text: string): readonly number[] {
  if (text.length <= SLICE_MOST || UNCUT_MARKS.some((mark) => text.includes(mark))) return [0];
  const starts = [0];
  let fence: string | undefined;
  let blank = false;
  let at = 0;

  while (at < text.length) {
    const end = text.indexOf("\n", at);
    const next = end === -1 ? text.length : end + 1;
    const line = text.slice(at, end === -1 ? text.length : end).replace(/\r$/, "");
    const opened = FENCE.exec(line)?.[1];

    if (fence !== undefined) {
      // Note that a fence closes on a run of its own character at least as long as its opening.
      if (opened !== undefined && opened[0] === fence[0] && opened.length >= fence.length) {
        fence = undefined;
      }
    } else if (opened !== undefined) {
      fence = opened;
    } else if (blank && BLOCK_OPENS.test(line) && at - (starts.at(-1) ?? 0) >= SLICE_MOST) {
      starts.push(at);
    }

    blank = fence === undefined && line.trim() === "";
    at = next;
  }

  return starts;
}

/** `node` and every node under it, each place moved by `offset` characters and `lines` lines. */
function shifted(node: Nodes, offset: number, lines: number): void {
  const { position } = node;

  if (position !== undefined) {
    position.start = {
      ...position.start,
      line: position.start.line + lines,
      offset: (position.start.offset ?? 0) + offset,
    };
    position.end = {
      ...position.end,
      line: position.end.line + lines,
      offset: (position.end.offset ?? 0) + offset,
    };
  }

  if ("children" in node) for (const child of node.children) shifted(child, offset, lines);
}

/**
 * The tree of `text`'s slice from `from` to `to`, each node's place counted
 * in the whole of `text` as one parse of it would count it.
 */
export function markdownSliceTree(text: string, from: number, to: number): Root {
  const tree = markdownTree(text.slice(from, to));

  // Note that the whole's parse counts places from after a leading byte-order mark, so a later slice moves by one less.
  if (from > 0) {
    const mark = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0;
    const lines = text.slice(0, from).split("\n").length - 1;

    for (const child of tree.children) shifted(child, from - mark, lines);
  }

  return tree;
}

/** One tree of the whole document from its slices' trees, in order. */
export function joinedMarkdownTree(slices: readonly Root[], text: string): Root {
  const lines = text.split("\n");

  return {
    type: "root",
    children: slices.flatMap((slice) => slice.children),
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: {
        line: lines.length,
        column: (lines.at(-1) ?? "").length + 1,
        offset: text.length - (text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0),
      },
    },
  };
}
