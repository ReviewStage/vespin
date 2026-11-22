// document-blocks.ts -- a Markdown document as the blocks a rich editor draws without syntax, each keeping its exact source, and the document written back from them with only the blocks that changed printed again.

import type { Nodes, PhrasingContent, RootContent } from "mdast";
import { keptMarkdownTree } from "./markdown-tree.js";
import { PILL_RUN, type Pill, pillRuns } from "./pill-words.js";

/**
 * A document edited as rich text is cut into its top-level blocks, read by
 * the parse every reader shares (`markdownTree`), each keeping the exact
 * source it was written as, the blank lines after it included, so the
 * sources join back into the document byte for byte. A block the editor
 * draws (a paragraph, a heading, a flat list, a quote of paragraphs, a code
 * block) is read into lines of styled runs with no syntax; a block it cannot
 * draw faithfully (a table, a Mermaid fence, HTML, a footnote, a nested
 * list) stands locked, as a card, and is written back as it came. Written
 * back, a block whose content is the content it was read as is its source,
 * and only a block that changed, or a new one, is printed again, as the
 * desktop's editor keeps an untouched block's source
 * (`@repo/panel`'s `document-source.ts`), so an agent's tables and diagrams
 * survive a one-line edit, and the description's history shows one change.
 */

/** What a block is. */
export const BLOCK_KIND = {
  PARAGRAPH: "paragraph",
  HEADING: "heading",
  BULLET_LIST: "bullet-list",
  ORDERED_LIST: "ordered-list",
  TASK_LIST: "task-list",
  QUOTE: "quote",
  CODE: "code",
  RULE: "rule",
  LOCKED: "locked",
} as const;

export type BlockKind = (typeof BLOCK_KIND)[keyof typeof BLOCK_KIND];

/** What a locked block is, which its card names. */
export const LOCKED_KIND = {
  TABLE: "table",
  DIAGRAM: "diagram",
  HTML: "html",
  OTHER: "other",
} as const;

export type LockedKind = (typeof LOCKED_KIND)[keyof typeof LOCKED_KIND];

/** A look a run of words is drawn with, the panel's Markdown storing each; underline is none, since Markdown has no way to store it. */
export const INLINE_MARK = {
  STRONG: "strong",
  EMPHASIS: "emphasis",
  STRIKE: "strike",
  CODE: "code",
} as const;

export type InlineMark = (typeof INLINE_MARK)[keyof typeof INLINE_MARK];

/** What a run of a line is. */
export const INLINE_RUN = {
  WORDS: "words",
  PILL: "pill",
  /** Something written that the line draws but the editor does not change, such as a picture, kept as its source. */
  RAW: "raw",
} as const;

/** A run of a line: words with their looks and the address they link to, a pill, or a piece kept as its source. */
export type InlineRun =
  | {
      readonly kind: typeof INLINE_RUN.WORDS;
      readonly text: string;
      readonly marks: readonly InlineMark[];
      readonly link?: string | undefined;
    }
  | { readonly kind: typeof INLINE_RUN.PILL; readonly pill: Pill }
  | { readonly kind: typeof INLINE_RUN.RAW; readonly source: string };

/** The list a nested list's line stands in, which may differ from its parent's, as bullets under a numbered item do. */
export const LIST_MARKER = {
  BULLET: "bullet",
  ORDERED: "ordered",
  TASK: "task",
} as const;

export type ListMarker = (typeof LIST_MARKER)[keyof typeof LIST_MARKER];

/** A line of a block: a paragraph, a heading's words, a list's item with its box where it is a task, or a code block's text as one run. */
export interface BlockLine {
  readonly runs: readonly InlineRun[];
  readonly checked?: boolean | undefined;
  /** How deep a list's item stands under the block's own items, which stand at none. */
  readonly depth?: number | undefined;
  /** The list a nested item stands in; none at the block's own depth, where its kind says. */
  readonly marker?: ListMarker | undefined;
}

/** A block's content, what the editor draws and changes. */
export type BlockContent =
  | {
      readonly kind:
        | typeof BLOCK_KIND.PARAGRAPH
        | typeof BLOCK_KIND.BULLET_LIST
        | typeof BLOCK_KIND.TASK_LIST
        | typeof BLOCK_KIND.QUOTE
        | typeof BLOCK_KIND.RULE;
      readonly lines: readonly BlockLine[];
    }
  | {
      readonly kind: typeof BLOCK_KIND.HEADING;
      readonly level: number;
      readonly lines: readonly BlockLine[];
    }
  | {
      readonly kind: typeof BLOCK_KIND.ORDERED_LIST;
      readonly start: number;
      readonly lines: readonly BlockLine[];
    }
  | {
      readonly kind: typeof BLOCK_KIND.CODE;
      readonly language: string;
      readonly lines: readonly BlockLine[];
    }
  | {
      readonly kind: typeof BLOCK_KIND.LOCKED;
      readonly locked: LockedKind;
      readonly lines: readonly BlockLine[];
    };

/** A block as read: its content, and the exact source it was written as, the blank lines after it included. */
export type DocumentBlock = BlockContent & { readonly source: string };

/** A block as the editor hands it back: its content, and which block of the document as read it is, none for a block the editor made. */
export type EditedBlock = BlockContent & { readonly from?: number | undefined };

/** What separates a printed block from the next. */
const BLOCK_GAP = "\n\n";

/** The language a fenced block is drawn as a diagram in. */
const DIAGRAM_LANGUAGE = "mermaid";

/** A line ending in CR LF, which a document written on github.com keeps. */
const CRLF = "\r\n";

/** Characters a printed run's words escape so they read back as words. */
const ESCAPED = /[\\`*[\]~<]/gu;

/** An underscore at a word's edge, which would open or close emphasis; one inside a word, as in `snake_case`, stays as it is. */
const EDGE_UNDERSCORE = /(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu;

/** What at a line's start would read as a block's mark: a heading's `#`, a quote's `>`, a list's mark, or a rule. */
const LINE_START_MARK = /^(#{1,6}\s|>|[-+]\s|\d{1,9}[.)]\s|-{3,}\s*$)/u;

/** The order marks wrap a run in, outermost first, so runs sharing a mark are wrapped once. */
const MARK_ORDER: readonly InlineMark[] = [
  INLINE_MARK.STRIKE,
  INLINE_MARK.STRONG,
  INLINE_MARK.EMPHASIS,
  INLINE_MARK.CODE,
];

/** Each mark as it is written around its words. */
const MARK_FENCE: Readonly<Record<Exclude<InlineMark, typeof INLINE_MARK.CODE>, string>> = {
  [INLINE_MARK.STRIKE]: "~~",
  [INLINE_MARK.STRONG]: "**",
  [INLINE_MARK.EMPHASIS]: "_",
};

/** A node's offsets in the Markdown. */
function placeOf(node: Nodes): { readonly start: number; readonly end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;

  if (start === undefined || end === undefined) return undefined;

  return { start, end };
}

/** The runs a line's phrasing reads as, or none where it holds something the editor cannot keep, which leaves its block locked. */
function phrasingRuns(
  markdown: string,
  nodes: readonly PhrasingContent[],
  marks: readonly InlineMark[],
  link: string | undefined,
  files: ReadonlySet<string>,
): InlineRun[] | undefined {
  const runs: InlineRun[] = [];

  for (const node of nodes) {
    const read = phrasingRun(markdown, node, marks, link, files);

    if (read === undefined) return undefined;
    runs.push(...read);
  }

  return runs;
}

/** The runs one piece of phrasing reads as, or none where the editor cannot keep it. */
function phrasingRun(
  markdown: string,
  node: PhrasingContent,
  marks: readonly InlineMark[],
  link: string | undefined,
  files: ReadonlySet<string>,
): readonly InlineRun[] | undefined {
  const words = (text: string, more: readonly InlineMark[] = []): InlineRun => {
    const run = { kind: INLINE_RUN.WORDS, text, marks: [...marks, ...more] } as const;

    if (link === undefined) return run;

    return { ...run, link };
  };

  switch (node.type) {
    case "text":
      return wordsWithPills(markdown, node, marks, link, files) ?? [words(node.value)];
    case "inlineCode":
      return [words(node.value, [INLINE_MARK.CODE])];
    case "strong":
      return phrasingRuns(markdown, node.children, [...marks, INLINE_MARK.STRONG], link, files);
    case "emphasis":
      return phrasingRuns(markdown, node.children, [...marks, INLINE_MARK.EMPHASIS], link, files);
    case "delete":
      return phrasingRuns(markdown, node.children, [...marks, INLINE_MARK.STRIKE], link, files);
    case "link":
      return linkRuns(markdown, node, marks, files);
    case "image":
    case "break": {
      const place = placeOf(node);

      return place === undefined
        ? undefined
        : [{ kind: INLINE_RUN.RAW, source: markdown.slice(place.start, place.end) }];
    }

    default:
      return undefined;
  }
}

/** A text node holding a held file's marker, read as words and the marker's pill; none where it holds none. */
function wordsWithPills(
  markdown: string,
  node: PhrasingContent,
  marks: readonly InlineMark[],
  link: string | undefined,
  files: ReadonlySet<string>,
): readonly InlineRun[] | undefined {
  const place = placeOf(node);

  if (place === undefined || files.size === 0 || link !== undefined) return undefined;
  const read = pillRuns(markdown.slice(place.start, place.end), files);

  if (!read.some((run) => run.kind === PILL_RUN.PILL)) return undefined;

  return read.map((run) =>
    run.kind === PILL_RUN.PILL
      ? { kind: INLINE_RUN.PILL, pill: run.pill }
      : { kind: INLINE_RUN.WORDS, text: run.text, marks: [...marks] },
  );
}

/** A link: a mention as its pill, any other link as its words carrying its address; a link with a title, which the editor cannot keep, none. */
function linkRuns(
  markdown: string,
  node: PhrasingContent & { readonly type: "link" },
  marks: readonly InlineMark[],
  files: ReadonlySet<string>,
): readonly InlineRun[] | undefined {
  const place = placeOf(node);

  if (place === undefined || (node.title ?? null) !== null) return undefined;
  const read = pillRuns(markdown.slice(place.start, place.end), files);
  const [only] = read;

  if (read.length === 1 && only?.kind === PILL_RUN.PILL) {
    return [{ kind: INLINE_RUN.PILL, pill: only.pill }];
  }

  return phrasingRuns(markdown, node.children, marks, node.url, files);
}

/** A block's lines read from paragraphs, or none where one holds something the editor cannot keep. */
function paragraphLines(
  markdown: string,
  nodes: readonly RootContent[],
  files: ReadonlySet<string>,
): BlockLine[] | undefined {
  const lines: BlockLine[] = [];

  for (const node of nodes) {
    if (node.type !== "paragraph") return undefined;
    const runs = phrasingRuns(markdown, node.children, [], undefined, files);

    if (runs === undefined) return undefined;
    lines.push({ runs });
  }

  return lines;
}

/** A locked block: what its card names, and its source as one run. */
function locked(source: string, kind: LockedKind): BlockContent {
  return {
    kind: BLOCK_KIND.LOCKED,
    locked: kind,
    lines: [{ runs: [{ kind: INLINE_RUN.RAW, source }] }],
  };
}

/** A task item's box with no words after it, which GFM reads as the words "[ ]", as an empty task's printing writes it. */
const EMPTY_TASK = /^\[([ xX])\]$/u;

/** Whether an item is a task, and checked: GFM's reading, else an item holding only an empty task's box. */
function itemChecked(
  markdown: string,
  item: RootContent & { readonly type: "listItem" },
): boolean | undefined {
  if (item.checked !== null && item.checked !== undefined) return item.checked;
  const [paragraph, ...rest] = item.children;
  const start = paragraph?.position?.start.offset;
  const end = paragraph?.position?.end.offset;

  if (
    rest.length > 0 ||
    paragraph?.type !== "paragraph" ||
    start === undefined ||
    end === undefined
  )
    return undefined;
  const box = EMPTY_TASK.exec(markdown.slice(start, end).trim());

  return box === null ? undefined : box[1] !== " ";
}

/** A list's items as lines at `depth`, each followed by the lines of the lists nested in it, or none where an item holds more than a paragraph and lists, such as a code block. */
function listLines(
  markdown: string,
  node: RootContent & { readonly type: "list" },
  files: ReadonlySet<string>,
  depth: number,
): BlockLine[] | undefined {
  const lines: BlockLine[] = [];
  const checks = node.children.map((item) => itemChecked(markdown, item));
  const task = checks.some((checked) => checked !== undefined);

  const marker =
    node.ordered === true ? LIST_MARKER.ORDERED : task ? LIST_MARKER.TASK : LIST_MARKER.BULLET;

  for (const [index, item] of node.children.entries()) {
    const checked = checks[index];
    const [paragraph, ...nested] = item.children;
    const lists = nested.flatMap((child) => (child.type === "list" ? [child] : []));

    if (lists.length < nested.length || paragraph?.type === "list") return undefined;

    // Note that an empty task's box is its item's whole paragraph, so the line holds no words.
    const empty = (item.checked === null || item.checked === undefined) && checked !== undefined;

    const [read] =
      paragraph === undefined || empty
        ? [{ runs: [] }]
        : (paragraphLines(markdown, [paragraph], files) ?? []);

    if (read === undefined) return undefined;
    const boxed = task ? { ...read, checked: checked === true } : read;
    lines.push(depth === 0 ? boxed : { ...boxed, depth, marker });

    for (const list of lists) {
      const inner = listLines(markdown, list, files, depth + 1);

      if (inner === undefined) return undefined;
      lines.push(...inner);
    }
  }

  return lines;
}

/** A list read as its items and the items nested under them, or none where an item holds more than a paragraph and lists. */
function listContent(
  markdown: string,
  node: RootContent & { readonly type: "list" },
  files: ReadonlySet<string>,
): BlockContent | undefined {
  const lines = listLines(markdown, node, files, 0);

  if (lines === undefined) return undefined;

  if (node.ordered === true)
    return { kind: BLOCK_KIND.ORDERED_LIST, start: node.start ?? 1, lines };

  const task = node.children.some((item) => itemChecked(markdown, item) !== undefined);

  return { kind: task ? BLOCK_KIND.TASK_LIST : BLOCK_KIND.BULLET_LIST, lines };
}

/** What a top-level node reads as: the content the editor draws, or a locked block. */
function blockContent(
  markdown: string,
  node: RootContent,
  source: string,
  files: ReadonlySet<string>,
): BlockContent {
  const lines = (nodes: readonly RootContent[]) => paragraphLines(markdown, nodes, files);

  switch (node.type) {
    case "paragraph": {
      const read = lines([node]);

      return read === undefined
        ? locked(source, LOCKED_KIND.OTHER)
        : { kind: BLOCK_KIND.PARAGRAPH, lines: read };
    }

    case "heading": {
      const runs = phrasingRuns(markdown, node.children, [], undefined, files);

      return runs === undefined
        ? locked(source, LOCKED_KIND.OTHER)
        : { kind: BLOCK_KIND.HEADING, level: node.depth, lines: [{ runs }] };
    }

    case "list":
      return listContent(markdown, node, files) ?? locked(source, LOCKED_KIND.OTHER);
    case "blockquote": {
      const read = lines(node.children);
      // Note that a GitHub alert (`> [!NOTE]`) stays locked, since its marker is no words of its own.
      const alert = /^\s*>\s*\[!\w+\]/u.test(source);

      return read === undefined || alert
        ? locked(source, LOCKED_KIND.OTHER)
        : { kind: BLOCK_KIND.QUOTE, lines: read };
    }

    case "code":
      return node.lang === DIAGRAM_LANGUAGE
        ? locked(source, LOCKED_KIND.DIAGRAM)
        : {
            kind: BLOCK_KIND.CODE,
            language: node.lang ?? "",
            lines: [{ runs: [{ kind: INLINE_RUN.WORDS, text: node.value, marks: [] }] }],
          };
    case "thematicBreak":
      return { kind: BLOCK_KIND.RULE, lines: [] };
    case "table":
      return locked(source, LOCKED_KIND.TABLE);
    case "html":
      return locked(source, LOCKED_KIND.HTML);
    default:
      return locked(source, LOCKED_KIND.OTHER);
  }
}

/**
 * The document read as its blocks, each keeping its exact source: from where
 * it starts to where the next starts, so the blank lines after it are its
 * own, the first holding what stands before it and the last running to the
 * document's end. Their sources joined are the document exactly. `files`
 * names the held files whose markers stand as pills.
 */
export function documentBlocks(
  markdown: string,
  files: ReadonlySet<string> = new Set(),
): readonly DocumentBlock[] {
  const nodes = keptMarkdownTree(markdown).children.flatMap((node) => {
    const place = placeOf(node);

    return place === undefined ? [] : [{ node, ...place }];
  });

  return nodes.map(({ node }, index) => {
    const start = index === 0 ? 0 : (nodes[index]?.start ?? 0);
    const end = nodes[index + 1]?.start ?? markdown.length;
    const source = markdown.slice(start, end);

    return { ...blockContent(markdown, node, source.trimEnd(), files), source };
  });
}

/** A block's content as words to compare, its source and where it came from aside. */
/** Each block's content key once worked out, so a document written again and again, as each key typed writes it, works out its read blocks' keys once. */
const CONTENT_KEYS = new WeakMap<DocumentBlock | EditedBlock, string>();

function contentKey(block: DocumentBlock | EditedBlock): string {
  const kept = CONTENT_KEYS.get(block);

  if (kept !== undefined) return kept;
  const key = JSON.stringify({ ...block, source: undefined, from: undefined });
  CONTENT_KEYS.set(block, key);

  return key;
}

/** Words escaped so they read back as words: a mark's character, and at a line's start what would read as a block's mark. */
function escaped(text: string): string {
  return text
    .replace(ESCAPED, (character) => `\\${character}`)
    .replace(EDGE_UNDERSCORE, "\\_")
    .split("\n")
    .map((line) => (LINE_START_MARK.test(line) ? `\\${line}` : line))
    .join("\n");
}

/** Inline code's words between enough backticks to hold any run of them inside, padded where they start or end with one. */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";

  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A run's words printed with no marks, which an outer group wraps. */
function bareRun(run: InlineRun, code: boolean): string {
  if (run.kind === INLINE_RUN.PILL) return run.pill.markdown;

  if (run.kind === INLINE_RUN.RAW) return run.source;

  return code ? codeSpan(run.text) : escaped(run.text);
}

/** Runs printed with the marks from `depth` in `MARK_ORDER` on, each mark wrapping the longest stretch of runs that share it, so `**a _b_**` prints as one bold. */
function markedRuns(runs: readonly InlineRun[], depth: number): string {
  const mark = MARK_ORDER[depth];

  if (mark === undefined) {
    return runs
      .map((run) =>
        bareRun(run, run.kind === INLINE_RUN.WORDS && run.marks.includes(INLINE_MARK.CODE)),
      )
      .join("");
  }

  const has = (run: InlineRun) => run.kind === INLINE_RUN.WORDS && run.marks.includes(mark);
  const groups: InlineRun[][] = [];

  for (const run of runs) {
    const last = groups.at(-1);
    const first = last?.[0];

    if (last !== undefined && first !== undefined && has(first) === has(run)) last.push(run);
    else groups.push([run]);
  }

  return groups
    .map((group) => {
      const inner = markedRuns(group, depth + 1);
      const first = group[0];

      if (first === undefined || !has(first) || mark === INLINE_MARK.CODE) return inner;
      // Note that spaces at a stretch's edges stand outside its fences, since `**a **` reads back as no mark at all.
      const core = inner.trim();

      if (core === "") return inner;
      const lead = inner.slice(0, inner.length - inner.trimStart().length);
      const trail = inner.slice(inner.trimEnd().length);

      return `${lead}${MARK_FENCE[mark]}${core}${MARK_FENCE[mark]}${trail}`;
    })
    .join("");
}

/** A line's runs printed as Markdown: each link wrapping the runs that share its address, then the marks inside. */
function printRuns(runs: readonly InlineRun[]): string {
  const groups: InlineRun[][] = [];
  const linkOf = (run: InlineRun) => (run.kind === INLINE_RUN.WORDS ? run.link : undefined);

  for (const run of runs) {
    const last = groups.at(-1);
    const first = last?.[0];

    if (last !== undefined && first !== undefined && linkOf(first) === linkOf(run)) last.push(run);
    else groups.push([run]);
  }

  return groups
    .map((group) => {
      const first = group[0];
      const link = first === undefined ? undefined : linkOf(first);
      const inner = markedRuns(group, 0);

      return link === undefined ? inner : `[${inner}](${link})`;
    })
    .join("");
}

/** The list a list block's own items stand in. */
function topMarker(kind: BlockContent["kind"]): ListMarker {
  if (kind === BLOCK_KIND.ORDERED_LIST) return LIST_MARKER.ORDERED;

  return kind === BLOCK_KIND.TASK_LIST ? LIST_MARKER.TASK : LIST_MARKER.BULLET;
}

/**
 * A list block printed as its items, each nested item indented to where its
 * parent's words start (two spaces under `- `, three under `1. `), as
 * CommonMark reads a nested list. A run of numbered items counts from the
 * block's start at its own depth and from one beneath, starting again where
 * a run of another kind or a shallower item stood between; an item is never
 * deeper than one under the item before it.
 */
function printList(block: BlockContent, printed: readonly string[]): string {
  const top = topMarker(block.kind);
  const first = block.kind === BLOCK_KIND.ORDERED_LIST ? block.start : 1;
  // The column each depth's words start at, the list it stands in, and the number its next item takes.
  const columns: number[] = [];
  const markers: ListMarker[] = [];
  const numbers: number[] = [];

  return block.lines
    .map((line, index) => {
      const depth = Math.min(line.depth ?? 0, columns.length);
      const marker = depth === 0 ? top : (line.marker ?? LIST_MARKER.BULLET);
      const lead = depth === 0 ? 0 : (columns[depth - 1] ?? 0);
      const number = markers[depth] === marker ? (numbers[depth] ?? 1) : depth === 0 ? first : 1;

      const mark =
        marker === LIST_MARKER.ORDERED
          ? `${number}. `
          : marker === LIST_MARKER.TASK
            ? `- [${line.checked === true ? "x" : " "}] `
            : "- ";

      // Note that a task's words start after its `- `, its box being the start of its paragraph, so what nests under it stands two spaces in.
      columns.length = depth;
      markers.length = depth;
      numbers.length = depth;
      columns.push(lead + (marker === LIST_MARKER.TASK ? 2 : mark.length));
      markers.push(marker);
      numbers.push(number + 1);

      return `${" ".repeat(lead)}${mark}${printed[index] ?? ""}`;
    })
    .join("\n");
}

/** A code block printed between fences longer than any run of backticks in it. */
function printCode(language: string, text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);

  return `${fence}${language}\n${text}\n${fence}`;
}

/** A block's content printed as Markdown, in the panel's style, with no blank lines after it. */
export function printBlock(block: BlockContent): string {
  const lines = block.lines.map((line) => printRuns(line.runs));

  switch (block.kind) {
    case BLOCK_KIND.PARAGRAPH:
      return lines.join(BLOCK_GAP);
    case BLOCK_KIND.HEADING:
      return `${"#".repeat(Math.min(Math.max(block.level, 1), 6))} ${lines.join(" ")}`;
    case BLOCK_KIND.BULLET_LIST:
    case BLOCK_KIND.ORDERED_LIST:
    case BLOCK_KIND.TASK_LIST:
      return printList(block, lines);
    case BLOCK_KIND.QUOTE:
      return lines
        .map((line) =>
          line
            .split("\n")
            .map((part) => `> ${part}`)
            .join("\n"),
        )
        .join("\n>\n");
    case BLOCK_KIND.CODE:
      return printCode(
        block.language,
        block.lines
          .flatMap((line) =>
            line.runs.map((run) => (run.kind === INLINE_RUN.WORDS ? run.text : "")),
          )
          .join(""),
      );
    case BLOCK_KIND.RULE:
      return "---";
    case BLOCK_KIND.LOCKED:
      return block.lines.flatMap((line) => line.runs.map((run) => bareRun(run, false))).join("");
  }
}

/**
 * The document written back from the blocks the editor hands: a block whose
 * content is still what it was read as is its exact source, and a changed or
 * new one is printed (`printBlock`) with a blank line after it, the last
 * keeping the document's own ending. A document written with CR LF line
 * endings has its printed blocks written with them too. A caller writing the
 * same document again and again, as an editor does on each key, hands the
 * blocks it already read (`read`), so the document is not parsed again.
 */
export function writtenDocument(
  markdown: string,
  edited: readonly EditedBlock[],
  files: ReadonlySet<string> = new Set(),
  read: readonly DocumentBlock[] = documentBlocks(markdown, files),
): string {
  const ending = markdown.includes(CRLF) ? CRLF : "\n";
  // Note that the blank lines closing the document are found by trimming rather than by a pattern, which would try every run of spaces in a long document again from each of its characters.
  const close = markdown.slice(markdown.trimEnd().length);

  return edited
    .map((block, index) => {
      const original = block.from === undefined ? undefined : read[block.from];
      const last = index === edited.length - 1;

      // Note that an untouched block is its exact source where it stands as it stood, and else only its blank lines after it change, so a block added after the document's last, or a last one deleted, still leaves one blank line between blocks.
      if (original !== undefined && contentKey(original) === contentKey(block)) {
        const ended = block.from === read.length - 1;

        if (ended === last) return original.source;

        return original.source.trimEnd() + (last ? close : BLOCK_GAP.replaceAll("\n", ending));
      }

      const printed = printBlock(block) + (last ? close.replaceAll(CRLF, "\n") : BLOCK_GAP);

      return ending === CRLF ? printed.replaceAll("\n", CRLF) : printed;
    })
    .join("");
}
