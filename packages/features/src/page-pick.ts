import { Schema as EffectSchema } from "effect";
import { DESCRIPTION_COMMENT_BOUNDS } from "./description-comment-wire.js";

/**
 * page-pick.ts -- a comment's element in a plan's page as drawn: the pick the page's frame runs when a member comments on one of its elements, and the messages the side panel and the frame pass to drive it.
 *
 * A page is drawn in a frame sandboxed to its scripts alone, with an opaque
 * origin, so nothing in the panel reaches its elements. Every server of a
 * page therefore answers it with one more script of our own ahead of the
 * agent's HTML (`withPageScripts`), beside the find's and the link's: at the
 * panel's asking it outlines the element under the pointer, takes the next
 * press for itself rather than the page's, and posts what was pressed back
 * to the panel by its path from the document's root, its words, the
 * heading of the section it stands in, and where it stands in the frame; it
 * outlines the element a thread is on and brings it into view, where the
 * version drawn still holds it, and faintly the one whose pin the pointer
 * is over; it says where each element the panel marks stands, again as the
 * page scrolls, resizes, or changes, so the panel pins the threads on it
 * over the frame, and tints in it the words a thread quotes, with the CSS
 * Custom Highlight API, as the find tints its matches; and it posts the words selected in the
 * page, with where they stand and the element holding them, as a press or
 * a key lets them go, or a finger's rests, and that none are once they go;
 * and it says a press landed in the page that selected nothing, which
 * dismisses a card standing over it, as a press anywhere else does; and
 * which element marked the pointer is over, so the panel tells its
 * comments as it does over the element's pin.
 * The outline is a stylesheet the document adopts over an attribute set on
 * the element, so the page's own tree is never rewritten.
 *
 * The script runs among the page's own, so whatever the frame posts is the
 * page's word, not ours: the panel takes a pick only from the frame it drew,
 * only in the shape below, only while it asked for one, and only while the
 * window holds a press of the developer's, which a press in the frame hands
 * the window that framed it (`page-pane.tsx`). A page can still answer a
 * pick with another element than the one pressed, since its scripts share
 * the frame with ours; what it gains is a wrong quote on a comment about
 * itself, since a pick is kept and shown as words and nothing acts on it.
 */

/** The mark every message of the pick wears, setting it apart from whatever else the page posts. */
export const PAGE_PICK_TYPE = "app-page-pick";

/** What the panel asks of the frame. */
export const PAGE_PICK_ACT = {
  /** Outline the element under the pointer and take the next press as the pick. */
  START: "start",
  /** Stop picking, taking no press. */
  STOP: "stop",
  /** Outline the element a path names and bring it into view; an empty path outlines none. */
  SHOW: "show",
  /** Outline faintly the element a path names, as the pointer is over its pin; an empty path outlines none. */
  HINT: "hint",
  /** Say where the elements the marks name stand, now and each time they move, and tint the words selected in them that a thread quotes. */
  MARK: "mark",
  /** Let go of the words selected, as a reply quoting them was pressed. */
  UNSELECT: "unselect",
} as const;

/** A message the panel posts to the frame. */
export type PagePickAsk =
  | {
      readonly type: typeof PAGE_PICK_TYPE;
      readonly act:
        | typeof PAGE_PICK_ACT.START
        | typeof PAGE_PICK_ACT.STOP
        | typeof PAGE_PICK_ACT.UNSELECT;
    }
  | {
      readonly type: typeof PAGE_PICK_TYPE;
      readonly act: typeof PAGE_PICK_ACT.SHOW | typeof PAGE_PICK_ACT.HINT;
      readonly path: string;
    }
  | {
      readonly type: typeof PAGE_PICK_TYPE;
      readonly act: typeof PAGE_PICK_ACT.MARK;
      readonly marks: readonly PageMark[];
    };

/** An element the panel marks: by its path, with the words selected in it that a thread quotes, where one does; an element several threads quote words of is marked once for each. */
export interface PageMark {
  readonly path: string;
  readonly words?: string;
}

/** Where something stands in the frame, in its own viewport's pixels. */
const frameBoxSchema = EffectSchema.Struct({
  left: EffectSchema.Finite,
  top: EffectSchema.Finite,
  right: EffectSchema.Finite,
  bottom: EffectSchema.Finite,
});

export type FrameBox = typeof frameBoxSchema.Type;

const elementPathSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_ELEMENT_PATH_CHARS),
);

/** An element picked in the frame, as it posts it: its path, its words, the heading it stands under, and where it stands. */
const pickedSchema = EffectSchema.Struct({
  path: elementPathSchema,
  quote: EffectSchema.String.check(
    EffectSchema.isPattern(/\S/u),
    EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
  ),
  section: EffectSchema.String.check(
    EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_SECTION_CHARS),
  ),
  box: frameBoxSchema,
  /** Whether the quote is words selected in the element rather than the element as a whole. */
  words: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type PagePicked = typeof pickedSchema.Type;

/**
 * A message the frame posts to the panel: the element picked; that the pick
 * was let go, by Escape in the page; where each element marked stands, or
 * none where the page holds it no more; the words selected, in the shape
 * of an element picked whose quote they are, or none once they go; that
 * a press landed in the page, selecting nothing; or the element marked that
 * the pointer is over, the innermost where several hold it, or none as it
 * leaves them.
 */
export const pagePickAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ type: EffectSchema.Literal(PAGE_PICK_TYPE), picked: pickedSchema }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    stopped: EffectSchema.Literal(true),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    marks: EffectSchema.Array(
      EffectSchema.Struct({ path: elementPathSchema, box: EffectSchema.NullOr(frameBoxSchema) }),
    ).check(EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION)),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    selected: EffectSchema.NullOr(pickedSchema),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    pressed: EffectSchema.Literal(true),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    over: EffectSchema.NullOr(elementPathSchema),
  }),
]);

/**
 * The script the frame runs, ahead of the page's own. It is plain JavaScript
 * in a string because it runs in the page, apart from every bundle of ours.
 * Its listeners stand on the window as a press sets out, ahead of every one
 * the page adds, so while it picks no press reaches the page. An element's
 * path names it by its id where it has one, and otherwise by its place among
 * its siblings of its kind, from the body down; one too long to keep names
 * the nearest element above it that fits. Its words are its text, its
 * whitespace run together, else its label or alternative text, else its
 * kind; its section is the last heading at or before it.
 */
export const PAGE_PICK_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_PICK_TYPE)};
  const MAX_PATH = ${DESCRIPTION_COMMENT_BOUNDS.MAX_ELEMENT_PATH_CHARS};
  const MAX_QUOTE = ${DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS};
  const MAX_SECTION = ${DESCRIPTION_COMMENT_BOUNDS.MAX_SECTION_CHARS};
  const MARK = "data-ui-pick";
  const PRESSES = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"];
  const WORDS = "ui-comment-words";
  const pick = { on: false, hovered: null, shown: null, hinted: null, styled: false };
  const painted = typeof CSS !== "undefined" && CSS.highlights !== undefined && typeof Highlight === "function";

  const post = (message) => parent.postMessage(Object.assign({ type: TYPE }, message), "*");
  const flat = (text) => String(text ?? "").replace(/\\s+/g, " ").trim();
  const cut = (text, most) => (text.length > most ? text.slice(0, most - 1) + "…" : text);

  const style = () => {
    if (pick.styled || typeof CSSStyleSheet !== "function") return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("[" + MARK + "] { outline: 2px solid #0a84ff !important; outline-offset: 2px !important; } [" + MARK + "=hover] { cursor: crosshair !important; } [" + MARK + "=hint] { outline-color: rgba(10, 132, 255, 0.45) !important; } ::highlight(" + WORDS + ") { background-color: rgba(255, 196, 0, 0.32); }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    pick.styled = true;
  };

  // The element hovered or shown moved to another, or to none, each of the two marked for what it now is.
  const mark = (key, element) => {
    const was = pick[key];
    pick[key] = element;
    for (const each of [was, element]) {
      if (each === null) continue;
      const value = each === pick.hovered ? "hover" : each === pick.shown ? "shown" : each === pick.hinted ? "hint" : null;
      if (value === null) {
        each.removeAttribute(MARK);
      } else {
        style();
        each.setAttribute(MARK, value);
      }
    }
  };

  const step = (element) => {
    if (element.id !== "" && typeof CSS !== "undefined" && document.querySelectorAll("#" + CSS.escape(element.id)).length === 1) return "#" + CSS.escape(element.id);
    const tag = element.tagName.toLowerCase();
    if (element === document.body || element === document.documentElement) return tag;
    let place = 1;
    for (let sibling = element.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
      if (sibling.tagName === element.tagName) place += 1;
    }
    return tag + ":nth-of-type(" + place + ")";
  };

  const pathOf = (element) => {
    const steps = [];
    for (let at = element; at !== null; at = at.parentElement) {
      const one = step(at);
      steps.unshift(one);
      if (one.startsWith("#") || at === document.body || at === document.documentElement) break;
    }
    const path = steps.join(" > ");
    return path.length <= MAX_PATH || element.parentElement === null ? path.slice(0, MAX_PATH) : pathOf(element.parentElement);
  };

  const quoteOf = (element) => {
    const words = flat(element.innerText ?? element.textContent)
      || flat(element.getAttribute("aria-label"))
      || flat(element.getAttribute("alt"))
      || flat(element.getAttribute("title"));
    return cut(words || "<" + element.tagName.toLowerCase() + ">", MAX_QUOTE);
  };

  const sectionOf = (element) => {
    let heading = null;
    for (const each of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      if (each === element || each.contains(element) || (each.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) heading = each;
      else break;
    }
    return heading === null ? "" : cut(flat(heading.textContent), MAX_SECTION);
  };

  const stop = () => {
    pick.on = false;
    mark("hovered", null);
  };

  const target = (event) => (event.target instanceof Element ? event.target : null);

  const boxOf = (rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

  const find = (path) => {
    try {
      return path === "" ? null : document.querySelector(path);
    } catch {
      return null;
    }
  };

  const told = { marks: [], said: "[]", selected: "", queued: false, settle: undefined, over: null };

  // The words a thread quotes, found in its element's text as one string, as a range; none where they stand there no more.
  // Note that both are read with each run of whitespace as one space, because a selection's words are the page as drawn, its source's line breaks and indents run together, and a quote cut to its bound ends in an ellipsis the page never held.
  const wordsIn = (element, words) => {
    const sought = flat(words).replace(/…$/u, "");
    if (sought === "") return null;
    const at = [];
    let text = "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      for (let offset = 0; offset < node.data.length; offset += 1) {
        const spaced = /\\s/u.test(node.data[offset]);
        if (spaced && (text === "" || text.endsWith(" "))) continue;
        text += spaced ? " " : node.data[offset];
        at.push({ node, offset });
      }
    }
    const from = text.indexOf(sought);
    if (from < 0) return null;
    const last = at[from + sought.length - 1];
    const range = document.createRange();
    range.setStart(at[from].node, at[from].offset);
    range.setEnd(last.node, last.offset + 1);
    return range;
  };

  const tint = () => {
    if (!painted) return;
    style();
    const ranges = told.marks.flatMap((each) => {
      const element = typeof each.words === "string" ? find(each.path) : null;
      const range = element === null ? null : wordsIn(element, each.words);
      return range === null ? [] : [range];
    });
    CSS.highlights.set(WORDS, new Highlight(...ranges));
  };

  // The block holding the words a range takes: the nearest one around every text it takes more than spaces of, so a triple-click's selection, which runs on to the start of the next block, stands on its own block rather than the list or the section around both.
  const holderOf = (range) => {
    const around = range.commonAncestorContainer;
    let first = null;
    let last = null;
    const walker = document.createTreeWalker(around, NodeFilter.SHOW_TEXT);
    for (let node = around.nodeType === Node.TEXT_NODE ? around : walker.nextNode(); node !== null; node = walker.nextNode()) {
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.data.length;
      if (!range.intersectsNode(node) || node.data.slice(from, to).trim() === "") continue;
      first ??= node;
      last = node;
    }
    let element = around instanceof Element ? around : around.parentElement;
    if (first !== null) {
      const taken = document.createRange();
      taken.setStart(first, 0);
      taken.setEnd(last, last.data.length);
      element = taken.commonAncestorContainer instanceof Element ? taken.commonAncestorContainer : taken.commonAncestorContainer.parentElement;
    }
    // Note that words inside a run of bold or a link stand on the box they are read in, as an element picked with the pointer does, and never on one drawing no box of its own, which has nowhere to pin; an inline block draws its own.
    const unboxed = (each) => {
      const display = getComputedStyle(each).display;
      return display === "inline" || display === "contents";
    };
    while (element !== null && element !== document.body && element.parentElement !== null && unboxed(element)) element = element.parentElement;
    return element;
  };

  // The words selected, as an element picked whose quote they are: none where none are, or they stand in a field.
  const selected = () => {
    const selection = getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
    const words = cut(String(selection).trim(), MAX_QUOTE);
    const range = selection.getRangeAt(0);
    const element = holderOf(range);
    if (words === "" || element === null || element.closest("input, textarea, select, [contenteditable]") !== null) return null;
    return { path: pathOf(element), quote: words, section: sectionOf(element), box: boxOf(range.getBoundingClientRect()), words: true };
  };

  // What the panel holds of the page told again where it moved: each element marked, and the words selected.
  const tell = () => {
    told.queued = false;
    // Note that an element marked for each of several threads' words is said once.
    const marks = [...new Set(told.marks.map(({ path }) => path))].map((path) => {
      const element = find(path);
      return { path, box: element === null ? null : boxOf(element.getBoundingClientRect()) };
    });
    const said = JSON.stringify(marks);
    if (said !== told.said) {
      told.said = said;
      post({ marks });
      tint();
    }
    if (told.selected !== "" && told.selected !== "null") tellSelected();
  };

  const tellSelected = () => {
    const now = selected();
    const said = JSON.stringify(now);
    if (said === told.selected) return;
    told.selected = said;
    post({ selected: now });
  };

  const moved = () => {
    if (told.queued) return;
    told.queued = true;
    (typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout)(tell);
  };

  addEventListener("scroll", moved, true);
  addEventListener("resize", moved);
  new MutationObserver(moved).observe(document, { childList: true, subtree: true, characterData: true, attributes: true });

  // Note that words are offered as a press or a key lets them go, a finger's once they rest, and taken away at once.
  addEventListener("pointerup", () => setTimeout(tellSelected, 0), true);
  addEventListener("keyup", tellSelected, true);
  document.addEventListener("selectionchange", () => {
    clearTimeout(told.settle);
    if (getSelection()?.isCollapsed !== false) tellSelected();
    else told.settle = setTimeout(tellSelected, 300);
  });

  // The element marked that the pointer is over, the innermost, said as it changes; none while picking, which outlines what it is over instead.
  const tellOver = (element) => {
    let over = null;
    for (const { path } of pick.on || element === null ? [] : told.marks) {
      const marked = find(path);
      if (marked !== null && marked.contains(element) && (over === null || over.element.contains(marked))) over = { path, element: marked };
    }
    const path = over === null ? null : over.path;
    if (path === told.over) return;
    told.over = path;
    post({ over: path });
  };

  addEventListener("pointerover", (event) => {
    if (pick.on) mark("hovered", target(event));
    tellOver(target(event));
  }, true);
  // Note that the pointer leaving the page for the window around it is over nothing marked.
  addEventListener("pointerout", (event) => {
    if (event.relatedTarget === null) tellOver(null);
  }, true);

  for (const name of PRESSES) {
    addEventListener(name, (event) => {
      if (!pick.on) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const element = target(event);
      if (name !== "click" || element === null) return;
      stop();
      post({ picked: { path: pathOf(element), quote: quoteOf(element), section: sectionOf(element), box: boxOf(element.getBoundingClientRect()) } });
    }, true);
  }

  // Note that a press the pick took for itself stops before this, and one that selected words is a selection's.
  addEventListener("click", () => {
    if (getSelection()?.isCollapsed !== false) post({ pressed: true });
  }, true);

  addEventListener("keydown", (event) => {
    if (!pick.on || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stop();
    post({ stopped: true });
  }, true);

  addEventListener("message", (event) => {
    const ask = event.data;
    if (event.source !== parent || ask === null || typeof ask !== "object" || ask.type !== TYPE) return;
    // Note that a pick under way is over nothing marked, so the element the pointer stays on is told again once it ends.
    if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.START)}) {
      pick.on = true;
      tellOver(null);
    }
    else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.STOP)}) stop();
    else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.UNSELECT)}) getSelection()?.removeAllRanges();
    else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.MARK)} && Array.isArray(ask.marks)) {
      told.marks = ask.marks.filter((each) => each !== null && typeof each === "object" && typeof each.path === "string");
      told.said = "";
      tell();
      tint();
    } else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.SHOW)} && typeof ask.path === "string") {
      const element = find(ask.path);
      mark("shown", element);
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.HINT)} && typeof ask.path === "string") {
      mark("hinted", find(ask.path));
    }
  });
})();`;
