import { MENTION_SIGIL, mentionMarkdownLink } from "@repo/features/link-grammar";
import { mentionLinksIn, mentionName } from "@repo/features/mention-link";
import { keySpansIn } from "@repo/features/workspace-key";
import { type Editor, type JSONContent, Node } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { chipOverSelection } from "./chip-spacing.js";
import type { ChipsRead, MentionDrawer, MentionNode, MentionNodeDoors } from "./contract.js";

/**
 * mention-node.ts -- a mention in the editors' words: an atom holding the name it was written with and its link's target, drawn by the panel, written back as the link it was read from.
 *
 * A mention is written into markdown as a link whose label starts with `@`
 * (`@repo/features/mention-link`, which only the panel reads). The editor
 * holds it as one node, an atom one Backspace takes out whole, its name and
 * target in the node and never in the DOM's attributes, since the recording
 * masks words and not every attribute: the chip inside the node's element
 * is the panel's (`drawMention`), handed the doors that name the node anew
 * or take it out (a date's picker). Read from markdown, a link whose words
 * start with `@` becomes the node, its formatting, if its label had any,
 * left behind; written back, it is the link again, `[@name](target)`,
 * written and read as every link is (`@repo/features/link-grammar`).
 * A link written as plain words that the read view draws as a chip all the
 * same (a file's, a pull request's, a bare address) is the node too, where
 * the panel says which targets it chips (`namesChip`), so its chip stands
 * open as it stood drawn; it holds its words, formatting and all, and is
 * written back as the link it was. So is a listed task's key written among
 * plain words (`ACME-42`), which the read view draws as its task's chip
 * (`keyTargets`): its chip stands open as it stood drawn, saying the key,
 * and it is written back as the bare key it was. Nothing here knows what a
 * target names.
 */

export const MENTION_NODE = "mention";

/** The link mark's name, as StarterKit spells it. */
const LINK_MARK = "link";

/** A code block's name, as StarterKit spells it, whose words hold no key. */
const CODE_BLOCK = "codeBlock";

/** An address GitHub's dialect links written bare. */
const WEB_ADDRESS = /^https?:\/\/\S+$/u;

/** A mention as markdown writes it. */
export function mentionLink(mention: MentionNode): string {
  return mentionMarkdownLink(mention.name, mention.target);
}

/**
 * The doors to the mention node `getPos` finds, each acting only while the
 * editor takes changes. Note that a rename sets the node's attributes in
 * place, so undo takes back the one change, and the text written from the
 * node is the new link.
 */
function nodeDoors(editor: Editor, getPos: () => number | undefined): MentionNodeDoors {
  const at = () => (editor.isEditable ? getPos() : undefined);

  const after = (pos: number, tr: Transaction) =>
    tr.setSelection(TextSelection.create(tr.doc, pos + (tr.doc.nodeAt(pos)?.nodeSize ?? 1)));

  return {
    rename: (mention, focus) => {
      const pos = at();

      if (pos === undefined) return;

      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        name: mention.name,
        target: mention.target,
      });

      editor.view.dispatch(focus ? after(pos, tr) : tr);

      if (focus) editor.view.focus();
    },
    remove: () => {
      const pos = at();

      if (pos === undefined) return;
      const tr = editor.state.tr.delete(pos, pos + (editor.state.doc.nodeAt(pos)?.nodeSize ?? 1));
      editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos)));
      editor.view.focus();
    },
    focusAfter: () => {
      const pos = at();

      if (pos === undefined) return;
      editor.view.dispatch(after(pos, editor.state.tr));
      editor.view.focus();
    },
  };
}

/** What the node holds, as its attributes come from the document. */
interface MentionAttrs {
  readonly name?: unknown;
  readonly target?: unknown;
  readonly words?: unknown;
  readonly unlinked?: unknown;
}

/** The words a link written as plain words holds, each a run of its label as read; none for a mention written `[@name](target)`. */
function wordsOf(attrs: MentionAttrs | undefined): readonly JSONContent[] | undefined {
  const words = attrs?.words;

  return Array.isArray(words) ? words : undefined;
}

/** A node's mention as the panel draws it: its link's own words where it holds them. */
function mentionOf(attrs: MentionAttrs): MentionNode {
  const words = wordsOf(attrs);
  const mention = { name: String(attrs.name), target: String(attrs.target) };

  return words === undefined ? mention : { ...mention, label: plainOf(words) };
}

/** What a mention reads as in words: its link's own words, or `@name`. */
function writtenOf(mention: MentionNode): string {
  return mention.label ?? `${MENTION_SIGIL}${mention.name}`;
}

function plainOf(words: readonly JSONContent[]): string {
  return words.map((word) => word.text ?? "").join("");
}

/** The mention node: an atom drawn into its own element by the panel where it can draw one, and as its words where it cannot. */
export function mentionNode(drawMention: MentionDrawer | undefined) {
  const node = Node.create({
    name: MENTION_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    addAttributes() {
      return {
        name: { default: "", rendered: false },
        target: { default: "", rendered: false },
        words: { default: null, rendered: false },
        unlinked: { default: false, rendered: false },
      };
    },
    renderHTML({ node: held }) {
      return ["span", { "data-chip": MENTION_NODE }, writtenOf(mentionOf(held.attrs))];
    },
    renderText({ node: held }) {
      const words = wordsOf(held.attrs);

      if (held.attrs.unlinked === true && words !== undefined) return plainOf(words);

      return mentionLink({ name: String(held.attrs.name), target: String(held.attrs.target) });
    },
    renderMarkdown: (held: JSONContent, helpers) => {
      const words = wordsOf(held.attrs);
      const target = String(held.attrs?.target ?? "");

      // Note that a task's key read from plain words is written as those words again, as it was.
      if (held.attrs?.unlinked === true && words !== undefined) return plainOf(words);

      if (words === undefined) return mentionLink({ name: String(held.attrs?.name ?? ""), target });

      // Note that a web address written bare is written bare again, as GitHub's dialect links one; any other is no autolink.
      if (
        words.length === 1 &&
        words[0]?.marks === undefined &&
        words[0]?.text === target &&
        WEB_ADDRESS.test(target)
      ) {
        return target;
      }

      // Note that the words are written under their link again, as TipTap writes every link.
      return helpers.renderChildren(
        words.map((word) => ({
          ...word,
          marks: [...(word.marks ?? []), { type: LINK_MARK, attrs: { href: target } }],
        })),
      );
    },
  });

  if (drawMention === undefined) return node;

  return node.extend({
    addNodeView() {
      return ({ node: held, editor, getPos }) => {
        const dom = document.createElement("span");
        dom.contentEditable = "false";
        dom.dataset.chip = MENTION_NODE;

        const undraw = drawMention(dom, mentionOf(held.attrs), nodeDoors(editor, getPos));

        return { dom, ignoreMutation: () => true, destroy: undraw };
      };
    },
  });
}

function linkOf(node: JSONContent): string | undefined {
  if (node.type !== "text") return undefined;
  const href: unknown = node.marks?.find((mark) => mark.type === LINK_MARK)?.attrs?.href;

  return href === undefined || href === null ? undefined : String(href);
}

/** A run of plain words with each listed task's key in it made its task's mention, the words between left as they were; words with any formatting stand. */
function keyedWords(node: JSONContent, keyTargets: ReadonlyMap<string, string>): JSONContent[] {
  const text = node.text ?? "";

  const spans =
    node.type === "text" && (node.marks ?? []).length === 0 ? keySpansIn(text, keyTargets) : [];

  if (spans.length === 0) return [node];

  const read: JSONContent[] = [];
  let from = 0;

  for (const span of spans) {
    if (span.start > from) read.push({ type: "text", text: text.slice(from, span.start) });
    read.push({
      type: MENTION_NODE,
      attrs: {
        name: span.key,
        target: span.known,
        words: [{ type: "text", text: span.key }],
        unlinked: true,
      },
    });
    from = span.end;
  }

  if (from < text.length) read.push({ type: "text", text: text.slice(from) });

  return read;
}

/** One inline run as read: a run of text under one link whose words start with `@` becomes a mention, as does one whose target `namesChip` chips, and a listed task's key among plain words, and anything else stands. */
function mentionsOfRun(
  content: readonly JSONContent[],
  chips: ChipsRead | undefined,
): JSONContent[] {
  const read: JSONContent[] = [];

  for (let at = 0; at < content.length; at += 1) {
    const node = content[at];

    if (node === undefined) continue;
    const href = linkOf(node);

    if (href === undefined) {
      const block = withMentions(node, chips);
      read.push(...(chips === undefined ? [block] : keyedWords(block, chips.keyTargets)));
      continue;
    }

    // Note that a label with formatting in it is read as several runs under the one link.
    let end = at;

    while (end + 1 < content.length && linkOf(content[end + 1] ?? {}) === href) end += 1;

    const run = content.slice(at, end + 1);
    const words = plainOf(run);

    if (words.startsWith(MENTION_SIGIL) && words.length > MENTION_SIGIL.length) {
      read.push({
        type: MENTION_NODE,
        attrs: { name: words.slice(MENTION_SIGIL.length), target: href },
      });
    } else if (
      chips?.namesChip(href) === true &&
      run.every((each) => each.type === "text" && !titled(each))
    ) {
      read.push({
        type: MENTION_NODE,
        attrs: { name: words, target: href, words: run.map(withoutLink) },
      });
    } else {
      read.push(...run);
    }

    at = end;
  }

  return read;
}

/** Whether a run's link carries a title, which a chip has no place to keep, so it stays the link. */
function titled(word: JSONContent): boolean {
  const title: unknown = word.marks?.find((mark) => mark.type === LINK_MARK)?.attrs?.title;

  return title !== undefined && title !== null && title !== "";
}

function withoutLink(word: JSONContent): JSONContent {
  const marks = (word.marks ?? []).filter((mark) => mark.type !== LINK_MARK);

  const { marks: _marks, ...bare } = word;

  return marks.length === 0 ? bare : { ...bare, marks };
}

/** A block read from markdown with each link whose words start with `@`, or whose target `chips` chips, and each listed task's key among its plain words, made the mention node; a code block's words stand. */
export function withMentions(node: JSONContent, chips?: ChipsRead | undefined): JSONContent {
  if (node.content === undefined || node.type === CODE_BLOCK) return node;

  return { ...node, content: mentionsOfRun(node.content, chips) };
}

/** A mention written in plain words: where its link stands, and what it holds. */
export interface MentionToken {
  readonly start: number;
  readonly end: number;
  readonly mention: MentionNode;
}

/** Every mention written in plain words, in order, outside code, as the composer reads a message laid in whole: a restored draft or a paste. */
export function mentionTokens(text: string): readonly MentionToken[] {
  return mentionLinksIn(text).map(({ start, end, label, target }) => ({
    start,
    end,
    mention: { name: mentionName(label), target },
  }));
}

/**
 * A paste whose words the panel reads as one link it draws as a chip
 * (`@repo/features/mention-link`'s `linkChipOf`), laid in as that chip's node where the caret
 * stands, outside code, spaced as every chip is (`chipOverSelection`);
 * answers whether it was, so any other paste goes on as words.
 */
export function pastedMention(
  view: EditorView,
  event: ClipboardEvent,
  pasted: (words: string) => MentionNode | undefined,
): boolean {
  const mention = pasted(event.clipboardData?.getData("text/plain") ?? "");
  const { $from } = view.state.selection;

  if (mention === undefined || $from.parent.type.spec.code === true) return false;

  if ($from.marks().some((mark) => mark.type.spec.code === true)) return false;
  const { schema } = view.state;
  const node = schema.node(MENTION_NODE, { name: mention.name, target: mention.target });
  view.dispatch(chipOverSelection(view.state, node).scrollIntoView());

  return true;
}
