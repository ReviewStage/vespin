// markdown-styles.ts -- a field of Markdown read for drawing as it is written: each span of its words with the looks the page draws it in, its syntax's marks among them, and its pills, the text itself never changed.

import type { Nodes, Parents } from "mdast";
import { markdownTree } from "./markdown-tree.js";
import { PILL_RUN, type Pill, type PillRun, pillRuns } from "./pill-words.js";

/**
 * A look a span of Markdown is drawn with as it is written. `SYNTAX` marks
 * the characters that only spell a look (`**`, a heading's `#`, a link's
 * `](…)`), which a field shows on the line the caret stands on and hides
 * elsewhere, so the words read as the page draws them; a list's mark and a
 * rule are their own looks, since hiding them would leave nothing in their
 * place, and a field draws a bullet or a line there instead.
 */
export const MARK_STYLE = {
  HEADING_1: "heading-1",
  HEADING_2: "heading-2",
  /** A heading of the third level or deeper, which the page draws alike. */
  HEADING_3: "heading-3",
  STRONG: "strong",
  EMPHASIS: "emphasis",
  STRIKE: "strike",
  CODE: "code",
  CODE_BLOCK: "code-block",
  QUOTE: "quote",
  LINK: "link",
  LIST_MARK: "list-mark",
  RULE: "rule",
  SYNTAX: "syntax",
} as const;

export type MarkStyle = (typeof MARK_STYLE)[keyof typeof MARK_STYLE];

/** A span of the Markdown, by its offsets, and the looks it is drawn with, in `MARK_STYLE`'s order; none for plain words. */
export interface StyledSpan {
  readonly start: number;
  readonly end: number;
  readonly styles: readonly MarkStyle[];
}

/** A run a field draws: words with their looks, never empty, or one pill. */
export type StyledRun =
  | {
      readonly kind: typeof PILL_RUN.WORDS;
      readonly text: string;
      readonly styles: readonly MarkStyle[];
    }
  | { readonly kind: typeof PILL_RUN.PILL; readonly pill: Pill };

/** A look laid over a span of the Markdown. */
interface StyledRange {
  readonly start: number;
  readonly end: number;
  readonly style: MarkStyle;
}

/** Each look in its place in `MARK_STYLE`, so a span's looks read in one order however they were laid. */
const STYLE_ORDER: ReadonlyMap<MarkStyle, number> = new Map(
  Object.values(MARK_STYLE).map((style, index) => [style, index]),
);

/** A heading's look by its level. */
const HEADING_STYLE: ReadonlyMap<number, MarkStyle> = new Map([
  [1, MARK_STYLE.HEADING_1],
  [2, MARK_STYLE.HEADING_2],
]);

/** Where a fenced code block's fence stands alone on its line. */
const FENCE = /^[ \t]*(`{3,}|~{3,})/u;

/** A quote's mark at the start of each of its lines. */
const QUOTE_MARK = /^[ \t]*>[ \t]?/gmu;

/** The backticks, and the one space inside them, that open and close an inline code span. */
const CODE_OPEN = /^`+ ?/u;
const CODE_CLOSE = / ?`+$/u;

/** A node's offsets in the Markdown, or none for a node the parse placed nowhere. */
function placeOf(node: Nodes): { readonly start: number; readonly end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;

  if (start === undefined || end === undefined) return undefined;

  return { start, end };
}

/** The offsets a parent's children span, or none where it holds none placed. */
function innerOf(node: Parents): { readonly start: number; readonly end: number } | undefined {
  const first = node.children.at(0);
  const last = node.children.at(-1);
  const start = first === undefined ? undefined : placeOf(first)?.start;
  const end = last === undefined ? undefined : placeOf(last)?.end;

  if (start === undefined || end === undefined) return undefined;

  return { start, end };
}

/** A node that wraps its words in marks on both sides, such as `**…**` or `[…](…)`: its look over the whole, and its marks as syntax. */
function wrapped(node: Parents, style: MarkStyle, laid: StyledRange[]): void {
  const place = placeOf(node);
  const inner = innerOf(node);

  if (place === undefined) return;
  laid.push({ ...place, style });

  if (inner === undefined) return;
  laid.push({ start: place.start, end: inner.start, style: MARK_STYLE.SYNTAX });
  laid.push({ start: inner.end, end: place.end, style: MARK_STYLE.SYNTAX });
}

/** A heading: its look over the whole, its `#`s before the words and any closing `#`s after them as syntax. */
function heading(node: Nodes & { readonly type: "heading" }, laid: StyledRange[]): void {
  const place = placeOf(node);
  const inner = innerOf(node);

  if (place === undefined) return;
  laid.push({ ...place, style: HEADING_STYLE.get(node.depth) ?? MARK_STYLE.HEADING_3 });

  if (inner === undefined) {
    laid.push({ ...place, style: MARK_STYLE.SYNTAX });

    return;
  }

  laid.push({ start: place.start, end: inner.start, style: MARK_STYLE.SYNTAX });
  laid.push({ start: inner.end, end: place.end, style: MARK_STYLE.SYNTAX });
}

/** An inline code span: its look over the whole, its backticks as syntax. */
function inlineCode(markdown: string, node: Nodes, laid: StyledRange[]): void {
  const place = placeOf(node);

  if (place === undefined) return;
  const source = markdown.slice(place.start, place.end);
  const open = CODE_OPEN.exec(source)?.[0].length ?? 0;
  const close = CODE_CLOSE.exec(source)?.[0].length ?? 0;

  laid.push({ ...place, style: MARK_STYLE.CODE });
  laid.push({ start: place.start, end: place.start + open, style: MARK_STYLE.SYNTAX });
  laid.push({ start: place.end - close, end: place.end, style: MARK_STYLE.SYNTAX });
}

/** A code block: its look over the whole, and a fenced block's opening and closing fence lines as syntax. */
function codeBlock(markdown: string, node: Nodes, laid: StyledRange[]): void {
  const place = placeOf(node);

  if (place === undefined) return;
  laid.push({ ...place, style: MARK_STYLE.CODE_BLOCK });
  const source = markdown.slice(place.start, place.end);

  if (!FENCE.test(source)) return;
  const firstBreak = source.indexOf("\n");
  laid.push({
    start: place.start,
    end: firstBreak === -1 ? place.end : place.start + firstBreak,
    style: MARK_STYLE.SYNTAX,
  });

  const lastBreak = source.lastIndexOf("\n");

  if (lastBreak === -1 || !FENCE.test(source.slice(lastBreak + 1))) return;
  laid.push({ start: place.start + lastBreak + 1, end: place.end, style: MARK_STYLE.SYNTAX });
}

/** A quote: its look over the whole, and the `>` opening each of its lines as syntax. */
function quote(markdown: string, node: Nodes, laid: StyledRange[]): void {
  const place = placeOf(node);

  if (place === undefined) return;
  laid.push({ ...place, style: MARK_STYLE.QUOTE });

  for (const mark of markdown.slice(place.start, place.end).matchAll(QUOTE_MARK)) {
    const start = place.start + mark.index;
    laid.push({ start, end: start + mark[0].length, style: MARK_STYLE.SYNTAX });
  }
}

/** A list item: the mark before its words, a task's box included, as the list's mark. */
function listItem(node: Nodes & { readonly type: "listItem" }, laid: StyledRange[]): void {
  const place = placeOf(node);
  const inner = innerOf(node);

  if (place === undefined || inner === undefined) return;
  laid.push({ start: place.start, end: inner.start, style: MARK_STYLE.LIST_MARK });
}

/** A link or a picture: its look over the whole, and where it is written with brackets, the brackets and its address as syntax; a bare address is all words. */
function link(markdown: string, node: Parents, laid: StyledRange[]): void {
  const place = placeOf(node);

  if (place === undefined) return;

  if (markdown[place.start] === "[" || markdown.startsWith("![", place.start)) {
    wrapped(node, MARK_STYLE.LINK, laid);

    return;
  }

  laid.push({ ...place, style: MARK_STYLE.LINK });
}

/** Every look the node and its children lay over the Markdown. */
function lay(markdown: string, node: Nodes, laid: StyledRange[]): void {
  switch (node.type) {
    case "heading":
      heading(node, laid);
      break;
    case "strong":
      wrapped(node, MARK_STYLE.STRONG, laid);
      break;
    case "emphasis":
      wrapped(node, MARK_STYLE.EMPHASIS, laid);
      break;
    case "delete":
      wrapped(node, MARK_STYLE.STRIKE, laid);
      break;
    case "inlineCode":
      inlineCode(markdown, node, laid);
      break;
    case "code":
      codeBlock(markdown, node, laid);
      break;
    case "blockquote":
      quote(markdown, node, laid);
      break;
    case "listItem":
      listItem(node, laid);
      break;
    case "link":
      link(markdown, node, laid);
      break;
    case "thematicBreak": {
      const place = placeOf(node);

      if (place !== undefined) laid.push({ ...place, style: MARK_STYLE.RULE });

      break;
    }

    default:
      break;
  }

  if ("children" in node) for (const child of node.children) lay(markdown, child, laid);
}

/** The looks covering the span from `start` to `end`, each once, in `MARK_STYLE`'s order. */
function stylesOver(
  laid: readonly StyledRange[],
  start: number,
  end: number,
): readonly MarkStyle[] {
  const covering = new Set(
    laid.flatMap((range) => (range.start <= start && range.end >= end ? [range.style] : [])),
  );

  return [...covering].sort(
    (first, second) => (STYLE_ORDER.get(first) ?? 0) - (STYLE_ORDER.get(second) ?? 0),
  );
}

/** Whether two spans' looks are the same. */
function sameStyles(first: readonly MarkStyle[], second: readonly MarkStyle[]): boolean {
  return first.length === second.length && first.every((style, index) => style === second[index]);
}

/**
 * The Markdown cut into spans by the looks the page draws its words in, read
 * through the parse every reader shares (`markdownTree`): the spans follow on
 * from the first character to the last, so their words joined are the
 * Markdown exactly, and side by side spans never share the same looks.
 * Tables, HTML and a link's reference stand as plain words.
 */
export function markdownStyles(markdown: string): readonly StyledSpan[] {
  const laid: StyledRange[] = [];
  lay(markdown, markdownTree(markdown), laid);

  const cuts = [
    ...new Set([0, markdown.length, ...laid.flatMap((range) => [range.start, range.end])]),
  ]
    .filter((cut) => cut >= 0 && cut <= markdown.length)
    .sort((first, second) => first - second);

  const spans: StyledSpan[] = [];

  for (const [index, start] of cuts.slice(0, -1).entries()) {
    const end = cuts[index + 1] ?? start;
    const styles = stylesOver(laid, start, end);
    const last = spans.at(-1);

    if (last !== undefined && sameStyles(last.styles, styles)) {
      spans[spans.length - 1] = { ...last, end };
    } else {
      spans.push({ start, end, styles });
    }
  }

  return spans;
}

/**
 * The Markdown read into the runs a field draws as it is written: each pill
 * (`pillRuns`) as itself, and the words between them cut by their looks
 * (`markdownStyles`). The looks are read over the whole Markdown, pills
 * included, so a mention inside bold words leaves the words after it bold.
 */
export function styledRuns(markdown: string, files: ReadonlySet<string>): readonly StyledRun[] {
  const spans = markdownStyles(markdown);
  const runs: StyledRun[] = [];
  let at = 0;

  for (const run of pillRuns(markdown, files) satisfies readonly PillRun[]) {
    if (run.kind === PILL_RUN.PILL) {
      runs.push(run);
      at += run.pill.markdown.length;
      continue;
    }

    const end = at + run.text.length;

    for (const span of spans) {
      const start = Math.max(span.start, at);
      const stop = Math.min(span.end, end);

      if (start < stop) {
        runs.push({
          kind: PILL_RUN.WORDS,
          text: markdown.slice(start, stop),
          styles: span.styles,
        });
      }
    }

    at = end;
  }

  return runs;
}
