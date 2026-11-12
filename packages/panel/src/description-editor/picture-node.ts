import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import { fileMarkers } from "@repo/features/file-marker";
import type { JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import {
  Fragment,
  type NodeType,
  type Node as PmNode,
  type ResolvedPos,
  Slice,
} from "@tiptap/pm/model";
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { insertPoint } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { descriptionFiles, isPdfUpload, isPictureFile } from "../picture-files.js";
import {
  type DescriptionEditorPictures,
  PICTURE_LEAVE,
  type PictureLanding,
  type PictureLeave,
  type PictureNode,
  type PictureTaken,
} from "./contract.js";
import { copiedFileOf, fileOfCopy } from "./copied-files.js";
import { inTableCell } from "./writing-keys.js";

/**
 * picture-node.ts -- a picture in the description's text: TipTap's image held inline in its own paragraph and kept as a block there, written back escaped, drawn by the panel, and laid in from a paste, a drop, or a file chosen.
 *
 * A picture stands in the description's Markdown as `![alt](address "caption")`
 * (`@repo/features/description-attachment-link`), and so does a PDF, its
 * alt its file's name, which the panel draws as the file's chip. The editor keeps it as TipTap's
 * image node, inline, in a paragraph of its own, and writes it back with
 * its alt text's brackets, its address's parentheses, and its caption's
 * quotes escaped, which TipTap's own writer does not. A picture laid in from
 * a paste, a drop, or a file chosen has no address yet: it waits on an
 * upload the panel names, writes nothing to the text meanwhile, and takes
 * its address once the panel kept it (`settled`), a change undo never takes
 * back alone, so undo and redo take the picture out and bring it back whole. A picture of another description
 * pasted in is kept again on this one, so its new readers can see it. The
 * node's element is the panel's to draw into, as a mention's is: its
 * picture, its upload, and its tools while selected. A picture alone on its
 * line is a block, as a document editor's image is: the caret never stands
 * beside it, an arrow from the line before or after selects it, Enter on it
 * opens a line below, Backspace and Delete take it out with its line, words
 * typed over it start a line below, a double-click enlarges it, and an
 * Escape from its own controls comes back to it. One laid in stands
 * selected, with no empty line kept or added around it.
 */

const PICTURE_NODE = "image";

/** What a picture laid in from a pasted screenshot is called until it is described. */
const PASTED_ALT = "Screenshot";

/** The panel's own controls inside a picture, which keep their events from the editor. */
const PICTURE_CONTROLS = "button, input, textarea";

/** The keys besides the arrows a selected picture takes. */
const PICTURE_KEYS: ReadonlySet<string> = new Set(["Enter", "Backspace", "Delete"]);

/** Which way each arrow moves past a picture, and whether it moves by lines, which only the view can tell the caret's edge for. */
const ARROWS: ReadonlyMap<string, { readonly dir: 1 | -1; readonly vertical: boolean }> = new Map([
  ["ArrowDown", { dir: 1, vertical: true }],
  ["ArrowRight", { dir: 1, vertical: false }],
  ["ArrowUp", { dir: -1, vertical: true }],
  ["ArrowLeft", { dir: -1, vertical: false }],
]);

/** Escapes the characters that would end a picture's alt text, address, or title early. */
function escaped(words: string, ends: RegExp): string {
  return words.replace(ends, "\\$&");
}

/** A picture as Markdown writes it: nothing while it waits on its upload. */
function pictureMarkdown(attrs: JSONContent["attrs"]): string {
  if (String(attrs?.upload ?? "") !== "") return "";
  const alt = escaped(String(attrs?.alt ?? ""), /[\\[\]]/gu);
  const src = escaped(String(attrs?.src ?? ""), /[\\()]/gu);
  const title = attrs?.title ? ` "${escaped(String(attrs.title), /[\\"]/gu)}"` : "";

  return `![${alt}](${src}${title})`;
}

/** The uploads the panel has kept, each with the address it was kept at, which a picture waiting on one takes whenever it stands in the text. */
const SETTLED = new PluginKey<ReadonlyMap<string, string>>("settled-pictures");

/** An upload kept, as a transaction tells `SETTLED`. */
interface Settled {
  readonly upload: string;
  readonly src: string;
}

/**
 * Every picture still waiting on an upload the panel has kept given its
 * address, kept out of the undo history. Note that this runs on every change,
 * not only the settle, because undo or redo can bring back a picture after
 * its upload settled, which the panel no longer holds and would draw failed.
 */
function picturesFilled(state: EditorState): Transaction | null {
  const settled = SETTLED.getState(state);

  if (settled === undefined || settled.size === 0) return null;
  const { tr } = state;
  state.doc.descendants((node, pos) => {
    const src = node.type.name === PICTURE_NODE ? settled.get(node.attrs.upload) : undefined;

    // Note that the attributes change in place, so a selected picture stays selected as it is kept.
    if (src !== undefined) tr.setNodeAttribute(pos, "src", src).setNodeAttribute(pos, "upload", "");
  });

  return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
}

/** What remembers the uploads kept and lays each address into its picture, wherever undo or redo brings it back. */
function settledPictures(): Plugin<ReadonlyMap<string, string>> {
  return new Plugin<ReadonlyMap<string, string>>({
    key: SETTLED,
    state: {
      init: (): ReadonlyMap<string, string> => new Map(),
      apply: (tr, was): ReadonlyMap<string, string> => {
        const settled: Settled | undefined = tr.getMeta(SETTLED);

        return settled === undefined ? was : new Map(was).set(settled.upload, settled.src);
      },
    },
    appendTransaction: (trs, _old, state) =>
      trs.some((tr) => tr.docChanged || tr.getMeta(SETTLED) !== undefined)
        ? picturesFilled(state)
        : null,
  });
}

/** Whether a line holds a picture alone, which the editor treats as a block of its own. */
function pictureLine(line: PmNode): boolean {
  return line.childCount === 1 && line.firstChild?.type.name === PICTURE_NODE;
}

/** The picture a caret stands beside at an end of its line, by its position, and whether the caret stands before it, at the line's start, or after it, at its end; none elsewhere. */
function pictureBesideCaret(selection: Selection): { at: number; before: boolean } | undefined {
  const { $head, empty } = selection;

  if (!(selection instanceof TextSelection) || !empty) return undefined;
  const { parent, parentOffset } = $head;
  const { firstChild, lastChild } = parent;

  if (parentOffset === 0 && firstChild?.type.name === PICTURE_NODE) {
    return { at: $head.pos, before: true };
  }

  if (parentOffset === parent.content.size && lastChild?.type.name === PICTURE_NODE) {
    return { at: $head.pos - lastChild.nodeSize, before: false };
  }

  return undefined;
}

/** A selection landing on a line that holds a picture alone made the picture's, as the arrows land on a picture; any other as it was. */
function landingOn(doc: PmNode, landed: Selection): Selection {
  const { $from } = landed;

  return pictureLine($from.parent) ? NodeSelection.create(doc, $from.start()) : landed;
}

/** The selection on the line past the one `$line` stands on, after it where `dir` is 1 and before it where -1, its picture where it holds one alone; none at the text's end. */
function linePast(doc: PmNode, $line: ResolvedPos, dir: 1 | -1): Selection | undefined {
  const edge = dir > 0 ? $line.after() : $line.before();
  const past = Selection.findFrom(doc.resolve(edge), dir, true);

  return past === null ? undefined : landingOn(doc, past);
}

/**
 * The caret kept off the two spots beside a picture at an end of its line,
 * whose caret boxes the browser and ProseMirror draw the picture's height on
 * a line of their own: a move onto either, by the arrows or a press, selects
 * the picture instead, as a document editor selects an image block, and a
 * move off a selected picture onto either goes on to the line past it, or
 * stays on the picture at the text's end. Note that a change to the text,
 * and a caret already standing there, are left as they are, so the editor
 * opening on a text that starts with a picture never selects it, where a
 * key typed would replace it.
 */
function pictureCaret(): Plugin {
  return new Plugin({
    appendTransaction: (trs, old, state) => {
      const beside = pictureBesideCaret(state.selection);

      if (
        beside === undefined ||
        trs.some((tr) => tr.docChanged) ||
        old.selection.eq(state.selection)
      ) {
        return null;
      }

      const picture = NodeSelection.create(state.doc, beside.at);

      if (!(old.selection instanceof NodeSelection && old.selection.from === beside.at)) {
        return state.tr.setSelection(picture);
      }

      const past = linePast(state.doc, state.selection.$head, beside.before ? -1 : 1);

      return state.tr.setSelection(past ?? picture);
    },
  });
}

/** The picture standing alone on its line that is selected; none where the selection is anything else. */
function pictureSelected(selection: Selection): NodeSelection | undefined {
  return selection instanceof NodeSelection &&
    selection.node.type.name === PICTURE_NODE &&
    pictureLine(selection.$from.parent)
    ? selection
    : undefined;
}

/** The line past the caret's onto a picture alone on its own, where the caret stands at its line's edge that way; none anywhere else. */
function arrivedOnPicture(view: EditorView, key: string): Selection | undefined {
  const arrow = ARROWS.get(key);
  const { selection } = view.state;

  if (arrow === undefined || !(selection instanceof TextSelection) || !selection.empty) {
    return undefined;
  }

  const { $head } = selection;

  const atEdge = arrow.vertical
    ? view.endOfTextblock(arrow.dir > 0 ? "down" : "up")
    : $head.parentOffset === (arrow.dir > 0 ? $head.parent.content.size : 0);

  const past = atEdge ? linePast(view.state.doc, $head, arrow.dir) : undefined;

  return past instanceof NodeSelection ? past : undefined;
}

/** The line a picture stood alone on taken out with it, the caret on the line past it, before it for Backspace and after it for Delete, or the other where none is. */
function pictureTakenOut(view: EditorView, picked: NodeSelection, dir: 1 | -1): void {
  const $line = picked.$from;
  const tr = view.state.tr.delete($line.before(), $line.after());
  const $gone = tr.doc.resolve(tr.mapping.map($line.before()));
  const near = Selection.findFrom($gone, dir, true) ?? Selection.findFrom($gone, -dir, true);

  if (near !== null) tr.setSelection(landingOn(tr.doc, near));
  view.dispatch(tr.scrollIntoView());
}

/** An empty line, or one holding `words`, laid in below a selected picture, the caret at its end. */
function lineBelow(view: EditorView, picked: NodeSelection, words: string): void {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph;

  if (paragraph === undefined) return;
  const after = picked.$from.after();
  const line = paragraph.create(null, words === "" ? null : state.schema.text(words));
  const tr = state.tr.insert(after, line);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1 + words.length)));
}

/**
 * A key on the text around its pictures, as a document editor takes one on
 * an image block: an arrow onto a picture alone on its line selects it, and
 * one on a selected picture moves to the line past it, or stays on it at the
 * text's end; Enter on it opens an empty line below it, never in its place;
 * Backspace and Delete take it out with its line. Answers whether the key
 * was the picture's.
 */
export function pictureKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
  const { state } = view;
  const picked = pictureSelected(state.selection);
  const arrow = ARROWS.get(event.key);

  if (picked === undefined) {
    const arrived = arrivedOnPicture(view, event.key);

    if (arrived !== undefined) view.dispatch(state.tr.setSelection(arrived).scrollIntoView());

    return arrived !== undefined;
  }

  if (arrow !== undefined) {
    const past = linePast(state.doc, picked.$from, arrow.dir);

    // Note that a move up off the text's first picture is not the picture's, so ↑ there leaves for the title above, as from the first line.
    if (past === undefined) return arrow.dir > 0;
    view.dispatch(state.tr.setSelection(past).scrollIntoView());
  } else if (event.key === "Enter") {
    lineBelow(view, picked, "");
  } else if (event.key === "Backspace" || event.key === "Delete") {
    pictureTakenOut(view, picked, event.key === "Backspace" ? -1 : 1);
  }

  return arrow !== undefined || PICTURE_KEYS.has(event.key);
}

/** Whether a node is a picture the drawn text draws as one, a description's own: not one from outside the app, which it draws as a link. */
export function drawnAsPicture(node: PmNode): boolean {
  return (
    node.type.name === PICTURE_NODE &&
    descriptionAttachmentOf(String(node.attrs.src ?? "")) !== undefined
  );
}

/** Words typed over a selected picture alone on its line, laid in on a new line below it rather than in its place; answers whether they were. */
export function pictureTyped(view: EditorView, words: string): boolean {
  const picked = pictureSelected(view.state.selection);

  if (picked !== undefined) lineBelow(view, picked, words);

  return picked !== undefined;
}

/** The node's picture as the panel draws it. */
function pictureOf(node: PmNode): PictureNode {
  return {
    src: String(node.attrs.src ?? ""),
    alt: String(node.attrs.alt ?? ""),
    title: String(node.attrs.title ?? ""),
    upload: String(node.attrs.upload ?? ""),
  };
}

/** A new upload's name, which ties a picture laid in to the panel's keeping of it. */
function uploadName(): string {
  return crypto.randomUUID();
}

/** What a picture laid in from a file is called: a PDF its whole name, which its chip shows; any other its name without its type, or "Screenshot" for a paste that has none worth keeping. */
function altOf(file: File): string {
  if (isPdfUpload(file) && file.name.trim() !== "") return file.name.trim();
  const stem = file.name.replace(/\.[^.]*$/u, "").trim();

  return stem === "" || stem === "image" ? PASTED_ALT : stem;
}

/** Whether an event lands on one of the panel's own controls inside a picture: a button, or a field such as its caption's. */
function onControl(event: Event): boolean {
  return event.target instanceof Element && event.target.closest(PICTURE_CONTROLS) !== null;
}

/** A message box's copied file chip, as its copy writes it: a picture's image, or another file's chip carrying it (`./copied-files.ts`). */
const COMPOSER_CHIP = '[data-chip="fileChip"]';

/** The image a message box's copied chip is read in as: its file's name its alt, its data address its source. */
const COMPOSER_PICTURE = 'img[data-chip="fileChip"]';

/**
 * A paste's markup with each of a message box's copied chips that carried a
 * picture or a PDF written as its image, its alt the file's name, so it is
 * read in as a picture; every other chip as it was, which pastes as its
 * marker's words.
 */
function composerChipsAsPictures(html: string): string {
  if (!html.includes(COMPOSER_CHIP.slice(1, -1))) return html;
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const chip of template.content.querySelectorAll(COMPOSER_CHIP)) {
    const address = chip.getAttribute(chip.tagName === "IMG" ? "src" : "data-file");
    const name = fileMarkers(chip.getAttribute("alt") ?? chip.textContent)[0]?.name;
    const file = copiedFileOf(address);
    const kind = { name: name ?? "", type: file?.mediaType ?? "" };

    if (name === undefined || file === undefined || !(isPictureFile(kind) || isPdfUpload(kind))) {
      continue;
    }

    const image = template.ownerDocument.createElement("img");
    image.dataset.chip = "fileChip";
    image.alt = name;
    image.setAttribute("src", address ?? "");
    chip.replaceWith(image);
  }

  return template.innerHTML;
}

/** The picture of a message box's copied chip, rewritten by `composerChipsAsPictures`, which TipTap's own image leaves out for its data address. */
function composerPictureRule() {
  return { tag: COMPOSER_PICTURE };
}

/**
 * The picture node: TipTap's image, inline, with the upload it waits on;
 * drawn into its own element by the panel where it can draw one, and as an
 * image element where it cannot, as in a template.
 */
export function pictureNode(pictures: DescriptionEditorPictures | undefined) {
  const node = Image.extend({
    addAttributes() {
      return { ...this.parent?.(), upload: { default: "", rendered: false } };
    },
    renderMarkdown: (held: JSONContent) => pictureMarkdown(held.attrs),
  }).configure({ inline: true });

  if (pictures === undefined) return node;

  return node.extend({
    parseHTML() {
      return [composerPictureRule(), ...(this.parent?.() ?? [])];
    },
    addProseMirrorPlugins() {
      return [
        ...(this.parent?.() ?? []),
        settledPictures(),
        pictureCaret(),
        new Plugin({ props: { transformPastedHTML: composerChipsAsPictures } }),
      ];
    },
    addNodeView() {
      return ({ node: held, getPos, editor }) => {
        const dom = document.createElement("span");
        dom.className = "editor-picture block";
        dom.contentEditable = "false";
        let current = held;
        let selected = false;

        const drawing = pictures.draw(dom, pictureOf(held), {
          describe: (change) => {
            const pos = getPos();

            if (pos === undefined) return;
            const { tr } = editor.state;

            // Note that the attributes change in place, so the picture stays selected, its tools with it, while its caption is typed.
            for (const [name, value] of Object.entries(change))
              tr.setNodeAttribute(pos, name, value);
            editor.view.dispatch(tr);
          },
          remove: () => {
            const pos = getPos();

            if (pos !== undefined) removedAt(editor.view, pos);
          },
          leave: (to) => {
            const pos = getPos();

            if (pos !== undefined) leftAt(editor.view, pos, to);
          },
        });

        // Note that an Escape from the picture's own controls that none of them took goes back to the picture, selected in the focused text, since the editor never hears their keys and the window would leave the task on it.
        const escaped = (event: KeyboardEvent) => {
          const pos = getPos();

          if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;

          if (pos === undefined) return;
          event.preventDefault();
          const { view } = editor;
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
          view.focus();
        };

        // Note that a double-click in the picture's own controls, its caption's words among them, is theirs and enlarges nothing.
        const enlarged = (event: MouseEvent) => {
          if (!onControl(event)) drawing.enlarge();
        };

        dom.addEventListener("keydown", escaped);
        dom.addEventListener("dblclick", enlarged);

        return {
          dom,
          update: (next) => {
            if (next.type !== current.type) return false;
            current = next;
            drawing.redraw(pictureOf(next), selected);

            return true;
          },
          selectNode: () => {
            selected = true;
            drawing.redraw(pictureOf(current), true);
          },
          deselectNode: () => {
            selected = false;
            drawing.redraw(pictureOf(current), false);
          },
          // Note that the panel's own controls inside the picture, its alt text's field among them, keep their events from the editor.
          stopEvent: (event) => onControl(event),
          ignoreMutation: () => true,
          destroy: () => {
            dom.removeEventListener("keydown", escaped);
            dom.removeEventListener("dblclick", enlarged);
            drawing.undraw();
          },
        };
      };
    },
  });
}

/** The picture at `pos` taken out, with the paragraph it stood alone in. */
function removedAt(view: EditorView, pos: number): void {
  const $pos = view.state.doc.resolve(pos);
  const alone = $pos.parent.type.name === "paragraph" && $pos.parent.childCount === 1;
  const from = alone ? $pos.before() : pos;
  const to = alone ? $pos.after() : pos + ($pos.nodeAfter?.nodeSize ?? 1);
  view.dispatch(view.state.tr.delete(from, to));
}

/**
 * The caret handed back to the text from the caption of the picture at
 * `pos`: the picture selected; the start of the first line after its own,
 * an empty line laid in after it where no line follows; or a new empty line
 * laid in just after it, as a document editor leaves an image's caption by
 * its arrows and by Return.
 */
function leftAt(view: EditorView, pos: number, to: PictureLeave): void {
  const { state } = view;

  if (to === PICTURE_LEAVE.UP) {
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
    view.focus();

    return;
  }

  const after = state.doc.resolve(pos).after();
  const { tr } = state;

  const next =
    to === PICTURE_LEAVE.NEW_LINE ? null : Selection.findFrom(state.doc.resolve(after), 1, true);

  const paragraph = state.schema.nodes.paragraph;

  if (next !== null) tr.setSelection(next);
  else if (paragraph !== undefined) {
    tr.insert(after, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }

  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** The nodes a list's items are, whose depth a picture dropped below one of their lines lands at. */
export const LIST_ITEMS: ReadonlySet<string> = new Set(["listItem", "taskItem"]);

/** The depths of the list items `$at` stands in, outermost first. */
function itemDepths($at: ResolvedPos): number[] {
  const depths: number[] = [];

  for (let depth = 1; depth <= $at.depth; depth += 1) {
    if (LIST_ITEMS.has($at.node(depth).type.name)) depths.push(depth);
  }

  return depths;
}

/**
 * Where pictures laid in at `pos` stand, as the stretch they take the place
 * of: the empty line `pos` stands on, else just below the line it stands on,
 * which they never split, inside a list item where the line is one's, else
 * after the top-level block `pos` stands in, as from a table's cell, whose
 * Markdown holds no block. A drop's `landing` puts them before the text's
 * first block, or at a shallower list depth than the line's: after the
 * outermost list at `0`, else at the end of the item that many in.
 */
function pictureRoom(doc: PmNode, pos: number, paragraph: NodeType, landing?: PictureLanding) {
  if (landing !== undefined && "first" in landing) return { from: 0, to: 0 };
  const $at = doc.resolve(pos);
  const top = $at.depth === 0 ? pos : $at.after(1);

  if (inTableCell($at)) return { from: top, to: top };
  const items = itemDepths($at);
  const outer = landing === undefined ? undefined : items[landing.depth - 1];

  if (landing !== undefined && landing.depth < items.length) {
    const at = outer === undefined ? $at.after((items[0] ?? 1) - 1) : $at.end(outer);

    return { from: at, to: at };
  }

  const { parent } = $at;

  if (parent.type === paragraph && parent.content.size === 0) {
    return { from: $at.before(), to: $at.after() };
  }

  const below = insertPoint(doc, parent.isTextblock ? $at.after() : pos, paragraph) ?? top;

  return { from: below, to: below };
}

/**
 * Pictures laid in, each in a paragraph of its own, where `pos` stands, or
 * where the caret does where none is given, as a drop's `landing` says; each waits on a new upload,
 * which is handed to the panel with its file. Note that the upload finds
 * its picture by name when it settles, so words typed meanwhile never move it.
 */
export function laidInPictures(
  view: EditorView,
  files: readonly File[],
  pictures: DescriptionEditorPictures,
  pos?: number,
  landing?: PictureLanding,
): void {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph;

  if (files.length === 0 || paragraph === undefined) return;
  const taken: PictureTaken[] = [];

  const paragraphs = files.map((file) => {
    const upload = uploadName();
    taken.push({ upload, file });
    const picture = state.schema.node(PICTURE_NODE, { src: "", alt: altOf(file), upload });

    return paragraph.create(null, [picture]);
  });

  const { from, to } = pictureRoom(state.doc, pos ?? state.selection.from, paragraph, landing);
  const tr = state.tr.replaceWith(from, to, paragraphs);
  // The last picture laid in stands selected, so no caret stands on a line beside it.
  const last = paragraphs.slice(0, -1).reduce((at, each) => at + each.nodeSize, from + 1);

  if (tr.doc.nodeAt(last)?.type.name === PICTURE_NODE) {
    tr.setSelection(NodeSelection.create(tr.doc, last));
  }

  view.dispatch(tr.scrollIntoView());
  pictures.take(taken);
}

/** The position of the picture waiting on `upload`; none where the text no longer holds it. */
function waitingAt(view: EditorView, upload: string): number | undefined {
  let found: number | undefined;
  view.state.doc.descendants((node, pos) => {
    if (found === undefined && node.type.name === PICTURE_NODE && node.attrs.upload === upload) {
      found = pos;
    }
  });

  return found;
}

/** The picture waiting on `upload` given its address, which the text now writes, and any that undo or redo brings back later; nothing where it was taken out meanwhile. */
export function settledPicture(view: EditorView, upload: string, src: string): void {
  const settled: Settled = { upload, src };
  view.dispatch(view.state.tr.setMeta(SETTLED, settled).setMeta("addToHistory", false));
}

/** The picture waiting on `upload` taken out of the text. */
export function removedPicture(view: EditorView, upload: string): void {
  const pos = waitingAt(view, upload);

  if (pos !== undefined) removedAt(view, pos);
}

/** A paste of image files or PDFs laid in as pictures at the caret's line; answers whether it was one. */
export function pastedPictures(
  view: EditorView,
  event: ClipboardEvent,
  pictures: DescriptionEditorPictures,
): boolean {
  const files = descriptionFiles(event.clipboardData?.files);

  if (files.length === 0) return false;
  laidInPictures(view, files, pictures);

  return true;
}

/** A drop of image files or PDFs from outside the editor laid in as pictures at the line they landed on; answers whether it was one. */
export function droppedPictures(
  view: EditorView,
  event: DragEvent,
  moved: boolean,
  pictures: DescriptionEditorPictures,
): boolean {
  const files = descriptionFiles(event.dataTransfer?.files);

  if (moved || files.length === 0) return false;
  const landed = view.posAtCoords({ left: event.clientX, top: event.clientY });
  laidInPictures(view, files, pictures, landed?.pos);

  return true;
}

/** A fragment with each picture in it made again by `change`, at any depth, every other node as it was. */
function withPictures(fragment: Fragment, change: (picture: PmNode) => PmNode): Fragment {
  const nodes: PmNode[] = [];
  fragment.forEach((child) => {
    if (child.type.name === PICTURE_NODE) nodes.push(change(child));
    else nodes.push(child.isLeaf ? child : child.copy(withPictures(child.content, change)));
  });

  return Fragment.fromArray(nodes);
}

/**
 * A pasted slice's pictures of another description, and those a message box's
 * copied chips carried in, each made to wait on a new upload that keeps it on
 * this description, and handed to the panel to keep; every other picture as it was.
 */
export function copiedPictures(slice: Slice, pictures: DescriptionEditorPictures): Slice {
  const taken: PictureTaken[] = [];

  const content = withPictures(slice.content, (picture) => {
    const src = String(picture.attrs.src ?? "");
    const carried = copiedFileOf(src);

    if (carried === undefined && !pictures.copies(src)) return picture;
    const upload = uploadName();

    taken.push(
      carried === undefined
        ? { upload, from: src }
        : { upload, file: fileOfCopy(carried, String(picture.attrs.alt ?? "")) },
    );

    return picture.type.create({ ...picture.attrs, src: "", upload }, null, picture.marks);
  });

  if (taken.length === 0) return slice;
  pictures.take(taken);

  return new Slice(content, slice.openStart, slice.openEnd);
}
