/**
 * draft-text.ts -- the words an agent writes to be sent elsewhere, read from their fence: a Slack message's marks and links, an email's subject, and each as the HTML and plain text a copy puts on the clipboard.
 *
 * An agent puts what the developer will send elsewhere in a fence named for
 * where it goes, and the window draws it as it will look there
 * (`DraftCard`):
 *
 * - ```slack, a Slack message in Slack's own mrkdwn: `*bold*`, `_italic_`,
 *   `~strike~`, `` `code` ``, and `<https://…|label>` or `<https://…>`
 *   links. A mark opens after a space, a punctuation mark, or the line's
 *   start, closes before one or the line's end, and never spans a line,
 *   as Slack reads it, so `snake_case_name` stays as it is; marks nest,
 *   and a code span holds its words as written.
 * - ```email, an email in plain text, whose first line, where it reads
 *   `Subject: …`, is its subject, the blank lines after it dropped.
 * - ```draft, plain text bound nowhere in particular.
 *
 * Every line break stands where the agent put it. A copy is the body
 * alone, as HTML (each mark its element, each link an anchor, each line
 * break a `<br>`) and as the plain words beside it, a link's address after
 * its label where the two differ, so it pastes into Slack or Mail with its
 * links and bold and into a plain field as readable words.
 */

/** Where a draft is bound, which is the name of the fence it is written in. */
export const DRAFT_KIND = {
  SLACK: "slack",
  EMAIL: "email",
  DRAFT: "draft",
} as const;

export type DraftKind = (typeof DRAFT_KIND)[keyof typeof DRAFT_KIND];

/** How a run of a Slack message is marked. */
export const DRAFT_MARK = {
  BOLD: "bold",
  ITALIC: "italic",
  STRIKE: "strike",
  CODE: "code",
} as const;

export type DraftMark = (typeof DRAFT_MARK)[keyof typeof DRAFT_MARK];

/** What a run of a draft is: words, words under a mark, or words going to an address. */
export const DRAFT_RUN = {
  TEXT: "text",
  MARK: "mark",
  LINK: "link",
} as const;

export type DraftRun =
  | { readonly kind: typeof DRAFT_RUN.TEXT; readonly text: string }
  | {
      readonly kind: typeof DRAFT_RUN.MARK;
      readonly mark: DraftMark;
      readonly runs: readonly DraftRun[];
    }
  | {
      readonly kind: typeof DRAFT_RUN.LINK;
      readonly url: string;
      readonly runs: readonly DraftRun[];
    };

/** A draft as read: where it is bound, an email's subject where it names one, and its body's runs. */
export interface Draft {
  readonly kind: DraftKind;
  readonly subject: string | undefined;
  readonly runs: readonly DraftRun[];
}

/** What a draft's copy puts on the clipboard: its body as HTML, and as plain words beside it. */
export interface DraftCopy {
  readonly html: string;
  readonly text: string;
}

/** The character each Slack mark is written between. */
const MARK_OF = {
  "*": DRAFT_MARK.BOLD,
  _: DRAFT_MARK.ITALIC,
  "~": DRAFT_MARK.STRIKE,
  "`": DRAFT_MARK.CODE,
} as const satisfies Record<string, DraftMark>;

/** The element each mark is copied as. */
const MARK_ELEMENT = {
  [DRAFT_MARK.BOLD]: "b",
  [DRAFT_MARK.ITALIC]: "i",
  [DRAFT_MARK.STRIKE]: "s",
  [DRAFT_MARK.CODE]: "code",
} as const satisfies Record<DraftMark, string>;

/** What an email's subject line opens with, in any case; only its first line may be one. */
const SUBJECT_LEAD = "subject:";

/** A Slack link: an address Slack opens, then its label after a bar where it has one. */
const SLACK_LINK = /^<((?:https?:\/\/|mailto:)[^|>\s]+)(?:\|([^>\n]*))?>/u;

/** A character a mark may open after or close before: anything but a letter or a digit. */
const BOUNDARY = /[^\p{L}\p{N}]/u;

/** Whether the character at `at` of `text` is a mark's edge: the text's end, or a boundary. */
function edgeAt(text: string, at: number): boolean {
  const character = text[at];
  return character === undefined || BOUNDARY.test(character);
}

/** Where the mark opened at `from` with `marker` closes on its line, or none where it never does. */
function closingOf(text: string, from: number, marker: string): number | undefined {
  const lineEnd = text.indexOf("\n", from);
  const end = lineEnd === -1 ? text.length : lineEnd;
  for (
    let at = text.indexOf(marker, from + 2);
    at !== -1 && at < end;
    at = text.indexOf(marker, at + 1)
  ) {
    const inner = text[at - 1];
    if (inner !== undefined && !/\s/u.test(inner) && edgeAt(text, at + 1)) return at;
  }
  return undefined;
}

/** Appends `text` to `runs`, joined to a run of words it follows. */
function pushText(runs: DraftRun[], text: string): void {
  const last = runs.at(-1);
  if (last?.kind === DRAFT_RUN.TEXT)
    runs[runs.length - 1] = { kind: DRAFT_RUN.TEXT, text: last.text + text };
  else if (text !== "") runs.push({ kind: DRAFT_RUN.TEXT, text });
}

/** A Slack message's runs, its marks and links read as Slack reads them. */
function slackRuns(text: string): DraftRun[] {
  const runs: DraftRun[] = [];
  let at = 0;
  while (at < text.length) {
    const character = text[at] ?? "";
    const link = character === "<" ? SLACK_LINK.exec(text.slice(at)) : null;
    if (link !== null) {
      const [whole, url = "", label] = link;
      const words = label === undefined || label === "" ? url : label;
      runs.push({ kind: DRAFT_RUN.LINK, url, runs: slackRuns(words) });
      at += whole.length;
      continue;
    }
    const mark = Object.hasOwn(MARK_OF, character)
      ? MARK_OF[character as keyof typeof MARK_OF]
      : undefined;
    const opens =
      mark !== undefined && (at === 0 || edgeAt(text, at - 1)) && !/\s/u.test(text[at + 1] ?? " ");
    const closes = opens ? closingOf(text, at, character) : undefined;
    if (mark === undefined || closes === undefined) {
      pushText(runs, character);
      at += 1;
      continue;
    }
    const inner = text.slice(at + 1, closes);
    runs.push({
      kind: DRAFT_RUN.MARK,
      mark,
      runs: mark === DRAFT_MARK.CODE ? [{ kind: DRAFT_RUN.TEXT, text: inner }] : slackRuns(inner),
    });
    at = closes + 1;
  }
  return runs;
}

/** Escapes words for HTML. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Runs as HTML, each line break a `<br>`. */
function runsHtml(runs: readonly DraftRun[]): string {
  return runs
    .map((run) => {
      if (run.kind === DRAFT_RUN.TEXT) return escapeHtml(run.text).replaceAll("\n", "<br>");
      if (run.kind === DRAFT_RUN.LINK)
        return `<a href="${escapeHtml(run.url)}">${runsHtml(run.runs)}</a>`;
      const element = MARK_ELEMENT[run.mark];
      return `<${element}>${runsHtml(run.runs)}</${element}>`;
    })
    .join("");
}

/** Runs as plain words, a link's address after its label where the two differ. */
function runsText(runs: readonly DraftRun[]): string {
  return runs
    .map((run) => {
      if (run.kind === DRAFT_RUN.TEXT) return run.text;
      const words = runsText(run.runs);
      if (run.kind === DRAFT_RUN.MARK || words === run.url) return words;
      return `${words} (${run.url})`;
    })
    .join("");
}

/** The draft kind a fence's language names, or none for any other fence. */
export function draftKindOf(language: string): DraftKind | undefined {
  return Object.values(DRAFT_KIND).find((kind) => kind === language);
}

/** A draft's fenced words, read for where they are bound. */
export function readDraft(kind: DraftKind, text: string): Draft {
  if (kind === DRAFT_KIND.SLACK) return { kind, subject: undefined, runs: slackRuns(text) };
  const [first = "", ...rest] = text.split("\n");
  const subject =
    kind === DRAFT_KIND.EMAIL && first.toLowerCase().startsWith(SUBJECT_LEAD)
      ? first.slice(SUBJECT_LEAD.length).trim()
      : undefined;
  // Note that the blank lines after a subject are dropped line by line, since a pattern over them would backtrack on a long run of spaces.
  const blank = rest.findIndex((line) => line.trim() !== "");
  const body =
    subject === undefined ? text : rest.slice(blank === -1 ? rest.length : blank).join("\n");
  return { kind, subject, runs: body === "" ? [] : [{ kind: DRAFT_RUN.TEXT, text: body }] };
}

/** What a draft's copy puts on the clipboard: its body, as HTML and as plain words. */
export function draftCopy(draft: Draft): DraftCopy {
  return { html: runsHtml(draft.runs), text: runsText(draft.runs) };
}
