import { createContext, type ReactNode, useContext } from "react";

/**
 * inline-ref-fit.tsx -- how a thing named in a line takes its line: wrapping in running words, or kept to one line in a slot one line tall, said by the token or by the surface it stands on.
 *
 * The same chip stands in an agent's words and in a one-line row of them,
 * and a card hung from a chip in words is drawn under that chip, so the
 * fit is a surface's to say for every token under it (`InlineRefFitScope`):
 * running words say `FLOW`, and a slot one line tall inside them, a row, a
 * subject line, a card, says `LINE` back. A token whose place says neither
 * keeps to one line. It stands apart from the token (`inline-ref.tsx`) so a
 * surface the token's own hint draws, the tooltip's card, can say it too.
 */

/** How a token takes its line, by the place it stands. */
export const INLINE_REF_FIT = {
  /** In running words: wraps across lines as they do, read whole. */
  FLOW: "flow",
  /** In a slot one line tall, a row's or a byline's: kept to one line, its name fading out where it is cut. */
  LINE: "line",
} as const;

export type InlineRefFit = (typeof INLINE_REF_FIT)[keyof typeof INLINE_REF_FIT];

const InlineRefFitContext = createContext<InlineRefFit>(INLINE_REF_FIT.LINE);

/** How a token takes its line: its own fit where it says one, else the surface's. */
export function useInlineRefFit(own: InlineRefFit | undefined): InlineRefFit {
  const scoped = useContext(InlineRefFitContext);

  return own ?? scoped;
}

/** Sets how every token under it takes its line where the token says nothing itself. */
export function InlineRefFitScope({
  fit,
  children,
}: {
  fit: InlineRefFit;
  children: ReactNode;
}): React.JSX.Element {
  return <InlineRefFitContext.Provider value={fit}>{children}</InlineRefFitContext.Provider>;
}
