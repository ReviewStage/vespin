import { closeHistory, history, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import type { Fragment, Node as PmNode, Schema } from "@tiptap/pm/model";
import type { EditorState, SelectionBookmark } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep, Step, type StepMap } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { Predicate } from "effect";
import { type EditorHistory, HISTORY_STEP, type OpenedHistory } from "./contract.js";

/**
 * kept-history.ts -- an editor's undo history kept as it is taken down, and taken up by the next editor opened on the same document.
 *
 * An editor's history lives in its state, which goes with it, so a
 * description closed and opened again would have nothing to take back. As
 * the editor is taken down its history is kept with the document it ends on
 * (`historyOf`); an editor opened later takes it up only where the document
 * it opened on is that very document (`historyTakenUp`), since each step is
 * a change at a place in it, and against any other text it would change the
 * wrong words. Each editor builds a schema of its own, which a step's
 * nodes belong to, so every step is made again on the new editor's schema
 * from its JSON; and the blocks a step brings back keep the sources the
 * earlier editor knew them by, so a block undone writes back as it was
 * written.
 *
 * Note that the history's own classes are not exported, so its state is
 * read and made again through their shape in prosemirror-history 1.5
 * (`HistoryState`, `Branch`, `Item`); a state of any other shape is
 * dropped rather than taken up.
 */

/**
 * The key every history plugin keeps its state under, read off a plugin of
 * its own since the library does not export it. Note that a transaction
 * carrying a history state under it, as an undo's does, is how that state
 * is set, which is how a kept one is laid in.
 */
const HISTORY_KEY = history().spec.key;

/** One item of a history branch: the map of its change, the inverted step that takes it back where it holds one, the selection its event opens with, and the item it mirrors. */
interface HistoryItem {
  readonly map: StepMap;
  readonly step: Step | undefined;
  readonly selection: SelectionBookmark | undefined;
  readonly mirrorOffset: number | undefined;
}

/** A branch's items, as the rope sequence holding them reads and grows. */
interface HistoryItems {
  readonly slice: (from: number, to: number) => HistoryItems;
  readonly append: (items: readonly HistoryItem[]) => HistoryItems;
  readonly map: <A>(each: (item: HistoryItem) => A) => A[];
}

/** One way through the history: the changes to take back, or those to put back. */
interface HistoryBranch {
  readonly items: HistoryItems;
  readonly eventCount: number;
}

/** The history plugin's state: its two branches, and what tells a change that joins the last event from one that starts its own. */
interface HistoryState {
  readonly done: HistoryBranch;
  readonly undone: HistoryBranch;
  readonly prevRanges: readonly number[] | null;
  readonly prevTime: number;
  readonly prevComposition: number;
}

/** What a kept history holds beside what the panel reads: the document it ends on, as JSON, the history plugin's state, and the sources of the blocks it may bring back. */
interface HeldHistory {
  readonly doc: string;
  readonly state: HistoryState;
  readonly sources: ReadonlyMap<PmNode, string>;
}

/** Each kept history's steps, by the history the panel holds, so the panel never holds them itself. */
const held = new WeakMap<EditorHistory, HeldHistory>();

/** Whether a branch has the shape `HistoryBranch` reads. */
function isBranch(branch: unknown): branch is HistoryBranch {
  return (
    Predicate.hasProperty(branch, "eventCount") &&
    Predicate.hasProperty(branch, "items") &&
    Predicate.hasProperty(branch.items, "append") &&
    Predicate.isFunction(branch.items.append)
  );
}

/** Whether the history plugin's state has the shape `HistoryState` reads. */
function isHistoryState(state: unknown): state is HistoryState {
  return (
    Predicate.hasProperty(state, "done") &&
    Predicate.hasProperty(state, "undone") &&
    isBranch(state.done) &&
    isBranch(state.undone)
  );
}

/** A value of `like`'s own class made with `fields`, in the order its constructor takes them. */
function madeLike<A extends object>(like: A, fields: readonly unknown[]): A {
  // Note that each of the history's classes sets its fields from its constructor's arguments and nothing else, so this is a value of that class.
  const made: A = Reflect.construct(like.constructor, fields);

  return made;
}

/** Each block of `from` that `sources` knows, by the copy of it standing at the same place in `to`. */
function sourcesCopied(
  from: Fragment,
  to: Fragment,
  sources: ReadonlyMap<PmNode, string>,
  copied: Map<PmNode, string>,
): void {
  from.forEach((node, _offset, index) => {
    const source = sources.get(node);

    if (source !== undefined && index < to.childCount) copied.set(to.child(index), source);
  });
}

/** `step` made again on `schema`, the blocks it lays in keeping their sources in `copied`. */
function stepOn(
  schema: Schema,
  step: Step,
  sources: ReadonlyMap<PmNode, string>,
  copied: Map<PmNode, string>,
): Step {
  const made = Step.fromJSON(schema, step.toJSON());
  const laid = step instanceof ReplaceStep || step instanceof ReplaceAroundStep;
  const laysAgain = made instanceof ReplaceStep || made instanceof ReplaceAroundStep;

  if (laid && laysAgain) sourcesCopied(step.slice.content, made.slice.content, sources, copied);

  return made;
}

/** `branch` with each of its steps made again on `schema`. */
function branchOn(
  schema: Schema,
  branch: HistoryBranch,
  sources: ReadonlyMap<PmNode, string>,
  copied: Map<PmNode, string>,
): HistoryBranch {
  const items = branch.items.map((item) =>
    madeLike(item, [
      item.map,
      item.step === undefined ? undefined : stepOn(schema, item.step, sources, copied),
      item.selection,
      item.mirrorOffset,
    ]),
  );

  return madeLike(branch, [branch.items.slice(0, 0).append(items), branch.eventCount]);
}

/** The history of `state` as it stands, ending on its document, which writes as `markdown`, with the sources of the blocks it holds. */
export function historyOf(
  state: EditorState,
  markdown: string,
  sources: ReadonlyMap<PmNode, string>,
): EditorHistory {
  const kept = { markdown, undoes: undoDepth(state) > 0, redoes: redoDepth(state) > 0 };
  const plugin: unknown = HISTORY_KEY?.getState(state);

  if (isHistoryState(plugin)) {
    held.set(kept, { doc: JSON.stringify(state.doc.toJSON()), state: plugin, sources });
  }

  return kept;
}

/**
 * The kept history laid into `view`'s state where its document is the one
 * that history ends on, a new change after it starting an event of its
 * own; answers the sources of the blocks it may bring back, or none where
 * it was dropped.
 */
export function historyTakenUp(
  view: EditorView,
  opened: OpenedHistory | undefined,
): ReadonlyMap<PmNode, string> | undefined {
  const kept = opened === undefined ? undefined : held.get(opened.kept);
  const { doc, schema } = view.state;

  if (kept === undefined || HISTORY_KEY === undefined || kept.doc !== JSON.stringify(doc.toJSON()))
    return undefined;
  const copied = new Map<PmNode, string>();
  const { state } = kept;

  const historyState = madeLike(state, [
    branchOn(schema, state.done, kept.sources, copied),
    branchOn(schema, state.undone, kept.sources, copied),
    state.prevRanges,
    state.prevTime,
    state.prevComposition,
  ]);

  view.dispatch(
    view.state.tr
      .setMeta(HISTORY_KEY, { redo: false, historyState })
      .setMeta("addToHistory", false),
  );
  view.dispatch(closeHistory(view.state.tr));

  return copied;
}

/** The command of each step through the history. */
const STEP_COMMANDS = { [HISTORY_STEP.UNDO]: undo, [HISTORY_STEP.REDO]: redo } as const;

/**
 * The step the editor opens taking, ⌘Z's or ⇧⌘Z's, where one is asked.
 * Note that the caret is first put where the step leaves it, because the
 * history keeps the caret each step was taken from, and the step back the
 * other way returns it there rather than to where the editor opened.
 */
export function historyStepped(view: EditorView, opened: OpenedHistory | undefined): void {
  if (opened?.step === undefined) return;
  const command = STEP_COMMANDS[opened.step];
  command(view.state, (step) => {
    const before = step.selection.map(view.state.doc, step.mapping.invert());
    view.dispatch(view.state.tr.setSelection(before));
  });
  command(view.state, view.dispatch);
}
