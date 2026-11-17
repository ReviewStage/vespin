// mermaid-diagram.ts -- a Mermaid fence as every surface draws it: the language that names one, the words its card says, what its picture is heard as, and the palette's roles it is colored in.

/** The language a code block names to be drawn as its diagram. */
export const DIAGRAM_LANGUAGE = "mermaid";

/** The words a diagram's card says: its head, and its toggle between the picture and its code. */
export const DIAGRAM_WORDS = {
  HEAD: "Diagram",
  SHOW_CODE: "Show code",
  SHOW_DIAGRAM: "Show diagram",
} as const;

/** How much of a title or first line an alt text keeps, so a long one does not read out whole. */
const ALT_LIMIT = 80;

/** The front matter a Mermaid code may open with: its settings between two `---` fences, which name nothing of the diagram but a `title`. */
const FRONT_MATTER = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/u;

/** The title a front matter names (`title: Order flow`), a top-level key. */
const FRONT_TITLE = /^title:[ \t]*(.+?)[ \t]*$/mu;

/** A title a diagram's own lines name, as a line of its own or after the diagram's kind (`title Votes`, `pie title Votes`). */
const BODY_TITLE = /^[ \t]*(?:\w+[ \t]+)?title[ \t]+(.+?)[ \t]*$/mu;

/** A line of Mermaid code that names nothing of the diagram: blank or a comment. */
const SILENT_LINE = /^\s*(?:%%.*)?\s*$/u;

/**
 * The palette's roles a diagram draws in: the ground it stands on, the
 * words, the lines and arrows, a box's face and what is raised off one (a
 * note, a label on a line), a box's edge, and a group and its edge.
 */
export const DIAGRAM_ROLE = {
  GROUND: "ground",
  WORDS: "words",
  LINES: "lines",
  BOX: "box",
  RAISED: "raised",
  EDGE: "edge",
  GROUP: "group",
  GROUP_EDGE: "groupEdge",
} as const;

export type DiagramRole = (typeof DIAGRAM_ROLE)[keyof typeof DIAGRAM_ROLE];

/**
 * Each color Mermaid is handed, by the role it is drawn in: the primary ink
 * for words, the secondary ink for lines and arrows, a chip's face for a box
 * and its hover step for what is raised off one, a chip's strong edge for a
 * box's, and a well for a group.
 */
const MERMAID_ROLE = {
  primaryColor: DIAGRAM_ROLE.BOX,
  primaryBorderColor: DIAGRAM_ROLE.EDGE,
  primaryTextColor: DIAGRAM_ROLE.WORDS,
  secondaryColor: DIAGRAM_ROLE.RAISED,
  tertiaryColor: DIAGRAM_ROLE.RAISED,
  lineColor: DIAGRAM_ROLE.LINES,
  textColor: DIAGRAM_ROLE.WORDS,
  actorBkg: DIAGRAM_ROLE.BOX,
  actorBorder: DIAGRAM_ROLE.EDGE,
  actorTextColor: DIAGRAM_ROLE.WORDS,
  signalColor: DIAGRAM_ROLE.LINES,
  signalTextColor: DIAGRAM_ROLE.WORDS,
  noteBkgColor: DIAGRAM_ROLE.RAISED,
  noteBorderColor: DIAGRAM_ROLE.EDGE,
  noteTextColor: DIAGRAM_ROLE.WORDS,
  edgeLabelBackground: DIAGRAM_ROLE.RAISED,
  clusterBkg: DIAGRAM_ROLE.GROUP,
  clusterBorder: DIAGRAM_ROLE.GROUP_EDGE,
} as const satisfies Record<string, DiagramRole>;

/** Mermaid's theme variables in an appearance: a role's color where the palette reaches it. */
export type DiagramThemeVariables = { readonly darkMode: boolean } & Partial<
  Record<keyof typeof MERMAID_ROLE, string>
>;

/** The words kept of a title or first line, cut at the limit with an ellipsis. */
function altWords(line: string): string {
  const words = line.replace(/^["']|["']$/gu, "").trim();

  return words.length > ALT_LIMIT ? `${words.slice(0, ALT_LIMIT).trimEnd()}…` : words;
}

/** What a diagram's picture says it is, and what its press is named for after "Enlarge": its title, or its first line, after "Diagram". */
export function diagramAlt(code: string): string {
  const front = FRONT_MATTER.exec(code);
  const body = front === null ? code : code.slice(front[0].length);
  const title = FRONT_TITLE.exec(front?.[1] ?? "")?.[1] ?? BODY_TITLE.exec(body)?.[1];
  const first = body.split("\n").find((line) => !SILENT_LINE.test(line));
  const words = altWords(title ?? first ?? "");

  return words === "" ? DIAGRAM_WORDS.HEAD : `${DIAGRAM_WORDS.HEAD}: ${words}`;
}

/**
 * Mermaid's colors, each its role's as `colorOf` reads it, opaque, in the
 * sRGB form Mermaid parses (`#rrggbb`); a role `colorOf` does not reach is
 * left out, and Mermaid keeps its own for it.
 */
export function diagramThemeVariablesOf(
  colorOf: (role: DiagramRole) => string | undefined,
  dark: boolean,
): DiagramThemeVariables {
  const colors = Object.entries(MERMAID_ROLE).flatMap(([name, role]) => {
    const color = colorOf(role);

    return color === undefined ? [] : [[name, color]];
  });

  return { ...Object.fromEntries(colors), darkMode: dark };
}
