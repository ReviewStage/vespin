import { describe, expect, it } from "vitest";
import { AGENT_BOUNDS } from "./agent-wire.js";
import type { BrowserLivePickedElement } from "./browser-live-wire.js";
import { browserNotesMessage, notesFit } from "./browser-notes.js";

/**
 * browser-notes.test.ts -- notes picked in a Browser tab make one message
 * naming the tab, then each note's words and how the agent finds its
 * element, with its crop attached by the name the words give it; and they
 * fit a message only while its files, words, and bytes do.
 */

const TAB = { title: "Checkout · Acme", address: "https://localhost:3000/checkout" };

const BUTTON: BrowserLivePickedElement = {
  box: { x: 68, y: 65, width: 46, height: 15 },
  pageBox: { x: 136.4, y: 130, width: 92, height: 30.2 },
  tab: "page-1",
  ref: "e4182",
  selector: "form#checkout > button:nth-of-type(2)",
  role: "button",
  name: "Place order",
  tag: '<button class="btn btn-secondary" type="submit">',
  text: "Place order",
  crop: "QUJD",
};

const SUMMARY: BrowserLivePickedElement = {
  ...BUTTON,
  pageBox: { x: 24, y: 96, width: 612, height: 58 },
  ref: "e2207",
  selector: "p.summary",
  role: "",
  name: "",
  tag: '<p class="summary">',
  text: "Your order ships in 3 days",
  crop: "REVG",
};

describe("browserNotesMessage", () => {
  it("names the tab, then each note's words and element, its crop attached in order", () => {
    const message = browserNotesMessage(TAB, [
      { words: "Make this the primary action ", element: BUTTON },
      { words: 'Say "ships" once', element: SUMMARY },
    ]);

    expect(message.text).toBe(
      [
        "Notes on elements I picked in your browser:",
        'In the tab "Checkout · Acme", https://localhost:3000/checkout',
        "",
        '1. "Make this the primary action"',
        '   Element: button "Place order", form#checkout > button:nth-of-type(2)',
        "   Ref: e4182 on tab page-1, until the page reloads",
        '   Tag: <button class="btn btn-secondary" type="submit">',
        "   Box: 136,130 92×30 (CSS pixels of the visible page)",
        "   Picture: note-1.jpg",
        "",
        '2. "Say \\"ships\\" once"',
        "   Element: p.summary",
        "   Ref: e2207 on tab page-1, until the page reloads",
        '   Tag: <p class="summary">',
        '   Text: "Your order ships in 3 days"',
        "   Box: 24,96 612×58 (CSS pixels of the visible page)",
        "   Picture: note-2.jpg",
      ].join("\n"),
    );
    expect(message.attachments).toEqual([
      { name: "note-1.jpg", mediaType: "image/jpeg", data: "QUJD" },
      { name: "note-2.jpg", mediaType: "image/jpeg", data: "REVG" },
    ]);
  });
});

describe("notesFit", () => {
  it("holds no more notes than a message has files", () => {
    const note = { words: "Tighten", element: SUMMARY };
    const most = Array.from({ length: AGENT_BOUNDS.MAX_ATTACHMENTS }, () => note);

    expect(notesFit(TAB, most)).toBe(true);
    expect(notesFit(TAB, [...most, note])).toBe(false);
  });
});
