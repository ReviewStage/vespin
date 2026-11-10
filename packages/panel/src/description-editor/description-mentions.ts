import type { Editor } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { atWordAround, spacedChip } from "./chip-spacing.js";
import {
  type ComposerTrigger,
  type DescriptionEditorMentions,
  type HeadingsChange,
  type MentionNode,
  sameTrigger,
} from "./contract.js";
import { MENTION_NODE } from "./mention-node.js";

/**
 * description-mentions.ts -- the description editor's `@`: the word the caret ends reported to the panel, the mention it picks written in its place, and a mention of a heading the developer renames named again with the new words.
 *
 * An `@` word, outside code, opens the panel's list (`onTrigger`), read as
 * every composer reads one (`atWordAround`). A pick replaces the word with
 * the mention's node, spaced as every chip is (`spacedChip`).
 * The keys the list takes are the panel's first
 * (`../description-editor.ts`'s `handleKeyDown`).
 *
 * A section is named by its heading's anchor, so renaming a heading in the
 * editor, or laying in one that a later heading's anchor now has to step
 * aside for, would leave the text's own mentions of it naming nothing, or
 * the wrong section. Each change that moves the text's headings hands the
 * panel the headings before and after it and which section each kept one
 * is now, its heading still the block it was, and the panel names every
 * mention of a section renamed or whose anchor moved again, target by
 * target and under the section's new heading (`retarget`), in the same
 * change, since only it reads a target. A
 * heading laid in by the app's merged answer replaces the block whole, so the
 * section it opened is none the change kept.
 */

/** The heading levels that open a section, as `descriptionSections` counts them. */
const SECTION_LEVELS = new Set([1, 2]);

/** What a change that named mentions again is tagged with, so it names none of its own. */
const RETARGETED_META = "plan-retargeted";

/** The character an inline node that is no text stands for in its block's words, one position wide as the node is. */
const LEAF_CHARACTER = "￼";

/** The `@` word the caret ends: the report, and the range a pick replaces. */
interface TaskTrigger {
  readonly trigger: ComposerTrigger;
  readonly from: number;
  readonly to: number;
}

/** What the plugin holds between changes: the word last found, and the report last made. */
interface MentionsState {
  found: TaskTrigger | undefined;
  reported: ComposerTrigger | undefined;
}

/** The `@` word the caret ends in plain text, outside code; nothing while the editor has no caret or the caret ends none. */
function triggerAt(view: EditorView): TaskTrigger | undefined {
  const { selection, doc } = view.state;
  if (!selection.empty || !view.hasFocus()) return undefined;
  const { $from } = selection;
  if ($from.parent.type.spec.code === true) return undefined;
  const { parent, parentOffset } = $from;
  const before = parent.textBetween(0, parentOffset, undefined, LEAF_CHARACTER);
  const after = parent.textBetween(parentOffset, parent.content.size, undefined, LEAF_CHARACTER);
  const word = atWordAround(before, after);
  if (word === undefined) return undefined;
  const from = $from.start() + before.length - word.query.length - 1;
  if (
    doc
      .resolve(from + 1)
      .marks()
      .some((mark) => mark.type.spec.code === true)
  )
    return undefined;
  const box = view.coordsAtPos(from);
  return {
    trigger: {
      start: from,
      query: word.query,
      rect: { left: box.left, top: box.top, bottom: box.bottom },
    },
    from,
    to: selection.from + word.rest,
  };
}

/** The `@` word found again, and reported where it changed. */
function reported(
  view: EditorView,
  state: MentionsState,
  mentions: DescriptionEditorMentions,
): void {
  state.found = triggerAt(view);
  const next = state.found?.trigger;
  if (sameTrigger(next, state.reported)) return;
  state.reported = next;
  mentions.onTrigger(next);
}

/** Whether a top-level block opens a section. */
function opensSection(node: PmNode): boolean {
  return node.type.name === "heading" && SECTION_LEVELS.has(Number(node.attrs.level));
}

/**
 * A heading's words as the description's text spells them, its formatting kept, as
 * `descriptionSections` knows a section by: the block's own source while it is the
 * block it opened as, so `_today_` stays `_today_`, else as the editor will
 * write it.
 */
function headingWords(
  manager: MarkdownManager,
  sourceOf: (node: PmNode) => string | undefined,
  node: PmNode,
): string {
  const line =
    sourceOf(node)?.split("\n")[0] ?? manager.serialize({ type: "doc", content: [node.toJSON()] });
  return line
    .trim()
    .replace(/^#{1,6}\s+/u, "")
    .replace(/\s+#+$/u, "")
    .trim();
}

/** Where a position stands after every change, or nothing where the block after it went. */
function mappedThrough(transactions: readonly Transaction[], position: number): number | undefined {
  let at = position;
  for (const tr of transactions) {
    const mapped = tr.mapping.mapResult(at, 1);
    if (mapped.deletedAfter) return undefined;
    at = mapped.pos;
  }
  return at;
}

/**
 * The headings before the changes and after them, and which section each
 * kept heading opens now; nothing where the changes left the headings as
 * they were.
 */
function headingsChange(
  manager: MarkdownManager,
  sourceOf: (node: PmNode) => string | undefined,
  transactions: readonly Transaction[],
  before: PmNode,
  after: PmNode,
): HeadingsChange | undefined {
  const was: string[] = [];
  const opened = new Map<number, number>();
  before.forEach((node, offset) => {
    if (opensSection(node)) {
      opened.set(offset, was.length);
      was.push(headingWords(manager, sourceOf, node));
    }
  });
  const is: string[] = [];
  const placed = new Map<number, number>();
  after.forEach((node, offset) => {
    if (opensSection(node)) {
      placed.set(offset, is.length);
      is.push(headingWords(manager, sourceOf, node));
    }
  });
  if (was.length === is.length && was.every((heading, at) => heading === is[at])) return undefined;
  const kept = new Map<number, number>();
  for (const [offset, at] of opened) {
    const now = mappedThrough(transactions, offset);
    const place = now === undefined ? undefined : placed.get(now);
    if (place !== undefined) kept.set(at, place);
  }
  return { before: was, after: is, kept };
}

/** The change naming each mention of a section whose anchor moved again; nothing where none names one. */
function retargeted(
  state: EditorState,
  change: HeadingsChange,
  mentions: DescriptionEditorMentions,
): Transaction | undefined {
  const tr = state.tr.setMeta(RETARGETED_META, true);
  state.doc.descendants((node, position) => {
    if (node.type.name !== MENTION_NODE) return;
    const named = mentions.retarget(String(node.attrs.target), change);
    if (
      named !== undefined &&
      (named.target !== node.attrs.target || named.name !== node.attrs.name)
    ) {
      tr.setNodeMarkup(position, undefined, { ...node.attrs, ...named });
    }
  });
  return tr.docChanged ? tr : undefined;
}

/** The description editor's mentions: the `@` word reported as the editor's state moves and as it takes or loses the caret, and renamed headings' mentions named again. */
export function descriptionMentions(
  manager: MarkdownManager,
  sourceOf: (node: PmNode) => string | undefined,
  mentions: DescriptionEditorMentions,
) {
  const state: MentionsState = { found: undefined, reported: undefined };
  const plugin = new Plugin({
    key: new PluginKey("description-mentions"),
    appendTransaction: (transactions, before, after) => {
      if (!transactions.some((tr) => tr.docChanged)) return undefined;
      if (transactions.some((tr) => tr.getMeta(RETARGETED_META) === true)) return undefined;
      const change = headingsChange(manager, sourceOf, transactions, before.doc, after.doc);
      return change === undefined ? undefined : retargeted(after, change, mentions);
    },
    view: () => ({ update: (view) => reported(view, state, mentions) }),
    props: {
      handleDOMEvents: {
        focus: (view) => {
          reported(view, state, mentions);
          return false;
        },
        blur: (view) => {
          reported(view, state, mentions);
          return false;
        },
      },
    },
  });
  /** The `@` word the caret ends written as the mention chosen, spaced as every chip is (`spacedChip`). */
  const choose = (editor: Editor, mention: MentionNode): void => {
    const word = state.found;
    if (word === undefined) return;
    const chip = editor.schema.node(MENTION_NODE, { name: mention.name, target: mention.target });
    const tr = editor.state.tr.replaceWith(word.from, word.to, chip);
    editor.view.dispatch(spacedChip(tr, word.from, word.from + chip.nodeSize).scrollIntoView());
    editor.view.focus();
  };
  return { plugin, choose };
}
