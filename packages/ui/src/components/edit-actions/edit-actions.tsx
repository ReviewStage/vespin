import { BUTTON_VARIANT, Button } from "../button/button.js";
import { GAP, Inline } from "../layout/layout.js";

/**
 * edit-actions.tsx -- a row's way out of an edit made in place and its Save, standing at the row's end while the edit does: a run action's command, an always-allowed command.
 *
 * The way out is quiet and says what letting the edit go does (Discard for
 * a saved thing changed, Cancel for one opened to edit or just added); Save
 * is the primary press, standing unavailable until the edit may be saved,
 * and saying Saving while its save is out, when neither may be pressed.
 */
export function EditActions({
  leave,
  saving,
  canSave,
  onLeave,
  onSave,
}: {
  /** What letting the edit go says: Discard or Cancel. */
  leave: string;
  /** Whether its save is out. */
  saving: boolean;
  /** Whether the edit may be saved as it stands. */
  canSave: boolean;
  onLeave: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <Button variant={BUTTON_VARIANT.QUIET} disabled={saving} onClick={onLeave}>
        {leave}
      </Button>
      <Button variant={BUTTON_VARIANT.PRIMARY} disabled={!canSave || saving} onClick={onSave}>
        {saving ? "Saving" : "Save"}
      </Button>
    </Inline>
  );
}
