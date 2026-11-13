/**
 * markdown-tasks.tsx -- a note's task items a reader can tick, and any words' a reader cannot: each item's checkbox named by its item's words and placed by its marker's offset, drawn as the shared `Checkbox` in the bullet's gutter.
 */

import { isWireString } from "@repo/wire";
import type { Element, ElementContent, Root } from "hast";
import { Fragment } from "react";
import type { Components } from "streamdown";
import { Checkbox } from "../components/checkbox/checkbox.js";
import { MARKDOWN_CLASS } from "./markdown-class.js";

/** The class the box a reader can tick stands in, in the bullet's gutter (`prose.css`), the description's editor's box alike. */
const TASK_BOX_CLASS = MARKDOWN_CLASS.TASK_BOX;

/** A task item's checkbox as drawn: the offset its item starts at in the words, where they say it, its place among the words' boxes, and the item's own words, which name it. */
interface TaskItem {
  readonly at: number | undefined;
  readonly index: number;
  readonly label: string;
}

/**
 * A task item's tick as its caller's mutation stands (`useMutation`): how
 * the box asks for a state, and the state it was pressed to while that ask is
 * out or once it saved, none once refused or never asked. Note that it names
 * the state the box was pressed to rather than a flip, so a press waiting
 * behind one that failed still asks for what the reader saw.
 */
export interface TaskWrite {
  readonly run: (ticked: boolean) => void;
  readonly asked: boolean | undefined;
}

/** A task item a reader can tick, as its box is drawn: the offset its marker starts at in the words, its words, which name it, and whether the words tick it. */
export interface TaskBoxItem {
  readonly at: number;
  readonly label: string;
  readonly checked: boolean;
}

/** A task item a reader can tick by its place among the words' boxes, the first 0, as words drawn from HTML are, whose items say no offset: its words, which name it, and whether the words tick it. */
export interface TaskBoxOrdinal {
  readonly index: number;
  readonly label: string;
  readonly checked: boolean;
}

/** Draws the box of a task item a reader can tick by its place among the words' boxes (`TaskBoxOrdinal`). */
export type MarkdownTaskTick = (item: TaskBoxOrdinal) => React.ReactNode;

/**
 * Draws a task item's box a reader can tick: the place's own component,
 * which holds the item's tick and draws `TaskBox` from it. Note that the
 * box is drawn afresh whenever the words' own state changes, so a change
 * arriving from anyone redraws it from them.
 */
export type MarkdownTaskBox = (item: TaskBoxItem) => React.ReactNode;

/** Each task item's checkbox, by the tree's own node. */
const TASK_ITEMS = new WeakMap<Element, TaskItem>();

/** A list item's own words, a picture's alt text among them, without the words of a list nested in it. */
function itemWords(node: ElementContent): string {
  if (node.type === "text") return node.value;

  if (node.type !== "element" || node.tagName === "ul" || node.tagName === "ol") return "";

  if (node.tagName === "img") return isWireString(node.properties.alt) ? node.properties.alt : "";

  return node.children.map(itemWords).join("");
}

/**
 * Gives each task item's checkbox the offset its list item starts at in the
 * words, its marker's, which the tree keeps on the item and not on the box,
 * and the item's words as its name. Note that the nearest item is the box's
 * own, so a nested list's box names its own item rather than the one around it,
 * and that a box from HTML has no offset, so it is named but never ticked.
 */
function placeTasks(
  parent: Root | Element,
  item: Element | undefined,
  counted: { boxes: number },
): void {
  for (const child of parent.children) {
    if (child.type !== "element") continue;
    const own = child.tagName === "li" ? child : item;
    const at = own?.position?.start.offset;

    if (child.tagName === "input" && child.properties.type === "checkbox" && own) {
      const label = own.children.map(itemWords).join("").trim();
      TASK_ITEMS.set(child, { at, index: counted.boxes, label });
      counted.boxes += 1;
    }

    placeTasks(child, own, counted);
  }
}

/** The rehype step that names each task item's checkbox by its item's offset and its place among the words' boxes. */
export const placeTaskItems = () => (tree: Root) => placeTasks(tree, undefined, { boxes: 0 });

/**
 * A task item's checkbox that ticks or clears its item through `write`. It
 * stands at the state pressed while its tick is out and once it saved, since
 * the words come back changed only after, and at the words' own state where
 * it was refused.
 */
export function TaskBox({
  label,
  checked,
  write,
}: {
  label: string;
  checked: boolean;
  write: TaskWrite;
}): React.JSX.Element {
  // Note that the box stands in the bullet's gutter (`prose.css`), and
  // takes a finger's press around it there, as the editor's does.
  return (
    <span className={TASK_BOX_CLASS}>
      <Checkbox label={label} checked={write.asked ?? checked} onChange={write.run} />
    </span>
  );
}

/**
 * How a note draws a task item's checkbox where its reader cannot tick it: the
 * shared `Checkbox`, read-only, named by its item's words, in the gutter a box
 * the reader can tick stands in. Note that a read-only box keeps its words' own
 * ink, where the browser's disabled box fades its tick past reading.
 */
function readTaskBox({
  node,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  node?: Element | undefined;
}): React.JSX.Element {
  const item = node === undefined ? undefined : TASK_ITEMS.get(node);

  if (props.type !== "checkbox") return <input {...props} />;

  return (
    <span className={TASK_BOX_CLASS}>
      <Checkbox
        label={item?.label ?? "Task"}
        checked={props.checked === true}
        readOnly
        onChange={() => undefined}
      />
    </span>
  );
}

export const readTaskInput: NonNullable<Components["input"]> = readTaskBox;

/** How a note draws a task item's checkbox where its reader can tick it, as `drawBox` draws it. */
export function taskInput(drawBox: MarkdownTaskBox): NonNullable<Components["input"]> {
  return ({ node, ...props }) => {
    const item = node === undefined ? undefined : TASK_ITEMS.get(node);
    const at = item?.at;

    return item === undefined || at === undefined ? (
      <Checkbox label="Task" checked={props.checked === true} disabled onChange={() => undefined} />
    ) : (
      <Fragment key={String(props.checked === true)}>
        {drawBox({ at, label: item.label, checked: props.checked === true })}
      </Fragment>
    );
  };
}

/**
 * How words drawn from HTML draw a task item's checkbox where their reader
 * can tick it, as `drawBox` draws it, by its place among the words' boxes.
 * Note that the box is drawn afresh whenever the words' own state changes,
 * as a note's is.
 */
export function orderedTaskInput(drawBox: MarkdownTaskTick): NonNullable<Components["input"]> {
  return ({ node, ...props }) => {
    const item = node === undefined ? undefined : TASK_ITEMS.get(node);
    const checked = props.checked === true;

    if (props.type !== "checkbox" || item === undefined) return readTaskBox({ node, ...props });

    return (
      <Fragment key={String(checked)}>
        {drawBox({ index: item.index, label: item.label, checked })}
      </Fragment>
    );
  };
}
