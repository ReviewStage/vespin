import type { CodeLines } from "@repo/features/tasks-view";
import { CODE_ROW, CodeCard, type CodeRow, DraftCard } from "@repo/ui";
import { draftKindOf } from "@repo/ui/draft-text";
import { SUGGESTED_CHANGE_LANGUAGE } from "@repo/ui/github-html";
import type { MarkdownComponents, MarkdownNodeProps } from "@repo/ui/markdown";
import { useQuery } from "@tanstack/react-query";
import { type ComponentProps, createContext, type ReactNode, useContext, useMemo } from "react";
import { colorable, coloringQueryOptions } from "../code-coloring.js";
import { copyRichThroughShell, copyThroughShell } from "../copy-feedback.js";
import { DescriptionDiagram } from "../description-diagram.js";
import { TextLink } from "../text-link.js";
import { fenceHeading, SUGGESTION_LANGUAGE, suggests } from "./code-fence-heading.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * transcript-markdown.tsx -- code and tables as every rendered text draws them: a fenced block in the window's one code card, a draft to be sent elsewhere as it will look when sent, a note's as a transcript's, a table bare, and an inline span on a subtle fill.
 *
 * Streamdown, the markdown renderer behind AI Elements' Response, draws a
 * fenced block and a table with components of its own: a bordered card on
 * the sidebar's fill with a second bordered box inside it, a language label,
 * and copy and download buttons, colored by `@streamdown/code` where that
 * plugin is installed and drawn plain where, as here, it is not; a table
 * boxed twice with copy, download, and fullscreen buttons over it. Those
 * are replaced here through Streamdown's own `components`, so nothing of
 * theirs is drawn and no stylesheet fights their classes. A fenced block
 * is colored by main, by the highlighter the Code and File tabs' lines
 * are colored with (`ACT_KIND.TASKS_COLOR_CODE`), so the colors and
 * the type are theirs; the window's content policy and its bundle size
 * keep that highlighter out of the window. Only a block that is whole is
 * asked for: one whose closing fence has not arrived is still streaming,
 * and is drawn plain until it does, so a long answer is colored once
 * rather than once a word. What main answered is held by language and
 * code, so a block drawn again, or twice, asks once. A block stands in
 * `@repo/ui`'s `CodeCard`, as every block of code in the window does, so
 * its header, its one Copy, its cut at 40 lines, and the screen recording's
 * leaving its lines out are the card's.
 */

/** The language a fence names to be drawn as its diagram once it is whole. */
const MERMAID_LANGUAGE = "mermaid";

/** The language a diff is fenced in, whose rows are tinted by what they do. */
const DIFF_LANGUAGE = "diff";

/** A diff's file header, `--- a/path` or `+++ b/path`: three marks, then a space or nothing. */
const DIFF_HEADER = /^(?:---|\+\+\+)(?:\s|$)/u;

/** A row of a block drawn as rows: what it does, and the words it shows. */
interface Row {
  readonly kind: CodeRow;
  readonly text: string;
}

/** The language a fenced block's class names, as Streamdown hands it on. */
const LANGUAGE_CLASS = /(?:^|\s)language-(\S+)/u;

/** A fence's opening: up to three spaces, then three or more backticks or tildes. */
const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})/u;

/** The quote marks a line inside a quote opens on. */
const QUOTE_MARKS = /^[\s>]*/u;

/**
 * The last line written inside a fenced block of a transcript's words still
 * waiting for its closing fence, or none where every fence closed, which a
 * block reads to tell whether it is the one still streaming. Note that it
 * is a line rather than the words, because Streamdown hands a component its
 * place in its own block alone, and because a value that stands still while
 * the words after the last block stream draws no block again.
 */
const OpenFenceTail = createContext<string | undefined>(undefined);

/** Whether `line` closes a fence opened with `marker`: the opening's character at least as long, alone but for the quote marks of a block inside a quote. */
function closesFence(line: string, marker: string): boolean {
  const bare = line.replace(QUOTE_MARKS, "").trim();

  return bare.length >= marker.length && [...bare].every((character) => character === marker[0]);
}

/**
 * The last line written inside a fenced block that still waits for its
 * closing fence at the end of `markdown`, empty for one with no line yet, or
 * none where every fence closed. Only the last block can still be open,
 * since a fence left open runs to the end of the words.
 */
function openFenceTail(markdown: string): string | undefined {
  let marker: string | undefined;
  let last: string | undefined;

  for (const line of markdown.trimEnd().split("\n")) {
    if (marker === undefined) {
      marker = FENCE_OPENING.exec(line.replace(QUOTE_MARKS, ""))?.[1];
      last = "";
    } else if (closesFence(line, marker)) {
      marker = undefined;
    } else {
      last = line;
    }
  }

  return marker === undefined ? undefined : last;
}

/** A fenced block's code: the text its element holds, as the markdown wrote it. */
function blockText(node: MarkdownNodeProps["node"]): string {
  return (node?.children ?? []).map((child) => (child.type === "text" ? child.value : "")).join("");
}

/**
 * A block's lines as main colored them, or none while they are asked for,
 * while the block streams, or for a block not colored at all.
 */
function useColoredLines(language: string, code: string, whole: boolean): CodeLines | undefined {
  const asking = whole && colorable(language, code);
  const coloring = useQuery({ ...coloringQueryOptions(language, code), enabled: asking });

  return asking ? (coloring.data ?? undefined) : undefined;
}

/**
 * A block's lines as rows tinted by what each does, or none for a block of
 * plain lines. A suggestion as written holds the new lines alone, every one
 * added; a suggested change GitHub rendered marks each line `-` or `+`
 * (`@repo/ui/github-html`), which the row stands for in its mark's place, as
 * GitHub draws one; a diff's lines keep their marks, and its other lines
 * stand untinted.
 */
function rowsOf(language: string, code: string): readonly Row[] | undefined {
  const lines = code.split("\n");

  if (language === SUGGESTION_LANGUAGE) {
    return lines.map((text) => ({ kind: CODE_ROW.ADDED, text }));
  }

  if (language === SUGGESTED_CHANGE_LANGUAGE) {
    return lines.map((line) => ({
      kind: line.startsWith("-") ? CODE_ROW.REMOVED : CODE_ROW.ADDED,
      text: line.slice(1),
    }));
  }

  if (language !== DIFF_LANGUAGE) return undefined;

  return lines.map((text) => ({
    kind: DIFF_HEADER.test(text)
      ? CODE_ROW.CONTEXT
      : text.startsWith("-")
        ? CODE_ROW.REMOVED
        : text.startsWith("+")
          ? CODE_ROW.ADDED
          : CODE_ROW.CONTEXT,
    text,
  }));
}

/** The words of the rows added, which is what a suggestion copies. */
function addedText(rows: readonly Row[]): string {
  return rows
    .filter((row) => row.kind === CODE_ROW.ADDED)
    .map((row) => row.text)
    .join("\n");
}

/**
 * A fenced block as a `CodeCard`: its language in the header, as every
 * fence is headed (`fenceHeading`), over its lines, which keep whole and
 * scroll sideways inside the card rather than widening the transcript. A
 * ```suggestion block, a change suggested to the lines a review comment is
 * on, is headed as GitHub heads one, its lines drawn as rows on the added
 * lines' tint, and a suggested change GitHub rendered its removed lines over
 * its added ones on the removed lines' tint; its copy is the new lines
 * alone, which is the suggestion. A diff's rows are tinted the same way
 * (`rowsOf`).
 */
function CodeFence({ language, code }: { language: string; code: string }): ReactNode {
  const openTail = useContext(OpenFenceTail);
  // Note that the block still open is the one the words end on, so its last line ends them.
  const whole = openTail === undefined || !openTail.endsWith(code.split("\n").at(-1) ?? "");
  const suggesting = suggests(language);
  // Note that a suggestion names no language of its own to color it in.
  const lines = useColoredLines(language, code, whole && !suggesting);
  const rows = rowsOf(language, code);
  const heading = fenceHeading(language);

  return (
    <CodeCard
      glyph={heading.glyph}
      title={heading.title}
      titleIs={heading.titleIs}
      code={rows === undefined ? code : rows.map((row) => row.text).join("\n")}
      lines={lines}
      rows={rows?.map((row) => row.kind)}
      copied={suggesting ? addedText(rows ?? []) : code}
      copy={copyThroughShell}
    />
  );
}

/** A link in a draft's words, opening as a transcript's link does (`use-open-link.ts`). */
function draftLink(url: string, children: ReactNode): ReactNode {
  return <DraftLink url={url}>{children}</DraftLink>;
}

function DraftLink({ url, children }: { url: string; children: ReactNode }): ReactNode {
  const openLink = useOpenLink();

  return (
    <TextLink href={url} words={undefined} onOpen={openLink}>
      {children}
    </TextLink>
  );
}

/**
 * Words an agent wrote to be sent elsewhere, fenced ```slack, ```email, or
 * ```draft, in a `DraftCard` as they will look when sent
 * (`@repo/ui/draft-text`), its Copy putting them on the clipboard as rich
 * text; none for any other fence, which its place draws as code. A
 * transcript's block and an Inbox to-do's step draw a draft alike.
 */
export function DraftFence({
  language,
  code,
}: {
  language: string | undefined;
  code: string;
}): ReactNode {
  const draft = draftKindOf(language ?? "");

  if (draft === undefined) return null;

  return (
    <DraftCard
      kind={draft}
      text={code}
      link={draftLink}
      copy={copyRichThroughShell}
      copyText={copyThroughShell}
    />
  );
}

/** A fenced block as the transcript draws it: a draft as it will look when sent (`DraftFence`), and any other block in a `CodeCard` (`CodeFence`). */
export function TranscriptCodeBlock({
  className,
  node,
}: ComponentProps<"code"> & MarkdownNodeProps): ReactNode {
  const language = LANGUAGE_CLASS.exec(className ?? "")?.[1] ?? "";
  const code = blockText(node).replace(/\n$/u, "");

  if (draftKindOf(language) === undefined) return <CodeFence language={language} code={code} />;

  return <DraftFence language={language} code={code} />;
}

/**
 * A transcript's fence: a whole Mermaid one as its diagram (`DescriptionDiagram`,
 * the renderer a description draws with), over the code card it falls back to
 * while the diagram draws or where Mermaid refuses it, and any other as a code
 * card. Note that a fence still streaming stays a code card, so a half-written
 * diagram is never handed to Mermaid.
 */
function TranscriptFence(props: ComponentProps<"code"> & MarkdownNodeProps): ReactNode {
  const openTail = useContext(OpenFenceTail);
  const language = LANGUAGE_CLASS.exec(props.className ?? "")?.[1] ?? "";
  const code = blockText(props.node).replace(/\n$/u, "");
  const source = <TranscriptCodeBlock {...props} />;
  const streaming = openTail !== undefined && openTail.endsWith(code.split("\n").at(-1) ?? "");

  if (language !== MERMAID_LANGUAGE || streaming) return source;

  return <DescriptionDiagram code={code} source={source} />;
}

/**
 * How a transcript's markdown draws code and tables: a fenced block in the
 * window's one code card, an inline span on a subtle fill, and a table bare,
 * as a note's is, its look the flow's (`@repo/ui`'s prose.css), each part
 * standing in for Streamdown's own, whose copy, download, and fullscreen
 * controls no note has. A cell keeps the alignment its column's rule gave
 * it, which Streamdown hands on as the cell's style.
 */
export const TRANSCRIPT_CODE_AND_TABLE_COMPONENTS: MarkdownComponents = {
  code: TranscriptFence,
  inlineCode: ({ children }) => <code className="transcript-inline-code">{children}</code>,
  table: ({ children }) => <table>{children}</table>,
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children, style }) => <th style={style}>{children}</th>,
  td: ({ children, style }) => <td style={style}>{children}</td>,
};

/** The markdown a transcript's words are drawn from, read for the block still waiting for its closing fence and handed to the blocks inside them. */
export function TranscriptMarkdownSource({
  markdown,
  children,
}: {
  markdown: string;
  children: ReactNode;
}): ReactNode {
  const openTail = useMemo(() => openFenceTail(markdown), [markdown]);

  return <OpenFenceTail.Provider value={openTail}>{children}</OpenFenceTail.Provider>;
}
