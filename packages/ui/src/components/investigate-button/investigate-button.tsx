/**
 * investigate-button.tsx -- a failure's Investigate: the bug glyph alone, named "Investigate", whose press starts an agent to find the failure's cause and fix it.
 *
 * It stands before a failure's Copy details, wherever the app offers one
 * (`ReportedFailure`'s `investigation`): a failure said in place
 * (`FailureCopy`) and a failure's toast (`ToastActions`). It is the glyph
 * alone, as Copy details is, so the failure's words keep their room, and
 * its hint says what it does. The press is the app's: this package reaches
 * no agent, and the app says what came of it on its own surfaces.
 */

import { GLYPH } from "../../icons/glyph-registry.js";
import { type ButtonSize, IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

/** What Investigate is called, and its hint says. */
const INVESTIGATE_LABEL = "Investigate";

/** What its hint says beside its name, of what a press does. */
const INVESTIGATE_HINT = "Investigate: start an agent to find the cause and fix it";

/** Investigate on a failure: the bug glyph, whose press is `onPress`. */
export function InvestigateButton({
  onPress,
  size,
}: {
  onPress: () => void;
  size?: ButtonSize | undefined;
}): React.JSX.Element {
  const Glyph = GLYPH.INVESTIGATE;
  return (
    <Tooltip label={INVESTIGATE_HINT}>
      <IconButton
        icon={<Glyph />}
        label={INVESTIGATE_LABEL}
        onClick={onPress}
        {...(size === undefined ? {} : { size })}
      />
    </Tooltip>
  );
}
