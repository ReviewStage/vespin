/**
 * code-face.ts -- the classes a block of code's card and its lines wear, wherever a fenced block is drawn.
 *
 * A fenced block is drawn by two renderers: `@repo/ui`'s code card
 * (`CodeCard`) wherever Markdown is drawn, and TipTap in the description's
 * editor, whose block the panel frames as the card
 * (`description-editor/code-block-view.ts`). Each hands its card and its
 * lines these classes, so a block opened to be edited stands where it stood,
 * in the same type, inset, and gaps, and no renderer's own default (the
 * browser's margins around a figure, its generic `monospace` for code)
 * reaches it.
 */

/** The card's own class, with no margin of its own, so the gap around it is the text's rhythm alone (`components/prose/prose.css`). */
export const CODE_CARD_CLASS = "ui-code-card m-0";

/** The lines, whole and scrolling sideways, each run in its color for the appearance it stands in. */
export const CODE_BODY_CLASS =
  "ui-code-card-body m-0 overflow-x-auto overscroll-x-contain py-row-inset font-mono text-caption leading-reading wrap-normal whitespace-pre text-code [tab-size:2] [&_span]:text-code-run [&>code]:[font:inherit]";

/** The lines of a block drawn plain, inset as the card is. */
export const CODE_LINES_CLASS = `${CODE_BODY_CLASS} px-list-inset`;
