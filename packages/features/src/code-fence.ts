/**
 * code-fence.ts -- a fenced block as every client reads it: its language as a reader says it, by the name its header shows (a transcript's code card, a note's, the description's editor's frame, and the iOS app's block of code); the languages a block open in the editor may be set to; and the lines of a suggested change or a diff as rows tinted by what each does.
 */

/** What a block whose fence names no language is labeled. */
const PLAIN_LANGUAGE = "text";

/** A language's name as a reader says it, by the extension its files are written with. */
const LANGUAGE_NAMES: ReadonlyMap<string, string> = new Map([
  ["ts", "TypeScript"],
  ["tsx", "TypeScript"],
  ["js", "JavaScript"],
  ["jsx", "JavaScript"],
  ["py", "Python"],
  ["sh", "Shell"],
  ["bash", "Shell"],
  ["zsh", "Shell"],
  ["rb", "Ruby"],
  ["rs", "Rust"],
  ["go", "Go"],
  ["json", "JSON"],
  ["yaml", "YAML"],
  ["yml", "YAML"],
  ["css", "CSS"],
  ["html", "HTML"],
  ["sql", "SQL"],
  ["md", "Markdown"],
  ["diff", "Diff"],
]);

/** The extension a language named in full is written with, which its name and file icon are found by. */
const LANGUAGE_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["typescript", "ts"],
  ["javascript", "js"],
  ["python", "py"],
  ["rust", "rs"],
  ["shell", "sh"],
  ["ruby", "rb"],
  ["markdown", "md"],
]);

type CodeLanguageResult = {
  readonly id: string;
  readonly extension: string;
  readonly name: string | undefined;
};

/** A fence's language, read as the extension its files are written with and the name a reader says it by, where this file has one. */
export function codeLanguage(language: string): CodeLanguageResult {
  const id = language.toLowerCase();
  const extension = LANGUAGE_EXTENSION.get(id) ?? id;

  return { id, extension, name: LANGUAGE_NAMES.get(extension) };
}

/** What a fence's header calls its language: its name ("TypeScript"), its id where it has none here, and "text" for a fence that names none. */
export function codeTitle(language: string): string {
  const { id, name } = codeLanguage(language);

  return name ?? (id === "" ? PLAIN_LANGUAGE : id);
}

/** A language a block open in the editor may be set to: the id its fence is written with, and the name its header shows. */
export interface CodeLanguageChoice {
  readonly id: string;
  readonly name: string;
}

/** What the choice of no language is called, which a fence writes as none. */
const PLAIN_CHOICE_NAME = "Plain text";

/**
 * The languages a block may be set to: none first, then each language this
 * file names once, by the first extension it is written with, in the order
 * named above.
 */
export const CODE_LANGUAGE_CHOICES: readonly CodeLanguageChoice[] = [
  { id: "", name: PLAIN_CHOICE_NAME },
  ...[...LANGUAGE_NAMES].flatMap(([id, name], at, all) =>
    all.findIndex(([, first]) => first === name) === at ? [{ id, name }] : [],
  ),
];

/** The choice a fence's language stands for, by its extension, so a fence written ```typescript stands checked as TypeScript; none for one this file names no choice for. */
export function codeLanguageChoice(language: string): CodeLanguageChoice | undefined {
  const { id, name } = codeLanguage(language);

  if (id === "") return CODE_LANGUAGE_CHOICES[0];

  return CODE_LANGUAGE_CHOICES.find((choice) => choice.id !== "" && choice.name === name);
}

/** The language a suggestion is written in, a change suggested to the lines a review comment is on, its lines the new ones alone. */
export const SUGGESTION_LANGUAGE = "suggestion";

/**
 * The language a suggested change GitHub rendered is fenced as, its lines
 * marked `-` and `+` (`@repo/ui/github-html`). Note that it is not
 * `suggestion`, whose lines may start with either mark as words of their
 * own, as a list's do.
 */
export const SUGGESTED_CHANGE_LANGUAGE = "suggested-change";

/** The language a diff is fenced in, whose rows are tinted by what they do. */
export const DIFF_LANGUAGE = "diff";

/** What a suggestion's block is headed, as GitHub heads one. */
const SUGGESTION_TITLE = "Suggested change";

/** A diff's file header, `--- a/path` or `+++ b/path`: three marks, then a space or nothing. */
const DIFF_HEADER = /^(?:---|\+\+\+)(?:\s|$)/u;

/** What a line of a block drawn as rows does, which tints it: a line added, one removed, or one standing as it was. */
export const CODE_ROW = {
  ADDED: "added",
  REMOVED: "removed",
  CONTEXT: "context",
} as const;

export type CodeRow = (typeof CODE_ROW)[keyof typeof CODE_ROW];

/** A row of a block drawn as rows: what it does, and the words it shows. */
export interface FenceRow {
  readonly kind: CodeRow;
  readonly text: string;
}

/** Whether a block fenced in `language` is a change suggested to a review comment's lines: one written ```suggestion, or one GitHub rendered. */
export function suggests(language: string): boolean {
  return language === SUGGESTION_LANGUAGE || language === SUGGESTED_CHANGE_LANGUAGE;
}

/** What a fence's header calls it: a suggestion "Suggested change", as GitHub heads one, and any other by its language (`codeTitle`). */
export function fenceTitle(language: string): string {
  return suggests(language) ? SUGGESTION_TITLE : codeTitle(language);
}

/** A diff's line as its row: its file header and its unchanged lines as they stood, and each line it adds or removes tinted so. */
function diffRow(text: string): FenceRow {
  if (DIFF_HEADER.test(text)) return { kind: CODE_ROW.CONTEXT, text };

  if (text.startsWith("-")) return { kind: CODE_ROW.REMOVED, text };

  return { kind: text.startsWith("+") ? CODE_ROW.ADDED : CODE_ROW.CONTEXT, text };
}

/**
 * A block's lines as rows tinted by what each does, or none for a block of
 * plain lines. A suggestion as written holds the new lines alone, every one
 * added; a suggested change GitHub rendered marks each line `-` or `+`,
 * which the row stands for in its mark's place, as GitHub draws one; a
 * diff's lines keep their marks, and its other lines stand untinted.
 */
export function fenceRows(language: string, code: string): readonly FenceRow[] | undefined {
  const lines = code.split("\n");

  if (language === SUGGESTION_LANGUAGE)
    return lines.map((text) => ({ kind: CODE_ROW.ADDED, text }));

  if (language === SUGGESTED_CHANGE_LANGUAGE) {
    return lines.map((line) => ({
      kind: line.startsWith("-") ? CODE_ROW.REMOVED : CODE_ROW.ADDED,
      text: line.slice(1),
    }));
  }

  return language === DIFF_LANGUAGE ? lines.map(diffRow) : undefined;
}

/** The words of the rows added, which is what a suggestion copies. */
export function addedText(rows: readonly FenceRow[]): string {
  return rows.flatMap((row) => (row.kind === CODE_ROW.ADDED ? [row.text] : [])).join("\n");
}
