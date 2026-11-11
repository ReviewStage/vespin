import {
  INLINE_MARK,
  INLINE_SPAN,
  type InlineMark,
  type InlineMarkName,
  readInline,
  writeInline,
} from "@repo/features/composer-markdown";
import { fenceAfter } from "@repo/features/description-document";
import { fileMarker, fileMarkers } from "@repo/features/file-marker";
import { skillWord } from "@repo/features/skill-word";
import { WRITING_BLOCK, WRITING_MARK } from "@repo/settings/shortcuts";
import { TEXT_LINK_MARK_ATTRIBUTES } from "@repo/ui/link-face";
import {
  cutReply,
  MESSAGE_BLOCK,
  messageBlocks,
  messageText,
  QUOTE_GAP,
  quoteOf,
} from "@repo/ui/reply-quote";
import {
  insideCode,
  leadingCommandToken,
  mentionAt,
  skillTokens,
  type TextRange,
} from "@repo/ui/skill-mention";
import { type AnyExtension, Editor, Extension, Node } from "@tiptap/core";
import {
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  splitBlock,
} from "@tiptap/pm/commands";
import {
  type Fragment,
  type Mark,
  type Node as PmNode,
  type Schema,
  Slice,
} from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorProps, EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { enterKeyHint, enterSends, modEnterSends } from "../enter-sends.js";
import { atWordAround, chipOverSelection, spacedChip } from "./chip-spacing.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type ComposerEditorProps,
  type ComposerInput,
  type ComposerMark,
  type ComposerTrigger,
  type EditorAria,
  type MentionNode,
  rootAria,
  sameAria,
  sameTrigger,
} from "./contract.js";
import {
  MENTION_NODE,
  type MentionToken,
  mentionLink,
  mentionNode,
  mentionTokens,
  pastedMention,
} from "./mention-node.js";
import { quoteNode } from "./quote-node.js";
import { editorFormatting, formatReports } from "./writing-format.js";
import { withoutTipTapChords, writingKeys } from "./writing-keys.js";

/**
 * composer-editor.ts -- an agent's message box on TipTap: words and their inline marks, a line break, a chosen skill as a chip, and a quote, read out as the one string the message is.
 *
 * The box holds lines of words and one block, the quote, so its schema is
 * StarterKit cut down to a document of paragraphs, text, a hard break,
 * undo, the inline marks (bold, italic, strikethrough, code, and a link),
 * and the quote both editors hold (`./quote-node.ts`), holding lines alone. A mark is typed as its Markdown, by its chord from the writing
 * vocabulary (`./writing-keys.ts`, its marks' chords and the quote's), or
 * from the format toolbar its owner stands over the words selected
 * (`./writing-format.ts`), and is read out and back as the Markdown it is
 * (`./composer-markdown.ts`); words wearing none read out exactly as typed.
 * A quote is typed as `> ` at a line's start, or by its chord, as Notion's,
 * Linear's, and Slack's are, and its keys are the editor's own: Backspace
 * at its start turns the line back into words, and the caret stands over a
 * quote that starts the box as a gap cursor. Since Enter alone is the
 * owner's send, Shift with Enter is the box's Enter as a document has it
 * (`DOCUMENT_ENTER`): a new line, or, on an empty line of a quote, the line
 * out of it. No list or heading is typed into being, and no link is made of
 * an address as it is typed. A chip wears no mark, so words selected around
 * one and bolded leave it as it was. One node is added, the `skill` chip,
 * an atom that one Backspace takes out whole and that reads out as
 * `/name`. Reply lays the agent's words in as a quote where the caret
 * stands (`insertQuote`), edited as any quote is. A quote reads out as a
 * Markdown blockquote with a blank line around it
 * (`@repo/ui/reply-quote`), read back into a quote as the words are laid
 * in again. The words leave
 * the editor one way, `onDraft`, as the string `textOf` reads off the
 * document; nothing hands them back in. A change from outside is one of
 * the handle's commands (`./contract.ts`): `clear` after a send, `replace`
 * for a message that comes back, and a mark that carries the caret through
 * every change until a dictation's words land there, so no offset into the
 * string is ever turned back into a place in the document by arithmetic.
 *
 * A file's chip is an atom too, read out as its marker, `[Picture 1]` or
 * `[File: spec.pdf]` (`@repo/features/file-marker`), laid in where the owner
 * marked the caret as the file was handed (`ComposerMark.insertFiles`), and
 * made of a marker naming a file the box holds wherever the words are laid in.
 *
 * A `/name` naming one of the repository's skills becomes its chip once the
 * caret has left it, typed or pasted, and at once in words laid in whole;
 * a `/` word the caret ends is reported to the box (`onTrigger`), which
 * draws the list over it and writes the choice back through `chooseSkill`.
 * The trigger is the character's finder over the words (`slashWord`), so
 * another character's list stands on the same report beside it.
 * Neither a chip nor anything else in the editor's DOM carries the skill's
 * name in an attribute: it lives in the node, and the chip's words, drawn by
 * the panel (`drawChip`), are text the session recording masks.
 *
 * The bound is a transaction filter, so no keystroke, pick, or command
 * carries the words past it; a paste past it is cut to the room left, as a
 * textarea cuts one, and the owner is told it was (`onPasteCut`), unless the
 * owner took the words as a file first (`onPasteText`). Enter with no Shift is the owner's send, unless an
 * input method is composing, when the key is the input method's. On a
 * coarse pointer, a phone's or a tablet's, Enter is a new line, since its
 * keyboard has no Shift+Enter to type one, and the visible Send beside the
 * box sends; ⌘ or Ctrl with Enter, from a keyboard attached to it, still
 * sends. A box whose words are kept rather than sent, as an automation's
 * prompt is, writes a new line on every bare Enter, as a document's text
 * does, and hands its owner ⌘ or Ctrl with Enter alone (`enterWrites`).
 * The return key's label (`enterkeyhint`) says which Enter does
 * (`../enter-sends.ts`).
 */

/** The element class the editor wears beside the owner's. */
const EDITOR_CLASS = "composer-editor";

/** The key code a browser gives a key an input method takes. */
const COMPOSING_KEY_CODE = 229;

/** What a transaction from one of the handle's commands is tagged with, which read-only still takes. */
const COMMAND_META = "composer-command";

/** What a transaction that made chips of `/name` words is tagged with, so it makes none of its own. */
const CHIPPED_META = "composer-chipped";

/** A character a skill's name is spelled in, which a pick replaces through to the word's end. */
const NAME_CHARACTER = /[A-Za-z0-9-]/u;

const SPACE = " ";
const NEWLINE = "\n";
const SKILL_NODE = "skill";
const FILE_NODE = "fileChip";
const QUOTE_NODE = "blockquote";
const HARD_BREAK_NODE = "hardBreak";

/** No commands, for a box that runs none, and for words laid in among others, which open no message. */
const NO_COMMANDS: ReadonlySet<string> = new Set();

/** A run of plain text in the words: where it starts in the string, and where in the document. */
interface TextRun {
  readonly offset: number;
  readonly pos: number;
  readonly length: number;
}

/** The writing actions the box answers: its marks', and a quote's. */
const WRITING_ACTIONS = [...Object.values(WRITING_MARK), WRITING_BLOCK.QUOTE];

/** The marks the box holds, by name. */
const INLINE_MARKS: ReadonlySet<string> = new Set(Object.values(INLINE_MARK));

/** Whether a mark's name is one the box holds. */
function isInlineMark(name: string): name is InlineMarkName {
  return INLINE_MARKS.has(name);
}

/** A mark as the box writes it: its name, and a link's address. */
function inlineMark(mark: Mark): InlineMark[] {
  const { name } = mark.type;
  if (!isInlineMark(name)) return [];
  return [{ name, href: name === INLINE_MARK.LINK ? String(mark.attrs.href) : undefined }];
}

/** The words an inline node stands for, its marks aside. */
function inlineText(node: PmNode): string {
  if (node.isText) return node.text ?? "";
  if (node.type.name === SKILL_NODE) return skillWord(String(node.attrs.name));
  if (node.type.name === FILE_NODE) return fileMarker(String(node.attrs.name));
  if (node.type.name === MENTION_NODE) {
    return mentionLink({ name: String(node.attrs.name), target: String(node.attrs.target) });
  }
  return node.type.name === HARD_BREAK_NODE ? NEWLINE : "";
}

/** Whether a node is a quote block. */
function isQuote(node: PmNode): boolean {
  return node.type.name === QUOTE_NODE;
}

/** A quote block's words: its lines, each as the Markdown it is written as. */
function quoteWords(node: PmNode): string {
  return fragmentText(node.content);
}

/** Inline nodes written as one line of Markdown: the line, and where each text node's words landed in it, by the node's index. */
function writtenLine(nodes: readonly PmNode[]): ReturnType<typeof writeInline> {
  return writeInline(
    nodes.map((node) => ({
      text: inlineText(node),
      marks: node.isText ? node.marks.flatMap(inlineMark) : [],
      atom: !node.isText,
    })),
  );
}

/** The words a fragment stands for: its paragraphs a line each and its quotes each a blockquote set apart, or its inline nodes written as one line. */
function fragmentText(fragment: Fragment): string {
  const blocks: ({ kind: "quote"; words: string } | { kind: "words"; lines: string[] })[] = [];
  const inline: PmNode[] = [];
  fragment.forEach((node) => {
    const last = blocks.at(-1);
    if (isQuote(node)) blocks.push({ kind: MESSAGE_BLOCK.QUOTE, words: quoteWords(node) });
    else if (!node.isBlock) inline.push(node);
    else if (last?.kind === MESSAGE_BLOCK.WORDS) last.lines.push(fragmentText(node.content));
    else blocks.push({ kind: MESSAGE_BLOCK.WORDS, lines: [fragmentText(node.content)] });
  });
  return blocks.length === 0 ? writtenLine(inline).text : messageText(blocks);
}

/** The words a copied slice stands for: words picked inside one quote copied as its words, not as a quote, as a copy taken out of a quoted line elsewhere is; anything else as the box writes it. */
function copiedText(slice: Slice): string {
  const only = slice.content.childCount === 1 ? slice.content.firstChild : null;
  const insideQuote = only !== null && isQuote(only) && slice.openStart > 0 && slice.openEnd > 0;
  return fragmentText(insideQuote ? only.content : slice.content);
}

/** The words the document stands for, as the message sends them. */
function textOf(doc: PmNode): string {
  return fragmentText(doc.content);
}

/** Where a character of a quote's line stands once the line is quoted: past the `> ` (or, on an empty line, `>`) of its own line and of each line a break opened before it. */
function quotedOffset(line: string, at: number): number {
  const lines = line.split(NEWLINE);
  const before = line.slice(0, at).split(NEWLINE).length;
  let prefixes = 0;
  for (let index = 0; index < before; index += 1) prefixes += lines[index] === "" ? 1 : 2;
  return at + prefixes;
}

/** The runs of words of one line of the document, `start` the place its paragraph stands at and `offset` where its words start, a quote's lines shifted past their `> `. */
function lineRuns(
  paragraph: PmNode,
  start: number,
  offset: number,
  quoted: boolean,
): { runs: TextRun[]; length: number } {
  const children: PmNode[] = [];
  const starts: number[] = [];
  paragraph.forEach((child, childStart) => {
    children.push(child);
    starts.push(start + 1 + childStart);
  });
  const line = writtenLine(children);
  const runs = line.segments.map((segment) => ({
    offset: offset + (quoted ? quotedOffset(line.text, segment.offset) : segment.offset),
    pos: (starts[segment.piece] ?? 0) + segment.from,
    length: segment.length,
  }));
  return { runs, length: quoted ? quoteOf(line.text).length : line.text.length };
}

/** Every run of words in the document, in order, each with where it stands in the words, a mark's delimiters around it, a quote's lines among them. */
function textRuns(doc: PmNode): TextRun[] {
  const runs: TextRun[] = [];
  let offset = 0;
  let previous: PmNode | undefined;
  doc.forEach((block, start) => {
    if (previous !== undefined) {
      offset += isQuote(previous) || isQuote(block) ? QUOTE_GAP.length : NEWLINE.length;
    }
    previous = block;
    if (!isQuote(block)) {
      const line = lineRuns(block, start, offset, false);
      runs.push(...line.runs);
      offset += line.length;
      return;
    }
    block.forEach((paragraph, childStart) => {
      if (childStart > 0) offset += NEWLINE.length;
      const line = lineRuns(paragraph, start + 1 + childStart, offset, true);
      runs.push(...line.runs);
      offset += line.length;
    });
  });
  return runs;
}

/** Where in the document a range of the words stands, where it falls within one run of plain text; nothing where it does not. */
function placeOf(
  runs: readonly TextRun[],
  range: TextRange,
): { from: number; to: number } | undefined {
  const run = runs.find(
    (each) => range.start >= each.offset && range.end <= each.offset + each.length,
  );
  if (run === undefined) return undefined;
  return { from: run.pos + range.start - run.offset, to: run.pos + range.end - run.offset };
}

/** The words between two places in the document. */
function textBetween(doc: PmNode, from: number, to: number): string {
  return textOf(doc.cut(from, to));
}

/**
 * Where a place in the document stands in the words: in a run of words, by
 * the run, inside the delimiters of the marks it wears; anywhere else, as
 * the words before it read, since no mark stays open past a chip, a line,
 * or a quote.
 */
function offsetAt(doc: PmNode, pos: number): number {
  const run = textRuns(doc).find((each) => pos >= each.pos && pos <= each.pos + each.length);
  return run === undefined ? textBetween(doc, 0, pos).length : run.offset + pos - run.pos;
}

/** A chip written in plain words: where it stands, and the node it becomes. */
interface ChipToken {
  readonly start: number;
  readonly end: number;
  readonly node: (schema: Schema) => PmNode;
}

/** What words are made chips of: the skills a `/name` names, the commands the message's first word may name, the files a marker names, and whether the box takes mentions. */
interface Chipping {
  readonly skills: ReadonlySet<string>;
  readonly commands: ReadonlySet<string>;
  readonly files: ReadonlySet<string>;
  readonly mentions: boolean;
}

/** Each marker of a file the box holds, as the range it stands in. */
function fileTokens(text: string, files: ReadonlySet<string>): readonly ChipToken[] {
  return fileMarkers(text)
    .filter((marker) => files.has(marker.name))
    .map((marker) => ({
      start: marker.start,
      end: marker.end,
      node: (schema: Schema) => schema.node(FILE_NODE, { name: marker.name }),
    }));
}

/** Every chip the words spell, in order: each `/name` of a known skill, and each mention written as its link where the box takes mentions, none overlapping another. */
function chipTokens(
  text: string,
  { skills, commands, files, mentions: takesMentions }: Chipping,
): readonly ChipToken[] {
  // Note that a box that takes no mentions keeps a mention's link as the words it is, which it can edit.
  const mentions = (takesMentions ? mentionTokens(text) : []).map(
    (token: MentionToken): ChipToken => ({
      start: token.start,
      end: token.end,
      node: (schema) => schema.node(MENTION_NODE, { ...token.mention }),
    }),
  );
  // A command the message opens with is the command's chip, even where a skill shares its name, since the command is what it runs.
  const leading = leadingCommandToken(text, commands);
  const commanded = (leading === undefined ? [] : [leading]).map(
    (range): ChipToken => ({
      ...range,
      node: (schema) =>
        schema.node(SKILL_NODE, { name: text.slice(range.start + 1, range.end), command: true }),
    }),
  );
  // Note that a `/name` inside a mention's link is the link's words, never a chip of its own.
  const skilled = skillTokens(text, skills)
    .filter((range) => range.start !== leading?.start)
    .filter((range) => !mentions.some((each) => range.start < each.end && range.end > each.start))
    .map(
      (range): ChipToken => ({
        ...range,
        node: (schema) => schema.node(SKILL_NODE, { name: text.slice(range.start + 1, range.end) }),
      }),
    );
  // Note that a marker inside a mention's link is the link's words, as a `/name` there is.
  const filed = fileTokens(text, files).filter(
    (token) => !mentions.some((each) => token.start < each.end && token.end > each.start),
  );
  return [...mentions, ...commanded, ...skilled, ...filed].sort(
    (first, second) => first.start - second.start,
  );
}

/** A mark the words wear as the schema holds it. */
function schemaMark(schema: Schema, mark: InlineMark): Mark {
  return schema.mark(mark.name, mark.href === undefined ? null : { href: mark.href });
}

/**
 * The paragraphs lines of words stand for: one per line, its Markdown read
 * into marks, each `/name` of a known skill and each mention its chip. Note
 * that a fenced block's lines, its fences included, stand as the words they
 * are, because code read into marks is written back changed, ``` ``a`` ```
 * as `` `a` ``, and a prompt kept and opened again would be saved so; and
 * words typed in one make no mark either (`handleTextInput`).
 */
function paragraphsOf(schema: Schema, text: string, chipping: Chipping): PmNode[] {
  const tokens = chipTokens(text, chipping);
  const paragraphs: PmNode[] = [];
  let lineStart = 0;
  let fence: string | undefined;
  for (const line of text.split(NEWLINE)) {
    const lineEnd = lineStart + line.length;
    const fenceBefore = fence;
    fence = fenceAfter(fence, line);
    if (fenceBefore !== undefined || fence !== undefined) {
      paragraphs.push(schema.node("paragraph", null, line === "" ? [] : [schema.text(line)]));
      lineStart = lineEnd + NEWLINE.length;
      continue;
    }
    const chips = tokens.filter((each) => each.start >= lineStart && each.end <= lineEnd);
    const atoms = chips.map((each) => ({
      start: each.start - lineStart,
      end: each.end - lineStart,
    }));
    const children = readInline(line, atoms).map((span) =>
      span.kind === INLINE_SPAN.ATOM
        ? (chips.find((each) => each.start === lineStart + span.from)?.node(schema) ??
          schema.text(line.slice(span.from, span.to)))
        : schema.text(
            line.slice(span.from, span.to),
            span.marks.map((mark) => schemaMark(schema, mark)),
          ),
    );
    paragraphs.push(schema.node("paragraph", null, children));
    lineStart = lineEnd + NEWLINE.length;
  }
  return paragraphs;
}

/**
 * The document the words stand for: each quote set apart in them a quote
 * block, and the lines between its paragraphs. Note that a quote ending the
 * words has an empty line laid under it, because no caret can stand after
 * a block that takes none.
 */
function documentOf(schema: Schema, text: string, chipping: Chipping): PmNode {
  const blocks = messageBlocks(text);
  const nodes = blocks.flatMap((block) =>
    block.kind === MESSAGE_BLOCK.QUOTE
      ? [schema.node(QUOTE_NODE, null, paragraphsOf(schema, block.words, chipping))]
      : paragraphsOf(schema, block.lines.join(NEWLINE), chipping),
  );
  if (blocks.at(-1)?.kind === MESSAGE_BLOCK.QUOTE) nodes.push(schema.node("paragraph"));
  return schema.topNodeType.create(null, nodes);
}

/** The words as a slice that lays in where a caret or a selection stands, its first and last lines joining the lines around them. */
function sliceOf(schema: Schema, text: string, chipping: Chipping): Slice {
  // Note that words laid in among others open no message, so a command among them stays words.
  return Slice.maxOpen(documentOf(schema, text, { ...chipping, commands: NO_COMMANDS }).content);
}

/**
 * Each `/name` of a known skill and each marker of a held file that
 * still stands as words made its chip, but the one the caret ends where it
 * is asked to be spared; nothing where there is none.
 */
function chipped(
  state: EditorState,
  chipping: Pick<Chipping, "skills" | "commands" | "files">,
  spareCaret: boolean,
): Transaction | undefined {
  const { doc, selection, schema } = state;
  const runs = textRuns(doc);
  const text = textOf(doc);
  const caret = selection.empty ? offsetAt(doc, selection.from) : undefined;
  const leading = leadingCommandToken(text, chipping.commands);
  const tokens: {
    start: number;
    end: number;
    node: (place: { from: number; to: number }) => PmNode;
  }[] = [
    ...(leading === undefined ? [] : [leading]).map((token) => ({
      ...token,
      node: (place: { from: number; to: number }) =>
        schema.node(SKILL_NODE, {
          name: doc.textBetween(place.from + 1, place.to),
          command: true,
        }),
    })),
    ...skillTokens(text, chipping.skills)
      .filter((token) => token.start !== leading?.start)
      .map((token) => ({
        ...token,
        node: (place: { from: number; to: number }) =>
          schema.node(SKILL_NODE, { name: doc.textBetween(place.from + 1, place.to) }),
      })),
    ...fileTokens(text, chipping.files).map((token) => ({
      ...token,
      node: () => token.node(schema),
    })),
  ];
  const places = tokens
    .filter((token) => !spareCaret || token.end !== caret)
    .flatMap((token) => {
      const place = placeOf(runs, token);
      return place === undefined ? [] : [{ ...place, node: token.node(place) }];
    })
    .sort((first, second) => first.from - second.from);
  if (places.length === 0) return undefined;
  const tr = state.tr;
  for (const place of places.reverse()) tr.replaceWith(place.from, place.to, place.node);
  return tr.setMeta(CHIPPED_META, true);
}

/**
 * Shift with Enter as a document's Enter: a new line, or, on an empty line
 * of a quote, the line out of the quote. Note that Enter alone is the
 * owner's send, so Shift with Enter is the box's one way to a new line.
 */
const DOCUMENT_ENTER = chainCommands(createParagraphNear, liftEmptyBlock, splitBlock);

/** The chip beside an empty selection taken out whole, before it for Backspace and after it for Delete; answers whether there was one. */
function removedChip(view: EditorView, key: string): boolean {
  const { selection } = view.state;
  if (!selection.empty || (key !== "Backspace" && key !== "Delete")) return false;
  const back = key === "Backspace";
  const beside = back ? selection.$from.nodeBefore : selection.$from.nodeAfter;
  if (beside === null || beside === undefined || !isChip(beside)) return false;
  const from = back ? selection.from - 1 : selection.from;
  view.dispatch(view.state.tr.delete(from, from + 1).scrollIntoView());
  return true;
}

/** Whether a key belongs to an input method that is composing, in any of the ways a browser says so. */
function composing(view: EditorView, event: KeyboardEvent): boolean {
  return event.isComposing || view.composing || event.keyCode === COMPOSING_KEY_CODE;
}

/** A word a trigger character starts, in the words' own terms: where the character stands, what follows it to the caret, and where the word ends. */
interface TriggerWord {
  readonly start: number;
  readonly query: string;
  readonly end: number;
}

/** Finds the word a trigger character starts at the caret; one for each character the box answers. */
type TriggerFinder = (text: string, caret: number) => TriggerWord | undefined;

/** The `/` word the caret ends: a skill's name as far as it is typed, through to the name's end. */
function slashWord(text: string, caret: number): TriggerWord | undefined {
  const mention = mentionAt(text, caret);
  if (mention === undefined) return undefined;
  let end = caret;
  while (end < text.length && NAME_CHARACTER.test(text[end] ?? "")) end += 1;
  return { ...mention, end };
}

/** The `@` word the caret ends, as far as it is typed, through to the word's end (`atWordAround`); nothing in code. */
function atWord(text: string, caret: number): TriggerWord | undefined {
  const word = atWordAround(text.slice(0, caret), text.slice(caret));
  if (word === undefined) return undefined;
  const start = caret - word.query.length - 1;
  // An `@` in code is the code's, as a `/` there is, and as the server reads no mention there.
  if (insideCode(text, start)) return undefined;
  return { start, query: word.query, end: caret + word.rest };
}

/**
 * The word a trigger character starts at the caret, where the character
 * stands in plain text: the report, and the range a pick replaces; nothing
 * while the box has no caret, or the caret ends no such word.
 */
function triggerAt(
  view: EditorView,
  find: TriggerFinder,
): { readonly trigger: ComposerTrigger; readonly from: number; readonly to: number } | undefined {
  const { doc, selection } = view.state;
  if (!selection.empty || !view.hasFocus()) return undefined;
  const text = textOf(doc);
  const caret = offsetAt(doc, selection.from);
  const word = find(text, caret);
  if (word === undefined) return undefined;
  const runs = textRuns(doc);
  const typed = placeOf(runs, { start: word.start, end: caret });
  if (typed === undefined) return undefined;
  const whole = placeOf(runs, { start: word.start, end: word.end }) ?? typed;
  const box = view.coordsAtPos(typed.from);
  return {
    trigger: {
      start: word.start,
      query: word.query,
      rect: { left: box.left, top: box.top, bottom: box.bottom },
    },
    from: whole.from,
    to: whole.to,
  };
}

/** The `skill` chip: an atom read out as `/name`, its look the panel's (`drawChip`), its name in the node and never in the DOM's attributes. */
function skillNode(drawChip: ComposerEditorProps["drawChip"], known: (name: string) => boolean) {
  return Node.create({
    name: SKILL_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    addAttributes() {
      return {
        name: { default: "", rendered: false },
        command: { default: false, rendered: false },
      };
    },
    // Note that a chip copied out and pasted back is read by its words, since its name is in no
    // attribute, and stays words where this repository keeps no skill of that name.
    parseHTML() {
      return [
        {
          tag: "span[data-chip]",
          getAttrs: (element) => {
            const name = element.textContent.replace(/^\//u, "");
            return known(name) ? { name } : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      return ["span", { "data-chip": SKILL_NODE }, skillWord(String(node.attrs.name))];
    },
    renderText({ node }) {
      return skillWord(String(node.attrs.name));
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("span");
        dom.contentEditable = "false";
        dom.dataset.chip = SKILL_NODE;
        const undraw = drawChip(dom, {
          name: String(node.attrs.name),
          command: node.attrs.command === true,
        });
        return { dom, ignoreMutation: () => true, destroy: undraw };
      };
    },
  });
}

/**
 * A file's chip: an atom read out as its marker, `[Picture 1]` or
 * `[File: spec.pdf]`, its look the panel's (`drawFile`), its name in the
 * node and never in the DOM's attributes, as a skill's is; where the panel
 * draws none, its marker as words. A chip copied out and pasted back is read
 * by its words, and stays words where the box holds no file of that name.
 */
function fileNode(drawFile: ComposerEditorProps["drawFile"], held: (name: string) => boolean) {
  return Node.create({
    name: FILE_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    addAttributes() {
      return { name: { default: "", rendered: false } };
    },
    parseHTML() {
      return [
        {
          tag: `span[data-chip="${FILE_NODE}"]`,
          getAttrs: (element) => {
            const name = fileMarkers(element.textContent)[0]?.name;
            return name !== undefined && held(name) ? { name } : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      return ["span", { "data-chip": FILE_NODE }, fileMarker(String(node.attrs.name))];
    },
    renderText({ node }) {
      return fileMarker(String(node.attrs.name));
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("span");
        dom.contentEditable = "false";
        dom.dataset.chip = FILE_NODE;
        const name = String(node.attrs.name);
        if (drawFile === undefined) dom.textContent = fileMarker(name);
        const undraw = drawFile?.(dom, name) ?? (() => undefined);
        return { dom, ignoreMutation: () => true, destroy: undraw };
      };
    },
  });
}

/**
 * What the box may hold: paragraphs, text, a hard break, undo, and the
 * inline marks, StarterKit's and nothing more, the chips, and the quote
 * block; the marks' chords the writing vocabulary's, and the selection told
 * to a format toolbar where one stands over the box. Note that a link is
 * made only on purpose, never of an address as it is typed, since an
 * address typed is sent as the words typed, and that a press on one opens
 * nothing, since the box's own right-click opens it.
 */
function composerExtensions(
  props: ComposerEditorProps,
  known: (name: string) => boolean,
  held: (name: string) => boolean,
): AnyExtension[] {
  const kit = StarterKit.configure({
    // Note that the quote is the description's own (`quoteNode`), holding lines alone.
    blockquote: false,
    bulletList: false,
    codeBlock: false,
    dropcursor: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    listKeymap: false,
    link: { autolink: false, openOnClick: false, HTMLAttributes: TEXT_LINK_MARK_ATTRIBUTES },
    orderedList: false,
    underline: false,
    trailingNode: false,
  });
  return [
    withoutTipTapChords(kit),
    writingKeys.configure({ actions: WRITING_ACTIONS }),
    ...formatReports(props.format),
    skillNode(props.drawChip, known),
    fileNode(props.drawFile, held),
    mentionNode(props.mentions?.drawMention),
    quoteNode(true),
  ];
}

/** Whether a node is a chip, a skill's, a file's, or a mention's. */
function isChip(node: PmNode): boolean {
  const { name } = node.type;
  return name === SKILL_NODE || name === FILE_NODE || name === MENTION_NODE;
}

/** Every chip a mark was laid on, as words selected around it and marked lay one, made to wear none again. */
function unmarkedChips(tr: Transaction): Transaction {
  tr.doc.descendants((node, pos) => {
    if (isChip(node) && node.marks.length > 0) tr.removeMark(pos, pos + node.nodeSize);
    return !node.isInline;
  });
  return tr;
}

/** What a mounted box keeps between its events: the skills it chips, whether it takes words, what ties it to its list, the last words and word it reported, and its marks. */
interface ComposerState {
  skills: ReadonlySet<string>;
  commands: ReadonlySet<string>;
  files: ReadonlySet<string>;
  input: ComposerInput;
  aria: EditorAria;
  emitted: string;
  reported: ComposerTrigger | undefined;
  trigger: ReturnType<typeof triggerAt>;
  mentionReported: ComposerTrigger | undefined;
  mentionTrigger: ReturnType<typeof triggerAt>;
  /** Whether the box takes mentions, as it was mounted. */
  readonly mentions: boolean;
  /** Each mark's place, carried through every change the document takes. */
  readonly marks: Map<symbol, number>;
}

/** The `/` word and the `@` word the caret ends found again, and each reported where it changed. */
function reported(view: EditorView, state: ComposerState, props: ComposerEditorProps): void {
  state.trigger = triggerAt(view, slashWord);
  const next = state.trigger?.trigger;
  if (!sameTrigger(next, state.reported)) {
    state.reported = next;
    props.onTrigger(next);
  }
  const { mentions } = props;
  if (mentions === undefined) return;
  state.mentionTrigger = triggerAt(view, atWord);
  const mention = state.mentionTrigger?.trigger;
  if (sameTrigger(mention, state.mentionReported)) return;
  state.mentionReported = mention;
  mentions.onTrigger(mention);
}

/**
 * The box's guard: no change past the bound and none while read-only but a
 * command's, each completed `/name` made its chip, no chip wearing a mark,
 * and the `/` word reported as the editor's state moves.
 */
function guardPlugin(state: ComposerState, props: ComposerEditorProps): Plugin {
  return new Plugin({
    key: new PluginKey("composer-guard"),
    // Note that a change that shrinks the words passes even past the bound, so
    // words already over it, which nothing lays in, can still be cut back.
    filterTransaction: (tr, before) => {
      if (!tr.docChanged) return true;
      if (state.input === COMPOSER_INPUT.READ_ONLY && tr.getMeta(COMMAND_META) !== true)
        return false;
      const length = textOf(tr.doc).length;
      return length <= props.maxLength || length <= textOf(before.doc).length;
    },
    appendTransaction: (transactions, _old, now) => {
      const chipping = transactions.some((tr) => tr.getMeta(CHIPPED_META) === true);
      const tr = unmarkedChips((chipping ? undefined : chipped(now, state, true)) ?? now.tr);
      return tr.docChanged ? tr : undefined;
    },
    view: () => ({ update: (view) => reported(view, state, props) }),
  });
}

/** Whether the line a place in the words stands on is a fenced block's, its fences included. */
function inFence(text: string, at: number): boolean {
  let fence: string | undefined;
  let start = 0;
  for (const line of text.split(NEWLINE)) {
    const before = fence;
    fence = fenceAfter(fence, line);
    if (at <= start + line.length) return before !== undefined || fence !== undefined;
    start += line.length + NEWLINE.length;
  }
  return false;
}

/**
 * Whether a caret stands in code: the character after it is code's, or the
 * one before it on its own line is, as a caret just inside a span's closing
 * backtick is. Note that the line before is never read, because a fence's
 * closing line is code and the line after it is not.
 */
function caretInCode(text: string, caret: number): boolean {
  if (insideCode(text, caret)) return true;
  return caret > 0 && text[caret - 1] !== NEWLINE && insideCode(text, caret - 1);
}

/** A paste taken: files the owner takes kept out of the words, words it takes as a file kept out too, and words past the bound cut to the room left, which the owner is told. */
function pasted(
  view: EditorView,
  event: ClipboardEvent,
  slice: Slice,
  state: ComposerState,
  props: ComposerEditorProps,
): boolean {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length > 0 && props.onPasteFiles(files)) return true;
  if (state.input === COMPOSER_INPUT.READ_ONLY) return true;
  const { doc, selection, schema } = view.state;
  const words = fragmentText(slice.content);
  if (props.onPasteText?.(words) === true) return true;
  // Note that what goes over is read off the words as the paste would leave them, since a selection inside a mark leaves its delimiters standing around what replaces it.
  const over = (pasting: string) =>
    textOf(view.state.tr.replaceSelection(sliceOf(schema, pasting, state)).doc).length -
    props.maxLength;
  // An address of our own or a page of an integration's pasted whole, outside code, is laid in as its mention, where its link has room.
  const mention = props.mentions?.pasted(words);
  if (
    mention !== undefined &&
    over(`${mentionLink(mention)}${SPACE}`) <= 0 &&
    !caretInCode(textOf(doc), offsetAt(doc, selection.from))
  ) {
    return pastedMention(view, event, () => mention);
  }
  let kept = words;
  for (let excess = over(kept); excess > 0 && kept !== ""; excess = over(kept)) {
    kept = kept.slice(0, Math.max(0, kept.length - excess));
  }
  if (kept === words) return false;
  if (kept !== "") {
    view.dispatch(view.state.tr.replaceSelection(sliceOf(schema, kept, state)).scrollIntoView());
  }
  // Note that the owner is told after the words land, so what it says of the cut is never cleared by the change that made it.
  props.onPasteCut?.();
  return true;
}

/** How the box's editor hears keys, input, focus, a paste, a drop, and the clipboard. */
function composerProps(state: ComposerState, props: ComposerEditorProps): EditorProps {
  return {
    // Note that the attributes are read again on every update, so the return key's label follows a pointer that changes, and the box names itself a combobox while its list stands.
    attributes: () => ({
      class: `${props.className} ${EDITOR_CLASS}`,
      ...rootAria(state.aria),
      "aria-label": props.label,
      enterkeyhint: enterKeyHint(props.enterWrites === true),
    }),
    // Note that a key an input method is composing is the input method's alone, the owner's included.
    handleKeyDown: (view, event) => {
      if (composing(view, event)) return false;
      if (props.onKey(event) || removedChip(view, event.key)) return true;
      // Note that Shift with Enter is never the owner's, ⌘ or Ctrl held too, since Shift is what breaks a line.
      if (event.shiftKey) {
        const plain = event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey;
        return plain && DOCUMENT_ENTER(view.state, view.dispatch);
      }
      if (!(props.enterWrites === true ? modEnterSends(event) : enterSends(event))) return false;
      props.onEnter();
      return true;
    },
    // Note that words typed in a fenced block are the code's, so no Markdown rule makes a mark of them, as none is read from its lines (`paragraphsOf`).
    handleTextInput: (view, from, _to, _text, typed) => {
      const { doc } = view.state;
      if (!inFence(textOf(doc), offsetAt(doc, from))) return false;
      view.dispatch(typed());
      return true;
    },
    handleDOMEvents: {
      // A dictation's read-only box keeps the caret and its keys, and takes no words.
      beforeinput: (_view, event) => {
        if (state.input !== COMPOSER_INPUT.READ_ONLY) return false;
        event.preventDefault();
        return true;
      },
      blur: (view) => {
        reported(view, state, props);
        return false;
      },
      focus: (view) => {
        reported(view, state, props);
        return false;
      },
      // The words scrolling under a list move the slash it stands over, with no change to the state.
      scroll: (view) => {
        reported(view, state, props);
        return false;
      },
    },
    handlePaste: (view, event, slice) => pasted(view, event, slice, state, props),
    // Note that a drop of files is left to the card around the box, which takes them as a "+" does.
    handleDrop: (_view, event) => event.dataTransfer?.types.includes("Files") === true,
    clipboardTextParser: (text, _context, _plain, view) => sliceOf(view.state.schema, text, state),
    clipboardTextSerializer: copiedText,
  };
}

/** A change from outside dispatched: taken while read-only, left out of undo, the caret kept in view. */
function commanded(editor: Editor, tr: Transaction): void {
  editor.view.dispatch(
    tr.setMeta(COMMAND_META, true).setMeta("addToHistory", false).scrollIntoView(),
  );
}

/**
 * The box focused, the browser's caret laid anew where the editor's caret
 * stands. Note that the browser's selection is let go first, because a
 * quote laid in over an empty line leaves Chrome saying its caret stands
 * where the editor's does, so ProseMirror lays none, while Chrome's own
 * caret stands nowhere it can type, and the words typed next are lost.
 */
function focusedAtCaret(editor: Editor): void {
  editor.view.dom.ownerDocument.getSelection()?.removeAllRanges();
  editor.view.focus();
}

/** The words laid in whole, each known skill's `/name` its chip, the caret at their end, and the browser's there too where the box holds the focus. */
function laidIn(editor: Editor, state: ComposerState, text: string): void {
  const { doc, schema } = editor.state;
  const tr = editor.state.tr.replaceWith(
    0,
    doc.content.size,
    documentOf(schema, text, state).content,
  );
  commanded(editor, tr.setSelection(TextSelection.atEnd(tr.doc)).setMeta(CHIPPED_META, true));
  if (editor.view.hasFocus()) focusedAtCaret(editor);
}

/** Whether words put in beside an inline node need a space from it: it ends, or starts where it stands after them, in a character that is no space. */
function needsSpace(node: PmNode | null | undefined, after: boolean): boolean {
  if (node === null || node === undefined) return false;
  const words = inlineText(node);
  const character = after ? words[0] : words.at(-1);
  return character !== undefined && !/\s/u.test(character);
}

/** The words put in at a place, spaced from a word either side and cut to the room left, the caret after them; answers whether any went in. */
function insertedAt(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  pos: number,
  words: string,
): boolean {
  const { doc, schema } = editor.state;
  const $pos = doc.resolve(pos);
  const lead = needsSpace($pos.nodeBefore, false) ? SPACE : "";
  const trail = needsSpace($pos.nodeAfter, true) ? SPACE : "";
  const room = Math.max(0, maxLength - textOf(doc).length - lead.length - trail.length);
  const fitting = words.slice(0, room).trim();
  if (fitting === "") return false;
  const tr = editor.state.tr.replace(pos, pos, sliceOf(schema, `${lead}${fitting}${trail}`, state));
  commanded(
    editor,
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(pos) - trail.length)),
  );
  editor.view.focus();
  return true;
}

/**
 * Files put in as their chips at a place, spaced from a word either side,
 * the caret after the last and the box focused, each held from now on;
 * answers whether they went in, which they do not past the bound, nor where
 * the place holds no words. Note that the change is undone as any other, so
 * its chips go and come back with undo, and their files with them
 * (`use-attached-files.ts`).
 */
function insertedFilesAt(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  pos: number,
  names: readonly string[],
): boolean {
  const { doc, schema } = editor.state;
  const $pos = doc.resolve(pos);
  if (names.length === 0 || !$pos.parent.inlineContent) return false;
  state.files = new Set([...state.files, ...names]);
  const chips = names.flatMap((name, index) => [
    ...(index > 0 ? [schema.text(SPACE)] : []),
    schema.node(FILE_NODE, { name }),
  ]);
  const laid = editor.state.tr.insert(pos, chips);
  const tr = spacedChip(laid, pos, laid.mapping.map(pos));
  if (textOf(tr.doc).length > maxLength) return false;
  editor.view.dispatch(tr.setMeta(COMMAND_META, true).setMeta(CHIPPED_META, true).scrollIntoView());
  editor.view.focus();
  return true;
}

/** The word a trigger found written as the chip given, spaced as every chip is (`spacedChip`). */
function choseChip(editor: Editor, word: ReturnType<typeof triggerAt>, chip: PmNode): void {
  if (word === undefined) return;
  const tr = editor.state.tr.replaceWith(word.from, word.to, chip);
  editor.view.dispatch(spacedChip(tr, word.from, word.from + chip.nodeSize).scrollIntoView());
}

/**
 * A mention made elsewhere laid in where the caret stands, over what is
 * selected, spaced as every chip is (`chipOverSelection`), and the box
 * focused; nothing where the box takes no words now, or the words with its
 * link would stand past the bound, as a key typed past it is not written.
 */
function laidInMention(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  mention: MentionNode,
): void {
  if (state.input !== COMPOSER_INPUT.EDITABLE) return;
  const chip = editor.schema.node(MENTION_NODE, { name: mention.name, target: mention.target });
  const tr = chipOverSelection(editor.state, chip);
  if (textOf(tr.doc).length > maxLength) return;
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/** The quote laid in under the line or the quote the caret stands in, or in its place where the line is empty, an empty line under it holding the caret. */
function quotedAt(editor: Editor, chipping: Chipping, words: string): Transaction {
  const { doc, selection, schema } = editor.state;
  const { $from } = selection;
  const line = doc.child($from.index(0));
  const quote = schema.node(QUOTE_NODE, null, paragraphsOf(schema, words, chipping));
  const from = $from.before(1);
  const empty = line.type.name === "paragraph" && line.content.size === 0;
  const tr = empty
    ? editor.state.tr.replaceWith(from, from + line.nodeSize, quote)
    : editor.state.tr.insert(from + line.nodeSize, quote);
  const under = (empty ? from : from + line.nodeSize) + quote.nodeSize;
  const next = tr.doc.nodeAt(under);
  if (next === null || next.type.name !== "paragraph" || next.content.size > 0) {
    tr.insert(under, schema.node("paragraph"));
  }
  return tr.setSelection(TextSelection.create(tr.doc, under + 1));
}

/**
 * Words of the agent's laid in as a quote where the caret stands, cut from
 * their end where the bound has no room for them whole, the box focused;
 * nothing where it takes no words now or has no room for any.
 */
function laidInQuote(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  words: string,
): boolean {
  if (state.input !== COMPOSER_INPUT.EDITABLE || editor.state.selection.$from.depth < 1) {
    return false;
  }
  let kept = words;
  while (kept !== "") {
    const tr = quotedAt(editor, state, kept);
    const over = textOf(tr.doc).length - maxLength;
    if (over <= 0) {
      editor.view.dispatch(tr.scrollIntoView());
      focusedAtCaret(editor);
      return true;
    }
    kept = cutReply(kept, kept.length - over);
  }
  return false;
}

/** A mark of the caret where it stands, carried through every change until its words land or it is let go. */
function marked(editor: Editor, state: ComposerState, maxLength: number): ComposerMark {
  const mark = Symbol("mark");
  state.marks.set(mark, editor.state.selection.to);
  return {
    insert: (words) => {
      const pos = state.marks.get(mark);
      state.marks.delete(mark);
      return pos !== undefined && insertedAt(editor, state, maxLength, pos, words);
    },
    insertFiles: (names) => {
      const pos = state.marks.get(mark);
      state.marks.delete(mark);
      return pos !== undefined && insertedFilesAt(editor, state, maxLength, pos, names);
    },
    release: () => {
      state.marks.delete(mark);
    },
  };
}

/** The editor element's attributes set, or taken off where a value is nothing. */
function attributed(
  editor: Editor,
  attributes: Readonly<Record<string, string | undefined>>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) editor.view.dom.removeAttribute(name);
    else editor.view.dom.setAttribute(name, value);
  }
}

/**
 * The message box's editor mounted into `host`, opening on the words given,
 * each change handed back through `onDraft`, and every outside change taken
 * through the handle it answers.
 */
export function mountComposer(host: HTMLElement, props: ComposerEditorProps): ComposerEditorHandle {
  const state: ComposerState = {
    skills: props.skills,
    commands: NO_COMMANDS,
    files: props.files ?? new Set(),
    input: COMPOSER_INPUT.EDITABLE,
    aria: {},
    emitted: props.text,
    reported: undefined,
    trigger: undefined,
    mentionReported: undefined,
    mentionTrigger: undefined,
    mentions: props.mentions !== undefined,
    marks: new Map(),
  };
  const guard = guardPlugin(state, props);
  const editor = new Editor({
    element: host,
    // Note that TipTap's own base rules would go in as an inline `<style>`, which the panel's policy (`style-src 'self'`: the desktop's `renderer/index.html` and the web's `vercel.json`) refuses; the owner's stylesheet styles the box instead.
    injectCSS: false,
    // Note that pasted words are read as the box reads its own (`clipboardTextParser`), so no paste rule makes a link of a bare address or bold of `__init__`; a link pasted over words selected still links them.
    enablePasteRules: false,
    extensions: [
      ...composerExtensions(
        props,
        (name) => state.skills.has(name),
        (name) => state.files.has(name),
      ),
      Extension.create({ name: "composerGuard", addProseMirrorPlugins: () => [guard] }),
    ],
    editorProps: composerProps(state, props),
  });
  editor.on("transaction", ({ transaction }) => {
    for (const [mark, pos] of state.marks) state.marks.set(mark, transaction.mapping.map(pos));
    const text = textOf(editor.state.doc);
    if (!transaction.docChanged || text === state.emitted) return;
    state.emitted = text;
    props.onDraft(text);
  });
  laidIn(editor, state, props.text);
  if (props.focus) editor.view.focus();
  return {
    ...editorFormatting(editor),
    clear: () => laidIn(editor, state, ""),
    replace: (text) => laidIn(editor, state, text),
    mark: () => marked(editor, state, props.maxLength),
    chooseSkill: (name) =>
      choseChip(editor, state.trigger, editor.schema.node(SKILL_NODE, { name })),
    chooseMention: (mention) =>
      choseChip(
        editor,
        state.mentionTrigger,
        editor.schema.node(MENTION_NODE, { name: mention.name, target: mention.target }),
      ),
    insertMention: (mention) => laidInMention(editor, state, props.maxLength, mention),
    insertQuote: (words) => laidInQuote(editor, state, props.maxLength, words),
    chooseSkillAtMention: (name) =>
      choseChip(editor, state.mentionTrigger, editor.schema.node(SKILL_NODE, { name })),
    setSkills: (skills) => {
      state.skills = skills;
      const tr = chipped(editor.state, state, true);
      if (tr !== undefined) editor.view.dispatch(tr.setMeta("addToHistory", false));
    },
    setCommands: (commands) => {
      state.commands = commands;
      const tr = chipped(editor.state, state, true);
      if (tr !== undefined) editor.view.dispatch(tr.setMeta("addToHistory", false));
    },
    setFiles: (files) => {
      state.files = files;
      const tr = chipped(editor.state, state, true);
      if (tr !== undefined) editor.view.dispatch(tr.setMeta("addToHistory", false));
    },
    setInput: (input) => {
      state.input = input;
      editor.setEditable(input !== COMPOSER_INPUT.DISABLED, false);
      attributed(editor, {
        "aria-disabled": input === COMPOSER_INPUT.DISABLED ? "true" : undefined,
        "aria-readonly": input === COMPOSER_INPUT.READ_ONLY ? "true" : undefined,
      });
    },
    setAria: (aria) => {
      if (sameAria(state.aria, aria) || editor.isDestroyed) return;
      state.aria = aria;
      // Note that an input method's words are never redrawn under it: the next change it makes names the list.
      if (!editor.view.composing) editor.view.updateState(editor.state);
    },
    blur: () => editor.view.dom.blur(),
    destroy: () => editor.destroy(),
  };
}
