// markdown-model.ts -- a message's Markdown read into what the iOS app draws: blocks, and runs of words, links, and chips, each link read as the panel reads it.

import { dateChipText } from "@repo/features/date-mention";
import { type Draft, draftKindOf, readDraft } from "@repo/features/draft-text";
import {
  type EntityKind,
  entityOfDestination,
  entityOfMention,
  entityWordHeard,
} from "@repo/features/entity-kind";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { type LinkDestination, openableLinkOf, readLink } from "@repo/features/link-grammar";
import { githubPageAsked } from "@repo/features/link-standing-model";
import { markdownTooDeep } from "@repo/features/markdown-nesting";
import { markdownTree } from "@repo/features/markdown-tree";
import { LINK_CHIP, linkChipOf, MENTION_KIND, type Mention } from "@repo/features/mention-link";
import { placeChipLook } from "@repo/features/place-chip-model";
import { Match } from "effect";
import type {
  Code,
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
 * of words cannot hold one. A link is read by the rule the panel's chip
 * reads (`@repo/features/mention-link`'s `linkChipOf`): a mention's target
 * as its chip, a link to a place in the app as that place's chip, and any
 * other link as underlined words. Raw HTML is drawn as
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
  DRAFT: "draft",
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
      readonly place: LinkDestination;
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
  readonly entity: EntityKind;
  readonly name: string;
  /** Its kind's word before its name, where the name does not say it already: "pull request #42 Fix the refresh". */
  readonly heard: string;
  readonly target: LinkTarget;
  /** The GitHub pull request's or issue's page it names, by which its standing is read; none for any other chip. */
  readonly github?: string | undefined;
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
  | { readonly kind: typeof MARKDOWN_BLOCK.CODE; readonly text: string }
  /** Words an agent wrote to be sent elsewhere, fenced ```slack, ```email, or ```draft, read as the panel's draft card reads them. */
  | { readonly kind: typeof MARKDOWN_BLOCK.DRAFT; readonly draft: Draft }
  | { readonly kind: typeof MARKDOWN_BLOCK.RULE }
  | { readonly kind: typeof MARKDOWN_BLOCK.PICTURE; readonly source: string; readonly alt: string };

/** What the words are read against: the repository a GitHub page is a file of, and the moment and zone a date's chip counts from. */
export interface MarkdownReading {
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips; null where it has none. */
  readonly repository: string | null;
  readonly now: number;
  readonly zone: string;
  /**
   * Whether a person typed the words line by line, as into a composer whose
   * Enter is a new line, so each line break they typed is kept, as the
   * panel keeps a typed message's (`remark-breaks`); words an agent wrote
   * join a paragraph's lines with a space, as Markdown reads them.
   */
  readonly typed?: boolean | undefined;
}

/** A line break inside a paragraph's words, which Markdown reads as a space. */
const SOFT_BREAK = /\r?\n/gu;

/** The schemes a picture is drawn from: the web's, and a picture written into the words. */
const PICTURE_SOURCE = /^(?:https:\/\/|data:image\/)/u;

const PLAIN: WordMarks = { strong: false, emphasis: false, struck: false };

const ALIGN: Readonly<Record<NonNullable<Table["align"]>[number] & string, ColumnAlign>> = {
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

  return openableLinkOf(href) === undefined
    ? { kind: LINK_TARGET.NONE }
    : { kind: LINK_TARGET.WEB, href };
}

function chipOf(entity: EntityKind, name: string, target: LinkTarget): MarkdownChip {
  const word = entityWordHeard(entity, name);

  return { entity, name, heard: word === undefined ? name : `${word} ${name}`, target };
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

/** A link as its chip, by the rule the panel's `linkChip` reads (`linkChipOf`); nothing where it names nothing, and stays a link. */
function linkChip(href: string, label: string, reading: MarkdownReading): MarkdownChip | undefined {
  const chip = linkChipOf(label, href, reading.repository);

  if (chip === undefined) return undefined;

  if (chip.kind === LINK_CHIP.PLACE) {
    const look = placeChipLook(chip.link.place, chip.name, NO_NAMES);

    return chipOf(entityOfDestination(chip.link.place).kind, look.name, linkTarget(href));
  }

  if (chip.mention.kind === MENTION_KIND.DATE) {
    const name = dateChipText(chip.mention, reading.now, reading.zone);

    return chipOf(MENTION_KIND.DATE, name, { kind: LINK_TARGET.NONE });
  }

  const drawn = chipOf(entityOfMention(chip.mention).kind, chip.name, linkTarget(href));
  const github = githubAddressOf(chip.mention);

  return github === undefined ? drawn : { ...drawn, github };
}

/** The GitHub pull request's or issue's page a mention names, as the panel's chip asks GitHub of it; none for any other. */
function githubAddressOf(mention: Mention): string | undefined {
  // Note that a well-known site's page names no provider to ask.
  if (mention.kind !== MENTION_KIND.LINK || !("provider" in mention)) return undefined;

  if (mention.provider !== INTEGRATION_PROVIDER.GITHUB) return undefined;

  return githubPageAsked(mention.url) === undefined ? undefined : mention.url;
}

/** The address a link node names, through its definition where it is a reference; none for any other node. */
function linkHrefOf(node: Nodes, reader: Reader): string | undefined {
  if (node.type === "link") return node.url;

  return node.type === "linkReference" ? referenced(node, reader)?.url : undefined;
}

/** Each GitHub page the links under `node` name as chips, by `reader`. */
function githubPagesUnder(node: Nodes, reader: Reader): readonly string[] {
  const href = linkHrefOf(node, reader);

  const own =
    href === undefined || !("children" in node)
      ? undefined
      : linkChip(href, node.children.map(wordsOf).join(""), reader.reading)?.github;

  const inner =
    "children" in node
      ? node.children.flatMap((child: Nodes) => githubPagesUnder(child, reader))
      : [];

  return own === undefined ? inner : [own, ...inner];
}

/**
 * The GitHub pull requests' and issues' pages `words` name as chips, each
 * once, read as `markdownBlocks` reads them, so a screen holds each one's
 * standing while it draws them.
 */
export function markdownGithubPages(words: string, reading: MarkdownReading): readonly string[] {
  if (markdownTooDeep(words)) return [];
  const tree = markdownTree(words);

  return [...new Set(githubPagesUnder(tree, { reading, definitions: definitionsIn(tree) }))];
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
      return wordsRun(
        reader.reading.typed === true ? node.value : node.value.replace(SOFT_BREAK, " "),
        marks,
      );
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
  const url = Match.value(node).pipe(
    Match.when({ type: "image" }, (image) => image.url),
    Match.when({ type: "imageReference" }, (reference) => referenced(reference, reader)?.url),
    Match.orElse(() => undefined),
  );

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

/** A fence: a draft where it is named for where its words go, as the panel draws every rendered text's (`DraftFence`), and code otherwise. */
function codeBlock(node: Code): MarkdownBlock {
  const kind = draftKindOf(node.lang ?? "");

  if (kind === undefined) return { kind: MARKDOWN_BLOCK.CODE, text: node.value };

  return { kind: MARKDOWN_BLOCK.DRAFT, draft: readDraft(kind, node.value) };
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
      return [codeBlock(node)];
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

/** A run's words as VoiceOver hears them, each chip by its kind and name. */
function heardRun(run: MarkdownRun): string {
  switch (run.kind) {
    case MARKDOWN_RUN.WORDS:
    case MARKDOWN_RUN.CODE:
      return run.text;
    case MARKDOWN_RUN.LINK:
      return run.runs.map(heardRun).join("");
    case MARKDOWN_RUN.CHIP:
      return run.chip.heard;
    case MARKDOWN_RUN.BREAK:
      return "\n";
  }
}

/** Whether a run is a chip or holds one. */
function holdsChip(run: MarkdownRun): boolean {
  if (run.kind === MARKDOWN_RUN.LINK) return run.runs.some(holdsChip);

  return run.kind === MARKDOWN_RUN.CHIP;
}

/**
 * A line's words as VoiceOver hears them where it holds a chip, each chip by
 * its kind and name; nothing where it holds none, since its words are heard
 * as drawn. Note that a chip stands in the line as a view, which iOS never
 * hears inside a run of text, so a line read without this says
 * "Pull request:" and stops.
 */
export function heardLine(runs: readonly MarkdownRun[]): string | undefined {
  return runs.some(holdsChip) ? runs.map(heardRun).join("") : undefined;
}

/** Markdown as the blocks the app draws, read as the panel reads it; words nested too deep to parse safely are one block of plain text. */
export function markdownBlocks(words: string, reading: MarkdownReading): readonly MarkdownBlock[] {
  if (markdownTooDeep(words)) return [{ kind: MARKDOWN_BLOCK.CODE, text: words }];
  const tree = markdownTree(words);

  return blocksOf(tree.children, { reading, definitions: definitionsIn(tree) });
}
