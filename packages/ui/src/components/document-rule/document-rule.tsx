/**
 * document-rule.tsx -- the hairline that parts a document's head from its text, as Notion's parts a page's properties from its body.
 *
 * It takes no class or style: the room above and below it is its column's,
 * which spaces it as any other block. It is drawn in the border's ink, one
 * pixel high, the column's full width, and says nothing to a reader, since
 * the head and the text it parts are each named on their own.
 */

/** The hairline between a document's head and its text. */
export function DocumentRule(): React.JSX.Element {
  return <hr aria-hidden className="document-rule h-px w-full flex-none border-0 bg-border" />;
}
