import { linkTarget } from "@repo/features/link-grammar";
import { keptBlankLines } from "@repo/features/reply-quote";
import { withoutTrailingNewlines } from "@repo/features/trailing-newlines";
import { type ReactNode, useCallback } from "react";

/**
 * selection-markdown.tsx -- words selected in drawn Markdown read back as the Markdown they were drawn from: their marks, their links, and each chip as the link it stands for.
 *
 * A selection's own words (`Selection.toString`) are what a reader sees
 * with every mark taken off, and a chip, which draws its link as a glyph and
 * a name no selection takes, reads as nothing at all, so a reply quoting
 * "**The form** ([@form.tsx](…))" came out as "The form ()". Here the drawn
 * tree under the selection is walked instead: bold, italics, a strike, a
 * code span, a link, a line break, paragraphs, lists, a quote, and a fenced
 * block are written as Markdown again, and an element drawn in place of
 * words it was written as, a chip, is read as those words whole
 * (`WrittenAs`), wherever the selection starts or ends inside it. Note that
 * what it was written as is held beside the element rather than in an
 * attribute of it, as a quote's words are in the box, so the recording masks
 * it as text and the words never stand in the page's markup. Words no
 * selection takes (`user-select: none`), and words drawn for a screen
 * reader alone, are left out, as the selection leaves them.
 */

const NEWLINE = "\n";
const BLOCK_GAP = "\n\n";

/** What each element drawn in place of words was written as, read back whole when a selection takes any of it. */
const WRITTEN = new WeakMap<Element, string>();

/** What bold is written with, as a heading is too. */
const STRONG_DELIMITER = "**";

/** The delimiters each inline mark is written with, by its element's tag, as the message box reads them (`@repo/features/composer-markdown`), so a quote laid in draws its marks. */
const MARK_DELIMITER: ReadonlyMap<string, string> = new Map([
  ["STRONG", STRONG_DELIMITER],
  ["B", STRONG_DELIMITER],
  ["EM", "*"],
  ["I", "*"],
  ["DEL", "~~"],
  ["S", "~~"],
]);

/** The elements that stand as blocks of their own: a blank line before and after each. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "FIGURE",
  "DETAILS",
  "SUMMARY",
  "TABLE",
]);

/** The headings, written bold, since a quote holds words rather than a document's outline. */
const HEADING_TAGS: ReadonlySet<string> = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/** The class of words drawn for a screen reader alone (`@repo/ui`'s `ui-visually-hidden`). */
const HEARD_ONLY_CLASS = "ui-visually-hidden";

/**
 * The characters words wearing a mark escape, as the message box writes them
 * (`@repo/features/composer-markdown`), so none closes the mark early or opens
 * another. Note that words wearing none are written as they read, never
 * escaped, as the box writes them, so a quote laid in reads as words typed.
 */
const MARK_SPECIAL = /[\\*~[\]]/gu;

/** The marks the words under an element wear, by its tag: a mark's own delimiters, and a link. */
const MARK_SELECTOR = "strong, b, em, i, del, s, a";

/** What the words being written stand inside: code, written as it is, or a mark, whose delimiters are escaped. */
interface Inside {
  readonly code: boolean;
  readonly marked: boolean;
}

/** Only links that go to the web or to a mail are written as links. */
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/iu;

/** A run of text's words inside `range`. */
function clipped(text: Text, range: Range): string {
  const from = text === range.startContainer ? range.startOffset : 0;
  const to = text === range.endContainer ? range.endOffset : text.length;

  return text.data.slice(from, to);
}

/** Words wrapped in a mark's delimiters, the spaces at their edges kept outside it, as Markdown reads a mark only against words. */
function wrapped(words: string, delimiter: string): string {
  const inner = words.trim();

  if (inner === "") return words;
  const lead = words.slice(0, words.length - words.trimStart().length);
  const trail = words.slice(words.trimEnd().length);

  return `${lead}${delimiter}${inner}${delimiter}${trail}`;
}

/** The longest run of backticks in `words`. */
function longestTicks(words: string): number {
  return Math.max(0, ...[...words.matchAll(/`+/gu)].map((run) => run[0].length));
}

/** Words as a code span, fenced past any backticks they hold. */
function codeSpan(words: string): string {
  if (words.trim() === "") return words;
  const fence = "`".repeat(longestTicks(words) + 1);
  const pad = words.startsWith("`") || words.endsWith("`") ? " " : "";

  return `${fence}${pad}${words}${pad}${fence}`;
}

/** Code as a fenced block, fenced past any backticks it holds. */
function fencedBlock(code: string): string {
  const fence = "`".repeat(Math.max(3, longestTicks(code) + 1));

  return `${BLOCK_GAP}${fence}${NEWLINE}${withoutTrailingNewlines(code)}${NEWLINE}${fence}${BLOCK_GAP}`;
}

/** Words standing as a block of their own. */
function block(words: string): string {
  const inner = words.trim();

  return inner === "" ? "" : `${BLOCK_GAP}${inner}${BLOCK_GAP}`;
}

/** Words as one block's lines, the blank lines inside them taken out, as a list item or a quote holds them, but a fenced block's, which are its code. */
function lines(words: string): string {
  return keptBlankLines(words, 0).trim();
}

/** Whether an element's words are left out: words no selection takes, and words drawn for a screen reader alone. */
function leftOut(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true") return true;

  if (element.classList.contains(HEARD_ONLY_CLASS)) return true;
  const style = getComputedStyle(element);

  // Note that WebKit answers the property by its prefixed name alone.
  return (style.userSelect || style.webkitUserSelect) === "none";
}

/** The boxes that stand on lines of their own, as a code card's rows do. */
const LINE_BOXES: ReadonlySet<string> = new Set(["block", "flex", "grid", "list-item"]);

/**
 * Code's words inside an element, ending its line where the element stands
 * on a line of its own, as a code card's row does, whose lines are boxes
 * with no newline between them; an empty row already holds its newline.
 */
function linedCode(element: Element, words: string): string {
  if (words === "" || words.endsWith(NEWLINE)) return words;

  return LINE_BOXES.has(getComputedStyle(element).display) ? `${words}${NEWLINE}` : words;
}

/** The children of `parent` inside `range`, written. */
function childrenWritten(parent: Node, range: Range, inside: Inside): string {
  let words = "";

  for (const child of parent.childNodes) words += written(child, range, inside);

  return words;
}

/** A list inside `range`, each item a line under its marker, its own lines kept under the marker's width. */
function listWritten(list: Element, range: Range, inside: Inside): string {
  const ordered = list.tagName === "OL";
  let number = Number(list.getAttribute("start") ?? "1") || 1;
  const items: string[] = [];

  for (const item of list.children) {
    if (item.tagName !== "LI") continue;
    const marker = ordered ? `${number}. ` : "- ";
    number += 1;

    if (!range.intersectsNode(item)) continue;
    const words = lines(childrenWritten(item, range, inside));

    if (words !== "")
      items.push(`${marker}${words.replaceAll(NEWLINE, `\n${" ".repeat(marker.length)}`)}`);
  }

  return block(items.join(NEWLINE));
}

/** A link's words as a Markdown link where it goes to the web, else as its words. */
function linkWritten(element: Element, words: string): string {
  const href = element.getAttribute("href");

  if (href === null || !SAFE_LINK.test(href) || words.trim() === "") return words;

  return `[${words}](${linkTarget(href)})`;
}

/** An element inside `range` written as Markdown, its marks around its words. */
function elementWritten(element: Element, range: Range, inside: Inside): string {
  const source = WRITTEN.get(element);

  if (source !== undefined) return source;

  if (leftOut(element)) return "";
  const tag = element.tagName;
  const coded = { ...inside, code: true };

  if (tag === "BR") return NEWLINE;

  if (tag === "PRE") return fencedBlock(childrenWritten(element, range, coded));

  if (tag === "UL" || tag === "OL") return listWritten(element, range, inside);

  if (tag === "CODE") {
    const code = childrenWritten(element, range, coded);

    return inside.code ? code : codeSpan(code);
  }

  // Note that a heading is written bold, so its words escape as a bold run's do.
  const marked = inside.marked || element.matches(MARK_SELECTOR) || HEADING_TAGS.has(tag);
  const words = childrenWritten(element, range, { ...inside, marked });

  if (inside.code) return linedCode(element, words);
  const delimiter = MARK_DELIMITER.get(tag);

  if (delimiter !== undefined) return wrapped(words, delimiter);

  if (tag === "A") return linkWritten(element, words);

  if (HEADING_TAGS.has(tag)) return block(wrapped(words, STRONG_DELIMITER));

  if (tag === "BLOCKQUOTE") {
    return block(
      lines(words)
        .split(NEWLINE)
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join(NEWLINE),
    );
  }

  if (tag === "LI" || tag === "TR") return `${NEWLINE}${words.trim()}${NEWLINE}`;

  if (tag === "TD" || tag === "TH") return `${words.trim()} `;

  return BLOCK_TAGS.has(tag) ? block(words) : words;
}

/** A node inside `range` written as Markdown; nothing for one outside it. */
function written(node: Node, range: Range, inside: Inside): string {
  if (!range.intersectsNode(node)) return "";

  if (node instanceof Text) {
    const words = clipped(node, range);

    return inside.marked && !inside.code ? words.replace(MARK_SPECIAL, "\\$&") : words;
  }

  return node instanceof Element ? elementWritten(node, range, inside) : "";
}

/**
 * Words written inside the inline elements around them that the selection
 * lies wholly in, so words picked out of a bold run or a link's label keep
 * their mark; the whole of what an element was written as, a chip's link,
 * where the selection lies inside one.
 */
function insideAncestors(words: string, from: Element): string {
  let kept = words;
  let start: Element | null = from;

  // Note that a chip's name lies under its press and its label's own boxes, so its whole run of ancestors is asked first, and the marks around the chip go on from it.
  for (let at: Element | null = from; at !== null; at = at.parentElement) {
    const source = WRITTEN.get(at);

    if (source === undefined) continue;
    kept = source;
    start = at.parentElement;
    break;
  }

  for (let at: Element | null = start; at !== null; at = at.parentElement) {
    const tag = at.tagName;
    const delimiter = MARK_DELIMITER.get(tag);

    if (delimiter !== undefined) kept = wrapped(kept, delimiter);
    else if (tag === "CODE") kept = at.parentElement?.tagName === "PRE" ? kept : codeSpan(kept);
    else if (tag === "PRE") return fencedBlock(kept);
    else if (tag === "A") kept = linkWritten(at, kept);
    else if (tag !== "SPAN" && tag !== "INS" && tag !== "MARK") return kept;
  }

  return kept;
}

/** What `node` stands inside: code, whose words are written as they are, or a mark, whose delimiters its words escape. */
function insideOf(node: Node): Inside {
  const element = node instanceof Element ? node : node.parentElement;

  return {
    code: (element?.closest("code, pre") ?? null) !== null,
    marked: (element?.closest(MARK_SELECTOR) ?? null) !== null,
  };
}

/**
 * The words `range` selects, written as the Markdown they were drawn from:
 * blocks a blank line apart, marks and links around their words, and each
 * chip as its link.
 */
export function selectedMarkdown(range: Range): string {
  const common = range.commonAncestorContainer;
  const words = keptBlankLines(written(common, range, insideOf(common)), 1);

  // Note that the walk up starts over the common node, which wrote its own marks already.
  return (
    common.parentElement === null ? words : insideAncestors(words, common.parentElement)
  ).trim();
}

/**
 * Draws what it holds, a chip, as itself, and has a selection taking any of
 * it read it back as `markdown`, the words it was written as. Note that its
 * box draws none of its own, so what it holds stands among the words as it
 * did without it.
 */
export function WrittenAs({
  markdown,
  children,
}: {
  markdown: string;
  children: ReactNode;
}): React.JSX.Element {
  const hold = useCallback(
    (element: HTMLSpanElement | null) => {
      if (element !== null) WRITTEN.set(element, markdown);
    },
    [markdown],
  );

  return (
    <span ref={hold} className="contents">
      {children}
    </span>
  );
}
