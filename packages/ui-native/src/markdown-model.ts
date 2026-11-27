// markdown-model.ts -- a message's Markdown read into what the iOS app draws: blocks, and runs of words, links, and chips, each link read as the panel reads it.

import { dateChipText } from "@repo/features/date-mention";
import { type Draft, draftKindOf, readDraft } from "@repo/features/draft-text";
import {
  type Entity,
  type EntityKind,
  entityOfDestination,
  entityOfMention,
  entityWordHeard,
} from "@repo/features/entity-kind";
import { escapedMarkers, isPictureName, writtenMarkers } from "@repo/features/file-marker";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import {
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  openableLinkOf,
  readLink,
} from "@repo/features/link-grammar";
import { githubPageAsked } from "@repo/features/link-standing-model";
import { markdownTooDeep } from "@repo/features/markdown-nesting";
import { markdownTree } from "@repo/features/markdown-tree";
import {
  LINK_CHIP,
  linkChipOf,
  MENTION_KIND,
  type Mention,
  mentionChipLabel,
} from "@repo/features/mention-link";
import { DIAGRAM_LANGUAGE } from "@repo/features/mermaid-diagram";
import { placeChipLook } from "@repo/features/place-chip-model";
import { type ReplyButtonLink, readReplyButtonLink } from "@repo/features/reply-button-wire";
import { Match } from "effect";
import type {
  Code,
  Definition,
  Html,
  ImageReference,
  LinkReference,
  List,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  Text,
} from "mdast";
import { HTML_TOKEN, type HtmlToken, htmlTokens } from "./html-tokens.js";

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
 * the words it was written with, as a note draws it, but in GitHub's words,
 * where it is read as GitHub's page reads it (`MarkdownReading`'s
 * `githubHtml`).
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
  DIAGRAM: "diagram",
  RULE: "rule",
  PICTURE: "picture",
  /** A folded section of GitHub's words (`<details>`), its summary standing over what it folds. */
  DETAILS: "details",
} as const;

/** What a run inside a block is. */
export const MARKDOWN_RUN = {
  WORDS: "words",
  CODE: "code",
  LINK: "link",
  CHIP: "chip",
  /** A suggestion an agent wrote into its reply as a link (`@repo/features/reply-button-wire`), which the screen reads and draws. */
  SUGGESTION: "suggestion",
  /** A picture the words name by its marker, "[Picture 1]", standing where it was written as its chip (`PictureChip`), as the panel's message draws it. */
  PICTURE: "picture",
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
  /** The entity it names, by its ids, by which the app finds its mark (`ChipMarkOf`); none for a date. */
  readonly of?: Entity | undefined;
}

/**
 * A suggestion's link as its words name it: the button it reads, the words it
 * was written with, its label until the button is read, and where the plain
 * link goes, to the agent whose reply holds it, drawn where no suggestion
 * stands (Suggestions off, the button unread, or refused).
 */
export interface MarkdownSuggestion {
  readonly link: ReplyButtonLink;
  readonly words: string;
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
  | { readonly kind: typeof MARKDOWN_RUN.SUGGESTION; readonly suggestion: MarkdownSuggestion }
  | { readonly kind: typeof MARKDOWN_RUN.PICTURE; readonly name: string }
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
  /** A Mermaid fence, drawn as its diagram where the words are read for diagrams (`MarkdownReading`'s `diagrams`). */
  | { readonly kind: typeof MARKDOWN_BLOCK.DIAGRAM; readonly code: string }
  | { readonly kind: typeof MARKDOWN_BLOCK.RULE }
  | { readonly kind: typeof MARKDOWN_BLOCK.PICTURE; readonly source: string; readonly alt: string }
  | {
      readonly kind: typeof MARKDOWN_BLOCK.DETAILS;
      /** What its summary says, standing while it is folded. */
      readonly summary: readonly MarkdownRun[];
      readonly blocks: readonly MarkdownBlock[];
    };

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
  /**
   * Whether the words are GitHub's, a pull request's or a comment's, whose
   * raw HTML is read as GitHub's own page draws it: a picture, a table, a
   * folded section, a list, a heading, a line break, and words marked bold,
   * italic, struck, as code or as a link drawn as they would be written in
   * Markdown, and every other tag, comment and template left unseen, never
   * printed. Elsewhere raw HTML is drawn as the words it was written with.
   */
  readonly githubHtml?: boolean | undefined;
  /**
   * Whether a Mermaid fence is drawn as its diagram, as a description's are;
   * elsewhere, such as a transcript still being written, it stays its code,
   * since a fence redrawn at each word would draw a picture each time.
   */
  readonly diagrams?: boolean | undefined;
  /** The pictures the message carries, by the names its markers name them by ("Picture 1"), each marker of one drawn as its chip; every marker stays its words where none is given, as in words that carry no pictures. */
  readonly pictures?: Pick<ReadonlySet<string>, "has"> | undefined;
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

/** A marker spelled in the words: where its bracket stands, and whether a backslash escapes it into words. */
interface SpelledMarker {
  readonly at: number;
  readonly escaped: boolean;
}

interface Reader {
  readonly reading: MarkdownReading;
  readonly definitions: Definitions;
  /** Every marker spelled outside code in the words read, in order; none where no picture is drawn by its marker. */
  readonly spelled?: readonly SpelledMarker[] | undefined;
  /** How many of GitHub's HTML tags stand around the pieces read (`MAX_HTML_DEPTH`); none outside any. */
  readonly htmlDepth?: number | undefined;
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

function chipOf(
  entity: EntityKind,
  name: string,
  target: LinkTarget,
  of?: Entity | undefined,
): MarkdownChip {
  const word = entityWordHeard(entity, name);

  const chip = { entity, name, heard: word === undefined ? name : `${word} ${name}`, target };

  return of === undefined ? chip : { ...chip, of };
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
    const entity = entityOfDestination(chip.link.place);

    return chipOf(entity.kind, look.name, linkTarget(href), entity);
  }

  if (chip.mention.kind === MENTION_KIND.DATE) {
    const name = dateChipText(chip.mention, reading.now, reading.zone);

    return chipOf(MENTION_KIND.DATE, name, { kind: LINK_TARGET.NONE });
  }

  const entity = entityOfMention(chip.mention);
  const shown = mentionChipLabel(chip.mention, chip.name);
  const drawn = chipOf(entity.kind, shown, linkTarget(href), entity);
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

/** Each suggestion the links under `node` name, by `reader`. */
function replyButtonsUnder(node: Nodes, reader: Reader): readonly ReplyButtonLink[] {
  const href = linkHrefOf(node, reader);
  const own = href === undefined ? undefined : readReplyButtonLink(href);

  const inner =
    "children" in node
      ? node.children.flatMap((child: Nodes) => replyButtonsUnder(child, reader))
      : [];

  return own === undefined ? inner : [own, ...inner];
}

/**
 * The suggestions `words` name, each button once, read as `markdownBlocks`
 * reads them, so a screen reads each one's button while it draws them.
 */
export function markdownReplyButtons(
  words: string,
  reading: MarkdownReading,
): readonly ReplyButtonLink[] {
  if (markdownTooDeep(words)) return [];
  const tree = markdownTree(words);
  const links = replyButtonsUnder(tree, { reading, definitions: definitionsIn(tree) });

  return links.filter(
    (link, at) =>
      links.findIndex(
        (each) => each.agentId === link.agentId && each.buttonId === link.buttonId,
      ) === at,
  );
}

/**
 * The GitHub pull requests' and issues' pages `words` name as chips, each
 * once, read as `markdownBlocks` reads them, so a screen holds each one's
 * standing while it draws them; `parse` reads the words' tree, a whole
 * document's kept one where its page already parsed it.
 */
export function markdownGithubPages(
  words: string,
  reading: MarkdownReading,
  parse: (words: string) => Root = markdownTree,
): readonly string[] {
  if (markdownTooDeep(words)) return [];
  const tree = parse(words);

  return [...new Set(githubPagesUnder(tree, { reading, definitions: definitionsIn(tree) }))];
}

function linkRun(
  href: string,
  children: readonly PhrasingContent[],
  marks: WordMarks,
  reader: Reader,
): MarkdownRun {
  const words = children.map(wordsOf).join("");

  return linkRunOf(href, words, () => phrasingRuns(children, marks, reader), reader);
}

/** A link to `href` whose words are `words`: a suggestion, a chip, or a link around its own runs, read only where it stays a link. */
function linkRunOf(
  href: string,
  words: string,
  runs: () => MarkdownRun[],
  reader: Reader,
): MarkdownRun {
  const button = readReplyButtonLink(href);

  if (button !== undefined) {
    const agentHref = linkOf(
      { kind: LINK_DESTINATION.AGENT, agentId: button.agentId },
      button.workspace,
    );

    return {
      kind: MARKDOWN_RUN.SUGGESTION,
      suggestion: { link: button, words, target: linkTarget(agentHref) },
    };
  }

  const chip = linkChip(href, words, reader.reading);

  if (chip !== undefined) return { kind: MARKDOWN_RUN.CHIP, chip };

  return { kind: MARKDOWN_RUN.LINK, target: linkTarget(href), runs: runs() };
}

/** A reference's definition, or nothing where none is written. */
function referenced(node: LinkReference | ImageReference, reader: Reader): Definition | undefined {
  return reader.definitions.get(folded(node.identifier));
}

/** A run of words as written, where nothing reads it as more: a reference with no definition, raw HTML. */
function wordsRun(text: string, marks: WordMarks): MarkdownRun[] {
  return text === "" ? [] : [{ kind: MARKDOWN_RUN.WORDS, text, ...marks }];
}

/** Every marker spelled outside code in the words, in order, each escaped where a backslash makes it words (`@repo/features/file-marker`). */
function spelledMarkers(words: string): readonly SpelledMarker[] {
  const written = writtenMarkers(words).map((marker) => ({ at: marker.start, escaped: false }));
  // Note that an escaped marker's place is its backslash's, so its bracket stands one after.
  const escaped = escapedMarkers(words).map((marker) => ({ at: marker.start + 1, escaped: true }));

  return [...written, ...escaped].sort((first, second) => first.at - second.at);
}

/**
 * Whether each of a text node's `count` markers was escaped into words
 * where it was written. Note that the tree hands the words with their
 * escapes read, so `\[Picture 1]` arrives as `[Picture 1]`; its markers are
 * matched in order with those spelled in its place in the words, and where
 * the two do not count alike none is taken as escaped.
 */
function escapedInWords(node: Text, count: number, reader: Reader): readonly boolean[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;

  if (reader.spelled === undefined || start === undefined || end === undefined) return [];
  const inPlace = reader.spelled.filter((marker) => marker.at >= start && marker.at < end);

  return inPlace.length === count ? inPlace.map((marker) => marker.escaped) : [];
}

/**
 * A run of words with each marker of a picture the message carries as its
 * chip, the words around it kept, and every other marker its words, as the
 * panel draws a sent message's. Note that words in code never come here, so
 * a marker in code stays the code's words, as `fileMarkers` reads it, and a
 * marker escaped into words, `\[Picture 1]`, stays its words too, as a
 * marker typed in a message box is sent.
 */
function wordsWithPictures(
  node: Text,
  text: string,
  marks: WordMarks,
  reader: Reader,
): MarkdownRun[] {
  const { pictures } = reader.reading;

  if (pictures === undefined) return wordsRun(text, marks);
  const runs: MarkdownRun[] = [];
  const markers = writtenMarkers(text);
  const escaped = escapedInWords(node, markers.length, reader);
  let at = 0;

  for (const [index, marker] of markers.entries()) {
    if (escaped[index] === true || !isPictureName(marker.name) || !pictures.has(marker.name))
      continue;
    runs.push(...wordsRun(text.slice(at, marker.start), marks));
    runs.push({ kind: MARKDOWN_RUN.PICTURE, name: marker.name });
    at = marker.end;
  }

  return [...runs, ...wordsRun(text.slice(at), marks)];
}

/** The runs an inline node draws, under the marks of the nodes around it. */
function runsOf(node: PhrasingContent, marks: WordMarks, reader: Reader): MarkdownRun[] {
  const inside = (children: readonly PhrasingContent[], more: Partial<WordMarks>) =>
    phrasingRuns(children, { ...marks, ...more }, reader);

  switch (node.type) {
    case "text":
    case "html": {
      if (node.type === "html" && reader.reading.githubHtml === true) {
        return runsOnly(inlinesOf(piecesOf([node]), marks, reader));
      }

      const text = reader.reading.typed === true ? node.value : node.value.replace(SOFT_BREAK, " ");

      return node.type === "html"
        ? wordsRun(text, marks)
        : wordsWithPictures(node, text, marks, reader);
    }

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
  const inlines = readsHtmlIn(node.children, reader)
    ? inlinesOf(piecesOf(node.children), PLAIN, reader)
    : node.children.flatMap((child) => nodeInlines(child, PLAIN, reader));

  return inlineBlocks(inlines);
}

/** A paragraph's runs and pictures as blocks: its words, each picture standing as a block between them. */
function inlineBlocks(inlines: readonly Inline[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let runs: MarkdownRun[] = [];

  const close = () => {
    if (runs.some((run) => !blank(run))) blocks.push({ kind: MARKDOWN_BLOCK.PARAGRAPH, runs });
    runs = [];
  };

  for (const inline of inlines) {
    if (inline.picture === undefined) {
      runs.push(inline.run);
      continue;
    }

    close();
    blocks.push({ kind: MARKDOWN_BLOCK.PICTURE, ...inline.picture });
  }

  close();

  return blocks;
}

/** An inline node as what it draws: a picture of its own, or its runs. */
function nodeInlines(node: PhrasingContent, marks: WordMarks, reader: Reader): Inline[] {
  const source = pictureSource(node, reader);

  if (source !== undefined) return [{ picture: { source, alt: wordsOf(node) } }];

  return runsOf(node, marks, reader).map((run) => ({ run }));
}

/** The runs inline nodes draw side by side, their raw HTML read as GitHub's where the words are GitHub's. */
function phrasingRuns(
  children: readonly PhrasingContent[],
  marks: WordMarks,
  reader: Reader,
): MarkdownRun[] {
  if (!readsHtmlIn(children, reader))
    return children.flatMap((child) => runsOf(child, marks, reader));

  return runsOnly(inlinesOf(piecesOf(children), marks, reader));
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

        return cell === undefined ? [] : phrasingRuns(cell.children, PLAIN, reader);
      }),
    ),
  };
}

/** A fence: a diagram where it names Mermaid and the words are read for diagrams, a draft where it is named for where its words go, as the panel draws every rendered text's (`DraftFence`), and code otherwise. */
function codeBlock(node: Code, reading: MarkdownReading): MarkdownBlock {
  if (reading.diagrams === true && node.lang === DIAGRAM_LANGUAGE) {
    return { kind: MARKDOWN_BLOCK.DIAGRAM, code: node.value };
  }

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
          runs: phrasingRuns(node.children, PLAIN, reader),
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
      return [codeBlock(node, reader.reading)];
    case "thematicBreak":
      return [{ kind: MARKDOWN_BLOCK.RULE }];
    case "html":
      return reader.reading.githubHtml === true
        ? htmlBlocksOf(piecesOf([node]), reader)
        : [{ kind: MARKDOWN_BLOCK.PARAGRAPH, runs: wordsRun(node.value, PLAIN) }];
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
  // Note that GitHub's raw HTML is read across the nodes it stands between, since a folded section opens in one node and closes nodes later, with Markdown between.
  if (readsHtmlIn(nodes, reader)) return htmlBlocksOf(piecesOf(nodes), reader);

  return nodes.flatMap((node) => blockOf(node, reader));
}

/** A piece of words read in order: a node of the tree, or a tag or words of raw HTML written among its nodes. */
type Piece<Node> =
  | { readonly node: Node; readonly token?: undefined }
  | { readonly token: HtmlToken; readonly node?: undefined };

/** What an inline piece draws: a run, or a picture, which a paragraph stands as a block of its own. */
type Inline =
  | { readonly run: MarkdownRun; readonly picture?: undefined }
  | {
      readonly picture: { readonly source: string; readonly alt: string };
      readonly run?: undefined;
    };

/** The tags whose words GitHub marks, and how. */
const MARK_TAGS: ReadonlyMap<string, Partial<WordMarks>> = new Map([
  ["b", { strong: true }],
  ["strong", { strong: true }],
  ["i", { emphasis: true }],
  ["em", { emphasis: true }],
  ["s", { struck: true }],
  ["del", { struck: true }],
  ["strike", { struck: true }],
]);

/** The tags that end a paragraph's words where they open or close, their own words standing in the next. */
const BOUNDARY_TAGS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "center",
  "section",
  "article",
  "header",
  "footer",
  "figure",
  "figcaption",
  "dl",
  "dt",
  "dd",
  "li",
  "summary",
  "tr",
  "th",
  "td",
]);

/** The tags whose words are never drawn, as a browser shows none of them. */
const UNSEEN_TAGS: ReadonlySet<string> = new Set(["script", "style", "template", "head", "title"]);

/** The heading tags, by the level each heads. */
const HEADING_TAGS: ReadonlyMap<string, 1 | 2 | 3 | 4 | 5 | 6> = new Map([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
  ["h5", 5],
  ["h6", 6],
]);

/** What a `<details>` says where it holds no summary, as GitHub's page says. */
const DETAILS_WORDS = "Details";

/**
 * The most of GitHub's HTML tags read inside one another, past which a tag
 * is left unseen, its words kept, so words that open tag after tag and
 * close none cost no more to read than their length, and never a stack's
 * depth. Note that GitHub's own words nest a few: a bot's folded section in
 * a quote in a table's cell.
 */
const MAX_HTML_DEPTH = 8;

/** The tags that draw blocks of their own (`htmlTagBlocks`), each read whole up to where it closes. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "details",
  "table",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/** The addresses a link or a picture written in GitHub's HTML may name: a page on the web. Any other, such as `javascript:` or `data:`, leaves its words alone. */
const WEB_ADDRESS = /^https?:\/\//iu;

/** Space as HTML folds it: a run of it is one space. Note that a no-break space is no such space. */
const HTML_SPACE = /[ \t\n\r\f]+/gu;

/** The reader for the pieces a tag of GitHub's wraps, one tag deeper. */
function deeper(reader: Reader): Reader {
  return { ...reader, htmlDepth: (reader.htmlDepth ?? 0) + 1 };
}

/** Whether a tag of GitHub's wrapping pieces is read here, rather than left unseen past `MAX_HTML_DEPTH`. */
function withinDepth(reader: Reader): boolean {
  return (reader.htmlDepth ?? 0) < MAX_HTML_DEPTH;
}

function isHtml(node: { readonly type: string }): node is Html {
  return node.type === "html";
}

/** Whether `nodes` hold raw HTML to read as GitHub's, which only GitHub's words do. */
function readsHtmlIn(nodes: readonly { readonly type: string }[], reader: Reader): boolean {
  return reader.reading.githubHtml === true && nodes.some(isHtml);
}

/** Nodes as pieces, each raw HTML node read as its tags and words. */
function piecesOf<Node extends { readonly type: string }>(nodes: readonly Node[]): Piece<Node>[] {
  return nodes.flatMap((node): Piece<Node>[] =>
    isHtml(node) ? htmlTokens(node.value).map((token) => ({ token })) : [{ node }],
  );
}

/** Where the tag opened at `from` closes among `pieces`, the same tags opened inside it counted; their end where it never closes. */
function closeAt<Node>(pieces: readonly Piece<Node>[], from: number, name: string): number {
  let depth = 0;

  for (let at = from + 1; at < pieces.length; at += 1) {
    const token = pieces[at]?.token;

    if (token?.kind === HTML_TOKEN.OPEN && token.name === name && !token.alone) depth += 1;

    if (token?.kind === HTML_TOKEN.CLOSE && token.name === name) {
      if (depth === 0) return at;
      depth -= 1;
    }
  }

  return pieces.length;
}

/** Block pieces read inline, as a heading's or a cell's words: a paragraph's nodes as its own, and any other node as its words. */
function asInline(pieces: readonly Piece<RootContent>[]): Piece<PhrasingContent>[] {
  return pieces.flatMap((piece): Piece<PhrasingContent>[] => {
    if (piece.token !== undefined) return [{ token: piece.token }];

    if (piece.node.type === "paragraph") return piecesOf(piece.node.children);

    return [{ token: { kind: HTML_TOKEN.TEXT, text: wordsOf(piece.node) } }];
  });
}

/** The words pieces hold as written, tags dropped, as code's are. */
function piecesWords(pieces: readonly Piece<PhrasingContent>[]): string {
  return pieces
    .map((piece) => {
      if (piece.node !== undefined) return wordsOf(piece.node);

      return piece.token.kind === HTML_TOKEN.TEXT ? piece.token.text : "";
    })
    .join("");
}

/** Inlines as runs alone, each picture as its words, where no picture can stand, as in a heading, a cell, or a link. */
function runsOnly(inlines: readonly Inline[]): MarkdownRun[] {
  return inlines.flatMap((inline) =>
    inline.picture === undefined ? [inline.run] : wordsRun(inline.picture.alt, PLAIN),
  );
}

/** Runs with the space at their ends cut, as HTML lays a block's words, and none left that holds nothing. */
function trimmedRuns(runs: readonly MarkdownRun[]): MarkdownRun[] {
  const last = runs.length - 1;

  return runs.flatMap((run, at): MarkdownRun[] => {
    if (run.kind !== MARKDOWN_RUN.WORDS) return [run];
    const start = at === 0 ? run.text.trimStart() : run.text;
    const text = at === last ? start.trimEnd() : start;

    return text === "" ? [] : [{ ...run, text }];
  });
}

/** A tag of GitHub's that stands alone in a line's words: a picture, drawn where its address is one the app draws and said by its words otherwise, and a line break. */
function tagInlines(token: Extract<HtmlToken, { kind: "open" }>, marks: WordMarks): Inline[] {
  if (token.name === "br") return [{ run: { kind: MARKDOWN_RUN.BREAK } }];

  if (token.name !== "img") return [];
  const source = (token.attributes.get("src") ?? "").trim();
  const alt = token.attributes.get("alt") ?? "";

  if (WEB_ADDRESS.test(source)) return [{ picture: { source, alt } }];

  return wordsRun(alt, marks).map((run) => ({ run }));
}

/** A tag of GitHub's that wraps words in a line: code, as its words written, or a link around its words, as a Markdown link reads. */
function spanInlines(
  token: Extract<HtmlToken, { kind: "open" }>,
  inner: readonly Piece<PhrasingContent>[],
  marks: WordMarks,
  reader: Reader,
): Inline[] {
  if (token.name === "code") {
    return [
      { run: { kind: MARKDOWN_RUN.CODE, text: piecesWords(inner).replace(HTML_SPACE, " ") } },
    ];
  }

  const runs = () => runsOnly(inlinesOf(inner, marks, reader));
  const href = token.attributes.get("href")?.trim();

  if (href === undefined || !WEB_ADDRESS.test(href)) return runs().map((run) => ({ run }));

  return [{ run: linkRunOf(href, piecesWords(inner).trim(), runs, reader) }];
}

/**
 * A line's pieces as what they draw, its raw HTML read as GitHub's page
 * reads it: each node as it draws, words as they read with HTML's space
 * folded, a bold, italic or struck tag marking the words it wraps until it
 * closes, code and a link around the words they wrap, a picture and a line
 * break where they stand, and every other tag unseen, its words kept.
 */
function inlinesOf(
  pieces: readonly Piece<PhrasingContent>[],
  marks: WordMarks,
  reader: Reader,
): Inline[] {
  const inlines: Inline[] = [];
  const open: { readonly name: string; readonly marks: Partial<WordMarks> }[] = [];
  const marked = (): WordMarks => Object.assign({}, marks, ...open.map((each) => each.marks));

  for (let at = 0; at < pieces.length; at += 1) {
    const piece = pieces[at];

    if (piece === undefined) continue;

    if (piece.node !== undefined) {
      inlines.push(...nodeInlines(piece.node, marked(), reader));
      continue;
    }

    const { token } = piece;

    if (token.kind === HTML_TOKEN.TEXT) {
      inlines.push(
        ...wordsRun(token.text.replace(HTML_SPACE, " "), marked()).map((run) => ({ run })),
      );
    } else if (token.kind === HTML_TOKEN.CLOSE) {
      const last = open.findLastIndex((each) => each.name === token.name);

      if (last !== -1) open.splice(last, 1);
    } else if (MARK_TAGS.has(token.name)) {
      if (!token.alone && open.length < MAX_HTML_DEPTH) {
        open.push({ name: token.name, marks: MARK_TAGS.get(token.name) ?? {} });
      }
    } else if (
      (token.name === "a" || token.name === "code") &&
      !token.alone &&
      withinDepth(reader)
    ) {
      const end = closeAt(pieces, at, token.name);
      inlines.push(...spanInlines(token, pieces.slice(at + 1, end), marked(), deeper(reader)));
      at = end;
    } else if (UNSEEN_TAGS.has(token.name) && !token.alone) {
      at = closeAt(pieces, at, token.name);
    } else {
      inlines.push(...tagInlines(token, marked()));
    }
  }

  return inlines;
}

/** A line's pieces as the blocks they draw: one paragraph, its words' ends trimmed, each picture a block of its own between them. */
function lineBlocks(pieces: readonly Piece<PhrasingContent>[], reader: Reader): MarkdownBlock[] {
  return inlineBlocks(inlinesOf(pieces, PLAIN, reader)).map((block) =>
    block.kind === MARKDOWN_BLOCK.PARAGRAPH ? { ...block, runs: trimmedRuns(block.runs) } : block,
  );
}

/** A heading tag's or a cell's words, read inline, trimmed. */
function htmlLine(inner: readonly Piece<RootContent>[], reader: Reader): MarkdownRun[] {
  return trimmedRuns(runsOnly(inlinesOf(asInline(inner), PLAIN, reader)));
}

/** Each run of pieces a tag named `name` wraps among `pieces`, the tags of that name nested in one left inside it. */
function wrapped<Node>(
  pieces: readonly Piece<Node>[],
  name: string,
): readonly (readonly Piece<Node>[])[] {
  const found: Piece<Node>[][] = [];

  for (let at = 0; at < pieces.length; at += 1) {
    const token = pieces[at]?.token;

    if (token?.kind !== HTML_TOKEN.OPEN || token.name !== name || token.alone) continue;
    const end = closeAt(pieces, at, name);
    found.push(pieces.slice(at + 1, end));
    at = end;
  }

  return found;
}

/** A `<details>` as its folded section: what its summary says, GitHub's word for it where it holds none, over the blocks it folds. */
function detailsBlock(inner: readonly Piece<RootContent>[], reader: Reader): MarkdownBlock {
  const at = inner.findIndex(
    (piece) => piece.token?.kind === HTML_TOKEN.OPEN && piece.token.name === "summary",
  );

  if (at === -1) {
    return {
      kind: MARKDOWN_BLOCK.DETAILS,
      summary: wordsRun(DETAILS_WORDS, PLAIN),
      blocks: htmlBlocksOf(inner, reader),
    };
  }

  const end = closeAt(inner, at, "summary");
  const folded = [...inner.slice(0, at), ...inner.slice(end + 1)];
  const summary = htmlLine(inner.slice(at + 1, end), reader);

  return { kind: MARKDOWN_BLOCK.DETAILS, summary, blocks: htmlBlocksOf(folded, reader) };
}

/** A `<table>` as a table: each row's cells read inline, the first row its header, as the panel draws a table, every row as wide as the widest. */
function htmlTableBlocks(inner: readonly Piece<RootContent>[], reader: Reader): MarkdownBlock[] {
  const rows = wrapped(inner, "tr").map((row) =>
    cellsOf(row).map((cell) => htmlLine(cell, reader)),
  );

  const width = Math.max(0, ...rows.map((row) => row.length));

  if (width === 0) return [];
  const columns = Array.from({ length: width }, (_, at) => at);

  return [
    {
      kind: MARKDOWN_BLOCK.TABLE,
      align: columns.map(() => COLUMN_ALIGN.START),
      rows: rows.map((row) => columns.map((at) => row[at] ?? [])),
    },
  ];
}

/** A row's cells in the order they stand, a header's and a body's alike. */
function cellsOf(row: readonly Piece<RootContent>[]): readonly (readonly Piece<RootContent>[])[] {
  const cells: Piece<RootContent>[][] = [];

  for (let at = 0; at < row.length; at += 1) {
    const token = row[at]?.token;

    if (token?.kind !== HTML_TOKEN.OPEN || (token.name !== "th" && token.name !== "td")) continue;
    const end = closeAt(row, at, token.name);
    cells.push(row.slice(at + 1, end));
    at = end;
  }

  return cells;
}

/** A `<ul>` or an `<ol>` as a list, each `<li>` an item of its own blocks, a numbered one counting from its `start`. */
function htmlListBlock(
  token: Extract<HtmlToken, { kind: "open" }>,
  inner: readonly Piece<RootContent>[],
  reader: Reader,
): MarkdownBlock {
  const start = Number.parseInt(token.attributes.get("start") ?? "1", 10);

  return {
    kind: MARKDOWN_BLOCK.LIST,
    start: token.name === "ol" ? (Number.isNaN(start) ? 1 : start) : undefined,
    items: wrapped(inner, "li").map((item) => ({
      checked: undefined,
      blocks: htmlBlocksOf(item, reader),
    })),
  };
}

/** What a block tag of GitHub's draws from the pieces it wraps; none for a tag that is no block's. */
function htmlTagBlocks(
  token: Extract<HtmlToken, { kind: "open" }>,
  inner: readonly Piece<RootContent>[],
  reader: Reader,
): MarkdownBlock[] | undefined {
  const level = HEADING_TAGS.get(token.name);

  if (level !== undefined) {
    return [{ kind: MARKDOWN_BLOCK.HEADING, level, runs: htmlLine(inner, reader) }];
  }

  switch (token.name) {
    case "details":
      return [detailsBlock(inner, reader)];
    case "table":
      return htmlTableBlocks(inner, reader);
    case "ul":
    case "ol":
      return [htmlListBlock(token, inner, reader)];
    case "blockquote":
      return [{ kind: MARKDOWN_BLOCK.QUOTE, blocks: htmlBlocksOf(inner, reader) }];
    case "pre":
      return [
        { kind: MARKDOWN_BLOCK.CODE, text: piecesWords(asInline(inner)).replace(/^\n/u, "") },
      ];
    case "hr":
      return [{ kind: MARKDOWN_BLOCK.RULE }];
    default:
      return UNSEEN_TAGS.has(token.name) ? [] : undefined;
  }
}

/**
 * Blocks of GitHub's words, read across the raw HTML among them as
 * GitHub's page reads it: each Markdown node as it draws; a folded
 * section, a table, a list, a quote, preformatted words, a heading and a
 * rule from their tags; a paragraph's tag ending the words before it; and
 * every other tag and its words read into the line around them
 * (`inlinesOf`), so a tag the app draws nothing for is unseen, never
 * printed.
 */
function htmlBlocksOf(pieces: readonly Piece<RootContent>[], reader: Reader): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let line: Piece<PhrasingContent>[] = [];

  const close = () => {
    blocks.push(...lineBlocks(line, reader));
    line = [];
  };

  for (let at = 0; at < pieces.length; at += 1) {
    const piece = pieces[at];

    if (piece === undefined) continue;

    if (piece.node !== undefined) {
      close();
      blocks.push(...blockOf(piece.node, reader));
      continue;
    }

    const { token } = piece;

    // Note that only a block's tag is matched to where it closes, and only within `MAX_HTML_DEPTH`, so tags left open never send the read back over the words after them again and again.
    const block =
      token.kind === HTML_TOKEN.OPEN &&
      (BLOCK_TAGS.has(token.name) || UNSEEN_TAGS.has(token.name)) &&
      withinDepth(reader)
        ? token
        : undefined;

    const end = block === undefined || block.alone ? at : closeAt(pieces, at, block.name);

    const drawn =
      block === undefined
        ? undefined
        : htmlTagBlocks(block, pieces.slice(at + 1, end), deeper(reader));

    if (drawn !== undefined) {
      close();
      blocks.push(...drawn);
      at = end;
    } else if (token.kind !== HTML_TOKEN.TEXT && BOUNDARY_TAGS.has(token.name)) {
      close();
    } else {
      line.push({ token });
    }
  }

  close();

  return blocks;
}

/** A chip as VoiceOver hears it where nothing more is known of it: by its kind and name. */
function chipHeardAsWritten(chip: MarkdownChip): string {
  return chip.heard;
}

/** A suggestion as VoiceOver hears it where nothing more is known of it: by the words it was written with. */
function suggestionHeardAsWritten(suggestion: MarkdownSuggestion): string {
  return suggestion.words;
}

/** How a line's chips and suggestions are heard. */
interface LineHearing {
  readonly chip: (chip: MarkdownChip) => string;
  readonly suggestion: (suggestion: MarkdownSuggestion) => string;
}

/** A run's words as VoiceOver hears them, each chip and suggestion as `hearing` says it. */
function heardRun(run: MarkdownRun, hearing: LineHearing): string {
  switch (run.kind) {
    case MARKDOWN_RUN.WORDS:
    case MARKDOWN_RUN.CODE:
      return run.text;
    case MARKDOWN_RUN.LINK:
      return run.runs.map((each) => heardRun(each, hearing)).join("");
    case MARKDOWN_RUN.CHIP:
      return hearing.chip(run.chip);
    case MARKDOWN_RUN.SUGGESTION:
      return hearing.suggestion(run.suggestion);
    case MARKDOWN_RUN.PICTURE:
      return run.name;
    case MARKDOWN_RUN.BREAK:
      return "\n";
  }
}

/** Whether a run is a chip or holds one. */
function holdsChip(run: MarkdownRun): boolean {
  if (run.kind === MARKDOWN_RUN.LINK) return run.runs.some(holdsChip);

  return (
    run.kind === MARKDOWN_RUN.CHIP ||
    run.kind === MARKDOWN_RUN.SUGGESTION ||
    run.kind === MARKDOWN_RUN.PICTURE
  );
}

/**
 * A line's words as VoiceOver hears them where it holds a chip, each chip as
 * `chipHeard` says it, by its kind and name unless the caller knows more of
 * it, such as a GitHub page's title and state; nothing where it holds none, since its words are heard
 * as drawn. Note that a chip stands in the line as a view, which iOS never
 * hears inside a run of text, so a line read without this says
 * "Pull request:" and stops.
 */
export function heardLine(
  runs: readonly MarkdownRun[],
  chipHeard: (chip: MarkdownChip) => string = chipHeardAsWritten,
  suggestionHeard: (suggestion: MarkdownSuggestion) => string = suggestionHeardAsWritten,
): string | undefined {
  const hearing = { chip: chipHeard, suggestion: suggestionHeard };

  return runs.some(holdsChip) ? runs.map((run) => heardRun(run, hearing)).join("") : undefined;
}

/**
 * Whether Markdown draws anything at all once read, such as a pull request
 * body that holds only a template's HTML comments. Note that the reader's
 * repository, clock and zone only name chips and dates, never whether a
 * block stands, so none is asked for.
 */
export function markdownShows(
  words: string,
  { githubHtml }: Pick<MarkdownReading, "githubHtml">,
): boolean {
  return markdownBlocks(words, { repository: null, now: 0, zone: "UTC", githubHtml }).length > 0;
}

/** Markdown as the blocks the app draws, read as the panel reads it; words nested too deep to parse safely are one block of plain text. */
export function markdownBlocks(words: string, reading: MarkdownReading): readonly MarkdownBlock[] {
  if (markdownTooDeep(words)) return [{ kind: MARKDOWN_BLOCK.CODE, text: words }];
  const tree = markdownTree(words);

  const spelled = reading.pictures === undefined ? undefined : spelledMarkers(words);

  return blocksOf(tree.children, { reading, definitions: definitionsIn(tree), spelled });
}
