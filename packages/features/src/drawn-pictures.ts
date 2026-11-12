/**
 * drawn-pictures.ts -- the address of every picture Markdown draws, as its parse reads it: an inline picture's, a reference-style one's through its definition, and one written between angle brackets, each once, in order; an address standing as a link or in code draws none.
 */

import type { Definition, Nodes } from "mdast";
import { markdownTree } from "./markdown-tree.js";

/** The definitions a text's reference-style links and pictures name, by their normalized label, the first of each as CommonMark reads it. */
function definitionsOf(node: Nodes, found: Map<string, Definition>): void {
  if (node.type === "definition" && !found.has(node.identifier)) found.set(node.identifier, node);

  if ("children" in node) for (const child of node.children) definitionsOf(child, found);
}

/** Each picture's address under `node`, in order. */
function picturesOf(node: Nodes, definitions: ReadonlyMap<string, Definition>): readonly string[] {
  if (node.type === "image") return [node.url];

  if (node.type === "imageReference") {
    const url = definitions.get(node.identifier)?.url;

    return url === undefined ? [] : [url];
  }

  return "children" in node
    ? node.children.flatMap((child: Nodes) => picturesOf(child, definitions))
    : [];
}

/** The address of every picture `text` draws, each once, in the order first drawn. */
export function drawnPictureAddresses(text: string): readonly string[] {
  const tree = markdownTree(text);
  const definitions = new Map<string, Definition>();
  definitionsOf(tree, definitions);

  return [...new Set(picturesOf(tree, definitions))];
}
