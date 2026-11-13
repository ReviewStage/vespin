// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentAgentAnswer } from "@repo/features/agent-view";
import { AGENT_ATTACHMENT_TYPE, AGENT_BOUNDS } from "@repo/features/agent-wire";
import { descriptionAttachmentAddress } from "@repo/features/description-attachment-link";
import { FAILURE_SURFACE, type ShownFailureReport } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { closeHistory } from "@tiptap/pm/history";
import { Effect } from "effect";
import { act, createElement, type ReactNode, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { installShownFailureReporter } from "./failure-report.js";
import { AgentComposer } from "./tasks/agent-composer.js";
import { useAgentComposer } from "./tasks/use-agent-composer.js";
import { fakeActPort, fakeActPortCalls } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { attachmentChipName } from "./testing/attachment-chip.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "./testing/composer.js";
import { testQueryClientNow, withQueryClient } from "./testing/copy-feedback.js";
import { installScrollIntoView } from "./testing/scroll-into-view.js";

/**
 * The agent's box takes files: a picture dropped on the card is held under
 * its own name, and a screenshot pasted into the field, which the clipboard
 * calls "image.png", as "Picture 1", a pasted PDF under its own name, each
 * one's chip written into the words where
 * the caret stood, and goes with its chip when one Backspace takes it out;
 * pictures past the bytes a message carries together are left out, the box saying why in its note while the
 * ones that fit still come; the note goes once the box's message goes,
 * whichever way it goes, queued behind a running turn as sent.
 */

const ignore = () => undefined;

/** The agent's box on its own control, whose sends never answer. */
function AgentBox({ agentId = "agent-1" }: { agentId?: string }): ReactNode {
  const composer = useAgentComposer({
    agentId,
    taskId: "plan-1",
    messages: [],
    send: () => new Promise<AgentAgentAnswer>(ignore),
  });

  return createElement(AgentComposer, { ...QUIET_COMPOSER, composer, skills: undefined });
}

/** The agent's box while a turn runs, its Enter queueing, the queue taking its message as the queue does: out of the box. */
function QueueingBox(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise<AgentAgentAnswer>(ignore),
  });

  const queued = () => {
    composer.setDraft("");
    composer.setAttachments(() => []);
  };

  return createElement(AgentComposer, {
    ...QUIET_COMPOSER,
    composer,
    skills: undefined,
    queueing: {
      working: true,
      enterQueues: true,
      onQueue: queued,
      editing: false,
      onSave: ignore,
      onSteer: ignore,
      onCancel: ignore,
    },
  });
}

/** The agent's box editing a queued message, whose Save the queue refuses, so its words stay standing. */
function RefusedEditBox(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise<AgentAgentAnswer>(ignore),
  });

  return createElement(AgentComposer, {
    ...QUIET_COMPOSER,
    composer,
    skills: undefined,
    queueing: {
      working: true,
      enterQueues: true,
      onQueue: ignore,
      editing: true,
      onSave: ignore,
      onSteer: ignore,
      onCancel: ignore,
    },
  });
}

/** The agent's box opening on a draft kept with a picture its words name, as a draft kept from before, or a message opened for editing. */
function KeptDraftBox(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise<AgentAgentAnswer>(ignore),
  });

  const [kept, setKept] = useState(false);
  // Note that the draft is kept once, before the box first draws, since the control's doors are new on every render.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    composer.setDraft("Like [Picture 1]");
    composer.setAttachments(() => [
      { name: "Picture 1", mediaType: AGENT_ATTACHMENT_TYPE.PNG, data: "iVBORw0KGgo=" },
    ]);
    setKept(true);
  });

  return kept
    ? createElement(AgentComposer, { ...QUIET_COMPOSER, composer, skills: undefined })
    : null;
}

/** The boxes that take files, each drawn alone. */
const BOXES = {
  agent: () => createElement(AgentBox),
} as const;

/** A PNG's signature, and bytes past it to give the picture its size. */
function png(name: string, size = 8): File {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return new File([bytes], name, { type: "image/png" });
}

/** A PDF of the name, its bytes a PDF's header. */
function pdf(name: string): File {
  return new File(["%PDF-1.7\n"], name, { type: "application/pdf" });
}

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppPlatform(QUIET_PANEL);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Lets files handed to a box be read off the disk, each read taking a few of the event loop's turns, one file after another. */
async function read(): Promise<void> {
  for (let round = 0; round < 16; round += 1) await settle();
}

/** A box drawn, its editor landed. */
async function drawn(box: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(withQueryClient(box)));
  await settle();

  return container;
}

/** The box drawn, its editor landed. */
function mounted(box: keyof typeof BOXES): Promise<HTMLElement> {
  return drawn(BOXES[box]());
}

/** Files dropped on the box's card, and read off the disk before they land. */
async function drop(container: HTMLElement, files: readonly File[]): Promise<void> {
  const card = container.querySelector(".agent-composer") ?? assert.fail("no card");
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } });
  act(() => card.dispatchEvent(event));
  await read();
}

/** Files pasted into the box's editor, as the clipboard hands a screenshot over, before they are read; answers whether the editor let the paste go by. */
function pasteUnread(container: HTMLElement, files: readonly File[]): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, types: ["Files"], getData: () => "" },
  });
  act(() => {
    composerEditor(container).dispatchEvent(event);
  });

  return !event.defaultPrevented;
}

/** Files pasted into the box's editor, and read off the disk before they land; answers whether the editor let the paste go by. */
async function paste(container: HTMLElement, files: readonly File[]): Promise<boolean> {
  const passed = pasteUnread(container, files);
  await read();

  return passed;
}

/** What the box shows of its files: its chips beside the words by name, the files its words hold by what their chips open, and its note. */
function held(container: HTMLElement) {
  return {
    chips: [...container.querySelectorAll('[aria-label="Attached files"] > li')].map(
      attachmentChipName,
    ),
    pictures: [
      ...composerEditor(container).querySelectorAll('[data-chip="fileChip"] [aria-label]'),
    ].map((chip) => chip.getAttribute("aria-label")),
    note: container.querySelector('.ui-composer-foot-note [role="alert"]')?.textContent ?? null,
  };
}

test("a picture and a PDF dropped on the agent's box are held as their chips in the words by their own names, and say nothing", async () => {
  // SAFETY: BOXES is a literal keyed by its boxes alone.
  for (const box of Object.keys(BOXES) as (keyof typeof BOXES)[]) {
    const container = await mounted(box);
    await drop(container, [png("IMG_1234.png"), pdf("spec.pdf")]);
    assert.deepEqual(
      held(container),
      { chips: [], pictures: ["Open IMG_1234.png", "Open spec.pdf"], note: null },
      box,
    );
  }
});

test("two files of one name, and one whose name holds brackets, each stand in the words as a chip of its own", async () => {
  const container = await mounted("agent");
  const text = (name: string) => new File(["words\n"], name, { type: "text/plain" });
  await drop(container, [text("notes.txt"), text("notes.txt"), text("log[1].txt")]);
  assert.deepEqual(held(container), {
    chips: [],
    pictures: ["Open notes.txt", "Open notes 2.txt", "Open log(1).txt"],
    note: null,
  });
});

test("a picture and a PDF pasted into the agent's box are held as their chips in the words, the paste writing no words of its own", async () => {
  // SAFETY: BOXES is a literal keyed by its boxes alone.
  for (const box of Object.keys(BOXES) as (keyof typeof BOXES)[]) {
    const container = await mounted(box);
    assert.equal(
      await paste(container, [png("image.png"), pdf("spec.pdf")]),
      false,
      `${box} takes the paste`,
    );
    assert.deepEqual(
      held(container),
      { chips: [], pictures: ["Open Picture 1", "Open spec.pdf"], note: null },
      box,
    );
  }
});

test("a picture pasted stands as its chip at once, before the words typed while it is read", async () => {
  const container = await mounted("agent");
  pasteUnread(container, [png("image.png")]);
  typeInComposer(container, "here");
  await read();
  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");
  assert.equal(editor.getText(), "[Picture 1] here");
  assert.deepEqual(held(container), { chips: [], pictures: ["Open Picture 1"], note: null });
});

test("a word typed after a file laid in as its chip stands a space apart from it", async () => {
  const container = await mounted("agent");
  await drop(container, [png("image.png")]);
  typeInComposer(container, "here");
  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");
  assert.equal(editor.getText(), "[Picture 1] here");

  // The document holds the first chip at 1, then the space the caret now stands before.
  act(() => editor.commands.setTextSelection(2));
  await drop(container, [png("image.png")]);
  typeInComposer(container, "and ");
  assert.equal(
    editor.getText(),
    "[Picture 1] [Picture 2] and here",
    "a space already there is not doubled",
  );
});

test("a file laid in as its chip before closing punctuation takes no space before it", async () => {
  const container = await mounted("agent");
  typeInComposer(container, "See.");
  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");
  // The document holds "See" from 1, then the period the caret now stands before.
  act(() => editor.commands.setTextSelection(4));
  await drop(container, [png("image.png")]);
  typeInComposer(container, ",");
  assert.equal(editor.getText(), "See [Picture 1],.");
});

/** The box's words selected from the first to the last and copied, as a drag over them and ⌘C do: what the copy wrote to the clipboard, by type. */
function copyAll(container: HTMLElement): Map<string, string> {
  const written = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      clearData: () => written.clear(),
      setData: (type: string, data: string) => written.set(type, data),
    },
  });
  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");
  act(() => {
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    composerEditor(container).dispatchEvent(event);
  });

  return written;
}

test("a picture's chip copied out of one box and pasted into another comes with its picture, numbered after the pictures that box holds", async () => {
  const from = await mounted("agent");
  typeInComposer(from, "Look at ");
  await drop(from, [png("image.png")]);
  const copied = copyAll(from);

  const to = await drawn(createElement(AgentBox, { agentId: "agent-2" }));
  // Note that this box's own picture is another picture, of other bytes, under the same name.
  await drop(to, [png("image.png", 16)]);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      types: [...copied.keys()],
      getData: (type: string) => copied.get(type) ?? "",
    },
  });
  act(() => {
    composerEditor(to).dispatchEvent(event);
  });
  await read();

  const editor = composerEditor(to).editor ?? assert.fail("the box's editor is running");
  assert.equal(editor.getText(), "[Picture 1] Look at [Picture 2] ");
  assert.deepEqual(held(to), {
    chips: [],
    pictures: ["Open Picture 1", "Open Picture 2"],
    note: null,
  });
});

test("a picture's chip copied alone goes to the clipboard as the picture too, and one copied among words does not", async () => {
  const written: { readonly text: string; readonly png?: Promise<string> | undefined }[] = [];
  fakeAppPlatform({
    ...QUIET_PANEL,
    copyRich: (rich) => {
      written.push(rich);

      return Promise.resolve();
    },
  });
  const container = await mounted("agent");
  await drop(container, [png("image.png")]);
  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");

  /** The box's words from one place to another copied, as a drag over them and ⌘C do. */
  const copy = (from: number, to: number) => {
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { clearData: () => undefined, setData: () => undefined },
    });
    act(() => {
      editor.commands.setTextSelection({ from, to });
      composerEditor(container).dispatchEvent(event);
    });
  };

  // The document holds the chip at 1 and the space laid in after it.
  copy(1, 2);
  typeInComposer(container, "here");
  copy(1, editor.state.doc.content.size - 1);

  assert.deepEqual(await Promise.all(written.map(async (each) => [each.text, await each.png])), [
    ["[Picture 1]", "iVBORw0KGgo="],
  ]);
});

test("a copy naming one picture twice pasted into the agent's box attaches it once, both chips naming it", async () => {
  const chip =
    '<img data-chip="fileChip" alt="[Picture 4]" src="data:image/png;base64,iVBORw0KGgo=">';

  const html = `<p>${chip} and ${chip}</p>`;
  const container = await mounted("agent");

  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      types: ["text/html"],
      getData: (type: string) => (type === "text/html" ? html : ""),
    },
  });
  act(() => {
    composerEditor(container).dispatchEvent(event);
  });
  await read();

  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");
  assert.equal(editor.getText(), "[Picture 1] and [Picture 1]");
});

test.each([
  {
    case: "is read and attached as the box's next picture, where it was pasted",
    pasted: (picture: string) => `<p>Like ${picture} here</p>`,
    alt: "The mock",
    words: "Like [Picture 1] here",
    pictures: ["Open Picture 1"],
  },
  {
    case: "twice is attached once, both chips naming it",
    pasted: (picture: string) => `<p>Like ${picture} and ${picture} here</p>`,
    alt: "The mock",
    words: "Like [Picture 1] and [Picture 1] here",
    pictures: ["Open Picture 1", "Open Picture 1"],
  },
  {
    case: "whose alt names it a PDF, though it reads as a picture, is not kept as a PDF",
    pasted: (picture: string) => `<p>Like ${picture} here</p>`,
    alt: "chart.pdf",
    words: "Like here",
    pictures: [],
  },
])(
  "a description's picture pasted into the agent's box $case",
  async ({ pasted, alt, words, pictures }) => {
    const address = descriptionAttachmentAddress(
      {
        taskId: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
        attachmentId: "3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02",
      },
      "acme",
    );

    fakeActPort({
      ...fakeActPortCalls(),
      [ACT_KIND.TASKS_PICTURE_READ]: () =>
        Promise.resolve({ contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: "iVBORw0KGgo=" }),
    });

    const container = await mounted("agent");
    const html = pasted(`<img src="${address}" alt="${alt}">`);

    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        types: ["text/html"],
        getData: (type: string) => (type === "text/html" ? html : ""),
      },
    });
    act(() => {
      composerEditor(container).dispatchEvent(event);
    });
    await read();

    const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");
    assert.equal(editor.getText(), words);
    assert.deepEqual(held(container).pictures, pictures);
  },
);

/** The chip a file was just laid in with taken out as two Backspaces would: the first the space laid in after it, which the browser deletes itself, the second the chip whole. */
function takeOutLastChip(container: HTMLElement): void {
  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");
  act(() => {
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.delete(from - 1, from));
  });
  act(() => pressInComposer(container, "Backspace"));
}

test("one Backspace taking a picture's chip out of the words takes the picture off the message", async () => {
  const container = await mounted("agent");
  await drop(container, [png("image.png"), png("image.png")]);
  assert.deepEqual(held(container).pictures, ["Open Picture 1", "Open Picture 2"]);

  takeOutLastChip(container);
  await settle();

  assert.deepEqual(held(container), { chips: [], pictures: ["Open Picture 1"], note: null });
});

test("undo bringing a deleted picture's chip back brings its picture back, though the words were emptied in between", async () => {
  const container = await mounted("agent");
  await drop(container, [png("image.png")]);
  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");

  // Note that each step closes its own entry in the history, as a pause between them would.
  const pause = () => act(() => editor.view.dispatch(closeHistory(editor.state.tr)));
  pause();
  takeOutLastChip(container);
  pause();
  typeInComposer(container, "a");
  act(() => {
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.delete(from - 1, from));
  });
  await settle();
  assert.deepEqual(held(container).pictures, []);

  for (let undo = 0; undo < 4 && held(container).pictures.length === 0; undo += 1) {
    act(() => editor.commands.undo());
    await settle();
  }

  assert.deepEqual(held(container), { chips: [], pictures: ["Open Picture 1"], note: null });
});

test("a save that leaves the box's words standing still lets one Backspace take a picture off with its chip", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(withQueryClient(createElement(RefusedEditBox))));
  await settle();
  await drop(container, [png("image.png"), png("image.png")]);

  act(() => pressInComposer(container, "Enter"));
  await settle();
  takeOutLastChip(container);
  await settle();

  assert.deepEqual(held(container), { chips: [], pictures: ["Open Picture 1"], note: null });
});

test("one Backspace taking a chip the box opened on out of the words takes its picture off", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(withQueryClient(createElement(KeptDraftBox))));
  await settle();
  assert.deepEqual(held(container).pictures, ["Open Picture 1"]);

  act(() => pressInComposer(container, "Backspace"));
  await settle();

  assert.deepEqual(held(container), { chips: [], pictures: [], note: null });
});

test("a file this machine cannot read says so in the agent's box and is reported with why", async () => {
  const reports: ShownFailureReport[] = [];

  const uninstall = installShownFailureReporter((report) => {
    reports.push(report);

    return undefined;
  }, testQueryClientNow());

  const unreadable = new DOMException("The file could not be read.", "NotReadableError");

  const file = Object.assign(new File(["notes"], "notes.txt", { type: "text/plain" }), {
    arrayBuffer: () => Promise.reject(unreadable),
  });

  const container = await mounted("agent");

  await drop(container, [file]);
  uninstall();

  assert.deepEqual(held(container), {
    chips: [],
    pictures: [],
    note: "notes.txt couldn't be read.",
  });
  assert.deepEqual(
    reports.map((report) => [report.surface, report.cause]),
    [[FAILURE_SURFACE.ATTACHMENT_READ, unreadable]],
  );
});

test("pictures past the bytes a message carries together leave the last out of the agent's box, and the note says why", async () => {
  // Note that each picture fits a message alone, kept as it is, and two of them fit together while three do not.
  const size = Math.floor(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES / 2.5);
  assert.ok(size <= AGENT_BOUNDS.MAX_IMAGE_BYTES);

  // SAFETY: BOXES is a literal keyed by its boxes alone.
  for (const box of Object.keys(BOXES) as (keyof typeof BOXES)[]) {
    const container = await mounted(box);
    await drop(container, [png("one.png", size), png("two.png", size), png("three.png", size)]);
    assert.deepEqual(
      held(container),
      {
        chips: [],
        pictures: ["Open one.png", "Open two.png"],
        note: "These files are too large to send together.",
      },
      box,
    );
  }
});

test("a note of files left out goes once the box's message is queued, as it goes once one is sent", async () => {
  const size = Math.floor(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES / 2.5);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(withQueryClient(createElement(QueueingBox))));
  await settle();
  await drop(container, [png("one.png", size), png("two.png", size), png("three.png", size)]);
  assert.equal(held(container).note, "These files are too large to send together.");

  const queue = container.querySelector('button[aria-label="Queue"]');
  assert.ok(queue instanceof HTMLButtonElement, "Send reads Queue while the turn runs");
  act(() => queue.click());
  await settle();

  assert.deepEqual(held(container), { chips: [], pictures: [], note: null });
});
