/**
 * browser-notes.ts -- notes a member wrote on elements they picked in an agent's Browser tab, as the one message the agent is sent: words that say where each element is, and a crop of each.
 *
 * The message opens by naming the tab by its title and address, then lists
 * the notes in the order they were picked. Each is the member's words, then
 * what the agent finds the element by: its accessible role and name, as its
 * snapshot prints them, a selector that finds it alone in the page, its ref
 * and tab, which its browser tool acts on while the page stands, its opening tag, its
 * words where they say more than its name, its box in the visible page, and
 * the name of its picture, attached after the words as a JPEG in the order
 * the notes are listed. A message is a member's message like any other, so
 * it is bounded as one: as many notes as a message has files, and words and
 * pictures that fit one message (`notesFit`).
 */

import { AGENT_ATTACHMENT_TYPE, AGENT_BOUNDS, type AgentAttachment } from "./agent-wire.js";
import type { BrowserLivePickedElement } from "./browser-live-wire.js";

/** The most characters of one note's words. */
export const BROWSER_NOTE_MAX_CHARS = 1_000;

/** One note: the member's words, and the element they are on. */
export interface BrowserNote {
  readonly words: string;
  readonly element: BrowserLivePickedElement;
}

/** The tab the notes were picked in, as its pane names it. */
export interface BrowserNotesTab {
  readonly title: string;
  readonly address: string;
}

/** The message the notes make: its words, and each note's picture. */
export interface BrowserNotesMessage {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
}

/** A JSON string's quoting, which escapes a quote or a line break inside the words. */
const quoted = (words: string) => JSON.stringify(words);

/** The element by its accessible role and name, `button "Place order"`; its selector where it has neither. */
export function browserNoteElement(element: BrowserLivePickedElement): string {
  if (element.role === "") return element.selector;

  return element.name === "" ? element.role : `${element.role} ${quoted(element.name)}`;
}

/** The picture of the note at a place, from one. */
function pictureName(place: number): string {
  return `note-${String(place)}.jpg`;
}

/** One note's lines, at its place from one. */
function noteLines(note: BrowserNote, place: number): readonly string[] {
  const { element } = note;
  const box = element.pageBox;
  const round = (value: number) => String(Math.round(value));
  const saysMore = element.text !== "" && element.text !== element.name;

  return [
    `${String(place)}. ${quoted(note.words.trim())}`,
    `   Element: ${element.role === "" ? element.selector : `${browserNoteElement(element)}, ${element.selector}`}`,
    `   Ref: ${element.ref} on tab ${element.tab}, until the page reloads`,
    `   Tag: ${element.tag}`,
    ...(saysMore ? [`   Text: ${quoted(element.text)}`] : []),
    `   Box: ${round(box.x)},${round(box.y)} ${round(box.width)}×${round(box.height)} (CSS pixels of the visible page)`,
    `   Picture: ${pictureName(place)}`,
  ];
}

/** The notes as the one message the agent is sent. */
export function browserNotesMessage(
  tab: BrowserNotesTab,
  notes: readonly BrowserNote[],
): BrowserNotesMessage {
  const head = [
    "Notes on elements I picked in your browser:",
    `In the tab ${quoted(tab.title)}, ${tab.address}`,
  ];

  const text = [
    head.join("\n"),
    ...notes.map((note, at) => noteLines(note, at + 1).join("\n")),
  ].join("\n\n");

  const attachments = notes.map((note, at) => ({
    name: pictureName(at + 1),
    mediaType: AGENT_ATTACHMENT_TYPE.JPEG,
    data: note.element.crop,
  }));

  return { text, attachments };
}

/** How many bytes a base64 text spells: three in every four characters. */
function bytesOf(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

/** Whether the notes fit one message: as many as it has files, words within its bound, and pictures within its bytes. */
export function notesFit(tab: BrowserNotesTab, notes: readonly BrowserNote[]): boolean {
  const { text, attachments } = browserNotesMessage(tab, notes);
  const bytes = attachments.reduce((sum, attachment) => sum + bytesOf(attachment.data), 0);

  return (
    notes.length <= AGENT_BOUNDS.MAX_ATTACHMENTS &&
    text.length <= AGENT_BOUNDS.MAX_MESSAGE_CHARS &&
    bytes <= AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES
  );
}
