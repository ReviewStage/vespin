// diagram-page.ts -- the sealed page a description's Mermaid diagrams are drawn in: its document, Mermaid inlined and nothing else reachable, what it is asked to draw, and what it answers.

import type { DiagramThemeVariables } from "@repo/features/mermaid-diagram";
import { Option, Schema } from "effect";

/** How many pixels each of a diagram's points is drawn in, so its picture stays sharp on the iPhone's and the iPad's screens. */
const DIAGRAM_SCALE = 3;

/** What the page answers: that it stands ready to draw, a fence drawn as its picture, or a fence Mermaid could not draw. */
export const DIAGRAM_ANSWER = {
  READY: "ready",
  DRAWN: "drawn",
  REFUSED: "refused",
} as const;

/** One fence the page is asked to draw: its number among the asks, its code, and Mermaid's colors. */
interface DiagramAsk {
  readonly id: number;
  readonly code: string;
  readonly theme: DiagramThemeVariables;
}

const answerSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(DIAGRAM_ANSWER.READY) }),
  Schema.Struct({
    kind: Schema.Literal(DIAGRAM_ANSWER.DRAWN),
    id: Schema.Number,
    picture: Schema.String,
    width: Schema.Number,
    height: Schema.Number,
  }),
  Schema.Struct({ kind: Schema.Literal(DIAGRAM_ANSWER.REFUSED), id: Schema.Number }),
]);

export type DiagramAnswer = typeof answerSchema.Type;

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(answerSchema));

/** The face a diagram's words are set in, the system's, as the words around it are. */
const FONT_FAMILY = "-apple-system, system-ui, sans-serif";

/** A label's size, as the description's words around a diagram are set. */
const FONT_SIZE = "14px";

/**
 * Nothing the page may reach: no address of any kind, its own inline
 * script and style alone, and pictures only from the `data:` addresses it
 * draws itself.
 */
const POLICY =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:";

/**
 * What the page runs once Mermaid stands: `vespinDraw`, which draws one
 * fence and answers its picture as a PNG. Note that labels are drawn as
 * the SVG's own text (`htmlLabels: false`), because a label drawn as HTML
 * in a `foreignObject` taints the canvas the picture is taken on, and a
 * tainted canvas answers no picture.
 */
const DRAW_SCRIPT = `
const answer = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));

window.vespinDraw = async (ask) => {
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      fontFamily: ${JSON.stringify(FONT_FAMILY)},
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      sequence: { mirrorActors: false },
      themeVariables: { ...ask.theme, background: "transparent", fontSize: ${JSON.stringify(FONT_SIZE)} },
    });

    if ((await mermaid.parse(ask.code, { suppressErrors: true })) === false) {
      answer({ kind: "${DIAGRAM_ANSWER.REFUSED}", id: ask.id });
      return;
    }

    const { svg } = await mermaid.render("diagram-" + ask.id, ask.code);
    const drawn = new DOMParser().parseFromString(svg, "text/html").body.firstElementChild;
    const [, , width, height] = (drawn.getAttribute("viewBox") || "").split(/[\\s,]+/).map(Number);

    if (!(width > 0 && height > 0)) throw new Error("A diagram with no size");
    drawn.setAttribute("width", String(width));
    drawn.setAttribute("height", String(height));
    const xml = new XMLSerializer().serializeToString(drawn);
    const bytes = new TextEncoder().encode(xml);
    let binary = "";

    for (const byte of bytes) binary += String.fromCharCode(byte);
    const image = new Image();
    image.src = "data:image/svg+xml;base64," + btoa(binary);
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * ${DIAGRAM_SCALE});
    canvas.height = Math.ceil(height * ${DIAGRAM_SCALE});
    const context = canvas.getContext("2d");
    context.scale(${DIAGRAM_SCALE}, ${DIAGRAM_SCALE});
    context.drawImage(image, 0, 0, width, height);
    answer({ kind: "${DIAGRAM_ANSWER.DRAWN}", id: ask.id, picture: canvas.toDataURL("image/png"), width, height });
  } catch {
    answer({ kind: "${DIAGRAM_ANSWER.REFUSED}", id: ask.id });
  }
};

answer({ kind: "${DIAGRAM_ANSWER.READY}" });
`;

/** Script text as it may stand inside a `<script>` element: no run of it closes the element early. */
function scriptText(source: string): string {
  return source.replace(/<\/(script)/giu, "<\\/$1");
}

/**
 * The sealed page diagrams are drawn in: Mermaid's own build, handed in as
 * `mermaidSource`, inlined with the drawing script, under a policy that
 * reaches nothing, so neither Mermaid nor a fence's words can load,
 * send, or open anything.
 */
export function diagramDocument(mermaidSource: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    "</head><body>",
    `<script>${scriptText(mermaidSource)}</script>`,
    `<script>${scriptText(DRAW_SCRIPT)}</script>`,
    "</body></html>",
  ].join("");
}

/** The script that asks the page to draw one fence. */
export function diagramAskScript(ask: DiagramAsk): string {
  return `window.vespinDraw(${JSON.stringify(ask)}); true;`;
}

/** What the page answered, read from its message; none for a message that is no answer. */
export function diagramAnswerOf(message: string): DiagramAnswer | undefined {
  return Option.getOrUndefined(decodeAnswer(message));
}
