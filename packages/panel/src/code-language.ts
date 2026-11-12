/**
 * code-language.ts -- a fenced block's language as a reader says it, by the name its header shows, wherever the window draws one: a transcript's code card, a note's, and the description's editor's frame; and the languages a block open in the editor may be set to.
 */

/** What a block whose fence names no language is labeled. */
const PLAIN_LANGUAGE = "text";

/** A language's name as a reader says it, by the extension its files are written with. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  rb: "Ruby",
  rs: "Rust",
  go: "Go",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  css: "CSS",
  html: "HTML",
  sql: "SQL",
  md: "Markdown",
  diff: "Diff",
};

/** The extension a language named in full is written with, which its name and file icon are found by. */
const LANGUAGE_EXTENSION: Readonly<Record<string, string>> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  shell: "sh",
  ruby: "rb",
  markdown: "md",
};

/** A fence's language, read as the extension its files are written with and the name a reader says it by, where this file has one. */
export function codeLanguage(language: string): {
  readonly id: string;
  readonly extension: string;
  readonly name: string | undefined;
} {
  const id = language.toLowerCase();
  const extension = LANGUAGE_EXTENSION[id] ?? id;

  return { id, extension, name: LANGUAGE_NAMES[extension] };
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
  ...Object.entries(LANGUAGE_NAMES)
    .filter(([, name], at, all) => all.findIndex(([, first]) => first === name) === at)
    .map(([id, name]) => ({ id, name })),
];

/** The choice a fence's language stands for, by its extension, so a fence written ```typescript stands checked as TypeScript; none for one this file names no choice for. */
export function codeLanguageChoice(language: string): CodeLanguageChoice | undefined {
  const { id, name } = codeLanguage(language);

  if (id === "") return CODE_LANGUAGE_CHOICES[0];

  return CODE_LANGUAGE_CHOICES.find((choice) => choice.id !== "" && choice.name === name);
}
