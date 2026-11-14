import { labelFill, PROVIDER_COLOR } from "@repo/features/label-fill";
import { Predicate } from "effect";
import type { CSSProperties, ReactNode } from "react";
import { cssCustomProperties } from "../../css.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { Badge as ShadcnBadge } from "../../shadcn/badge.js";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import type { VisuallyHiddenUnder } from "../visually-hidden/visually-hidden.js";

/**
 * badge.tsx -- a short word saying where something stands, in the state palette: working, needing you, done, merged, failed, or nothing in particular.
 *
 * The words are the badge, and the color says them again: a badge is never
 * a colored dot alone, so a reader, a screenshot in gray, and an eye that
 * cannot tell the inks apart all read the same state. A glyph may stand
 * before the words where one says the state too, in the tone's ink; a badge
 * in a tone without one leads its words with a dot of it. The badge stands
 * on the chip's own opaque face, its words in the text's ink, so they hold
 * their contrast on any ground behind it.
 *
 * A badge naming something a provider colors, a GitHub label, wears that
 * color as a dot before its words (`swatch`) rather than on them, because a
 * provider lets its color be anything, a dark one among them, which the
 * badge's words could not be read in. The color is six hex digits, the
 * spelling GitHub and Linear answer; any other is drawn in the muted ink.
 * Where the color is how a reader tells one from another, a pull request's
 * labels in its header, the badge is filled with it instead (`fill`), as
 * GitHub draws a label, in the inks `@repo/features/label-fill` reads from
 * the color for each appearance. A filled badge keeps its words
 * on one line, fading them out at their end where the row cuts them short,
 * in their own direction (`<bdi>`), and any other spelling draws it neutral.
 *
 * A badge may stand lit (`lit`), in the ink, as a pressed filter chip does:
 * the reader's own reaction where it cannot be pressed. In a narrow room
 * (`hideWordsUnder`) a badge gives its words up to a reader alone wherever
 * something else says its state in their place: its glyph, its swatch, or
 * its tone's dot.
 *
 * It is drawn by shadcn/ui's badge (`../../shadcn/badge.tsx`), whose tones
 * are this badge's, in the shared Tailwind theme; `badge.css` keeps what
 * utilities cannot say: the words given up under a room's width.
 */

/** The face a badge stands on: the chip's own, a provider's color, or the ink. */
const BADGE_FACE = {
  PLAIN: "plain",
  FILLED: "filled",
  LIT: "lit",
} as const;

/** A provider's color as a dot before the words, in the muted ink until the badge names one it can paint. */
const SWATCH = "ui-badge-swatch size-badge-swatch flex-none rounded-full bg-muted-foreground";

/** The fill, edge, and words a filled badge is drawn in, in each appearance (`labelFill`); none for a color it cannot paint. */
function fillColors(color: string): CSSProperties | undefined {
  const inks = labelFill(color);

  if (inks === undefined) return undefined;

  return cssCustomProperties({
    "--ui-badge-fill-light": inks.light.fill,
    "--ui-badge-edge-light": inks.light.edge,
    "--ui-badge-words-light": inks.light.words,
    "--ui-badge-fill-dark": inks.dark.fill,
    "--ui-badge-edge-dark": inks.dark.edge,
    "--ui-badge-words-dark": inks.dark.words,
  });
}

/** A filled badge's words, on one line in their own direction, ending in an ellipsis where the badge cuts them short. */
function FilledWords({ children }: { children: string }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.INHERIT}
      truncate
      className="ui-badge-line block"
      dir="auto"
    >
      {children}
    </Text>
  );
}

/** A state in `tone`, said by its words. */
export function Badge({
  tone = STATUS_TONE.NEUTRAL,
  icon,
  swatch,
  fill,
  lit = false,
  hideWordsUnder,
  replayMasked = false,
  children,
}: {
  tone?: StatusTone;
  /** A glyph before the words, saying the state again. */
  icon?: ReactNode;
  /** A provider's color for what the badge names, drawn as a dot before its words; any color but six hex digits is drawn muted. */
  swatch?: string | undefined;
  /** A provider's color the badge is filled with, its words on one line; any color but six hex digits draws it neutral. */
  fill?: string | undefined;
  /** Whether it stands in the ink, as a pressed filter chip does: the reader's own. */
  lit?: boolean;
  /** Give the words up, to a reader alone, once the room around the badge (a `ui-room` container) is narrower than this step; kept drawn where no `icon`, `swatch`, or tone's dot says the state in their place. */
  hideWordsUnder?: VisuallyHiddenUnder | undefined;
  /** Whether its words name a person's thing, a GitHub label or a branch, kept masked in a screen recording even under `ReplayUnmask`; a filled badge's words stay one string. */
  replayMasked?: boolean | undefined;
  /** The state's words, which the color only repeats; a filled badge's are one string. */
  children: ReactNode;
}): React.JSX.Element {
  const color = swatch === undefined ? undefined : PROVIDER_COLOR.exec(swatch)?.[1];
  const filled = fill === undefined ? undefined : fillColors(fill);
  const marked = icon != null || swatch !== undefined || tone !== STATUS_TONE.NEUTRAL;
  // Note that the tone's dot stands only where the words stand alone, because a glyph or a swatch already says the state.
  const toneDot = tone !== STATUS_TONE.NEUTRAL && icon == null && swatch === undefined;
  const face = lit ? BADGE_FACE.LIT : filled === undefined ? BADGE_FACE.PLAIN : BADGE_FACE.FILLED;

  return (
    <ShadcnBadge
      className={lit && filled !== undefined ? "ui-badge whitespace-nowrap" : "ui-badge"}
      variant={tone}
      face={face}
      dot={toneDot}
      data-tone={tone}
      data-fill={filled === undefined ? undefined : "true"}
      data-lit={lit ? "true" : undefined}
      style={filled}
    >
      {swatch === undefined ? null : (
        <span
          className={SWATCH}
          aria-hidden="true"
          style={color === undefined ? undefined : { background: `#${color}` }}
        />
      )}
      {icon}
      <span
        className="ui-badge-words min-w-0 wrap-break-word"
        data-under={marked ? hideWordsUnder : undefined}
      >
        <ReplayWords masked={replayMasked}>
          {filled !== undefined && Predicate.isString(children) ? (
            <FilledWords>{children}</FilledWords>
          ) : (
            children
          )}
        </ReplayWords>
      </span>
    </ShadcnBadge>
  );
}
