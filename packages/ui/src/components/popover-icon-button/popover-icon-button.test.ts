// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PopoverIconButton } from "./popover-icon-button.js";

/**
 * popover-icon-button.test.ts -- the button hangs its panel outside the box
 * it stands in, named by its title and saying so in `aria-expanded`; a second
 * press on the button puts the panel away rather than opening it again;
 * Escape puts it away and hands the focus back to the button; and a finger's
 * press away says so only once the press has moved the focus.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A button whose panel's standing is held as an owner holds it. */
function Held(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return createElement(PopoverIconButton, {
    icon: "☺",
    label: "Change icon",
    title: "Icon",
    open,
    onOpenChange: setOpen,
    children: createElement("p", null, "Pick an icon"),
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

async function mount(): Promise<{ container: HTMLElement; button: HTMLButtonElement }> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Held)));
  await settle();
  const button = container.querySelector("button") ?? assert.fail("no button");

  return { container, button };
}

const panel = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Icon"]');

test("a press hangs the panel outside the button's box, and a second press puts it away", async () => {
  const { container, button } = await mount();
  assert.equal(button.getAttribute("aria-expanded"), "false");

  await act(async () => button.click());
  await settle();
  const shown = panel() ?? assert.fail("no panel");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(container.contains(shown), false, "the panel is drawn outside the button's box");
  assert.ok(shown.textContent?.includes("Pick an icon"));

  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    button.click();
  });
  await settle();
  assert.equal(button.getAttribute("aria-expanded"), "false");
});

test("Escape puts the panel away and hands the focus back to the button", async () => {
  const { button } = await mount();
  await act(async () => button.click());
  await settle();
  const shown = panel() ?? assert.fail("no panel");

  await act(async () => {
    shown.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();

  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, button);
});

test("a finger's press away says so once its click lands, the focus standing where the press took it", async () => {
  const field = document.body.appendChild(document.createElement("input"));
  const aways: (Element | null)[] = [];

  /** A button whose owner hears a press away, noting where the focus stands as it does. */
  function Heard(): React.JSX.Element {
    const [open, setOpen] = useState(true);

    return createElement(PopoverIconButton, {
      icon: "☺",
      label: "Change icon",
      title: "Icon",
      open,
      onOpenChange: (next: boolean, away: boolean) => {
        setOpen(next);

        if (away) aways.push(document.activeElement);
      },
      children: createElement("input", { "aria-label": "Search" }),
    });
  }

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Heard)));
  await settle();
  assert.ok(panel(), "the panel stands");

  await act(async () => {
    field.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "touch" }),
    );
    // A finger's press reaches the page as a mouse's too, whose press down puts the panel away before the focus moves.
    field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await settle();
  assert.ok(panel() === null, "the finger's press puts the panel away");
  assert.equal(aways.length, 0, "and says nothing of a press away while the focus has not moved");

  await act(async () => {
    field.focus();
    field.click();
  });
  assert.equal(aways.length, 1, "the press away is said once its click lands");
  assert.equal(aways[0], field, "the focus standing on the field it landed on");
});
