import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";
import {
  CARD_CORNER,
  CARD_DROP_TARGET,
  CARD_ELEMENT,
  CARD_LOOK,
  CARD_PADDING,
  CARD_SHADOW,
  Card,
} from "../card/card.js";

/**
 * composer-frame.tsx -- the frame a message is written in: its edge, its corner, and its ground, and the edge brightened while files are dragged over it.
 *
 * The frame owns how a composer stands and nothing it holds: the field, the
 * files over it, and the foot of presses under it are the owner's, laid out
 * by the owner's own class. It clips nothing, because the field's `@` and `/`
 * menus open past its edge. Its look is a finite choice (`COMPOSER_LOOK`): the
 * window's message box, a card on the sidebar's ground at a card's corner,
 * as an agent's box, the Inbox's, and a thread's reply stand; a field on the
 * page's ground at a control's corner, as a comment is answered in a card's
 * well; as a text field is drawn (`INPUT`), on the input's own ground and edge, brightening once the caret is in it, where a form asks for words; or bare, no frame at all, where the card around it is the frame, as a
 * thread's first comment is. The note a box gives way to stands on the same
 * frame, so it stands where the box stood. It is a form where it sends and a
 * div where it does not (`COMPOSER_ELEMENT`); a form the browser never checks,
 * so no browser bubble is drawn over it, and its owner says what is wrong.
 *
 * The window's message box is a card (`Card`), on the surface's ground at a
 * card's corner with Geist's card shadow, so it stands as every other card
 * does and drops its edge where it stands inside one. The other looks are
 * drawn in Tailwind utilities over the theme, each look's edge, corner, and
 * ground picked here; shadcn/ui has no composer.
 */

/** How a composer stands: the window's message box, a field in a card's well, a text field's ground, or no frame of its own. */
export const COMPOSER_LOOK = {
  CARD: "card",
  FIELD: "field",
  INPUT: "input",
  BARE: "bare",
} as const;

export type ComposerLook = (typeof COMPOSER_LOOK)[keyof typeof COMPOSER_LOOK];

/** The elements a composer's frame may be: a form where its foot's submit sends it, a div where it does not. */
export const COMPOSER_ELEMENT = {
  FORM: "form",
  DIV: "div",
} as const;

export type ComposerElement = (typeof COMPOSER_ELEMENT)[keyof typeof COMPOSER_ELEMENT];

/**
 * Each look's edge, corner, and ground but the card's, which `Card` draws:
 * the field, the input, and the bare look flat in what holds them, the input
 * brightening once the caret is in it. Any look is edged in the danger ink
 * while what it holds stops its form (`invalid`).
 */
const LOOK_CLASS: Record<Exclude<ComposerLook, typeof COMPOSER_LOOK.CARD>, string> = {
  [COMPOSER_LOOK.FIELD]: "rounded-control border border-border bg-ground",
  [COMPOSER_LOOK.INPUT]:
    "rounded-control border border-border-strong bg-field transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit focus-within:bg-field-focus",
  [COMPOSER_LOOK.BARE]: "rounded-dialog border-0 bg-transparent",
};

/** The edge while files are dragged over it, brightened, so the drop target is the frame itself. */
const DROPPING = "data-[dropping=true]:border-border-selected";

/** The edge while what it holds is what stops a form, shaken and in the danger ink, as a text field's is. */
const INVALID = "data-[invalid=true]:animate-field-shake data-[invalid=true]:border-destructive";

/** `children` framed as a composer. */
export function ComposerFrame({
  as: Element = COMPOSER_ELEMENT.DIV,
  look = COMPOSER_LOOK.CARD,
  dropping = false,
  invalid = false,
  className,
  ref,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "className" | "children"> & {
  as?: ComposerElement;
  look?: ComposerLook | undefined;
  /** Whether files are dragged over it, which brightens its edge, so the drop target is the frame itself. */
  dropping?: boolean | undefined;
  /** Whether what it holds is what stops its form, as a text field marked invalid is drawn. */
  invalid?: boolean | undefined;
  /** The owner's own class, which names, places, and lays out what it holds, and sets nothing of its frame. */
  className?: string | undefined;
  /** The frame's element, for what asks whether the focus is inside it. */
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const owner = ["ui-composer-frame group/composer", className ?? ""]
    .filter((part) => part !== "")
    .join(" ");

  // Note that a card's drop is the card's own ring and wash, as a board's column takes a dragged row.
  if (look === COMPOSER_LOOK.CARD) {
    return (
      <Card
        {...rest}
        as={Element === COMPOSER_ELEMENT.FORM ? CARD_ELEMENT.FORM : CARD_ELEMENT.DIV}
        look={CARD_LOOK.SURFACE}
        corner={CARD_CORNER.CARD}
        padding={CARD_PADDING.NONE}
        shadow={CARD_SHADOW.CARD}
        invalid={invalid}
        className={owner}
        ref={ref}
        {...{ [CARD_DROP_TARGET]: dropping ? "true" : undefined }}
      >
        {children}
      </Card>
    );
  }

  // Note that the element is made rather than written, as a card's is.
  return createElement(
    Element,
    {
      ...rest,
      ref,
      className: [LOOK_CLASS[look], DROPPING, INVALID, owner].join(" "),
      noValidate: Element === COMPOSER_ELEMENT.FORM ? true : undefined,
      "data-look": look,
      "data-dropping": dropping ? "true" : undefined,
      "data-invalid": invalid ? "true" : undefined,
    },
    children,
  );
}
