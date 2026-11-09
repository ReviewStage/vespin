import {
  type ComponentType,
  type FocusEvent,
  type FocusEventHandler,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  useRef,
} from "react";
import { middlePressOf } from "../../middle-press.js";
import { pulseOnPress } from "../../press-pulse.js";
import { useLinkAddress } from "../menu/link-address.js";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_TRUNCATE, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";
import { INLINE_REF_FIT, type InlineRefFit, useInlineRefFit } from "./inline-ref-fit.js";

/**
 * inline-ref.tsx -- a thing named inside a line of words: its glyph, its name, and where it stands, as one target that hangs its card and, where it can, opens it.
 *
 * An agent, a person, a file, a skill, or a mention is named in place many
 * ways across a window, and each is the same token: a glyph that says what
 * kind of thing it is, the name it goes by, and after the name a quiet word
 * on where it stands (an issue's "Open", a file's lines). Handed `onPress` it
 * is a button, or a link where its press leaves the app for an address
 * (`leaves`); otherwise its press is the line's own, and it is words that
 * hang a card alone, which take the focus so the keyboard reaches the card.
 * A subject that is gone keeps its name, struck through. Its glyph is hidden
 * from a screen reader, which hears its kind in words before its name
 * (`kind`) and that it is gone after it.
 *
 * Its look is chosen by the place it stands (`INLINE_REF_LOOK`): words in
 * the line's own ink whose name underlines under the pointer as a link's
 * does, words that wash under the pointer as a byline's actor does, or a
 * pill on a raised fill as a mention is drawn in prose. An inert pill on a
 * row that is itself a button lifts with that row's hover, since its fill
 * is the row's hover fill.
 *
 * How it takes its line is chosen by the place too (`INLINE_REF_FIT`),
 * handed to the token or to every token under a surface at once
 * (`InlineRefFitScope`), since the same chip stands in an agent's words and
 * in a one-line row of them. In running words it wraps across lines as they do, its fill and corners
 * carried onto each line it stands on, breaking only inside its name, so
 * its glyph keeps to the name's first word and its standing to its last, and
 * a one-word name with them never parts, nor a short name kept whole (a date,
 * a pull request's key), and it is read whole: no cap and no
 * ellipsis, since a name cut short in a sentence says less than the
 * sentence does. In a slot one line tall, a row's, a byline's, or a head's,
 * it keeps to one line and its name gives way before anything else, fading
 * out at its end, or for a path cut at its start, so a file's own name
 * stays in sight; a token whose place says neither keeps to one line. Note that a token that wraps and presses is a `span` in a
 * button's role rather than a `button`, because a browser draws a button as
 * one box that never breaks across lines.
 *
 * What is drawn here is the token. Its hint, the pill or card hung while the
 * pointer rests on it and when that shows and goes, is the window's tooltip
 * (`Tooltip`, `hint.tsx`), or one the caller hangs in its place (`hint`):
 * it is handed the words and the card and wraps the token, which takes what
 * the hint hands it on its own root.
 *
 * It is drawn in the Tailwind theme's utilities, its metrics in em, since it
 * stands in prose of any size, and never making its line taller than a line
 * of words: its name alone sits on the words' baseline (a flex box takes its
 * baseline from the items that are, and otherwise from its glyph, whose
 * baseline is its bottom edge), and a pill stands proud of the name on
 * padding its margins take back. A wash bleeds by a ring of its own color
 * rather than padding, so the words around it keep their spacing, which a
 * box cutting the words right around it leaves room for (`inline-ref.css`)
 * rather than cutting it square, and hands the wash on
 * (`--ui-inline-ref-wash`) for a mark inside that rings itself in the
 * ground.
 */

/** How a token is drawn, by the place it stands. */
export const INLINE_REF_LOOK = {
  /** Words in the line's ink; a button's name underlines under the pointer. */
  LINK: "link",
  /** Words in the line's ink that wash under the pointer, a byline's. */
  WASH: "wash",
  /** A pill on a raised fill, a mention's in prose. */
  PILL: "pill",
} as const;

export type InlineRefLook = (typeof INLINE_REF_LOOK)[keyof typeof INLINE_REF_LOOK];

/** What a token's name is, which says how it is set and where a long one is cut. */
export const INLINE_REF_NAME = {
  /** A name, cut at its end. */
  NAME: "name",
  /** A path, in the code face and cut at its start, so its last part stays in sight. */
  PATH: "path",
  /** A short name kept whole with its glyph and its standing, never wrapped: a date, a pull request's key. */
  WHOLE: "whole",
} as const;

export type InlineRefName = (typeof INLINE_REF_NAME)[keyof typeof INLINE_REF_NAME];

/** What a hint hands the token it wraps: when to show and go, and what it says of the token. */
export interface InlineRefHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/** The hint an app hangs from a token: `label` in a pill, or `card` where the place hands one. */
export type InlineRefHint = ComponentType<{
  label: string;
  card: ReactNode;
  children: ReactElement<InlineRefHintProps>;
}>;

/** A `data-` attribute a place names its token by. */
type DataAttributes = { readonly [name: `data-${string}`]: string | undefined };

/** What a token says and does, beside how it is drawn. */
interface InlineRefFace {
  look: InlineRefLook;
  /** How it takes its line, where its place says: wrapping in running words, or kept to one line; the surface's (`InlineRefFitScope`) where none is said, and one line where neither says. */
  fit?: InlineRefFit | undefined;
  /** The mark of what kind of thing it names, before the name; hidden from a screen reader, which hears `kind` in its place. */
  glyph?: ReactNode;
  /** What kind of thing it names, in words a screen reader hears before the name and nothing draws: "pull request". */
  kind?: string | undefined;
  /** The name it goes by. */
  label: string;
  /** What the name is: a name, a path cut at its start, or a short name kept whole. */
  name?: InlineRefName;
  /** Whether the name is drawn nowhere and said to a screen reader alone, for a line too short to hold it. */
  labelHidden?: boolean;
  /** Where it stands, after its name, never cut: an issue's state, a file's lines. */
  state?: ReactNode;
  /** Words a screen reader hears after the name, which nothing draws. */
  heard?: string | undefined;
  /** Whether what it names is gone: its name stays, struck through, and a screen reader hears that it is gone. */
  gone?: boolean;
  /** Opens what it names; without it the token is words whose press is the line's. */
  onPress?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  /** What a reader is told its press does, where its name alone would not say: "Open src/app.ts, lines 4–9". */
  pressLabel?: string | undefined;
  /** The address its press opens, where it opens one, which a right-click offers as a link's (`useLinkAddress`). */
  linkHref?: string | undefined;
  /** Whether its press leaves the app for `linkHref`, which draws it as a link to that address rather than a button. */
  leaves?: boolean | undefined;
}

/** What every token is drawn with: one target, its words the line's own. */
const ROOT = "ui-inline-ref p-0 border-0 text-left [font:inherit] no-underline";

/**
 * How a token takes its line: wrapping as words do, each line's piece drawn
 * as if it were the whole, so a fill and its corners stand on every line; or
 * one row that never outgrows its column. Note that a token that wraps does
 * not wrap between its own parts, only inside its name (`labelClass`),
 * because a browser may always break beside a glyph's box, which would leave
 * the glyph alone at a line's end and `#42 Open` on the next.
 */
const FIT_ROOT = {
  [INLINE_REF_FIT.FLOW]: "inline whitespace-nowrap wrap-break-word box-decoration-clone",
  [INLINE_REF_FIT.LINE]:
    "inline-flex min-w-0 max-w-full items-center align-baseline whitespace-nowrap",
} as const satisfies Record<InlineRefFit, string>;

/** The gap each look keeps between its glyph, its name, and its standing: a row's gap where it is one line, and a margin on either side of the name where it wraps, which no gap reaches. */
const LOOK_GAP = {
  [INLINE_REF_LOOK.LINK]: { row: "gap-icon-gap", glyph: "me-icon-gap", state: "ms-icon-gap" },
  [INLINE_REF_LOOK.WASH]: { row: "gap-ui-4", glyph: "me-ui-4", state: "ms-ui-4" },
  [INLINE_REF_LOOK.PILL]: { row: "gap-ui-4", glyph: "me-ui-4", state: "ms-ui-4" },
} as const satisfies Record<InlineRefLook, { row: string; glyph: string; state: string }>;

/** Each look's own box and ink at rest, a pill's type asked on its look so it outranks the line's own font the root takes. Note that a wash's name stands at least a 16px mark's height, so a mark beside it stays centered on it. */
const LOOK_ROOT = {
  [INLINE_REF_LOOK.LINK]: "bg-transparent",
  [INLINE_REF_LOOK.WASH]:
    "rounded-ui-6 bg-transparent transition-[background-color,box-shadow,color] duration-(--ui-duration-hover) ease-motion-exit hover:bg-muted hover:text-foreground hover:shadow-inline-ref-wash hover:[--ui-inline-ref-wash:var(--ui-color-fill-hover)]",
  [INLINE_REF_LOOK.PILL]:
    "-my-[0.075em] rounded-ui-6 py-[0.075em] pr-ui-6 pl-ui-4 text-foreground data-[look=pill]:leading-[1.2] data-[look=pill]:font-tag transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit",
} as const satisfies Record<InlineRefLook, string>;

/** How a token's root is drawn: how it takes its line, its look, its ink, a pointer where it presses, and a pill's fill lifting under the pointer or the keyboard, or with the row it stands inert in, unless what it names is gone. */
function rootClass({
  look,
  fit,
  gone,
  pressable,
  leaving,
}: {
  look: InlineRefLook;
  fit: InlineRefFit;
  gone: boolean;
  pressable: boolean;
  /** Whether it is a link to another site, which keeps the pointing hand a control gives up on the desktop. */
  leaving: boolean;
}): string {
  const pill = look === INLINE_REF_LOOK.PILL;
  const parts: string[] = [ROOT, FIT_ROOT[fit], LOOK_ROOT[look]];
  if (fit === INLINE_REF_FIT.LINE) parts.push(LOOK_GAP[look].row);
  if (!pill) parts.push(gone ? "text-muted-foreground" : "text-inherit");
  if (pressable) parts.push(leaving ? "cursor-link" : "cursor-press");
  if (pill) {
    if (gone) parts.push("bg-transparent inset-ring inset-ring-border-strong");
    else if (pressable)
      parts.push("bg-fill-strong hover:bg-fill-selected focus-visible:bg-fill-selected");
    // Note that the lift is what keeps an inert pill seen on a row that is itself a press, because its resting fill is the row's hover fill.
    else
      parts.push(
        "bg-fill-strong [@media(hover:hover)]:in-[:is(button,summary):hover]:bg-fill-selected in-[:is(button,summary):focus-visible]:bg-fill-selected",
      );
  }
  return parts.join(" ");
}

/**
 * A token's glyph, centered in a box the line's size; a pill's in the muted
 * ink. Note that a pill's box is a line of words tall and at least as wide,
 * and a mark drawn at its own size (an agent's 16px tile, a pull request's
 * 12px mark) stands centered on it, spilling evenly above and below rather
 * than hanging from its corner, and widens it, so its name keeps its gap.
 * Where the token wraps, the glyph's box is a line of words tall in every
 * look and sits a little under the baseline, as an icon set in words does,
 * so its middle meets the middle of the letters beside it.
 */
function glyphClass(look: InlineRefLook, fit: InlineRefFit): string {
  const parts = [
    "ui-inline-ref-glyph inline-flex flex-none items-center justify-center empty:hidden [&>svg]:size-[1em]",
  ];
  const pill = look === INLINE_REF_LOOK.PILL;
  if (fit === INLINE_REF_FIT.FLOW || pill) parts.push("h-[1em]");
  if (fit === INLINE_REF_FIT.FLOW) parts.push(`align-[-0.125em] ${LOOK_GAP[look].glyph}`);
  if (pill) parts.push("min-w-[1em] text-muted-foreground");
  return parts.join(" ");
}

/** How a wrapping token's name breaks, by what it is. */
const FLOW_NAME_WRAP = {
  [INLINE_REF_NAME.NAME]: "whitespace-normal wrap-break-word",
  [INLINE_REF_NAME.PATH]: "whitespace-normal wrap-anywhere",
  [INLINE_REF_NAME.WHOLE]: "wrap-normal",
} as const satisfies Record<InlineRefName, string>;

/**
 * A token's name, alone on the words' baseline where it is one line: struck
 * through where gone, a link's name underlined under the pointer, a wash's at
 * least a mark tall, and where it wraps, the one part of the token that
 * breaks, unless it is kept whole. Note that a name breaks a word only where
 * the word cannot fit a line (`wrap-break-word`), never to make its column
 * narrower, because a table cell shrinks to one letter of a name that may
 * break anywhere; a path, which holds no spaces, breaks anywhere.
 */
function labelClass({
  look,
  fit,
  name,
  gone,
  pressable,
}: {
  look: InlineRefLook;
  fit: InlineRefFit;
  name: InlineRefName;
  gone: boolean;
  pressable: boolean;
}): string {
  const parts = ["ui-inline-ref-label"];
  if (fit === INLINE_REF_FIT.LINE) parts.push("self-baseline");
  else parts.push(FLOW_NAME_WRAP[name]);
  if (gone) parts.push("line-through");
  if (look === INLINE_REF_LOOK.LINK && pressable) {
    parts.push("group-hover/inline-ref:underline group-hover/inline-ref:underline-offset-2");
  }
  if (look === INLINE_REF_LOOK.WASH) parts.push("py-inline-ref-mark");
  return parts.join(" ");
}

/** Where a token stands, after its name, never cut or broken; a pill's set off by a hairline. */
function stateClass(look: InlineRefLook, fit: InlineRefFit): string {
  const state = `ui-inline-ref-state whitespace-nowrap text-muted-foreground ${
    fit === INLINE_REF_FIT.LINE ? "flex-none self-baseline" : LOOK_GAP[look].state
  }`;
  return look === INLINE_REF_LOOK.PILL
    ? `${state} border-l border-border-strong pl-ui-4 font-caption`
    : state;
}

/** U+200E, which sets what follows it left to right without isolating it. */
const LEFT_TO_RIGHT_MARK = "\u200E";

/** What a screen reader hears after a gone subject's name, which its strike-through says to the eye alone. */
const GONE_HEARD = " (gone)";

/** The controls an inert token may stand inside, whose own focus is the token's, so it takes none of its own. */
const CONTROL_ROOTS =
  "button, a[href], summary, [role='button'], [role='link'], [role='option'], [role='menuitem'], [role='tab']";

/**
 * Lets an inert token that hangs a card take the focus, so the keyboard
 * shows its card (`hint.tsx`), unless it stands inside a control,
 * whose focus is the token's already and which holds no control within.
 * Note that this reads the token's place once it is drawn, because nothing
 * before it says what the token stands in.
 */
function focusUnlessInControl(element: HTMLElement | null): void {
  if (element === null) return;
  const control = element.parentElement?.closest(CONTROL_ROOTS) ?? null;
  if (control === null) element.tabIndex = 0;
  else element.removeAttribute("tabindex");
}

/** Takes from a token that no longer hangs a card the focus it took. */
function noFocus(element: HTMLElement | null): void {
  element?.removeAttribute("tabindex");
}

/**
 * The keys a button answers, for a span in a button's role, each pressing it
 * as a click does: Enter as it goes down, and Space once as it is let go, as
 * a button's does, never again while it is held and not at all once the
 * focus leaves first; neither scrolls the page. The blur a hint hands the
 * token is still heard.
 */
function useButtonKeys(onBlur: FocusEventHandler<HTMLElement> | undefined): {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (event: KeyboardEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
} {
  const spaceHeld = useRef(false);
  return {
    onKeyDown: (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.key === "Enter") event.currentTarget.click();
      else if (!event.repeat) spaceHeld.current = true;
    },
    onKeyUp: (event) => {
      if (event.key !== " " || !spaceHeld.current) return;
      event.preventDefault();
      spaceHeld.current = false;
      event.currentTarget.click();
    },
    onBlur: (event) => {
      spaceHeld.current = false;
      onBlur?.(event);
    },
  };
}

/** The token itself, which takes what a hint hands it on its root. */
function InlineRefRoot({
  look,
  fit: ownFit,
  glyph,
  kind,
  label,
  name = INLINE_REF_NAME.NAME,
  labelHidden = false,
  state,
  heard,
  gone = false,
  onPress,
  pressLabel,
  linkHref,
  leaves = false,
  carded,
  ...rest
}: InlineRefFace &
  InlineRefHintProps &
  DataAttributes & {
    /** Whether it hangs a card, which an inert token takes the focus for. */
    carded: boolean;
  }): React.JSX.Element {
  const linkAddress = useLinkAddress(linkHref);
  const fit = useInlineRefFit(ownFit);
  const keys = useButtonKeys(rest.onBlur);
  const pressable = onPress !== undefined;
  const leaving = pressable && leaves && linkHref !== undefined;
  const stated = !(state === undefined || state === null || labelHidden);
  const labelClassName = labelClass({ look, fit, name, gone, pressable });
  // Note that a path that wraps keeps its own order in words of either direction by isolating its whole token rather than its name, because a browser breaks wherever the direction's level changes, which would part the name from its glyph.
  const isolated = name === INLINE_REF_NAME.PATH && fit === INLINE_REF_FIT.FLOW;
  const face = (
    <>
      {kind === undefined ? null : <span className="ui-visually-hidden">{`${kind} `}</span>}
      {glyph === undefined ? null : (
        <span className={glyphClass(look, fit)} aria-hidden="true">
          {glyph}
        </span>
      )}
      {labelHidden ? (
        <span className="ui-visually-hidden">{label}</span>
      ) : fit === INLINE_REF_FIT.LINE && name !== INLINE_REF_NAME.PATH ? (
        <ClippedLine
          className={labelClassName}
          as={ONE_LINE_ELEMENT.SPAN}
          end={ONE_LINE_END.FADE}
          words={label}
        >
          {label}
        </ClippedLine>
      ) : (
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.INHERIT}
          font={name === INLINE_REF_NAME.PATH ? TEXT_FONT.MONO : TEXT_FONT.SANS}
          truncate={fit === INLINE_REF_FIT.LINE ? TEXT_TRUNCATE.START : false}
          className={labelClassName}
        >
          {/* Note that a path cut at its start is isolated, so the ellipsis never reorders it; one that wraps is isolated with its whole token instead (`own`). */}
          {name === INLINE_REF_NAME.PATH && fit === INLINE_REF_FIT.LINE ? (
            <bdi>{label}</bdi>
          ) : (
            label
          )}
        </Text>
      )}
      {/* Note that an isolated path's standing opens on a left-to-right mark, so its lines stay after a path ending in right-to-left words rather than joining them, as a mark that changes no level adds no break. */}
      {!stated ? null : (
        <span className={stateClass(look, fit)}>
          {isolated ? LEFT_TO_RIGHT_MARK : null}
          {state}
        </span>
      )}
      {heard === undefined ? null : <span className="ui-visually-hidden">{heard}</span>}
      {gone ? <span className="ui-visually-hidden">{GONE_HEARD}</span> : null}
    </>
  );
  const own = {
    ...rest,
    className: `${rootClass({ look, fit, gone, pressable, leaving })}${pressable ? " group/inline-ref" : ""}`,
    "data-look": look,
    ...(isolated ? { dir: "ltr" } : {}),
  };
  const goneProps = gone ? { "data-gone": "true" } : {};
  if (onPress === undefined) {
    return (
      <span ref={carded ? focusUnlessInControl : noFocus} {...own} {...goneProps}>
        {face}
      </span>
    );
  }
  if (leaving) {
    // Note that the press, not the browser, opens the address, a
    // middle-click's as a click's, because the window's opener decides where
    // an address opens, a pull request's in its tab say; the link is what a
    // reader and a right-click are told.
    const open = pulseOnPress(onPress);
    const press = (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      open(event);
    };
    return (
      <a
        {...own}
        {...goneProps}
        href={linkHref}
        target="_blank"
        rel="noreferrer"
        aria-label={pressLabel}
        onClick={press}
        onAuxClick={middlePressOf(press)}
      >
        {face}
      </a>
    );
  }
  if (fit === INLINE_REF_FIT.FLOW) {
    // Note that a token that wraps presses as a span in a button's role, because a browser draws a button as one box that never breaks across lines; the keys a button answers press it the same way.
    // Its click is canceled, because a label holding it, a checkbox's words say, would tick its box on a press of a span where it ignores a button's.
    const press = pulseOnPress(onPress);
    return (
      // biome-ignore lint/a11y/useSemanticElements: a token in running words wraps across lines as they do, and a browser draws a <button> as one box that never breaks.
      <span
        role="button"
        tabIndex={0}
        ref={linkAddress}
        {...own}
        {...goneProps}
        aria-label={pressLabel}
        onClick={(event) => {
          event.preventDefault();
          press(event);
        }}
        onKeyDown={keys.onKeyDown}
        onKeyUp={keys.onKeyUp}
        onBlur={keys.onBlur}
      >
        {face}
      </span>
    );
  }
  return (
    <button
      type="button"
      ref={linkAddress}
      {...own}
      {...goneProps}
      aria-label={pressLabel}
      onClick={pulseOnPress(onPress)}
    >
      {face}
    </button>
  );
}

/** A thing named in a line: its glyph, name, and standing as one target, hanging `card` or its name through its `hint`. */
export function InlineRef({
  hint: Hint = Tooltip,
  hintLabel,
  card,
  ...token
}: InlineRefFace &
  DataAttributes & {
    /** The hint, which hangs the token's card, or its name in a pill: the window's tooltip, unless the caller hangs one of its own, or `false` for none, as a token whose pill would only repeat its words. */
    hint?: InlineRefHint | false | undefined;
    /** What the hint's pill says, where it is not the name: a file's whole path. */
    hintLabel?: string | undefined;
    /** The card the hint hangs in place of a pill. */
    card?: ReactNode;
  }): React.JSX.Element {
  const root = <InlineRefRoot {...token} carded={Hint !== false && card !== undefined} />;
  if (Hint === false) return root;
  return (
    <Hint label={hintLabel ?? token.label} card={card}>
      {root}
    </Hint>
  );
}
