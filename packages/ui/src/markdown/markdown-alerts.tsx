/**
 * markdown-alerts.tsx -- GitHub's alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`): the step that marks a quote opening on one, and the callout it is drawn as.
 *
 * GitHub draws a quote whose first line is an alert's marker alone as a
 * callout of that kind: a colored rule, and a title naming the kind with its
 * glyph over the quote's words. The window draws one the same wherever
 * Markdown is drawn, a note's, a transcript's, and GitHub's own rendering of
 * a comment, which `@repo/ui/github-html` hands over as the quote it was
 * written as. The step runs after any sanitizer, so the kind it sets on the
 * quote (`ALERT_PROPERTY`) is never one a writer could set themselves.
 */

import { isWireString } from "@repo/wire";
import type { Element, ElementContent, Root } from "hast";
import type { ReactNode } from "react";
import {
  CircleAlert,
  Info,
  Lightbulb,
  type LucideIcon,
  MessageSquareWarning,
  TriangleAlert,
} from "../icons/icons.js";

/** The kinds of alert GitHub draws, by the word its marker names. */
export const ALERT_KIND = {
  NOTE: "note",
  TIP: "tip",
  IMPORTANT: "important",
  WARNING: "warning",
  CAUTION: "caution",
} as const;

export type AlertKind = (typeof ALERT_KIND)[keyof typeof ALERT_KIND];

/** The property the step sets on a quote it marks, its alert's kind. */
export const ALERT_PROPERTY = "dataAlert";

/** The marker an alert opens on, alone on its line, in any case, as GitHub reads it. */
const ALERT_MARKER = /^\s*\[!(note|tip|important|warning|caution)\][^\S\n]*(?:\n|$)/iu;

/** How an alert's kind is drawn: its title, and the glyph beside it. */
interface AlertFace {
  readonly title: string;
  readonly Glyph: LucideIcon;
}

/** Each kind's title and glyph, GitHub's own words and the glyphs nearest its own. */
const ALERT_FACE: Readonly<Record<AlertKind, AlertFace>> = {
  [ALERT_KIND.NOTE]: { title: "Note", Glyph: Info },
  [ALERT_KIND.TIP]: { title: "Tip", Glyph: Lightbulb },
  [ALERT_KIND.IMPORTANT]: { title: "Important", Glyph: MessageSquareWarning },
  [ALERT_KIND.WARNING]: { title: "Warning", Glyph: TriangleAlert },
  [ALERT_KIND.CAUTION]: { title: "Caution", Glyph: CircleAlert },
};

function isAlertKind(word: string): word is AlertKind {
  return Object.values(ALERT_KIND).some((kind) => kind === word);
}

/** Whether a node stands for nothing a reader sees: blank words, or a line break. */
function empty(node: ElementContent): boolean {
  if (node.type === "text") return node.value.trim() === "";

  return node.type === "element" && node.tagName === "br";
}

/** Whether a line ends where a node stands: at the paragraph's end, a line break, or words opening on a new line. */
function lineEndsAt(node: ElementContent | undefined): boolean {
  if (node === undefined) return true;

  if (node.type === "text") return node.value.startsWith("\n");

  return node.type === "element" && node.tagName === "br";
}

/**
 * The kind a quote's first paragraph names, with the marker taken out of it,
 * and the paragraph taken out where it held the marker alone; none where the
 * quote opens on no marker.
 */
function takeMarker(quote: Element): AlertKind | undefined {
  const first = quote.children.find((child) => !empty(child));

  if (first?.type !== "element" || first.tagName !== "p") return undefined;
  const words = first.children[0];

  if (words?.type !== "text") return undefined;
  const marker = ALERT_MARKER.exec(words.value);
  const kind = marker?.[1]?.toLowerCase();

  if (marker === null || kind === undefined || !isAlertKind(kind)) return undefined;

  // Note that a marker matched up to its words' own end stands alone only where nothing follows it on its line.
  if (!marker[0].endsWith("\n") && !lineEndsAt(first.children[1])) return undefined;
  words.value = words.value.slice(marker[0].length);

  // Note that a line break left after the marker would open the alert's words on an empty line.
  while (first.children[0] !== undefined && empty(first.children[0])) first.children.shift();

  if (first.children.length === 0) quote.children = quote.children.filter((each) => each !== first);

  return kind;
}

function markAlerts(holder: Root | Element): void {
  for (const child of holder.children) {
    if (child.type !== "element") continue;

    if (child.tagName === "blockquote") {
      const kind = takeMarker(child);

      if (kind !== undefined) child.properties = { ...child.properties, [ALERT_PROPERTY]: kind };
    }

    markAlerts(child);
  }
}

/** The rehype step that marks each quote opening on an alert's marker with its kind (`ALERT_PROPERTY`), the marker taken out. */
export const alertQuotes = () => (tree: Root) => markAlerts(tree);

/** The kind a drawn quote was marked with; none for a plain quote. */
export function alertKindOf(node: Element | undefined): AlertKind | undefined {
  const kind = node?.properties[ALERT_PROPERTY];

  return isWireString(kind) && isAlertKind(kind) ? kind : undefined;
}

/** An alert as GitHub draws one: its kind's rule and title with its glyph, over its words (`prose.css`). */
export function MarkdownAlert({
  kind,
  children,
}: {
  kind: AlertKind;
  children: ReactNode;
}): React.JSX.Element {
  const { title, Glyph } = ALERT_FACE[kind];

  return (
    <div className="ui-markdown-alert" data-kind={kind}>
      <p className="ui-markdown-alert-title">
        <Glyph aria-hidden="true" />
        {title}
      </p>
      {children}
    </div>
  );
}
