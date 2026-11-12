// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type {
  DescriptionEditorHandle,
  DescriptionEditorPictures,
  DescriptionEditorPlacement,
  PictureTaken,
} from "./contract.js";
import { mountDescriptionEditor } from "./description-editor.js";

/**
 * A description's pictures in its editor: a file pasted, chosen, or dropped on the drawn text is laid in as a
 * picture below the caret's line, or in place of an empty one, handed to the panel under its upload,
 * and writes nothing until the panel kept it, then its line; Remove takes
 * one still being kept out; a picture of another description pasted in is kept
 * again on this one; and a picture alone on its line is a block the caret
 * never stands beside: laid in selected, left by the arrows for the line past
 * it, given a line below by Enter, selected by a press on it, and taken back
 * to by an Escape from its own controls. Synthetic description and pictures.
 */

const TASK_ID = "5d8e2a61-7c3b-4f0e-9b1a-2c6d4e8f0a13";
const OTHER_TASK_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const KEPT = `https://vespin.dev/acme/plan/${TASK_ID}/files/0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01`;
const OTHERS = `https://vespin.dev/acme/plan/${OTHER_TASK_ID}/files/3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02`;

const TEXT = "## Approach\n\nThe invite email follows the mock.\n\n## Decisions\n\nSingle use.\n";

const handles: DescriptionEditorHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The editor on `TEXT`, its caret at the end of the Approach section unless `placement` says, with the panel's pictures stood in for. */
function opened(markdown = TEXT, placement: DescriptionEditorPlacement = { section: 0 }) {
  const taken: PictureTaken[] = [];
  // The pictures drawn now, each by the upload it waits on, "" once kept.
  const drawn = new Map<number, string>();
  // Whether each picture drawn now is selected.
  const selected = new Map<number, boolean>();
  const onFinish = vi.fn();

  const pictures: DescriptionEditorPictures = {
    draw: (element, picture) => {
      const key = drawn.size + taken.length + Math.random();
      drawn.set(key, picture.upload);
      selected.set(key, false);
      // One of the panel's own controls on the picture, as its tools are.
      element.appendChild(document.createElement("button")).textContent = "Alt text";

      return {
        redraw: (next, isSelected) => {
          drawn.set(key, next.upload);
          selected.set(key, isSelected);
        },
        enlarge: () => undefined,
        undraw: () => {
          drawn.delete(key);
          selected.delete(key);
        },
      };
    },
    take: (each) => taken.push(...each),
    copies: (src) => src.includes(OTHER_TASK_ID),
  };

  const host = document.body.appendChild(document.createElement("div"));

  const handle = mountDescriptionEditor(host, {
    markdown,
    placement,
    focus: false,
    label: "Description",
    className: "markdown description-unit",
    onDraft: () => undefined,
    onFinish,
    onLeaveUp: () => undefined,
    pictures,
  });

  handles.push(handle);

  return { handle, taken, host, drawn, selected, onFinish };
}

/** A key pressed in the editor, answering whether something took it. */
function press(host: HTMLElement, key: string, on?: Element): boolean {
  const target = on ?? host.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);

  return event.defaultPrevented;
}

/** Words pasted at the caret, as typing them lays them in. */
function pasteWords(host: HTMLElement, words: string): void {
  const editable = host.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: {
      files: [],
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? words : ""),
    },
  });
  editable.dispatchEvent(paste);
}

/** The editor with a picture laid in at the end of the Approach section and kept. */
function withPicture() {
  const held = opened();
  held.handle.insertPictures([PNG()]);
  held.handle.settlePicture(held.taken[0]?.upload ?? "", KEPT);

  return held;
}

/** ⌘Z, or ⇧⌘Z with `redo`, pressed in the editor, as Ctrl outside a Mac. */
function pressUndo(host: HTMLElement, redo = false): void {
  const editable = host.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const key = { key: "z", ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true };
  editable.dispatchEvent(new KeyboardEvent("keydown", key));
}

const PNG = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "members.png", { type: "image/png" });

test("a picture laid in writes nothing while it is kept, then its line under the caret's section, named for its file", () => {
  const { handle, taken } = opened();

  handle.insertPictures([PNG()]);
  const meanwhile = handle.markdown();
  const [laid] = taken;
  assert.ok(laid !== undefined && "file" in laid);
  handle.settlePicture(laid.upload, KEPT);

  assert.equal(meanwhile, TEXT);
  assert.equal(
    handle.markdown(),
    TEXT.replace("follows the mock.\n", `follows the mock.\n\n![members](${KEPT})\n`),
  );
});

test("pictures dropped on the drawn text are laid in below the line they landed on as the editor opens there", () => {
  const landed = {
    section: 0,
    text: "The invite email follows the mock.",
    occurrence: 0,
    offset: 4,
    code: false,
    top: 0,
  };

  const { handle, taken } = opened(TEXT, { x: 0, y: 0, words: landed, pictures: [PNG()] });
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(taken.length, 1);
  assert.equal(
    handle.markdown(),
    TEXT.replace("follows the mock.\n", `follows the mock.\n\n![members](${KEPT})\n`),
  );
});

test("Remove takes a picture still being kept out of the text, leaving it as it was", () => {
  const { handle, taken } = opened();
  handle.insertPictures([PNG()]);

  handle.removePicture(taken[0]?.upload ?? "");
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(handle.markdown(), TEXT);
});

test("image files pasted are laid in as pictures, and a pasted screenshot is called one", () => {
  const { handle, taken, host } = opened();
  const editable = host.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const screenshot = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [screenshot], types: ["Files"], getData: () => "" },
  });

  editable.dispatchEvent(paste);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(taken.length, 1);
  assert.ok(handle.markdown().includes(`![Screenshot](${KEPT})`));
});

test("an image pasted mid-line in a list's first item stands below that line, in that item, not after the list", () => {
  const beats =
    "## Beats\n\n1. Open on the inbox.\n2. Show the agent at work.\n3. End on the logo.\n";

  const caret = { section: 0, text: "Open on the inbox.", occurrence: 0, offset: 4, code: false };
  const { handle, taken, host } = opened(beats, { x: 0, y: 0, words: { ...caret, top: 0 } });
  const editable = host.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [PNG()], types: ["Files"], getData: () => "" },
  });

  editable.dispatchEvent(paste);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  const written = handle.markdown();
  const line = written.indexOf("1. Open on the inbox.");
  const picture = written.indexOf(`![members](${KEPT})`);
  assert.ok(line !== -1 && line < picture);
  assert.ok(picture < written.indexOf("Show the agent at work."));
});

test("an image pasted on an empty line takes its place", () => {
  const { handle, taken } = opened("## Beats\n\n&nbsp;\n\n## Next\n\nShip.\n");

  handle.insertPictures([PNG()]);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(handle.markdown(), `## Beats\n\n![members](${KEPT})\n\n## Next\n\nShip.\n`);
});

test("a merged answer that changes the list a picture is still being kept in leaves the picture standing", () => {
  const sent = "## Beats\n\n1. Open on the inbox.\n2. End on the logo.\n\n## Next\n\nShip.\n";
  const caret = { section: 0, text: "End on the logo.", occurrence: 0, offset: 16, code: false };
  const { handle, taken } = opened(sent, { x: 0, y: 0, words: { ...caret, top: 0 } });
  handle.insertPictures([PNG()]);

  handle.take(sent, sent.replace("logo.\n", "logo.\n3. Fade out.\n"));
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.ok(handle.markdown().includes(`![members](${KEPT})`));
});

test("a picture of another description pasted in is kept again on this one, and one of this description's is pasted as it is", () => {
  const { handle, taken, host } = opened();
  const editable = host.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  const html = `<p><img src="${OTHERS}" alt="Old mock"></p><p><img src="${KEPT}" alt="The mock"></p>`;
  Object.defineProperty(paste, "clipboardData", {
    value: {
      files: [],
      types: ["text/html"],
      getData: (type: string) => (type === "text/html" ? html : ""),
    },
  });

  editable.dispatchEvent(paste);

  assert.deepEqual(
    taken.map((each) => ("from" in each ? each.from : undefined)),
    [OTHERS],
  );
  assert.ok(handle.markdown().includes(`![The mock](${KEPT})`));
  assert.equal(handle.markdown().includes(OTHER_TASK_ID), false);
});

test("a picture laid in after the text's last block stands apart from it by a blank line", () => {
  const { handle, taken } = opened("## Approach\n\nThe invite email follows the mock.\n");

  handle.insertPictures([PNG()]);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(
    handle.markdown(),
    `## Approach\n\nThe invite email follows the mock.\n\n![members](${KEPT})\n`,
  );
});

test("undo takes a dropped picture kept since out whole, and redo brings it back kept, never waiting on an upload already settled", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const landed = { section: 1, text: "Single use.", occurrence: 0, offset: 4, code: false, top: 0 };

  const { handle, taken, host, drawn } = opened(TEXT, {
    x: 0,
    y: 0,
    words: landed,
    pictures: [PNG()],
  });

  // Note that the upload settles well after the drop, as a real one does, past the pause that groups changes for undo.
  vi.advanceTimersByTime(5_000);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);
  vi.advanceTimersByTime(5_000);
  pressUndo(host);
  const undone = handle.markdown();
  const waitingAfterUndo = [...drawn.values()].filter((upload) => upload !== "");
  pressUndo(host, true);

  assert.equal(undone, TEXT);
  assert.deepEqual(waitingAfterUndo, []);
  assert.equal(handle.markdown(), `${TEXT}\n![members](${KEPT})\n`);
});

test("a dropped picture undone while its upload is out, then redone after it settled, comes back kept", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const landed = { section: 1, text: "Single use.", occurrence: 0, offset: 4, code: false, top: 0 };

  const { handle, taken, host, drawn } = opened(TEXT, {
    x: 0,
    y: 0,
    words: landed,
    pictures: [PNG()],
  });

  vi.advanceTimersByTime(5_000);
  pressUndo(host);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);
  vi.advanceTimersByTime(5_000);
  pressUndo(host, true);

  assert.deepEqual([...drawn.values()], [""]);
  assert.equal(handle.markdown(), `${TEXT}\n![members](${KEPT})\n`);
});

test.each([
  {
    where: "before the text's first block",
    markdown: TEXT,
    words: "Single use.",
    section: 1,
    landing: { first: true } as const,
    landed: `![members](${KEPT})\n\n${TEXT}`,
  },
  {
    where: "after the list, at the top level, from an item's line",
    markdown: "## Beats\n\n- Open on the inbox.\n- End on the logo.\n\n## Next\n\nShip.\n",
    words: "Open on the inbox.",
    section: 0,
    landing: { depth: 0 },
    landed: `## Beats\n\n- Open on the inbox.\n- End on the logo.\n\n![members](${KEPT})\n\n## Next\n\nShip.\n`,
  },
  {
    where: "at the end of the outer item, from a nested item's line",
    markdown: "## Beats\n\n- Open on the inbox.\n  - Zoom in.\n- End on the logo.\n",
    words: "Zoom in.",
    section: 0,
    landing: { depth: 1 },
    landed: `## Beats\n\n- Open on the inbox.\n  - Zoom in.\n\n  ![members](${KEPT})\n- End on the logo.\n`,
  },
])("a picture dropped $where lands there", ({ markdown, words, section, landing, landed }) => {
  const caret = { section, text: words, occurrence: 0, offset: 2, code: false, top: 0 };
  const placement = { x: 0, y: 0, words: caret, pictures: [PNG()], landing };
  const { handle, taken } = opened(markdown, placement);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(handle.markdown(), landed);
});

test("a picture laid in stands selected, so no caret stands on a line beside it", () => {
  const { selected } = withPicture();

  assert.deepEqual([...selected.values()], [true]);
});

test("an arrow off a selected picture goes on to the line past it, never to the spot beside it", () => {
  const { handle, host } = withPicture();

  press(host, "ArrowRight");
  pasteWords(host, "Next: ");

  assert.equal(
    handle.markdown(),
    TEXT.replace(
      "follows the mock.\n\n## Decisions",
      `follows the mock.\n\n![members](${KEPT})\n\n## Next: Decisions`,
    ),
  );
});

test("Enter on a selected picture opens an empty line below it and keeps the picture", () => {
  const { handle, host } = withPicture();

  press(host, "Enter");
  pasteWords(host, "Below.");

  assert.equal(
    handle.markdown(),
    TEXT.replace("follows the mock.\n", `follows the mock.\n\n![members](${KEPT})\n\nBelow.\n`),
  );
});

test("an Escape from a picture's own control goes back to the picture selected in the text, never past the editor", () => {
  const { host, selected, onFinish } = withPicture();
  press(host, "ArrowRight");
  const control = host.querySelector(".editor-picture button") ?? assert.fail("its control");

  const taken = press(host, "Escape", control);

  assert.equal(taken, true);
  assert.deepEqual([...selected.values()], [true]);
  assert.equal(onFinish.mock.calls.length, 0);
});

test("the editor opened by a press that landed on a picture opens with that picture selected", () => {
  const markdown = `## Approach\n\n![The mock](${KEPT})\n\n![members](${KEPT})\n\nSingle use.\n`;

  const { selected } = opened(markdown, { x: 300, y: 200, picture: { section: 0, occurrence: 1 } });

  assert.deepEqual([...selected.values()], [false, true]);
});
