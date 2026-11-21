/**
 * markdown-trees.ts -- each text's drawn tree, read once and kept, so words drawn again (a task opened again, a row drawn again) skip remark and rehype.
 *
 * Streamdown keeps one processor per list of steps, but parses and
 * transforms the words afresh on every draw: every message of a transcript,
 * every section of a description, each time its task is opened. A step
 * attached last keeps the tree the processor has drawn by then, and the next
 * read of the same words through the same processor takes a copy of it in
 * the place of a parse: the parser that step wraps hands the steps before it
 * an empty tree, and the step hands on the copy. What Streamdown runs after
 * the step (its own trailing steps, a place's address rewriter, the tree to
 * JSX) runs on the copy as it ran on the tree, so what is drawn is the same.
 *
 * Note that this holds only for steps whose tree is the words' and the
 * values they were attached with alone: a step reading anything else as it
 * runs keeps the tree it drew then. The one such step, the HTML parser that
 * lands after the first paint, forgets every tree as it lands
 * (`forgetMarkdownTrees`).
 */

import type { ElementContent, Properties, Root, RootContent } from "hast";
import type { StreamdownProps } from "streamdown";

/**
 * The characters of words whose trees are kept, across every processor, the
 * text read longest ago forgotten first. Note that a tree is weighed by its
 * words: measured in V8, positions and all, a kept tree holds about 13 bytes
 * for each character of prose and 30 of turns dense with tables and code
 * spans, so the trees kept stand at 6 to 15 MB at most. That holds a
 * thousand turns of 500 characters, or the descriptions and drawn messages
 * of the last several tasks opened.
 */
const KEPT_CHARACTERS = 500_000;

type MarkdownStep = NonNullable<StreamdownProps["rehypePlugins"]>[number];

/** The processor a step is attached to, whose parser remark's own step set on it, which this step wraps. */
type MarkdownProcessor = ThisParameterType<Extract<MarkdownStep, (...values: never[]) => void>>;

/** One processor's read underway: the tree kept for its words, where one is, and the words. */
interface Reading {
  readonly words: string;
  readonly held: Root | undefined;
}

/** Each text's trees, by the processor that drew each: the text read most recently last. */
const kept = new Map<string, Map<MarkdownProcessor, Root>>();

let keptCharacters = 0;

/** A copy of an element's properties, a list among them its own. */
function copiedProperties(properties: Properties): Properties {
  const copy: Properties = {};

  for (const [name, value] of Object.entries(properties)) {
    copy[name] = Array.isArray(value) ? [...value] : value;
  }

  return copy;
}

/** A copy of a node in an element, every node, property, and list of children its own. */
function copiedContent(node: ElementContent): ElementContent {
  if (node.type !== "element") return { ...node };

  return {
    ...node,
    properties: copiedProperties(node.properties),
    children: node.children.map(copiedContent),
  };
}

/**
 * A copy of a tree, every node, property, and list of children its own, so
 * the steps after this one may change it as they change a tree just drawn.
 * Note that a node's place in the words and its data are shared, because
 * nothing drawing a tree writes them.
 */
function copied(tree: Root): Root {
  return {
    ...tree,
    children: tree.children.map(
      (node): RootContent => (node.type === "doctype" ? { ...node } : copiedContent(node)),
    ),
  };
}

/** The tree `processor` drew for `words`, read as the text read most recently. */
function treeOf(processor: MarkdownProcessor, words: string): Root | undefined {
  const trees = kept.get(words);
  const tree = trees?.get(processor);

  if (trees === undefined || tree === undefined) return undefined;
  kept.delete(words);
  kept.set(words, trees);

  return tree;
}

/** Keeps the tree `processor` drew for `words`, forgetting the texts read longest ago past the budget. */
function keep(processor: MarkdownProcessor, words: string, tree: Root): void {
  const trees = kept.get(words) ?? new Map<MarkdownProcessor, Root>();
  trees.set(processor, tree);
  kept.delete(words);
  kept.set(words, trees);
  keptCharacters += words.length;

  for (const [oldest, gone] of kept) {
    if (keptCharacters <= KEPT_CHARACTERS) break;
    kept.delete(oldest);
    keptCharacters -= oldest.length * gone.size;
  }
}

/**
 * The step that keeps each tree its processor draws and draws a kept one in
 * place of a read, attached after every step of a place's own. Note that the
 * parser hands the read it began to the step, rather than the step looking
 * again, so a tree forgotten between the two cannot leave the words
 * undrawn.
 */
export function keepMarkdownTrees(this: MarkdownProcessor) {
  const parse = this.parser;
  let reading: Reading | undefined;

  if (parse !== undefined) {
    this.parser = (document, file) => {
      const held = treeOf(this, document);
      reading = { words: document, held };

      return held === undefined ? parse(document, file) : { type: "root", children: [] };
    };
  }

  return (tree: Root): Root => {
    const read = reading;
    reading = undefined;

    if (read === undefined) return tree;

    if (read.held !== undefined) return copied(read.held);
    keep(this, read.words, copied(tree));

    return tree;
  };
}

/** Forgets every tree kept, so each words are read afresh: for a step whose drawing has changed under the same name, as the HTML parser's does once it lands. */
export function forgetMarkdownTrees(): void {
  kept.clear();
  keptCharacters = 0;
}
