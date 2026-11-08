// markdown-model.ts -- a message's Markdown read into what the iOS app draws: blocks, and runs of words, links, and chips, each link read as the panel reads it.

import { dateChipText } from "@repo/features/date-mention";
import { type LinkPlace, readLink } from "@repo/features/link-grammar";
import { markdownTree } from "@repo/features/markdown-tree";
import { isBareLink, linkMention, MENTION_KIND, mentionName } from "@repo/features/mention-link";
import { placeChipLook } from "@repo/features/place-chip-model";
import {
  type ThingKind,
  thingOfMention,
  thingOfPlace,
  thingWordHeard,
} from "@repo/features/thing-kind";
import type {
  Definition,
  ImageReference,
  LinkReference,
  List,
  Nodes,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";

/**
 * The tree `@repo/features/markdown-tree` reads is the panel's own, so the
 * words parse here as they do on the Mac; this module only says how each
 * node is drawn on the iPhone, which has no DOM to hand it to. A block
 * stands on its own lines; a paragraph's pictures each stand as a block of
 * their own between its words, since a picture opens full screen and a run
 * of words cannot hold one. A link is read as the panel's chip reads it
 * (`mention-chip.tsx`'s `linkChip`): a mention's target as its chip
 * (`linkMention`), a link to a place in the app as that place's chip
 * (`readLink`), and any other link as underlined words. Raw HTML is drawn as
 * the words it was written with, as a note draws it.
 */

/** What a block is. */
export const MARKDOWN_BLOCK = {
  HEADING: "heading",
  PARAGRAPH: "paragraph",
  LIST: "list",
  QUOTE: "quote",
  TABLE: "table",
  CODE: "code",
  RULE: "rule",
  PICTURE: "picture",
} as const;

/** What a run inside a block is. */
export const MARKDOWN_RUN = {
  WORDS: "words",
  CODE: "code",
  LINK: "link",
  CHIP: "chip",
  BREAK: "break",
} as const;

/** Where a pressed link or chip goes. */
export const LINK_TARGET = {
  /** A place in the app, which the app routes to. */
  PLACE: "place",
  /** A page on the web, which Safari opens. */
  WEB: "web",
  /** Nowhere: a date, an MCP server, a link of no scheme the app opens. */
  NONE: "none",
} as const;

/** How a table's column lines its words up. */
export const COLUMN_ALIGN = {
  START: "start",
  CENTER: "center",
  END: "end",
} as const;

export type ColumnAlign = (typeof COLUMN_ALIGN)[keyof typeof COLUMN_ALIGN];

export type LinkTarget =
  | {
      readonly kind: typeof LINK_TARGET.PLACE;
      readonly workspace: string;
      readonly place: LinkPlace;
      readonly href: string;
    }
  | { readonly kind: typeof LINK_TARGET.WEB; readonly href: string }
  | { readonly kind: typeof LINK_TARGET.NONE };

/** How a run of words is marked. */
interface WordMarks {
  readonly strong: boolean;
  readonly emphasis: boolean;
  readonly struck: boolean;
}

/** A mention drawn as its chip: what it names, by its kind's glyph and its name, and what VoiceOver hears for it. */
export interface MarkdownChip {
  readonly thing: ThingKind;
  readonly name: string;
  /** Its kind's word before its name, where the name does not say it already: "pull request #42 Fix the refresh". */
  readonly heard: string;
  readonly target: LinkTarget;
}

export type MarkdownRun =
  | ({ readonly kind: typeof MARKDOWN_RUN.WORDS; readonly text: string } & WordMarks)
  | { readonly kind: typeof MARKDOWN_RUN.CODE; readonly text: string }
  | {
      readonly kind: typeof MARKDOWN_RUN.LINK;
      readonly target: LinkTarget;
      readonly runs: readonly MarkdownRun[];
    }
  | { readonly kind: typeof MARKDOWN_RUN.CHIP; readonly chip: MarkdownChip }
  | { readonly kind: typeof MARKDOWN_RUN.BREAK };

interface MarkdownListItem {
  /** Whether a task item stands ticked; undefined for an item that is no task. */
  readonly checked: boolean | undefined;
  readonly blocks: readonly MarkdownBlock[];
}

export type MarkdownBlock =
  | {
      readonly kind: typeof MARKDOWN_BLOCK.HEADING;
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly runs: readonly MarkdownRun[];
    }
  | { readonly kind: typeof MARKDOWN_BLOCK.PARAGRAPH; readonly runs: readonly MarkdownRun[] }
  | {
      readonly kind: typeof MARKDOWN_BLOCK.LIST;
      /** The first item's number, for a numbered list; undefined for a bulleted one. */
      readonly start: number | undefined;
      readonly items: readonly MarkdownListItem[];
    }
  | { readonly kind: typeof MARKDOWN_BLOCK.QUOTE; readonly blocks: readonly MarkdownBlock[] }
  | {
      readonly kind: typeof MARKDOWN_BLOCK.TABLE;
      readonly align: readonly ColumnAlign[];
      /** The header row first, then the body's, each cell its runs, every row as wide as the header. */
      readonly rows: readonly (readonly (readonly MarkdownRun[])[])[];
    }
  | {
      readonly kind: typeof MARKDOWN_BLOCK.CODE;
      readonly language: string | undefined;
      readonly text: string;
    }
  | { readonly kind: typeof MARKDOWN_BLOCK.RULE }
  | { readonly kind: typeof MARKDOWN_BLOCK.PICTURE; readonly source: string; readonly alt: string };

/** What the words are read against: the repository a GitHub page is a file of, and the moment and zone a date's chip counts from. */
export interface MarkdownReading {
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips; null where it has none. */
  readonly repository: string | null;
  readonly now: number;
  readonly zone: string;
}

/** The schemes a link opens in Safari by. */
const WEB_SCHEMES: ReadonlySet<string> = new Set(["https:", "http:", "mailto:"]);

/** The schemes a picture is drawn from: the web's, and a picture written into the words. */
const PICTURE_SOURCE = /^(?:https:\/\/|data:image\/)/u;

const PLAIN: WordMarks = { strong: false, emphasis: false, struck: false };

const ALIGN: { readonly [K in NonNullable<Table["align"]>[number] & string]: ColumnAlign } = {
  left: COLUMN_ALIGN.START,
  center: COLUMN_ALIGN.CENTER,
  right: COLUMN_ALIGN.END,
};

/** The definitions a reference link or picture is read through, by its identifier as CommonMark folds one. */
type Definitions = ReadonlyMap<string, Definition>;

interface Reader {
  readonly reading: MarkdownReading;
  readonly definitions: Definitions;
}

function folded(identifier: string): string {
  return identifier.trim().replace(/\s+/gu, " ").toLowerCase();
}

function definitionsIn(node: Nodes, found: Map<string, Definition> = new Map()): Definitions {
  if (node.type === "definition") {
    const key = folded(node.identifier);
    // Note that the first definition of an identifier wins, as CommonMark has it.
    if (!found.has(key)) found.set(key, node);
  }
  if ("children" in node) for (const child of node.children) definitionsIn(child, found);
  return found;
}

/** The words a node holds, as written, marks and all dropped. */
function wordsOf(node: Nodes): string {
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if ("value" in node && node.type !== "yaml") return node.value;
  if ("children" in node) return node.children.map(wordsOf).join("");
  return "";
}

/** Where a link written to `href` goes when pressed: a place of the app's, a page on the web, or nowhere. */
function linkTarget(href: string): LinkTarget {
  const read = readLink(href);
  if (read !== undefined) return { kind: LINK_TARGET.PLACE, ...read, href };
  const scheme = /^[a-z][a-z0-9+.-]*:/iu.exec(href)?.[0].toLowerCase();
  if (scheme !== undefined && WEB_SCHEMES.has(scheme)) return { kind: LINK_TARGET.WEB, href };
  return { kind: LINK_TARGET.NONE };
}

function chipOf(thing: ThingKind, name: string, target: LinkTarget): MarkdownChip {
  const word = thingWordHeard(thing, name);
  return { thing, name, heard: word === undefined ? name : `${word} ${name}`, target };
}

/** No names held: the app reads none for a chip yet, so a place is called by its label, or by its kind where it has none. */
const NO_NAMES = {
  tasks: new Map(),
  agents: new Map(),
  agentModels: new Map(),
  pages: new Map(),
  pagesTaskId: undefined,
  inboxItems: new Map(),
  people: new Map(),
  automations: new Map(),
} as const;

/** A link as its chip, as the panel's `linkChip` reads it; nothing where it names nothing, and stays a link. */
function linkChip(href: string, label: string, reading: MarkdownReading): MarkdownChip | undefined {
  const found = linkMention(label, href, reading.repository);
  if (found?.mention.kind === MENTION_KIND.DATE) {
    const name = dateChipText(found.mention, reading.now, reading.zone);
    return chipOf(MENTION_KIND.DATE, name, { kind: LINK_TARGET.NONE });
  }
  if (found !== undefined) {
    return chipOf(thingOfMention(found.mention).kind, found.name, linkTarget(href));
  }
  const read = readLink(href);
  if (read === undefined) return undefined;
  const written = isBareLink(label, href) ? undefined : mentionName(label.trim());
  const look = placeChipLook(read.place, written, NO_NAMES);
  return chipOf(thingOfPlace(read.place).kind, look.name, linkTarget(href));
}

function linkRun(
  href: string,
  children: readonly PhrasingContent[],
  marks: WordMarks,
  reader: Reader,
): MarkdownRun {
  const chip = linkChip(href, children.map(wordsOf).join(""), reader.reading);
  if (chip !== undefined) return { kind: MARKDOWN_RUN.CHIP, chip };
  return {
    kind: MARKDOWN_RUN.LINK,
    target: linkTarget(href),
    runs: children.flatMap((child) => runsOf(child, marks, reader)),
  };
}

/** A reference's definition, or nothing where none is written. */
function referenced(node: LinkReference | ImageReference, reader: Reader): Definition | undefined {
  return reader.definitions.get(folded(node.identifier));
}

/** A run of words as written, where nothing reads it as more: a reference with no definition, raw HTML. */
function wordsRun(text: string, marks: WordMarks): MarkdownRun[] {
  return text === "" ? [] : [{ kind: MARKDOWN_RUN.WORDS, text, ...marks }];
}

/** The runs an inline node draws, under the marks of the nodes around it. */
function runsOf(node: PhrasingContent, marks: WordMarks, reader: Reader): MarkdownRun[] {
  const inside = (children: readonly PhrasingContent[], more: Partial<WordMarks>) =>
    children.flatMap((child) => runsOf(child, { ...marks, ...more }, reader));
  switch (node.type) {
    case "text":
    case "html":
      return wordsRun(node.value, marks);
    case "inlineCode":
      return [{ kind: MARKDOWN_RUN.CODE, text: node.value }];
    case "break":
      return [{ kind: MARKDOWN_RUN.BREAK }];
    case "strong":
      return inside(node.children, { strong: true });
    case "emphasis":
      return inside(node.children, { emphasis: true });
    case "delete":
      return inside(node.children, { struck: true });
    case "link":
      return [linkRun(node.url, node.children, marks, reader)];
    case "linkReference": {
      const definition = referenced(node, reader);
      if (definition === undefined) return inside(node.children, {});
      return [linkRun(definition.url, node.children, marks, reader)];
    }
    // Note that a picture inside a run, a linked one say, is its alternative words, since only a paragraph's own pictures stand as blocks.
    case "image":
    case "imageReference":
      return wordsRun(node.alt ?? "", marks);
    case "footnoteReference":
      return wordsRun(`[^${node.label ?? node.identifier}]`, marks);
  }
}

/** A picture's source, where it is one the app draws; nothing for any other. */
function pictureSource(node: PhrasingContent, reader: Reader): string | undefined {
  const url =
    node.type === "image"
      ? node.url
      : node.type === "imageReference"
        ? referenced(node, reader)?.url
        : undefined;
  return url !== undefined && PICTURE_SOURCE.test(url) ? url : undefined;
}

/** Whether a run is only space, which a paragraph cut at a picture drops at its ends. */
function blank(run: MarkdownRun): boolean {
  return (
    run.kind === MARKDOWN_RUN.BREAK || (run.kind === MARKDOWN_RUN.WORDS && run.text.trim() === "")
  );
}

/** A paragraph's words, each picture of its own standing as a block between them. */
function paragraphBlocks(node: Paragraph, reader: Reader): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let runs: MarkdownRun[] = [];
  const close = () => {
    if (runs.some((run) => !blank(run))) blocks.push({ kind: MARKDOWN_BLOCK.PARAGRAPH, runs });
    runs = [];
  };
  for (const child of node.children) {
    const source = pictureSource(child, reader);
    if (source === undefined) {
      runs.push(...runsOf(child, PLAIN, reader));
      continue;
    }
    close();
    blocks.push({ kind: MARKDOWN_BLOCK.PICTURE, source, alt: wordsOf(child) });
  }
  close();
  return blocks;
}

function listBlock(node: List, reader: Reader): MarkdownBlock {
  return {
    kind: MARKDOWN_BLOCK.LIST,
    start: node.ordered === true ? (node.start ?? 1) : undefined,
    items: node.children.map((item) => ({
      checked: item.checked ?? undefined,
      blocks: blocksOf(item.children, reader),
    })),
  };
}

function tableBlock(node: Table, reader: Reader): MarkdownBlock {
  const width = node.children[0]?.children.length ?? 0;
  const columns = Array.from({ length: width }, (_, at) => at);
  return {
    kind: MARKDOWN_BLOCK.TABLE,
    align: columns.map((at) => {
      const align = node.align?.[at];
      return align === null || align === undefined ? COLUMN_ALIGN.START : ALIGN[align];
    }),
    // Note that a row is cut or filled to the header's width, as GitHub draws a ragged table.
    rows: node.children.map((row) =>
      columns.map((at) => {
        const cell = row.children[at];
        return cell === undefined
          ? []
          : cell.children.flatMap((child) => runsOf(child, PLAIN, reader));
      }),
    ),
  };
}

function blockOf(node: RootContent, reader: Reader): MarkdownBlock[] {
  switch (node.type) {
    case "heading":
      return [
        {
          kind: MARKDOWN_BLOCK.HEADING,
          level: node.depth,
          runs: node.children.flatMap((child) => runsOf(child, PLAIN, reader)),
        },
      ];
    case "paragraph":
      return paragraphBlocks(node, reader);
    case "list":
      return [listBlock(node, reader)];
    case "blockquote":
      return [{ kind: MARKDOWN_BLOCK.QUOTE, blocks: blocksOf(node.children, reader) }];
    case "table":
      return [tableBlock(node, reader)];
    case "code":
      return [{ kind: MARKDOWN_BLOCK.CODE, language: node.lang ?? undefined, text: node.value }];
    case "thematicBreak":
      return [{ kind: MARKDOWN_BLOCK.RULE }];
    case "html":
      return [{ kind: MARKDOWN_BLOCK.PARAGRAPH, runs: wordsRun(node.value, PLAIN) }];
    case "footnoteDefinition":
      return blocksOf(node.children, reader);
    // Note that a definition is read through by its references, and front matter is no message's.
    case "definition":
    case "yaml":
      return [];
    // A list's item, a table's row or cell, and every inline node stand inside the blocks above, never at a block's place.
    case "listItem":
    case "tableRow":
    case "tableCell":
    case "text":
    case "emphasis":
    case "strong":
    case "delete":
    case "inlineCode":
    case "break":
    case "link":
    case "linkReference":
    case "image":
    case "imageReference":
    case "footnoteReference":
      return [];
  }
}

function blocksOf(nodes: readonly RootContent[], reader: Reader): MarkdownBlock[] {
  return nodes.flatMap((node) => blockOf(node, reader));
}

/** Markdown as the blocks the app draws, read as the panel reads it. */
export function markdownBlocks(words: string, reading: MarkdownReading): readonly MarkdownBlock[] {
  const tree = markdownTree(words);
  return blocksOf(tree.children, { reading, definitions: definitionsIn(tree) });
}
