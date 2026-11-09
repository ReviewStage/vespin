import { SPINNER_SIZE, Spinner } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * waiting-line.tsx -- a wait on something outside the app, said as a line: the ring turning and what is awaited.
 *
 * Where a surface stands waiting on a person to finish elsewhere, a code
 * entered on another site, it says so in one line led by the one spinner,
 * standing from the start since the wait is the point, its words in the
 * label's type. It stands as a step does (`steps.tsx`), the ring in a slot
 * as wide as a step's disc and the words a step's gap after it, so under
 * the steps its words start where theirs do. The ring's words are the
 * line's own, so a reader hears the wait once.
 */

/** The row: the ring's slot, then the words, both from the row's top. */
const LEAD_ROW = "flex items-start gap-ui-12";

/** The ring's slot: a step's disc wide, one label line tall, the ring centered in it. */
const LEAD_SLOT = "flex h-lh w-ui-20 flex-none items-center justify-center text-label";

/** The words. */
const LEAD_WORDS = "flex min-w-0 flex-1 flex-col gap-control-gap";

/** The ring, and `children` saying what is awaited. */
export function WaitingLine({ children }: { children: string }): React.JSX.Element {
  return (
    <div className={`ui-waiting-line ${LEAD_ROW}`}>
      <span className={LEAD_SLOT}>
        <Spinner label={children} size={SPINNER_SIZE.INLINE} delay={false} />
      </span>
      <div className={LEAD_WORDS}>
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL} aria-hidden="true">
          {children}
        </Text>
      </div>
    </div>
  );
}
