import { type MarkdownToken, Node } from "@tiptap/core";

/**
 * soft-break.ts -- a line break inside a paragraph's words as its source wrote it (`one\ntwo`), drawn as the space the read view draws, and written back as the line break it was.
 *
 * Markdown reads a line break inside a paragraph as a space, and the read
 * view draws one. TipTap's Markdown keeps it as a newline in the words, which
 * the editor, keeping its words' whitespace, drew as a new line: opening the
 * text broke a line the read view ran on and moved every block under it,
 * and a word typed beside it turned it into a hard break, as the browser's
 * words were read back (two spaces at the line's end, which GitHub draws as
 * a break). This node stands in its place as one space the caret steps
 * over, and is written back as the line break it was, so an edited
 * paragraph keeps its source's lines. A hard break (two spaces, or `\`,
 * before the line break) is still `marked`'s own: the words stop before its
 * spaces, and only a break with at most one space before it is taken here.
 */

/** The token and node a soft break is. */
const SOFT_BREAK = "softBreak";

/** Where a line break and the spaces or `\` before it start in the words. */
const BREAK_START = /[ \\]*\n/u;

/** A soft break as its source writes it: at most one space, the line break, and the next line's indent, which Markdown drops. */
const SOFT_BREAK_SOURCE = /^ ?\n[^\S\n]*/u;

export const SoftBreak = Node.create({
  name: SOFT_BREAK,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  parseHTML: () => [{ tag: "span[data-soft-break]" }],
  renderHTML: () => ["span", { "data-soft-break": "" }, " "],
  renderText: () => " ",
  markdownTokenName: SOFT_BREAK,
  markdownTokenizer: {
    name: SOFT_BREAK,
    level: "inline",
    start: (src: string) => src.search(BREAK_START),
    tokenize: (src: string): MarkdownToken | undefined => {
      const raw = SOFT_BREAK_SOURCE.exec(src)?.[0];

      return raw === undefined ? undefined : { type: SOFT_BREAK, raw };
    },
  },
  parseMarkdown: () => ({ type: SOFT_BREAK }),
  renderMarkdown: () => "\n",
});
