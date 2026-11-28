import { describe, expect, it } from "vitest";
import { AGENT_BOUNDS } from "./agent-wire.js";
import type { BrowserLivePickedElement } from "./browser-live-wire.js";
import { browserNotesMessage, notesFit } from "./browser-notes.js";

/**
 * browser-notes.test.ts -- notes picked in a Browser tab make one message
 * of each note's words, the page it was picked on, and how the agent finds
 * its element, with its crop attached by the name the words give it; and they
 * fit a message only while its files, words, and bytes do.
 */

const CHECKOUT = { title: "Checkout · Acme", address: "https://localhost:3000/checkout" };

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
  it("lists each note's words, the page it was picked on, and its element, its crop attached in order", () => {
    const message = browserNotesMessage([
      { words: "Make this the primary action ", element: BUTTON, page: CHECKOUT },
      {
        words: 'Say "ships" once',
        element: SUMMARY,
        page: { title: "Order placed", address: "https://localhost:3000/done" },
      },
    ]);

    expect(message.text).toBe(
      [
        "Notes on elements I picked in your browser:",
        "",
        '1. "Make this the primary action"',
        '   Page: "Checkout · Acme", https://localhost:3000/checkout',
        '   Element: button "Place order", form#checkout > button:nth-of-type(2)',
        "   Ref: e4182 on tab page-1, until the page reloads",
        '   Tag: <button class="btn btn-secondary" type="submit">',
        "   Box: 136,130 92×30 (CSS pixels of the visible page)",
        "   Picture: note-1.jpg",
        "",
        '2. "Say \\"ships\\" once"',
        '   Page: "Order placed", https://localhost:3000/done',
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
    const note = { words: "Tighten", element: SUMMARY, page: CHECKOUT };
    const most = Array.from({ length: AGENT_BOUNDS.MAX_ATTACHMENTS }, () => note);

    expect(notesFit(most)).toBe(true);
    expect(notesFit([...most, note])).toBe(false);
  });
});
