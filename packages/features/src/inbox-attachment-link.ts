import { type LINK_DESTINATION, type LinkDestination, linkOf } from "./link-grammar.js";
import { isLinkHome, LINK_HOME_PATTERN } from "./link-home.js";
import { insideCode } from "./mention-link.js";
import { parsedUrl } from "./parsed-url.js";

/**
 * inbox-attachment-link.ts -- a picture in an Inbox item's Markdown as its address on vespin.dev: written, read back, and found in the item's words.
 *
 * A message on an item's thread, its agent's or a member's, draws a picture
 * as a description does, `![alt](<address> "caption")`, its address the item's own
 * link (`link-grammar.ts`) with `/files/<attachment>` after it, as a description's
 * picture stands under its plan's (`description-attachment-link.ts`):
 * `https://vespin.dev/<workspace>/task/<task>/inbox/<item>/files/<attachment>`,
 * or `/agent/<agent>/inbox/<item>/files/<attachment>`, found by its agent,
 * as the service writes a picture's address. The address is a real one on purpose: opened in a
 * browser it lands on the item, which opens to its readers alone, and
 * pasted anywhere else it names a picture only the item's readers can
 * fetch. The item and the attachment are what the picture is read by;
 * the workspace and the holder are the link's, read and never trusted.
 * Nothing here reaches the bytes. Before it is kept, the agent's picture
 * names a file in its sandbox by its path, which the post reads there and
 * writes as its address; a path is any destination naming no scheme.
 */

/** The step the picture's id follows in its address. */
const FILES_STEP = "files";

/** The steps a holder of an item is named under: a task, by either spelling, or its agent. */
const HOLDER_STEPS: ReadonlySet<string> = new Set(["plan", "task", "agent"]);

/** The step an item's id follows. */
const INBOX_STEP = "inbox";

/** An id as the service mints one: a UUID in lower case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A holder's id, as a link spells one: letters, digits, `_`, and `-`. */
const HOLDER_ID = /^[A-Za-z0-9_-]{1,200}$/u;

/**
 * Every picture address of an item in a text, by either scheme, the item's
 * id and the picture's; each step before them any run that holds no slash,
 * space, or parenthesis, bounded, so the scan stays linear over any text,
 * and the picture's id ends the address.
 */
const ADDRESS_IN_TEXT = new RegExp(
  `${LINK_HOME_PATTERN}\\/[^\\s/()]{1,200}\\/(?:plan|task|agent)\\/[^\\s/()]{1,200}\\/${INBOX_STEP}\\/([0-9a-f-]{36})\\/${FILES_STEP}\\/([0-9a-f-]{36})(?![\\w-])`,
  "gu",
);

/** The most characters an address is read from; past this no picture's address is that long. */
const MAX_ADDRESS_CHARS = 1_024;

/**
 * A picture in a message's words, `![alt](destination`, its opening
 * unescaped: the alt text the first group, the destination, bare or in
 * angle brackets, the second; each bounded, so the scan stays linear.
 */
export const INBOX_PICTURE_IN_WORDS =
  /(?<!\\)!\[((?:\\.|[^[\]\\\n]){0,1000})\]\([ \t]*(<[^<>\n]{1,1024}>|[^\s()<>]{1,1024})/gu;

/** A destination that names a scheme, `https:`, `data:`, or our own, and so no file in the agent's sandbox. */
const SCHEMED = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/** Where a run of spaces and tabs from the place given ends. */
function blanksEndAt(text: string, from: number): number {
  let at = from;
  while (text[at] === " " || text[at] === "\t") at += 1;
  return at;
}

/**
 * Where a picture closes, read on from its destination: past its caption in
 * double or single quotes, if any, and its closing parenthesis; nothing
 * where the words close it no way a picture closes. Note that it is a scan
 * rather than a regular expression, so it reads each character once.
 */
function pictureClosedAt(text: string, from: number): number | undefined {
  let at = blanksEndAt(text, from);
  const quote = text[at];
  if (quote === '"' || quote === "'") {
    at += 1;
    while (text[at] !== quote) {
      if (at >= text.length || text[at] === "\n") return undefined;
      at += text[at] === "\\" ? 2 : 1;
    }
    at = blanksEndAt(text, at + 1);
  }
  return text[at] === ")" ? at + 1 : undefined;
}

/** An item of the Inbox as its link names it: under its task, or under its agent. */
export type InboxItemPlace = Extract<
  LinkDestination,
  { readonly kind: typeof LINK_DESTINATION.INBOX_ITEM }
>;

/** One picture of one Inbox item. */
export interface InboxAttachmentRef {
  readonly itemId: string;
  readonly attachmentId: string;
}

/** The picture's address: the item's own link under the workspace given, its id after it. */
export function inboxAttachmentAddress(
  item: InboxItemPlace,
  attachmentId: string,
  workspace: string,
): string {
  return `${linkOf(item, workspace)}/${FILES_STEP}/${attachmentId}`;
}

/** The item's picture an address names, by either scheme; nothing for any other address, the item's own among them. */
export function inboxAttachmentOf(address: string): InboxAttachmentRef | undefined {
  const url = address.length > MAX_ADDRESS_CHARS ? undefined : parsedUrl(address);
  if (url === undefined || !isLinkHome(url)) return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  const [first, workspace, holder, holderId, inbox, itemId, files, attachmentId, ...rest] =
    url.pathname.split("/");
  const shaped =
    first === "" &&
    workspace !== undefined &&
    workspace !== "" &&
    holder !== undefined &&
    HOLDER_STEPS.has(holder) &&
    holderId !== undefined &&
    HOLDER_ID.test(holderId) &&
    inbox === INBOX_STEP &&
    files === FILES_STEP &&
    rest.length === 0;
  if (!shaped || itemId === undefined || attachmentId === undefined) return undefined;
  if (!UUID.test(itemId) || !UUID.test(attachmentId)) return undefined;
  return { itemId, attachmentId };
}

/** The ids of the item's own pictures a text names, in the order first named, each once. */
export function inboxAttachmentIdsIn(text: string, itemId: string): readonly string[] {
  const named = new Set<string>();
  for (const [, item, attachment] of text.matchAll(ADDRESS_IN_TEXT)) {
    if (item === itemId && attachment !== undefined && UUID.test(attachment)) named.add(attachment);
  }
  return [...named];
}

/** A picture's destination as the path or address it names, out of its angle brackets. */
export function inboxPictureDestination(destination: string): string {
  return destination.startsWith("<") ? destination.slice(1, -1) : destination;
}

/**
 * The path in the agent's sandbox of every picture its words draw from a
 * file there, in the order first drawn, each once: a destination that
 * names no scheme, read as the post's own write reads it, so a picture in
 * code is none.
 */
export function inboxSandboxPicturePaths(text: string): readonly string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(INBOX_PICTURE_IN_WORDS)) {
    const path = inboxPictureDestination(match[2] ?? "");
    if (path !== "" && !SCHEMED.test(path) && !insideCode(text, match.index)) paths.add(path);
  }
  return [...paths];
}

/**
 * The words with every picture drawn from a sandbox path the predicate
 * takes cut out whole, its alt, caption, and parentheses with it: a PDF a
 * post names as it draws a picture, which its message keeps as a file
 * rather than drawing. A picture in code, and one not closed as a picture
 * is, are left as written.
 */
export function withoutSandboxPictures(text: string, cut: (path: string) => boolean): string {
  let kept = "";
  let at = 0;
  for (const match of text.matchAll(INBOX_PICTURE_IN_WORDS)) {
    // A picture written inside the caption of one already cut out went with it.
    if (match.index < at) continue;
    const path = inboxPictureDestination(match[2] ?? "");
    const opened = match.index + match[0].length;
    const closed = pictureClosedAt(text, opened);
    if (SCHEMED.test(path) || insideCode(text, match.index) || closed === undefined || !cut(path)) {
      continue;
    }
    kept += text.slice(at, match.index);
    at = closed;
  }
  return kept + text.slice(at);
}
