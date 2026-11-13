import { CUT_PART_WORDS, cutPartText, WHOLE_PART } from "@repo/features/agent-parts";
import {
  AGENT_TODO_STATUS,
  type AgentTodoStatus,
  type AgentTodos,
} from "@repo/features/agent-wire";
import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { GLYPH_STATE } from "@repo/features/glyph-state";
import type { IntegrationProvider } from "@repo/features/integration-wire";
import { GITHUB_DEFAULT_BRANCH, GITHUB_PAGE, gitHubPageLink } from "@repo/features/link-grammar";
import { mayNameChip } from "@repo/features/mention-link";
import type { CatalogModel, ModelChoice } from "@repo/features/models-wire";
import { cardTitle } from "@repo/features/plain-words";
import { readReplyButtonLink } from "@repo/features/reply-button-wire";
import {
  blockSays,
  TOOL_BLOCK,
  TOOL_STATE,
  type ToolBlock,
  type ToolState,
} from "@repo/features/tool-call-block";
import { type SentWords, todosCount } from "@repo/features/tool-call-model";
import {
  agentCallLine,
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  type CallLine,
  calledFile,
  callLine,
  callPlace,
  isAgentCallKind,
  isCommandKind,
  type MadeCallKind,
  madeCallLine,
  moreFiles,
  sameFieldsBy,
  sameTurnRow,
  siteName,
  TURN_ROW,
  type TurnRow,
} from "@repo/features/turn-rows";
import { keyWordsIn } from "@repo/features/workspace-key";
import {
  DISCLOSURE_BODY,
  DISCLOSURE_LOOK,
  DISCLOSURE_SUMMARY,
  Disclosure,
  DisclosureBody,
  DisclosureChevron,
  DisclosureSummary,
  FAILURE_NOTE_TIME,
  FailureNote,
  GAP,
  GLYPH_ARRIVAL,
  GLYPH_INK,
  GlyphSlot,
  INLINE_REF_LOOK,
  InlineRef,
  LAYOUT_ELEMENT,
  LineButton,
  LineRow,
  NOTE_LINE_LOOK,
  NoteLine,
  OneLine,
  ProviderMark,
  RollingNumber,
  Shimmer,
  Stack,
  TEXT_ELEMENT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  TextLink as UiTextLink,
  useDisclosurePreviewShown,
  useDisclosureState,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@repo/ui/actor-model";
import {
  githubRedress,
  INLINE_PICTURE,
  inlinePictures,
  pictureFor,
  wholeRendering,
} from "@repo/ui/github-html";
import {
  AlarmClockCheckIcon,
  AlarmClockOffIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarCogIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  CircleCheckIcon,
  CircleDotDashedIcon,
  CircleIcon,
  CirclePlusIcon,
  CircleStopIcon,
  CornerDownRightIcon,
  CpuIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderInputIcon,
  FolderMinusIcon,
  FolderPlusIcon,
  GLYPH,
  GlobeIcon,
  HourglassIcon,
  ImageIcon,
  InboxIcon,
  LaptopIcon,
  LayoutListIcon,
  LinkIcon,
  type LucideIcon,
  MonitorIcon,
  PencilLineIcon,
  PlayIcon,
  PlugIcon,
  ScrollTextIcon,
  SearchIcon,
  SendIcon,
  TerminalIcon,
  TimerIcon,
  UnlinkIcon,
  WrenchIcon,
} from "@repo/ui/icons";
import {
  MARKDOWN_HTML_STEP,
  type MarkdownComponents,
  type MarkdownNodeProps,
  type MarkdownSteps,
  type MarkdownTaskTick,
  TRANSCRIPT_REMARK_STEPS,
} from "@repo/ui/markdown";
import { QUOTE_CLASS } from "@repo/ui/quote-face";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { Predicate } from "effect";
import {
  type ComponentProps,
  type ComponentType,
  createContext,
  Fragment,
  type MouseEvent,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import remarkBreaks from "remark-breaks";
import { ActorGlyph, ActorLine, ActorRef } from "../actor-ref.js";
import { FoldBody } from "../ai-elements/fold.js";
import { MessageResponse } from "../ai-elements/message.js";
import {
  REASONING_BODY_CLASS,
  REASONING_WORDS_CLASS,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../ai-elements/reasoning.js";
import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolHeaderProps,
  ToolInput,
  ToolLine,
  ToolOutput,
  ToolStateMark,
  ToolSummary,
  ToolTerminal,
} from "../ai-elements/tool.js";
import { useDrawnDark } from "../drawn-dark.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { FIND_DETAIL, FindDetailFolds } from "../find-in-tab.js";
import { OUTSIDE_GLYPH_CLASS } from "../picture-block.js";
import { StateGlyph } from "../state-glyph.js";
import { TextLink } from "../text-link.js";
import { KeptAppIcon } from "./agent-pictures.js";
import { useDescriptionPictureDrawer } from "./description-pictures.js";
import { useInboxPictureDrawer } from "./inbox-pictures.js";
import {
  INLINE_CODE_TARGET,
  type InlineCodeTarget,
  inlineCodeTarget,
} from "./inline-code-target.js";
import { LoneLinkCard } from "./lone-link-card.js";
import { fileChip, linkChip, type MentionDoors } from "./mention-chip.js";
import { ModelLabel } from "./model-label.js";
import { ReplyButtonLink } from "./reply-button-link.js";
import { SubagentMark } from "./tab-look.js";
import { useMentionDoors } from "./task-mentions.js";
import {
  TRANSCRIPT_CODE_AND_TABLE_COMPONENTS,
  TranscriptMarkdownSource,
} from "./transcript-markdown.js";
import { useWordTargets } from "./use-known-names.js";
import { opensAsLink, useOpenLink } from "./use-open-link.js";
import type { CutBody } from "./whole-parts.js";
import { WorkingTime } from "./working-time.js";

/**
 * transcript-blocks.tsx -- the one way a transcript's blocks are drawn, on a coding agent's tab and a subagent's alike.
 *
 * Each tab decides what its rows say from its own wire
 * (`agent-model.ts` with `tool-call-model.ts`); how a block of each kind looks is decided here
 * once, over the AI Elements components (`../ai-elements/`): words as
 * markdown at the panel's scale with a web link opening in the browser, reasoning folded under one quiet line
 * previewing its words, a tool call as one collapsible row wearing its kind's icon and verb
 * (`turn-rows.ts`) that opens onto its input and its answer, a run of
 * calls folded under one line saying how many, a finished turn's lead
 * folded under what it holds, a subagent's row as one line like a call's
 * that opens its tab, a call about something drawn in a tab of its own as
 * its line that opens that tab, an agent's to-do list as a call's row that opens onto
 * the list, and a note between the rows. A
 * tab that drew one of these its own way would be a second transcript
 * style, which is what this file is here to refuse.
 */

/**
 * An address the window opens nothing for, a file's say: a link's line,
 * dotted, with the address as its hint.
 */
export const INERT_LINK_CLASS =
  "text-link-inert underline decoration-dotted decoration-inert-link decoration-1 underline-offset-[0.24em]";

/**
 * A link in a transcript's words. A web page, such as the pull request an
 * agent opened or the docs it read, is a plain link (`../text-link.tsx`)
 * that opens in the browser over the act channel (`use-open-link.ts`), as
 * it is in a description, bare or labeled; any other address is drawn as words
 * that go nowhere, with the address as its hint. `words` are its label's,
 * which say whether it is its own address.
 * Note that the press is ours rather than Streamdown's, because Streamdown's
 * link asks in a modal of its own and then calls `window.open`, which the
 * window denies (`hardened-window.ts`), so its link opened nothing.
 */
function TranscriptLink({
  href,
  words,
  children,
}: {
  href: string | undefined;
  words: string;
  children: ReactNode;
}): ReactNode {
  const openLink = useOpenLink();

  if (href === undefined || !opensAsLink(href)) {
    return (
      <Tooltip label={href}>
        <span className={INERT_LINK_CLASS}>{children}</span>
      </Tooltip>
    );
  }

  return (
    <TextLink href={href} words={words} onOpen={openLink}>
      {children}
    </TextLink>
  );
}

/**
 * A page of the web as a chip: a globe and its site, its whole address in
 * its hint, opening in the browser (`use-open-link.ts`). Note that it
 * fetches no favicon, because that would tell a third party every page a
 * transcript names; and that the press stops at the chip, because a call's
 * row it stands in would fold.
 */
function SiteChip({ href }: { href: string }): ReactNode {
  const openLink = useOpenLink();

  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={<GLYPH.WEBSITE />}
      label={siteName(href) ?? href}
      hintLabel={href}
      onPress={(event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        openLink(href);
      }}
      linkHref={href}
      leaves
      data-site-chip=""
    />
  );
}

/** The element a mention's link is drawn as, and the one attribute that carries its target to the chip. */
const MENTION_ELEMENT = {
  TAG: "app-mention",
  TARGET: "to",
} as const;

/** The element a task's key written among the words is drawn as, and the attribute that carries the key to its chip. */
const TASK_KEY_ELEMENT = {
  TAG: "app-task-key",
  KEY: "named",
} as const;

/** The element a picture's Markdown is drawn as, and the attributes that carry its address, its words, and its caption. */
const PICTURE_ELEMENT = {
  TAG: "app-picture",
  ADDRESS: "to",
  WORDS: "words",
  CAPTION: "caption",
} as const;

/** The element a paragraph holding a link alone is drawn as in words drawn as a document, and the attributes that carry the link's target and its words. */
const LONE_LINK_ELEMENT = {
  TAG: "app-lone-link",
  TARGET: "to",
  WORDS: "words",
} as const;

/** The element a paragraph holding pictures alone is drawn as in words drawn as a document, which stands them side by side. */
const PICTURE_ROW_ELEMENT = {
  TAG: "app-pictures",
  CLASS: "transcript-pictures",
} as const;

/** The mention's element, a task key's, and the picture's, and a document's paragraphs of either, let through the drawing's sanitizer with what each carries. */
const MENTION_TAGS = {
  [MENTION_ELEMENT.TAG]: [MENTION_ELEMENT.TARGET],
  [TASK_KEY_ELEMENT.TAG]: [TASK_KEY_ELEMENT.KEY],
  [PICTURE_ELEMENT.TAG]: [PICTURE_ELEMENT.ADDRESS, PICTURE_ELEMENT.WORDS, PICTURE_ELEMENT.CAPTION],
  [LONE_LINK_ELEMENT.TAG]: [LONE_LINK_ELEMENT.TARGET, LONE_LINK_ELEMENT.WORDS],
  [PICTURE_ROW_ELEMENT.TAG]: [],
};

/** A node of the words, as markdown reads them or as they are drawn, as much of one as its words are told by. */
interface WordsNode {
  readonly type: string;
  readonly value?: string;
  readonly children?: readonly WordsNode[];
}

/** A node of the words as markdown reads them, which a mention's link is marked on: a link's target, or the label a reference link and its definition share. */
interface MarkdownNode extends WordsNode {
  readonly url?: string;
  readonly alt?: string | null;
  readonly title?: string | null;
  readonly identifier?: string;
  children?: readonly MarkdownNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

/** The words under a node, however they are formatted. */
function wordsOf(node: WordsNode): string {
  if (node.type === "text") return node.value ?? "";

  return (node.children ?? []).map((child) => wordsOf(child)).join("");
}

/**
 * Marks every link in the words whose target may be drawn as a chip
 * (`mayNameChip`), to be drawn as its own element,
 * which reads what it names against the plan its page is of (`linkChip`):
 * the same rule for a developer's `@`
 * mention, an agent's link, a reference link, and a bare address. A target
 * is read here before the page's repository is known,
 * so every page of GitHub's is marked, and every other link is drawn as
 * the library draws it. Note that the mark is made on the markdown, before
 * it is drawn, because the drawing's sanitizer keeps no address on a link
 * but the web's, so a mention's target would never reach a link of ours.
 * Code holds no link, so a mention in code stays code.
 */
function markMentions(node: MarkdownNode, definitions: ReadonlyMap<string, MarkdownNode>): void {
  const target =
    node.type === "link"
      ? node.url
      : node.type === "linkReference" && node.identifier !== undefined
        ? definitions.get(node.identifier)?.url
        : undefined;

  if (target !== undefined && (mayNameChip(target) || readReplyButtonLink(target) !== undefined)) {
    node.data = {
      hName: MENTION_ELEMENT.TAG,
      hProperties: { [MENTION_ELEMENT.TARGET]: target },
    };

    return;
  }

  for (const child of node.children ?? []) markMentions(child, definitions);
}

/** Each link definition in the words, its address and its title, by the label a reference names it with, the first standing where one is defined twice, as markdown reads them. */
function definitionsIn(
  node: MarkdownNode,
  found: Map<string, MarkdownNode> = new Map(),
): Map<string, MarkdownNode> {
  if (node.type === "definition" && node.identifier !== undefined && node.url !== undefined) {
    if (!found.has(node.identifier)) found.set(node.identifier, node);
  }

  for (const child of node.children ?? []) definitionsIn(child, found);

  return found;
}

/**
 * Marks every picture in the words to be drawn as its own element, which
 * names it as a link to where it points and never fetches it, because a
 * picture an agent writes is a request to wherever its address points the
 * moment the tab opens, and a model's words must make none; the pictures an
 * agent shows are its `show_image` calls'. The pictures drawn are a description's
 * own, inside the description's card, and an Inbox item's own, inside its pane,
 * each read through the host (`description-pictures.tsx`, `inbox-pictures.tsx`)
 * rather than from its address. Note that the mark is
 * made on the markdown, before the drawing's hardening reads a picture at
 * all, which draws a relative one as a placeholder of its own and an
 * absolute one as nothing.
 */
function markPictures(node: MarkdownNode, definitions: ReadonlyMap<string, MarkdownNode>): void {
  // A reference's address and caption are its definition's.
  const source =
    node.type === "image"
      ? node
      : node.type === "imageReference" && node.identifier !== undefined
        ? definitions.get(node.identifier)
        : undefined;

  if (node.type === "image" || node.type === "imageReference") {
    node.data = {
      hName: PICTURE_ELEMENT.TAG,
      hProperties: {
        [PICTURE_ELEMENT.ADDRESS]: source?.url ?? "",
        [PICTURE_ELEMENT.WORDS]: node.alt ?? "",
        [PICTURE_ELEMENT.CAPTION]: source?.title ?? "",
      },
    };

    return;
  }

  for (const child of node.children ?? []) markPictures(child, definitions);
}

/** Whether a node of a paragraph says nothing: a run of whitespace, or a line break. */
function blank(node: MarkdownNode): boolean {
  return node.type === "break" || (node.type === "text" && (node.value ?? "").trim() === "");
}

/** Whether a node of a paragraph is a picture, written whole or by reference. */
function isPicture(node: MarkdownNode): boolean {
  return node.type === "image" || node.type === "imageReference";
}

/**
 * Marks each paragraph of words drawn as a document that holds pictures
 * alone, the line breaks and spaces between them aside, to be drawn as a
 * row of them, so two written next to each other, a before and an after,
 * stand side by side. Note that the spaces between them go, since a row
 * lays out its pictures and nothing else.
 */
function markPictureRows(node: MarkdownNode): void {
  const said = (node.children ?? []).filter((child) => !blank(child));

  if (node.type === "paragraph" && said.length > 0 && said.every(isPicture)) {
    node.data = { hName: PICTURE_ROW_ELEMENT.TAG };
    node.children = said;

    return;
  }

  for (const child of node.children ?? []) markPictureRows(child);
}

/**
 * Marks each paragraph of words drawn as a document that holds one link
 * and nothing else, the spaces around it aside, to be drawn as the card of
 * what the link names (`lone-link-card.tsx`). Note that only a paragraph
 * standing on its own counts, never one in a list or a quote, where a
 * link is one of a run rather than a line of its own.
 */
function markLoneLinks(tree: MarkdownNode, definitions: ReadonlyMap<string, MarkdownNode>): void {
  for (const paragraph of tree.children ?? []) {
    const said = (paragraph.children ?? []).filter((child) => !blank(child));
    const [link] = said;

    if (paragraph.type !== "paragraph" || said.length !== 1 || link === undefined) continue;

    const target =
      link.type === "link"
        ? link.url
        : link.type === "linkReference" && link.identifier !== undefined
          ? definitions.get(link.identifier)?.url
          : undefined;

    if (target === undefined) continue;
    paragraph.data = {
      hName: LONE_LINK_ELEMENT.TAG,
      hProperties: { [LONE_LINK_ELEMENT.TARGET]: target, [LONE_LINK_ELEMENT.WORDS]: wordsOf(link) },
    };
  }
}

/**
 * What a task's key written among the words stands as once it is marked:
 * a node of its own rather than a link of markdown's, so it is drawn as its
 * task's chip (`TaskKeyElement`) and held with its punctuation as a mention
 * is, yet never read as a link standing alone in its paragraph, which a
 * document draws as a card.
 */
const KEY_NODE = "taskKey";

/** The nodes whose words hold no key: code, which is read literally, links and pictures, which already go somewhere, raw HTML, and a key already marked. */
const KEYLESS_NODES: ReadonlySet<string> = new Set([
  "code",
  "inlineCode",
  "link",
  "linkReference",
  "definition",
  "image",
  "imageReference",
  "html",
  KEY_NODE,
]);

/** A run of text with each word shaped like a task's key marked as its task's chip, the words between left as they were. */
function keyedRun(text: MarkdownNode): MarkdownNode[] {
  const value = text.value ?? "";
  const spans = keyWordsIn(value);

  if (spans.length === 0) return [text];
  const run: MarkdownNode[] = [];
  let from = 0;

  for (const span of spans) {
    if (span.start > from) run.push({ type: "text", value: value.slice(from, span.start) });
    run.push({
      type: KEY_NODE,
      data: { hName: TASK_KEY_ELEMENT.TAG, hProperties: { [TASK_KEY_ELEMENT.KEY]: span.key } },
      children: [{ type: "text", value: span.key }],
    });
    from = span.end;
  }

  if (from < value.length) run.push({ type: "text", value: value.slice(from) });

  return run;
}

/**
 * Marks each word shaped like a task's key among the words (`ACME-42`) to
 * be drawn as its task's chip, which says the key as written, wears the
 * task's status, and hangs its card, where the window lists a task by it.
 * Note that which task a key names is read as it is drawn
 * (`TaskKeyElement`), never here, because its library reads each block of
 * words once, so a key read here would never follow the tasks listed after
 * it, and words drawn again whole as they are listed would load every page
 * drawn among them again. The words themselves are left as written, so an
 * agent reading them reads the key, and a key in code, a link, or a
 * picture's words is left alone.
 */
function markTaskKeys(node: MarkdownNode): void {
  if (node.children === undefined || KEYLESS_NODES.has(node.type)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text") return keyedRun(child);
    markTaskKeys(child);

    return [child];
  });
}

/** The step that marks the words shaped like tasks' keys, named apart as every step is. */
function markTaskKeysStep(): (tree: MarkdownNode) => void {
  return markTaskKeys;
}

/** The step that marks a transcript's links and its pictures, a reference's read through its definition. */
function markLinks(tree: MarkdownNode): void {
  const definitions = definitionsIn(tree);
  markMentions(tree, definitions);
  markPictures(tree, definitions);
}

/** The step that marks words drawn as a document: a transcript's marks, then its rows of pictures and its links standing alone. */
function markDocument(tree: MarkdownNode): void {
  const definitions = definitionsIn(tree);
  markMentions(tree, definitions);
  markPictures(tree, definitions);
  markPictureRows(tree);
  markLoneLinks(tree, definitions);
}

/** What a picture with no words of its own is called where it is named. */
const UNNAMED_PICTURE = "Picture";

/**
 * A picture in a transcript's words: a description's own picture drawn as the description
 * draws it where its words stand inside `DescriptionPictures`, as the description's card
 * does, and an Inbox item's own where they stand inside `InboxPictures`
 * (`inbox-pictures.tsx`); any other a link to where it points, with the
 * picture's glyph, never drawn.
 */
function PictureElement({ node }: MarkdownNodeProps): ReactNode {
  const descriptionPicture = useDescriptionPictureDrawer();
  const inboxPicture = useInboxPictureDrawer();
  const address = String(node?.properties[PICTURE_ELEMENT.ADDRESS] ?? "");
  const said = String(node?.properties[PICTURE_ELEMENT.WORDS] ?? "");
  const caption = String(node?.properties[PICTURE_ELEMENT.CAPTION] ?? "");

  if (descriptionPicture !== undefined && descriptionAttachmentOf(address) !== undefined) {
    return descriptionPicture(address, said, caption === "" ? undefined : caption);
  }

  // An Inbox item's own picture, where its words stand inside `InboxPictures`.
  const itemPicture = inboxPicture?.(address, said, caption === "" ? undefined : caption);

  if (itemPicture !== undefined) return itemPicture;
  const words = said === "" ? UNNAMED_PICTURE : said;

  return (
    <TranscriptLink href={address === "" ? undefined : address} words={words}>
      <ImageIcon className={OUTSIDE_GLYPH_CLASS} aria-hidden="true" />
      {words}
    </TranscriptLink>
  );
}

/** The plugin that marks a transcript's links. */
function markLinksStep(): (tree: MarkdownNode) => void {
  return markLinks;
}

/**
 * The plugin that marks a document's links, pictures, and paragraphs. Note
 * that each step is a function named apart, because the library keeps one
 * processor per list of plugins and tells two lists apart by their plugins'
 * names alone, so two unnamed steps would draw a transcript with a
 * document's processor.
 */
function markDocumentStep(): (tree: MarkdownNode) => void {
  return markDocument;
}

/**
 * The steps words are read with: the library's own; for words a person
 * typed, each line break typed kept as one; the words shaped like tasks'
 * keys; then the marks on its links, a document's own marks among
 * them where the words are drawn as one. Note that Markdown joins two lines
 * with no blank line between them into one, which is right for words a
 * model wrote and wrong for words a person typed line by line into a box
 * whose Enter is a new line, as GitHub keeps a comment's line breaks for the
 * same reason.
 */
function remarkPluginsFor(typed: boolean, asDocument: boolean): MarkdownSteps {
  return [
    ...TRANSCRIPT_REMARK_STEPS,
    ...(typed ? [remarkBreaks] : []),
    markTaskKeysStep,
    asDocument ? markDocumentStep : markLinksStep,
  ];
}

/**
 * A link in a transcript's words: the chip that opens what it names
 * (`mention-chip.tsx`) where its target names a mention, read against the
 * task's page it is drawn on, or the window's doors off one; a link as any
 * other is where it names none.
 */
function MentionElement({
  node,
  children,
}: MarkdownNodeProps & { children?: ReactNode }): ReactNode {
  const doors = useMentionDoors();
  const target = String(node?.properties[MENTION_ELEMENT.TARGET] ?? "");
  const words = node === undefined ? "" : wordsOf(node);
  const button = readReplyButtonLink(target);

  if (button !== undefined) {
    return (
      <ReplyButtonLink
        link={button}
        words={words}
        plain={(href) => (
          <TranscriptLink href={href} words={words}>
            {children}
          </TranscriptLink>
        )}
      />
    );
  }

  const chip = node === undefined ? undefined : linkChip(target, words, doors);

  return (
    chip ?? (
      <TranscriptLink href={target} words={words}>
        {children}
      </TranscriptLink>
    )
  );
}

/**
 * A task's key written in a transcript's words: its task's chip where the
 * window lists a task by it (`useWordTargets`), as a link to the task is
 * drawn (`MentionElement`), and the key as written where it lists none. It
 * is read as it is drawn, so the chip follows the tasks as they are listed
 * while the words around it stand.
 */
function TaskKeyElement({
  node,
  children,
}: MarkdownNodeProps & { children?: ReactNode }): ReactNode {
  const doors = useMentionDoors();
  const key = String(node?.properties[TASK_KEY_ELEMENT.KEY] ?? "");
  const target = useWordTargets().get(key);

  return (target === undefined ? undefined : linkChip(target, key, doors)) ?? children;
}

/** A link standing alone in its paragraph of a document: the card of what it names, or the paragraph as it was where it earns none (`lone-link-card.tsx`). */
function LoneLinkElement({
  node,
  children,
}: MarkdownNodeProps & { children?: ReactNode }): ReactNode {
  const target = String(node?.properties[LONE_LINK_ELEMENT.TARGET] ?? "");
  const words = String(node?.properties[LONE_LINK_ELEMENT.WORDS] ?? "");

  return <LoneLinkCard target={target} words={words} fallback={<p>{children}</p>} />;
}

/** A document's paragraph of pictures alone: the pictures side by side, sharing its width. */
function PictureRowElement({ children }: MarkdownNodeProps & { children?: ReactNode }): ReactNode {
  // Side by side, sharing the column's width, so a before and an after read as a pair, and wrapping where more would leave each too narrow; each still hugs its own picture, and none grows past its own size (tasks.css).
  return (
    <div
      className={`${PICTURE_ROW_ELEMENT.CLASS} my-block-gap grid grid-cols-picture-row items-start gap-block-gap`}
    >
      {children}
    </div>
  );
}

/*
 * An inline span of code whose whole words are a file's path or a web
 * address opens what it names (`inline-code-target.ts`), its code drawn as
 * it is and a link only under the pointer: a file in its File tab, at the
 * line it names, through the place's one door for a file, as a mention of
 * the file opens it; a page as every link in the words opens one
 * (`use-open-link.ts`).
 */

/** A file's address on GitHub, at its line, which its link carries for the reader's link menu; the press opens its File tab. */
function fileAddress(repository: string, path: string, line: number | undefined): string {
  const file = { kind: GITHUB_PAGE.FILE, repository, ref: GITHUB_DEFAULT_BRANCH, path } as const;

  return gitHubPageLink(
    line === undefined ? file : { ...file, lines: { startLine: line, endLine: line } },
  );
}

/**
 * An inline span of code that opens a file of the checkout: its File tab,
 * at the line it names, through the place's door for a file. Note that a
 * file the checkout does not hold opens a File tab saying so, as a mention
 * of a file gone does, rather than a toast or nothing, and that where the
 * place opens no file the span is plain code.
 */
function InlineFileCode({
  target,
  children,
}: {
  target: Extract<InlineCodeTarget, { kind: typeof INLINE_CODE_TARGET.FILE }>;
  children: ReactNode;
}): ReactNode {
  const { onOpenFile, place } = useMentionDoors();
  const { repository } = place;

  if (onOpenFile === undefined || repository === null) return children;
  const { path, line } = target;

  return (
    <UiTextLink
      href={fileAddress(repository, path, line)}
      look={TEXT_LINK_LOOK.CODE}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenFile(path, line === undefined ? undefined : { startLine: line, endLine: line });
      }}
    >
      {children}
    </UiTextLink>
  );
}

/** An inline span of code that is a web address: a link to it, opened as every link in the words is. */
function InlineWebCode({ href, children }: { href: string; children: ReactNode }): ReactNode {
  const openLink = useOpenLink();

  return (
    <TextLink href={href} words={undefined} onOpen={openLink} look={TEXT_LINK_LOOK.CODE}>
      {children}
    </TextLink>
  );
}

/** An inline span of code on its subtle fill, opening the file or the page its whole words name, where they name one. */
function TranscriptInlineCode({
  children,
  node,
}: ComponentProps<"code"> & MarkdownNodeProps): ReactNode {
  const words = node === undefined ? "" : wordsOf(node);
  const target = useMemo(() => inlineCodeTarget(words), [words]);
  const code = <code className="transcript-inline-code">{children}</code>;

  if (target === undefined) return code;

  return target.kind === INLINE_CODE_TARGET.FILE ? (
    <InlineFileCode target={target}>{code}</InlineFileCode>
  ) : (
    <InlineWebCode href={target.href}>{code}</InlineWebCode>
  );
}

/**
 * How a transcript's markdown is drawn: at the panel's scale, its code and
 * tables as `transcript-markdown.tsx` draws them, an inline span of code
 * naming a file or a page as {@link TranscriptInlineCode}, its links as
 * {@link TranscriptLink}, and its pictures as links to where they point
 * ({@link PictureElement}), never as an image, because an image is a
 * request to wherever its address points the moment the tab opens, and
 * nothing said on a call or written by a model should make one.
 */
const TRANSCRIPT_COMPONENTS: MarkdownComponents = {
  ...TRANSCRIPT_CODE_AND_TABLE_COMPONENTS,
  inlineCode: TranscriptInlineCode,
  a: ({ href, children, node }) => (
    <TranscriptLink href={href} words={node === undefined ? "" : wordsOf(node)}>
      {children}
    </TranscriptLink>
  ),
  [MENTION_ELEMENT.TAG]: MentionElement,
  [TASK_KEY_ELEMENT.TAG]: TaskKeyElement,
  [PICTURE_ELEMENT.TAG]: PictureElement,
  [LONE_LINK_ELEMENT.TAG]: LoneLinkElement,
  [PICTURE_ROW_ELEMENT.TAG]: PictureRowElement,
  img: () => null,
};

/**
 * How a picture GitHub's rendering names is drawn by the place drawing the
 * words: its own image, read through the service, or nothing where the
 * place draws none, which draws its link instead. `inline` says it stands
 * in a line of words or inside a link the words keep, a press on which
 * follows the link, so the place draws it in that line as GitHub does, with
 * no press of its own. `written` is what its author wrote on it: its width
 * and height in pixels, which GitHub draws it at, as a bot's 16-pixel glyph
 * is, and where it stands in its line (`align`).
 */
export type GitHubPictureDrawer = (
  src: string,
  alt: string,
  inline: boolean,
  written: GitHubPictureWritten,
) => ReactNode | undefined;

/**
 * Where a picture stands in its line by the `align` its author wrote, as a
 * browser draws HTML's `align` and so GitHub does: `middle` sets the
 * picture's middle on the words' baseline, as a bot's glyph beside a name
 * is written (`-webkit-baseline-middle`, as Chromium and WebKit draw it),
 * and `absmiddle` on the middle of their small letters. Keyed by HTML's own
 * words; `left` and `right`, which float a picture, are left out.
 */
const WRITTEN_ALIGN = {
  middle: "-webkit-baseline-middle",
  center: "-webkit-baseline-middle",
  absmiddle: "middle",
  abscenter: "middle",
  top: "top",
  texttop: "text-top",
  bottom: "baseline",
  baseline: "baseline",
  absbottom: "bottom",
} as const;

type WrittenAlign = (typeof WRITTEN_ALIGN)[keyof typeof WRITTEN_ALIGN];

const ALIGN_BY_WORD: ReadonlyMap<string, WrittenAlign> = new Map(Object.entries(WRITTEN_ALIGN));

/** What a picture's author wrote on it: its width and height in pixels, and where it stands in its line; each unset where none is written. */
export interface GitHubPictureWritten {
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly align: WrittenAlign | undefined;
}

/** A size attribute as the drawn tree hands it, a number or its words, read as pixels; none where it is no positive number, as a percentage is not. */
function pixelsOf(value: string | number | undefined): number | undefined {
  const pixels = Predicate.isNumber(value) ? value : Number(value);

  return Number.isFinite(pixels) && pixels > 0 ? pixels : undefined;
}

/** An `align` attribute's word, read as where the picture stands in its line; none where it names no place a line holds. */
function alignOf(word: string): WrittenAlign | undefined {
  return ALIGN_BY_WORD.get(word.toLowerCase());
}

/** Whether what is drawn stands inside a link of GitHub's words. */
const InsideGitHubLink = createContext(false);

/**
 * A picture of GitHub's words, drawn by its place, or as its link where the
 * place draws none; nothing where it is the other theme's alone
 * (`pictureFor`), as GitHub hides one.
 */
function GitHubImage({
  src,
  alt,
  inWords,
  written,
  picture,
}: {
  src: string;
  alt: string;
  inWords: boolean;
  written: GitHubPictureWritten;
  picture: GitHubPictureDrawer;
}): ReactNode {
  const linked = useContext(InsideGitHubLink);
  const shown = pictureFor(src, useDrawnDark());

  if (shown === undefined) return null;

  return (
    picture(shown, alt, inWords || linked, written) ?? <GitHubPictureLink src={shown} alt={alt} />
  );
}

/** A picture GitHub's rendering names that its place draws none of: a link to where it points, as a transcript's picture is. */
export function GitHubPictureLink({ src, alt }: { src: string; alt: string }): ReactNode {
  const words = alt === "" ? UNNAMED_PICTURE : alt;

  return (
    <TranscriptLink href={src === "" ? undefined : src} words={words}>
      <ImageIcon className={OUTSIDE_GLYPH_CLASS} aria-hidden="true" />
      {words}
    </TranscriptLink>
  );
}

/**
 * The steps GitHub's rendering is drawn through: the library's own HTML
 * parse, GitHub's dress redressed into the window's own while its classes
 * still say what each part is (`@repo/ui/github-html`), then the library's
 * own sanitizer, GitHub's own allowlist, the pictures that share a line with
 * words marked as standing in it, and the library's link hardening.
 */
const GITHUB_REHYPE_PLUGINS: MarkdownSteps = [
  MARKDOWN_HTML_STEP.PARSE,
  githubRedress,
  MARKDOWN_HTML_STEP.SANITIZE,
  inlinePictures,
  MARKDOWN_HTML_STEP.HARDEN,
];

/** The one markdown step GitHub's rendering takes: handed over whole, as HTML. */
const GITHUB_REMARK_PLUGINS = [wholeRendering];

/**
 * Words GitHub rendered (`body_html`), drawn as a transcript's words are,
 * at the panel's scale, their code and tables the transcript's, their links
 * the transcript's: GitHub's own HTML read through the library's parse and
 * sanitizer, never set as HTML. Mentions, references, emoji, task lists,
 * and folded details stand as GitHub rendered them, an alert as the
 * window's own, and a task item's box as one the reader ticks where the
 * place hands `taskTick`. A picture is the place's to draw (`picture`), in
 * its line where it shares one with words, and stands as its link where
 * the place draws none.
 */
export function GitHubWords({
  html,
  picture,
  taskTick,
}: {
  html: string;
  picture: GitHubPictureDrawer;
  /** Draws each task item's box the reader can tick, by its place among the words' boxes; every box is read-only without it. */
  taskTick?: MarkdownTaskTick | undefined;
}): ReactNode {
  const components = useMemo<MarkdownComponents>(
    () => ({
      ...TRANSCRIPT_COMPONENTS,
      a: ({ href, children, node }) => (
        <InsideGitHubLink.Provider value={true}>
          <TranscriptLink href={href} words={node === undefined ? "" : wordsOf(node)}>
            {children}
          </TranscriptLink>
        </InsideGitHubLink.Provider>
      ),
      img: ({ src, alt, width, height, node }) => (
        <GitHubImage
          src={String(src ?? "")}
          alt={String(alt ?? "")}
          inWords={node?.properties[INLINE_PICTURE] === true}
          written={{
            width: pixelsOf(width),
            height: pixelsOf(height),
            align: alignOf(String(node?.properties.align ?? "")),
          }}
          picture={picture}
        />
      ),
    }),
    [picture],
  );

  return (
    <MessageResponse
      words={html}
      components={components}
      remarkPlugins={GITHUB_REMARK_PLUGINS}
      rehypePlugins={GITHUB_REHYPE_PLUGINS}
      normalizeHtmlIndentation={false}
      taskTick={taskTick}
    />
  );
}

/**
 * The elements of the transcript's own the words are drawn with, as a skill
 * named in a sent message is drawn as its chip and a picture it names as
 * the picture's (`skill-chip.tsx`): the words with each element written in
 * where it stands, each element's tag and the attributes it carries, and
 * what draws them. Their words are taken as they are, never as markdown.
 */
export interface TranscriptElement {
  readonly markdown: string;
  readonly tags: Readonly<Record<string, readonly string[]>>;
  readonly components: MarkdownComponents;
}

/** The components and tags the elements of the transcript's own are drawn with beside the transcript's own, the same objects while the elements hand the same components and tags, which their caller keeps as constants. */
function useElementDraw(element: TranscriptElement | undefined): {
  components: MarkdownComponents;
  allowedTags: Record<string, string[]>;
  literal: string[] | undefined;
} {
  const extra = element?.components;
  const tags = element?.tags;

  return useMemo(
    () =>
      extra === undefined || tags === undefined
        ? { components: TRANSCRIPT_COMPONENTS, allowedTags: MENTION_TAGS, literal: undefined }
        : {
            components: { ...TRANSCRIPT_COMPONENTS, ...extra },
            allowedTags: {
              ...MENTION_TAGS,
              ...Object.fromEntries(Object.entries(tags).map(([tag, names]) => [tag, [...names]])),
            },
            literal: Object.keys(tags),
          },
    [extra, tags],
  );
}

/** A call's Markdown block, as a memory's words, drawn as the turn's own words are, so its links, chips, and pictures keep a reply's rules. */
function toolMarkdown(text: string): ReactNode {
  return <TranscriptWords text={text} />;
}

/**
 * A turn's words as markdown, with an element of the transcript's own
 * written in where one is given. Words still being written are read as
 * they stream (`streaming`), so each block already drawn is not parsed
 * again as the next lands; settled words are read once, whole.
 */
export function TranscriptWords({
  text,
  element,
  typed = false,
  asDocument = false,
  streaming = false,
  line = false,
}: {
  text: string;
  element?: TranscriptElement | undefined;
  /** Whether a person typed the words, whose every line break is kept (`remarkPluginsFor`). */
  typed?: boolean | undefined;
  /** Whether the words are drawn as a document, as an Inbox item's are: pictures written next to each other side by side, and a link alone in its paragraph as its card (`lone-link-card.tsx`). */
  asDocument?: boolean | undefined;
  /** Whether the words are still being written, as a running turn's newest are. */
  streaming?: boolean | undefined;
  /** Whether the words are drawn on one line, as a queued message's row draws them. */
  line?: boolean | undefined;
}): ReactNode {
  const remarkPlugins = useMemo(() => remarkPluginsFor(typed, asDocument), [typed, asDocument]);
  const { components, allowedTags, literal } = useElementDraw(element);

  // Note that the source stays the words as written, because a code block's copy reads it.
  return (
    <TranscriptMarkdownSource markdown={text}>
      <MessageResponse
        words={element === undefined ? text : element.markdown}
        streaming={streaming}
        line={line}
        components={components}
        remarkPlugins={remarkPlugins}
        allowedTags={allowedTags}
        literalTagContent={literal}
      />
    </TranscriptMarkdownSource>
  );
}

/** The blank lines a reasoning may open on, up to the first line with words. */
const LEADING_BLANK_LINES = /^(?:[^\S\n]*\n)+/u;

/**
 * How many characters of a thought its closed line is handed: more than the
 * widest column shows, since the line cuts the rest itself. Note that the
 * words are cut here as well, because a transcript holds hundreds of closed
 * thoughts, and a long first paragraph whole in each line would put back in
 * the page what the fold keeps out of it.
 */
const REASONING_PREVIEW_LENGTH = 400;

/**
 * A model's reasoning, folded under one line until opened, its words as they
 * are but for the blank lines a model leaves around them. Note that only
 * whole blank lines go at the start, because the words keep their line breaks
 * and indents, and a trailing break would draw as an empty line under the last.
 *
 * The closed line previews the thought by its first line of words, as
 * plain words, as a task is named on its card: a model's thought often opens
 * on a bold title of its own, which a preview of every paragraph would run
 * into the sentence after it. Note that the preview keeps to that first line
 * rather than following the newest words while the thought streams, so it
 * stands still once the line fills the row, because a line rewritten word by
 * word draws the eye from the reply it sits in.
 */
export function TranscriptReasoning({
  text,
  cut,
}: {
  text: string;
  /** For a thought its page carried cut, its ends and its whole read, which its body asks for as it opens. */
  cut?: CutBody | undefined;
}): ReactNode {
  const shown = cut === undefined ? text : cut.head;

  return (
    <Reasoning>
      <ReasoningTrigger preview={cardTitle(shown).slice(0, REASONING_PREVIEW_LENGTH)} />
      {cut === undefined ? (
        <ReasoningContent text={text.replace(LEADING_BLANK_LINES, "").trimEnd()} />
      ) : (
        <FoldBody className={REASONING_BODY_CLASS}>
          <CutWords cut={cut} waiting={CUT_PART_WORDS.THOUGHT}>
            <p className={REASONING_WORDS_CLASS}>{cutPartText(cut)}</p>
          </CutWords>
        </FoldBody>
      )}
    </Reasoning>
  );
}

/**
 * A cut part's body: it asks for the part whole once its fold stands open,
 * not while a find only looks through it, and says so while the read is
 * under way; where the read failed, it draws the part's two ends.
 */
function CutWords({
  cut,
  waiting,
  children,
}: {
  cut: CutBody;
  waiting: string;
  /** The two ends as the part draws them, where its whole could not be read. */
  children: ReactNode;
}): ReactNode {
  const { open } = useDisclosureState();
  const { onOpen } = cut;
  useEffect(() => {
    if (open) onOpen();
  }, [open, onOpen]);

  if (cut.state === WHOLE_PART.FAILED) return children;

  return (
    <p data-part-reading="">
      <Shimmer>{waiting}</Shimmer>
    </p>
  );
}

/** Each kind of call's icon: a verb's own, or, for a call about something the window draws a glyph for, that glyph's likeness: the Code tab's brackets for code shown, the transcript's scroll for an agent read, as Copy full transcript wears it, never the terminal a shell command wears. A list of the agents is a list's own, rows each led by its mark, since it reads them all rather than one; a list of the models wears a chip, what an agent runs on. */
const CALL_ICON = {
  [CALL_KIND.COMMAND]: TerminalIcon,
  [CALL_KIND.MACHINE_COMMAND]: LaptopIcon,
  [CALL_KIND.BROWSER]: GlobeIcon,
  [CALL_KIND.COMPUTER]: MonitorIcon,
  [CALL_KIND.READ_FILE]: FileTextIcon,
  [CALL_KIND.WRITE_FILE]: FilePenIcon,
  [CALL_KIND.EDIT]: FilePenIcon,
  [CALL_KIND.SEARCH]: SearchIcon,
  [CALL_KIND.WEB_SEARCH]: SearchIcon,
  [CALL_KIND.WEB_PAGE]: GlobeIcon,
  [CALL_KIND.LOAD_SKILL]: () => <EntityGlyph kind={ENTITY_KIND.SKILL} />,
  [CALL_KIND.LOOK_AT_PICTURE]: ImageIcon,
  [CALL_KIND.LOOK_AT_THREAD_PICTURE]: ImageIcon,
  [CALL_KIND.READ_DESCRIPTION_PDF]: FileTextIcon,
  [CALL_KIND.EDIT_DESCRIPTION]: FilePenIcon,
  [CALL_KIND.TODOS]: () => <GLYPH.TODOS />,
  [CALL_KIND.INBOX_POST]: InboxIcon,
  [CALL_KIND.INBOX_CLOSE]: InboxIcon,
  [CALL_KIND.INBOX_READ]: InboxIcon,
  [CALL_KIND.INBOX_THREAD_READ]: InboxIcon,
  [CALL_KIND.INBOX_REPLY]: InboxIcon,
  [CALL_KIND.INBOX_WITHDRAW]: InboxIcon,
  [CALL_KIND.WORKER]: () => <EntityGlyph kind={ENTITY_KIND.WORKER} />,
  [CALL_KIND.WORKER_WAIT]: HourglassIcon,
  [CALL_KIND.WORKER_CANCEL]: CircleStopIcon,
  [CALL_KIND.WORKER_MESSAGE]: SendIcon,
  [CALL_KIND.STOP_BACKGROUND]: CircleStopIcon,
  [CALL_KIND.LIST_AGENTS]: LayoutListIcon,
  [CALL_KIND.READ_AGENT]: ScrollTextIcon,
  [CALL_KIND.MESSAGE_AGENT]: SendIcon,
  [CALL_KIND.START_AGENT]: PlayIcon,
  [CALL_KIND.ADD_SUGGESTION]: CornerDownRightIcon,
  [CALL_KIND.ARCHIVE_AGENT]: ArchiveIcon,
  [CALL_KIND.UNARCHIVE_AGENT]: ArchiveRestoreIcon,
  [CALL_KIND.LIST_MODELS]: CpuIcon,
  [CALL_KIND.STOP_AGENT]: CircleStopIcon,
  [CALL_KIND.LIST_PORTS]: PlugIcon,
  [CALL_KIND.SHARE_PORT]: LinkIcon,
  [CALL_KIND.UNSHARE_PORT]: UnlinkIcon,
  [CALL_KIND.UPDATE_AGENT]: PencilLineIcon,
  [CALL_KIND.READ_TASK]: FileTextIcon,
  [CALL_KIND.CREATE_SECTION]: FolderPlusIcon,
  [CALL_KIND.DELETE_SECTION]: FolderMinusIcon,
  [CALL_KIND.LIST_AUTOMATIONS]: CalendarClockIcon,
  [CALL_KIND.CREATE_AUTOMATION]: CalendarPlusIcon,
  [CALL_KIND.UPDATE_AUTOMATION]: CalendarCogIcon,
  [CALL_KIND.DELETE_AUTOMATION]: CalendarXIcon,
  [CALL_KIND.RUN_AUTOMATION]: CalendarCheckIcon,
  [CALL_KIND.MOVE_TASK]: FolderInputIcon,
  [CALL_KIND.UPDATE_TASK]: FilePenIcon,
  [CALL_KIND.LIST_ISSUES]: () => <GLYPH.ISSUE />,
  [CALL_KIND.READ_ISSUE]: () => <GLYPH.ISSUE />,
  [CALL_KIND.CREATE_ISSUE]: CirclePlusIcon,
  [CALL_KIND.UPDATE_ISSUE]: FilePenIcon,
  [CALL_KIND.CREATE_TASK]: FilePlusIcon,
  [CALL_KIND.SHOW_PAGE]: () => <EntityGlyph kind={ENTITY_KIND.PAGE} />,
  [CALL_KIND.READ_PAGE]: () => <EntityGlyph kind={ENTITY_KIND.PAGE} />,
  [CALL_KIND.SHOW_IMAGE]: ImageIcon,
  [CALL_KIND.OPEN_PULL_REQUEST]: () => <EntityGlyph kind={ENTITY_KIND.PULL_REQUEST} />,
  [CALL_KIND.SLEEP]: TimerIcon,
  [CALL_KIND.SCHEDULE_WAKEUP]: AlarmClockCheckIcon,
  [CALL_KIND.CANCEL_WAKEUP]: AlarmClockOffIcon,
  [CALL_KIND.END_TURN]: () => <GLYPH.DONE />,
  [CALL_KIND.LIST_TASKS]: () => <EntityGlyph kind={ENTITY_KIND.PLAN} />,
  [CALL_KIND.REMEMBER]: () => <GLYPH.MEMORY />,
  [CALL_KIND.RECALL]: () => <GLYPH.MEMORY />,
  [CALL_KIND.LIST_MEMORIES]: () => <GLYPH.MEMORY />,
  [CALL_KIND.FORGET_MEMORY]: () => <GLYPH.MEMORY />,
  [CALL_KIND.READ_COMMENTS]: () => <GLYPH.COMMENT />,
  [CALL_KIND.REPLY_TO_COMMENT]: () => <GLYPH.COMMENT />,
  [CALL_KIND.RESOLVE_THREAD]: () => <GLYPH.RESOLVED />,
  [CALL_KIND.REOPEN_THREAD]: () => <GLYPH.COMMENT />,
  [CALL_KIND.SEARCH_TOOLS]: () => <EntityGlyph kind={ENTITY_KIND.SERVER} />,
  [CALL_KIND.MCP_TOOL]: () => <EntityGlyph kind={ENTITY_KIND.TOOL} />,
  [CALL_KIND.OTHER]: WrenchIcon,
} as const satisfies Record<CallKind, ComponentType<{ "aria-hidden"?: "true" }>>;

/**
 * The coding agent a call about one names, drawn on its row in the place of
 * "the coding agent" as its mention's chip is drawn in words: its tile and
 * its name on the chip's raised fill. On a row that is itself the press
 * that opens the agent it is no target of its own, since a second press or
 * card inside it would be two targets for one thing, so it takes the row's
 * pointer and lifts with the row's hover. On a row that folds open what the
 * call sent (`opens`), the chip is the way to the agent: its press opens
 * the agent's tab and its hover hangs the agent's card, and the press stops
 * at the chip, so it never folds the row it stands on. On a row that folds
 * open the call's own input and answer, the chip hangs the agent's `card`
 * where the place gives one, and takes no hint where it gives none, since
 * the pill would only say its name again.
 */
function AgentCallChip({
  agent,
  opens,
  card,
}: {
  agent: Actor;
  opens?: AgentOpening | undefined;
  card?: ReactNode;
}): ReactNode {
  if (opens === undefined) {
    return (
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        glyph={<ActorGlyph actor={agent} />}
        label={actorName(agent)}
        hint={card === undefined ? false : undefined}
        card={card}
        data-tool-agent-ref=""
      />
    );
  }

  const press = (event: MouseEvent<HTMLElement>) => {
    // The press is the chip's alone: the summary it stands in would fold.
    event.preventDefault();
    event.stopPropagation();
    opens.onOpen();
  };

  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={<ActorGlyph actor={agent} />}
      label={actorName(agent)}
      onPress={press}
      hintLabel={opens.hint}
      card={opens.card}
      data-tool-agent-ref=""
    />
  );
}

/** How a chip on a row that folds open reaches its agent: what its hover says, the card it hangs, and its press. */
interface AgentOpening {
  readonly hint: string;
  readonly card: ReactNode;
  readonly onOpen: () => void;
}

/** A call's line, and the chip after its verb where it names its agent by one. */
interface ChippedLine {
  readonly line: CallLine;
  readonly chip: ReactNode | undefined;
}

/** A call's line and the chip it names its agent by: the agent's chip after the verb alone, for a call about one coding agent whose agent is known, opening the agent where `opens` says how, and the call's own words otherwise. */
function chippedLine(
  kind: CallKind,
  subject: string | undefined,
  description: string | undefined,
  agent: Actor | undefined,
  opens?: AgentOpening,
  card?: ReactNode,
): ChippedLine {
  if (agent === undefined || !isAgentCallKind(kind)) {
    return { line: callLine(kind, subject, description), chip: undefined };
  }

  return {
    line: agentCallLine(kind, subject),
    chip: <AgentCallChip agent={agent} opens={opens} card={card} />,
  };
}

/**
 * The chip a call's row names what it read or wrote by: the first file's,
 * of the task's repository, with its hover card, or the website chip of the
 * page it fetched; nothing where it names neither, or the place knows no
 * repository, or the path is no file of it, as an absolute one outside the
 * checkout or one that climbs out is not, and the row says its subject as
 * words.
 */
function calledChip(
  kind: CallKind,
  files: readonly string[] | undefined,
  page: string | undefined,
  doors: MentionDoors,
): ReactNode | undefined {
  if (kind === CALL_KIND.WEB_PAGE) {
    return page === undefined || siteName(page) === undefined ? undefined : (
      <SiteChip href={page} />
    );
  }

  const first = calledFile(kind, files);

  return first === undefined ? undefined : fileChip(first, doors);
}

/** Whose Mac a transcript's Mac commands ran on, its agent's starter, the reader's own among them (`macOwnerOf`); none where the window cannot tell, whose ran on the reader's own as far as it knows. */
const MacOwnerContext = createContext<Actor | undefined>(undefined);

/** Names whose Mac the transcript under it ran its Mac commands on. */
export const MacOwnerProvider = MacOwnerContext.Provider;

/** Whose Mac the transcript ran its Mac commands on, as `MacOwnerProvider` names it; none where the window cannot tell. */
export function useMacOwner(): Actor | undefined {
  return useContext(MacOwnerContext);
}

export type TranscriptToolProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    kind: CallKind;
    /** For a call of an integration's own tool, the integration, whose mark the row wears in its kind's icon's place. */
    provider?: IntegrationProvider | undefined;
    /** For a call on an app on the developer's Mac, the picture its icon was kept as, which the row wears in its kind's icon's place; a computer call with none wears the app icon's placeholder. */
    appIcon?: string | undefined;
    /** For a call of an MCP server's tool, the server's name, which the row says it ran on beside its line. */
    server?: string | undefined;
    /** For a command, the plain words the model said it is for, which the row says in its verb's place; the closed row previews the command's first line after them, and the body holds it whole. */
    description?: string | undefined;
    /** For a call about one coding agent, the agent, whose chip the row names it by in the place of "the coding agent"; none where the agent is not known. */
    agent?: Actor | undefined;
    /** For a call about one coding agent, the agent's card, which its chip hangs; none where the place hangs none. */
    agentCard?: ReactNode;
    /** For a call that made or is about a page, the description, a thread, a task, or a pull request, that thing's chip, which the row names it by after its verb alone, its press alone opening it; none where the place cannot link it. */
    made?: { readonly kind: MadeCallKind; readonly chip: ReactNode } | undefined;
    /** For a call that read, wrote, or edited files, their paths, which the row names by the first one's chip and how many more. */
    files?: readonly string[] | undefined;
    /** For a read of a web page, its whole address, which the row names by its website chip. */
    page?: string | undefined;
    input: ToolBlock;
    /** Nothing while the call has not answered. */
    output: ToolBlock | undefined;
    errorText: string | undefined;
    /** For a call whose answer its page carried cut, its ends and its whole read, which its body asks for as it opens. */
    cut?: CutBody | undefined;
    /** For a call the agent holds for an answer: where the ask stands in words, on the line; what the body says of who asks and why, over the input; and the answers' presses, under the row while it waits. None for the rest. */
    held?: HeldCall | undefined;
    /** What the body holds under the call's answer, seen once the row is opened, such as the window a computer call read. */
    answered?: ReactNode;
  };

/** A call held for an answer, as its row draws it (`TranscriptTool`'s `held`). */
export interface HeldCall {
  readonly status: string;
  /** Whether it still waits on an answer, which holds the call rather than working it. */
  readonly waiting: boolean;
  readonly about: string | undefined;
  readonly actions: ReactNode;
}

type UseHeldOpenResult = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Whether a held call's row stands open, and its toggle: open while the call
 * waits, so what it would do stands above its answers without a press, and
 * closed again as it is answered, as a finished row stands; a press opens
 * and closes it between.
 */
function useHeldOpen(waiting: boolean): UseHeldOpenResult {
  const [open, setOpen] = useState(waiting);
  const [was, setWas] = useState(waiting);

  if (was !== waiting) {
    setWas(waiting);
    setOpen(waiting);
  }

  return { open, onOpenChange: setOpen };
}

/**
 * One tool call: its row saying what it did, closed until clicked, and its
 * input and answer under it once opened, a command's as one terminal card
 * (`ToolTerminal`). A command is the closed row's
 * preview, dropped once the body under it shows the command whole behind
 * its prompt, or by a find, which draws that body hidden, and so is any
 * subject the input says whole, a read's path or a search's pattern
 * (`blockSays`); a description stays, since the body does not say it. A
 * call that made something names it by its chip, as a call about an agent
 * names the agent by its own; a call the agent holds for an answer stands
 * open while it waits (`useHeldOpen`); one that read, wrote, or edited files names
 * the first by its chip, and one that fetched a page names it by its
 * website chip (`calledChip`), which stays as the row opens.
 */
export function TranscriptTool({
  state,
  kind,
  provider,
  appIcon,
  server,
  subject,
  description,
  agent,
  agentCard,
  made,
  files,
  page,
  input,
  output,
  errorText,
  cut,
  held,
  answered,
  ...props
}: TranscriptToolProps): ReactNode {
  const Icon = CALL_ICON[kind];
  const called = calledChip(kind, files, page, useMentionDoors());

  const { line, chip } =
    made !== undefined
      ? { line: madeCallLine(made.kind), chip: made.chip }
      : called === undefined
        ? chippedLine(kind, subject, description, agent, undefined, agentCard)
        : { line: { ...callLine(kind, moreFiles(files), undefined), code: false }, chip: called };

  const command = isCommandKind(kind);
  const macOwner = useContext(MacOwnerContext);
  const opened = useHeldOpen(held?.waiting === true);

  const row = (
    <Tool {...props} {...(held === undefined ? undefined : opened)}>
      <ToolHeader
        state={state}
        icon={
          provider !== undefined ? (
            <ProviderMark provider={provider} />
          ) : appIcon !== undefined || kind === CALL_KIND.COMPUTER ? (
            <KeptAppIcon id={appIcon} />
          ) : (
            <Icon aria-hidden="true" />
          )
        }
        label={line.verb}
        subject={line.subject}
        chip={chip}
        subjectIsCode={line.code}
        subjectInBody={(command && input.kind === TOOL_BLOCK.COMMAND) || blockSays(input, subject)}
        place={
          (kind === CALL_KIND.MACHINE_COMMAND || kind === CALL_KIND.COMPUTER) &&
          macOwner !== undefined ? (
            <ActorLine>
              {"On "}
              <ActorRef actor={macOwner} sentence possessive />
              {" Mac"}
            </ActorLine>
          ) : (
            callPlace(kind, server)
          )
        }
        status={held?.status}
        paused={held?.waiting}
      />
      <ToolContent bare>
        {held?.about === undefined ? null : (
          <NoteLine look={NOTE_LINE_LOOK.INSET}>{held.about}</NoteLine>
        )}
        {input.kind === TOOL_BLOCK.COMMAND ? (
          cut === undefined ? (
            <ToolTerminal input={input} block={output} errorText={errorText} />
          ) : (
            <CutWords cut={cut} waiting={CUT_PART_WORDS.OUTPUT}>
              <ToolTerminal
                input={input}
                block={{ kind: TOOL_BLOCK.TEXT, text: cutPartText(cut) }}
                errorText={undefined}
              />
            </CutWords>
          )
        ) : (
          <>
            <ToolInput block={input} markdown={toolMarkdown} />
            {cut === undefined ? (
              <ToolOutput block={output} errorText={errorText} markdown={toolMarkdown} />
            ) : (
              <CutWords cut={cut} waiting={CUT_PART_WORDS.OUTPUT}>
                <ToolOutput
                  block={{ kind: TOOL_BLOCK.TEXT, text: cutPartText(cut) }}
                  errorText={undefined}
                  markdown={toolMarkdown}
                />
              </CutWords>
            )}
          </>
        )}
        {answered}
      </ToolContent>
    </Tool>
  );

  // A held call's answers stand under its row, set in to its words, as long as it waits.
  if (held?.actions === undefined || held.actions === null) return row;

  return (
    <>
      {row}
      <div className="tool-held ml-transcript-gutter">{held.actions}</div>
    </>
  );
}

/**
 * A call whose subject stands in a tab of its own, as a coding agent's start
 * does once the agent began, or a skill once loaded: the
 * call's line as a call's row draws it, its icon, what it did, and where it
 * stands, as the one button that opens that tab rather than folding its
 * input and answer open in place, its hover saying what it opens, or
 * hanging the card that tab hangs, an agent's, where it is given one. A
 * call about one coding agent names the agent by its chip, which the row's
 * press and card are for (`AgentCallChip`). A call that sent the agent
 * words is a row that folds them open instead, and its chip opens the agent
 * (`SentCall`).
 */
export function TranscriptOpeningCall({
  callId,
  kind,
  subject,
  agent,
  state,
  hint,
  card,
  sent,
  onOpen,
}: {
  callId: string;
  kind: CallKind;
  subject: string | undefined;
  /** For a call about one coding agent, the agent, whose chip the row names it by; none where the agent is not known. */
  agent?: Actor | undefined;
  state: ToolState;
  /** What the hover says the row opens. */
  hint: string;
  /** The card the hover hangs in the hint's place: the tab's own, where the tab it opens hangs one. */
  card?: ReactNode;
  /** What the call sent another agent, whole, which a press on the row folds open under it; none for a call that sent no words of its own. */
  sent?: SentWords | undefined;
  onOpen: () => void;
}): ReactNode {
  const Icon = CALL_ICON[kind];

  if (sent !== undefined) {
    return (
      <SentCall
        callId={callId}
        kind={kind}
        subject={subject}
        agent={agent}
        state={state}
        sent={sent}
        opens={{ hint, card, onOpen }}
      />
    );
  }

  const { line, chip } = chippedLine(kind, subject, undefined, agent);

  return (
    <Tooltip label={hint} card={card ?? undefined}>
      <LineButton data-call-id={callId} data-opens="" {...FIND_DETAIL} onClick={onOpen}>
        <ToolLine
          state={state}
          icon={<Icon aria-hidden="true" />}
          label={line.verb}
          subject={line.subject}
          chip={chip}
          subjectIsCode={line.code}
        />
      </LineButton>
    </Tooltip>
  );
}

/** The heading over a start's note. */
const SENT_WORDS = {
  NOTE: "Note",
} as const;

/** The agent a call that sent words names where the place knows it by no name yet, as a start the place has not listed: a coding agent, as its card names it. */
const UNNAMED_AGENT: Actor = {
  kind: ACTOR_KIND.AGENT,
  name: TAB_WORDS.AGENT,
  provider: undefined,
  state: ACTOR_STATE.REST,
};

/**
 * A call that sent another agent words, a message or a start: a call's row
 * that folds the words open whole under it, as any call's row folds its
 * input, its line's preview giving way while they are shown. The agent is
 * reached from its chip (`AgentCallChip`), whose press opens its tab and
 * whose hover hangs its card, so the row keeps one press, the fold, and
 * wears no toggle of its own at its end. What it sent is drawn as the
 * transcript's own quote, as a quote in an agent's words is. Note that an agent the place knows
 * by no name yet still gets its chip, named as its card names it, because
 * the chip is the row's one way to the agent.
 */
function SentCall({
  callId,
  kind,
  subject,
  agent,
  state,
  sent,
  opens,
}: {
  callId: string;
  kind: CallKind;
  subject: string | undefined;
  agent: Actor | undefined;
  state: ToolState;
  sent: SentWords;
  opens: AgentOpening;
}): ReactNode {
  const Icon = CALL_ICON[kind];
  const { line, chip } = chippedLine(kind, subject, undefined, agent ?? UNNAMED_AGENT, opens);

  return (
    <Tool data-call-id={callId}>
      <ToolHeader
        state={state}
        icon={<Icon aria-hidden="true" />}
        label={line.verb}
        subject={line.subject}
        chip={chip}
        subjectIsCode={line.code}
        subjectInBody
      />
      <ToolContent name="tool-sent-words" bare>
        {sent.words === undefined ? null : (
          <blockquote className={QUOTE_CLASS}>
            <TranscriptWords text={sent.words} />
          </blockquote>
        )}
        {sent.note === undefined ? null : (
          <blockquote className={QUOTE_CLASS}>
            <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {SENT_WORDS.NOTE}
            </Text>
            <TranscriptWords text={sent.note} />
          </blockquote>
        )}
      </ToolContent>
    </Tool>
  );
}

/**
 * How a to-do of each status is drawn: its glyph and what the glyph says
 * aloud; its ink and its words' are the item's status's (tasks.css's
 * `.todo-item`). Pending is an empty
 * circle, done a check in the muted ink with its words muted beside it, as
 * Linear and Things mark a finished item, and in progress a dotted circle
 * in the full ink, so the one item the list is at is the one that stands
 * out; while the agent is at it, the working mark an agent at work wears
 * (`state-glyph.tsx`) takes the dot's place (`TodoItems`). Note that a
 * done item is not struck through, because a rule through two or three
 * wrapped lines reads as noise over words the muted ink already quiets.
 */
const TODO_LOOK = {
  [AGENT_TODO_STATUS.PENDING]: { Icon: CircleIcon, label: "Pending" },
  [AGENT_TODO_STATUS.IN_PROGRESS]: { Icon: CircleDotDashedIcon, label: "In progress" },
  [AGENT_TODO_STATUS.DONE]: { Icon: CircleCheckIcon, label: "Done" },
} as const satisfies Record<AgentTodoStatus, { Icon: LucideIcon; label: string }>;

export type TranscriptTodosProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    todos: AgentTodos["todos"];
    errorText: string | undefined;
    /** Whether this is the list the agent is at now: its newest while it works. */
    live: boolean;
  };

/**
 * A to-do list's items, each behind the glyph of where it stands. The
 * glyph sits in a 16px column, as a call's icon does, with the call's 8px
 * gap after it, so a list set at a row's text column, or at its card's
 * icon, keeps its words on that row's words. The glyph is centered on its
 * item's first line, which at a 20px line centers it on the capitals, and
 * a wrapped line hangs under the words rather than the glyph. The item in
 * progress wears the moving working mark only on a `live` list, because a
 * list the agent wrote over or stopped at is a record, and a mark frozen
 * mid-lap there reads as a spinner that broke.
 */
function TodoItems({
  todos,
  live,
  docked = false,
}: {
  todos: AgentTodos["todos"];
  live: boolean;
  /** Whether it stands in the dock over the composer, where it keeps to under a third of what is seen and scrolls past it, so a long list leaves the transcript its room in a short window. */
  docked?: boolean;
}): ReactNode {
  return (
    <Stack
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.TIGHT}
      className={`todo-items leading-body${docked ? " max-h-todos-dock overflow-y-auto overscroll-contain" : ""}`}
    >
      {todos.map((todo, index) => (
        // Note that an item's place is its identity, so a write that moves
        // an item on is drawn as that item changing where it stands.
        <TodoItem key={index} todo={todo} live={live} />
      ))}
    </Stack>
  );
}

/**
 * One item behind the glyph of where it stands. An item that changes where
 * it stands while drawn has its glyph arrive (`GlyphSlot`'s `arrival`), a
 * check springing in as the item is done and a smaller arrival as it is
 * taken up; its words ease to their ink alike (tasks.css). An item drawn as it
 * stands is still, so a list opened or read back does not play its history.
 */
function TodoItem({ todo, live }: { todo: AgentTodos["todos"][number]; live: boolean }): ReactNode {
  const [first] = useState(todo.status);
  const look = TODO_LOOK[todo.status];
  const working = live && todo.status === AGENT_TODO_STATUS.IN_PROGRESS;
  const arrived = todo.status !== first;
  const done = todo.status === AGENT_TODO_STATUS.DONE;

  return (
    <li className="todo-item flex items-start gap-icon-gap" data-todo-status={todo.status}>
      {/* Keyed by where it stands, so each change mounts the glyph anew and its arrival runs. */}
      <GlyphSlot
        key={todo.status}
        line
        ink={todo.status === AGENT_TODO_STATUS.IN_PROGRESS ? GLYPH_INK.TEXT : GLYPH_INK.MUTED}
        label={look.label}
        arrival={arrived ? (done ? GLYPH_ARRIVAL.CHECK : GLYPH_ARRIVAL.STEP) : undefined}
      >
        {working ? (
          <StateGlyph state={GLYPH_STATE.WORKING} />
        ) : (
          <StateGlyph state={GLYPH_STATE.REST} glyph={<look.Icon aria-hidden="true" />} />
        )}
      </GlyphSlot>
      <span
        className={`min-w-0 wrap-anywhere transition-[color] duration-(--ui-duration-quick) ease-motion-exit${done ? " text-muted-foreground" : ""}`}
      >
        {todo.content}
      </span>
    </li>
  );
}

/**
 * One write of an agent's to-do list: a call's row saying how far the list
 * has got, which opens onto the list itself, set bare at the row's text
 * column as Claude Code and Codex hang theirs under the call, since it is
 * words rather than the code a call's card holds, and selectable as a
 * call's body is; a failure is said under it as a subagent's is. It starts
 * folded, as every call's row does, and whether it is `live`, the list the
 * agent is at, whose item in progress wears the moving mark, is the caller's.
 */
export function TranscriptTodos({
  state,
  subject,
  todos,
  errorText,
  live,
  ...props
}: TranscriptTodosProps): ReactNode {
  const words = CALL_WORDS[CALL_KIND.TODOS];

  return (
    <Tool data-todos="" {...props}>
      <ToolHeader
        state={state}
        icon={<GLYPH.TODOS />}
        label={words.verb}
        subject={subject}
        subjectIsCode={words.code}
      />
      <FoldBody className="mt-list-gap mr-0 mb-tight-gap ml-transcript-gutter select-text">
        <TodoItems todos={todos} live={live} />
        {errorText === undefined ? null : (
          <FailureNote failure={UNREPORTED.TOOL} time={FAILURE_NOTE_TIME.PAST}>
            {errorText}
          </FailureNote>
        )}
      </FoldBody>
    </Tool>
  );
}

/**
 * The list the agent is working through, docked above the composer while
 * it works, as Claude Code keeps its list over the prompt and VS Code's
 * chat over its log: one line saying how far the list has got and the
 * item it is at, which opens onto the whole list, led by the chevron as
 * every fold's line is. Closed by default, as
 * VS Code's collapses to the item in progress, so it costs the log one
 * line. It is a card on the task card's look, since it stands outside the
 * log, and it is drawn by the caller only while the list is worked. It
 * opens upward off the composer, as one sheet (tasks.css). How far it has
 * got is said as the transcript's row says it (`todosSummary`), its counts
 * rolling as they change, so a step done is seen to tick over.
 */
export function TranscriptTodosDock({
  todos,
  focus,
}: {
  todos: AgentTodos["todos"];
  /** The item the list is at; none once every item is done. */
  focus: string | undefined;
}): ReactNode {
  const { done, total } = todosCount(todos);

  return (
    <Disclosure look={DISCLOSURE_LOOK.DOCK} data-todos-dock="" aria-label="To-dos">
      <DisclosureSummary look={DISCLOSURE_SUMMARY.HEAD}>
        <DisclosureChevron />
        <GlyphSlot>
          <GLYPH.TODOS />
        </GlyphSlot>
        <span className="shrink-0 text-muted-foreground">
          <RollingNumber value={done} /> of <RollingNumber value={total} /> done
        </span>
        <TodosDockFocus focus={focus} />
      </DisclosureSummary>
      <DisclosureBody inset={DISCLOSURE_BODY.CARD}>
        <TodoItems todos={todos} live docked />
      </DisclosureBody>
    </Disclosure>
  );
}

/**
 * The item the dock's line says the list is at, cut to the line, which
 * gives way while the list under it is drawn, since the list says it
 * there; the count before it stays, since the list says none.
 */
function TodosDockFocus({ focus }: { focus: string | undefined }): ReactNode {
  const previewed = useDisclosurePreviewShown(focus !== undefined);

  if (focus === undefined || !previewed) return null;

  return (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} truncate className="flex-1">
      {focus}
    </Text>
  );
}

/** What a subagent's row says it runs on: the model and effort, and the catalog the model is named from. */
interface SubagentPair {
  readonly choice: ModelChoice;
  readonly models: readonly CatalogModel[];
}

export type TranscriptSubagentProps = {
  /** The call that started the subagent, which the row carries as `data-call-id`. */
  callId: string;
  /** The job the subagent was handed, as its tab names it. */
  job: string;
  /** What it runs on; none where the row knows no pair. */
  pair: SubagentPair | undefined;
  state: ToolState;
  /** When the subagent began, which a running row counts from beside its working mark; none where unknown or not counted, when the mark stands alone. */
  startedAt?: number | undefined;
  /** Why the call failed, drawn under the row, since a call refused before its worker began leaves no tab to read it in. */
  errorText: string | undefined;
  /** Opens the subagent's tab, or chooses it where it is open; none where the row stands in a tab that opens no tab. */
  onOpen: (() => void) | undefined;
  /** The card the hover hangs in its hint's place, the subagent's tab's own; none where the row knows none. */
  card?: ReactNode;
  /**
   * The task and the answer, for a row that opens no tab, which folds them
   * open under its line as a call's row does: a native harness's subagent,
   * whose own work we keep no transcript of.
   */
  body?: { readonly input: ToolBlock; readonly output: ToolBlock | undefined } | undefined;
};

/** What the hover over a subagent's row says it opens. */
const SUBAGENT_HINT = "Open the subagent";

/**
 * A subagent's row on a coding agent's tab, running
 * or finished: one line drawn as a call's row is, in its muted ink, wearing
 * the mark of the harness its model runs in (the worker's robot where the
 * model is unknown), the job in the full ink as a call's verb is, fading
 * where the line cuts it, the model and effort it runs on as every pair is
 * drawn (`model-label.tsx`), and the mark a call's
 * row wears for where it stands, with how long it has worked beside the
 * working mark while it runs (`working-time.tsx`). The whole line is
 * the one button that opens the subagent's tab, its hover hanging that
 * tab's card, or saying what it opens where it is given none, and the tab
 * is where its steps and its answer are read, so it folds nothing open in
 * place. Where it
 * opens no tab it is the same line, pressed by nothing, or, given the task
 * and the answer, a fold that opens onto them as a call's row does. A call that failed
 * says why in red under the line, open from the start.
 */
export function TranscriptSubagent({
  callId,
  job,
  pair,
  state,
  startedAt,
  errorText,
  onOpen,
  card,
  body,
}: TranscriptSubagentProps): ReactNode {
  const running = state === TOOL_STATE.INPUT_STREAMING || state === TOOL_STATE.INPUT_AVAILABLE;

  const line = (
    <>
      <GlyphSlot>
        <SubagentMark model={pair?.choice.model} />
      </GlyphSlot>
      <OneLine className="subagent-job flex-1 text-foreground">{job}</OneLine>
      {pair === undefined ? null : (
        <span className="subagent-pair shrink-0" data-subagent-pair="">
          <ModelLabel choice={pair.choice} models={pair.models} />
        </span>
      )}
      {running && startedAt !== undefined ? (
        <WorkingTime startedAt={startedAt} className="shrink-0" />
      ) : null}
      <ToolStateMark state={state} />
    </>
  );

  const row =
    onOpen === undefined && body !== undefined ? (
      <Tool>
        <ToolSummary data-subagent-row="" data-call-id={callId}>
          {line}
        </ToolSummary>
        <ToolContent bare>
          <ToolInput block={body.input} markdown={toolMarkdown} />
          <ToolOutput block={body.output} errorText={undefined} markdown={toolMarkdown} />
        </ToolContent>
      </Tool>
    ) : onOpen === undefined ? (
      // The same line as the one that opens a subagent's tab, pressed by nothing.
      <LineRow data-subagent-row="" data-call-id={callId}>
        {line}
      </LineRow>
    ) : (
      <Tooltip label={SUBAGENT_HINT} card={card ?? undefined}>
        <LineButton data-subagent-row="" data-call-id={callId} onClick={onOpen}>
          {line}
        </LineButton>
      </Tooltip>
    );

  return (
    <div className="subagent-row @container/subagent-row text-caption-inline" {...FIND_DETAIL}>
      {row}
      {errorText === undefined ? null : (
        <FailureNote failure={UNREPORTED.TOOL} time={FAILURE_NOTE_TIME.PAST}>
          {errorText}
        </FailureNote>
      )}
    </div>
  );
}

/**
 * A line that folds the rows beneath it: a run of calls, or a finished
 * turn's lead. Note that it stays in the muted ink, summary and all,
 * unlike a call's line, because it counts rows rather than saying what one
 * did, and the rows it opens onto are what a reader scans. It wears the
 * fold's chevron in a row's icon column, as the description's card does at its
 * head, because its count already says what it holds, so what is left to
 * say is whether it is open, and an icon of its own would read as one more
 * of the calls it opens onto. Note that it says nothing of a call that
 * failed, because the call's own row marks it and says why, and a failure
 * the agent went on past is not news on the line that folds its work away.
 */
function TurnFold({
  summary,
  running,
  open = false,
  children,
}: {
  summary: string;
  running: boolean;
  open?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <FindDetailFolds>
      <Disclosure defaultOpen={open} data-turn-fold="" {...FIND_DETAIL}>
        <DisclosureSummary>
          {running ? <Shimmer>{summary}</Shimmer> : <span>{summary}</span>}
        </DisclosureSummary>
        <DisclosureBody>{children}</DisclosureBody>
      </Disclosure>
    </FindDetailFolds>
  );
}

/** One row of a turn: a block drawn by its tab, or a run of calls. */
function TurnRowView<B>({
  row,
  children,
}: {
  row: TurnRow<B>;
  children: (block: B) => ReactNode;
}): ReactNode {
  switch (row.kind) {
    case TURN_ROW.BLOCK:
      return children(row.block);
    case TURN_ROW.GROUP:
      return (
        <TurnFold summary={row.summary} running={row.running} open={row.open}>
          {row.blocks.map((block, index) => (
            <Fragment key={index}>{children(block)}</Fragment>
          ))}
        </TurnFold>
      );
  }
}

/**
 * A turn's row, drawn again only where it reads otherwise than it did, or
 * the tab draws its blocks another way: a running turn's page touches its
 * newest row alone, so every row before it is kept as it was drawn.
 */
// SAFETY: memo draws TurnRowView with the same props, so it takes what TurnRowView takes.
const SteadyTurnRow = memo(TurnRowView, (a, b) =>
  sameFieldsBy(a, b, { row: sameTurnRow }),
) as typeof TurnRowView;

/**
 * A turn's rows (`turn-rows.ts`): each block drawn by its tab, a run of
 * calls and a folded lead drawn here.
 */
export function TranscriptRows<B>({
  rows,
  children,
}: {
  rows: readonly TurnRow<B>[];
  /** How the tab draws one of its own blocks. */
  children: (block: B) => ReactNode;
}): ReactNode {
  // Note that a group is keyed by whether it opens, because the fold reads `defaultOpen` once, and a group that stops being the turn's latest work has to fold.
  return rows.map((row) => (
    <SteadyTurnRow
      key={row.kind === TURN_ROW.GROUP ? `${row.key}-${String(row.open)}` : row.key}
      row={row}
    >
      {children}
    </SteadyTurnRow>
  ));
}

/** A quiet note between a transcript's rows: what was left out, or what stands in a row's place. */
export function TranscriptNote({ children }: { children: ReactNode }): ReactNode {
  return <NoteLine look={NOTE_LINE_LOOK.INSET}>{children}</NoteLine>;
}
