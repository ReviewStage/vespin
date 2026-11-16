// markdown-plain-text.ts -- Markdown said as plain text, as a place that draws no formatting shows a message: a notification's preview, whose title and body Apple draws as plain words.

import type { List, Nodes, PhrasingContent, RootContent } from "mdast";
import { markdownTree } from "./markdown-tree.js";

/** What leads an unordered list's item, as iOS's own lists mark one. */
const BULLET = "• ";

/** A phrasing node's words: emphasis and strikethrough without their marks, code by its text, a link by its label, a picture by its alt words, and a hard break as a new line. */
function phrasingWords(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      // Note that a soft line break inside a paragraph reads as a space, as Markdown renders one.
      return node.value.replaceAll("\n", " ");
    case "inlineCode":
      return node.value;
    case "break":
      return "\n";
    case "image":
    case "imageReference":
      return node.alt ?? "";
    case "html":
    case "footnoteReference":
      return "";
    default:
      return "children" in node ? node.children.map(phrasingWords).join("") : "";
  }
}

/** A block's words as lines, each trimmed and none empty. */
function wordLines(words: string): readonly string[] {
  return words
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** A list item's lines, its first led by its mark and the rest standing under it. */
function listItemLines(item: Nodes, mark: string): readonly string[] {
  const lines = "children" in item ? item.children.flatMap((child) => blockLines(child)) : [];
  const [first, ...rest] = lines;

  return first === undefined ? [] : [`${mark}${first}`, ...rest];
}

/** A list's items, each led by its bullet, or by its number counted from the list's first. */
function listLines(list: List): readonly string[] {
  const start = list.start ?? 1;

  return list.children.flatMap((item, index) =>
    listItemLines(item, list.ordered === true ? `${start + index}. ` : BULLET),
  );
}

/**
 * A block's lines: a paragraph's or heading's words without their marks, a
 * quote's blocks without its `>`, each list item led by its bullet or its
 * number, and a code block's first line as written. Note that a table, a
 * rule, a definition, and raw HTML say nothing, since none reads as a line of
 * plain words.
 */
function blockLines(node: RootContent | Nodes): readonly string[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return wordLines(node.children.map(phrasingWords).join(""));
    case "blockquote":
      return node.children.flatMap((child) => blockLines(child));
    case "list":
      return listLines(node);
    case "code":
      return wordLines(node.value).slice(0, 1);
    case "table":
    case "thematicBreak":
    case "definition":
    case "footnoteDefinition":
    case "html":
      return [];
    default:
      return "children" in node ? node.children.flatMap((child) => blockLines(child)) : [];
  }
}

/**
 * Markdown said as plain text, one line to each line it draws, read through
 * the parse the panel's other readers share (`markdownTree`). A mention's
 * chip stands as its label, `@` included, as the panel names one in words.
 */
export function markdownPlainText(text: string): string {
  return markdownTree(text)
    .children.flatMap((node) => blockLines(node))
    .join("\n");
}
