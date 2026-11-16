import { TrashIcon } from "../../icons/lucide-glyphs.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { GAP, Inline } from "../layout/layout.js";

/**
 * edit-actions.tsx -- a row's way out of an edit made in place and its Save, standing at the row's end while the edit does: a run action's command, an always-allowed command.
 *
 * The way out is quiet and says what letting the edit go does (Discard for
 * a saved thing changed, Cancel for one opened to edit or just added); Save
 * is the primary press, standing unavailable until the edit may be saved,
 * and saying Saving while its save is out, when neither may be pressed.
 * Where saving the edit as it stands would delete what is saved, as an
 * emptied script would, a red Delete with the trash glyph stands in Save's
 * place, saying what it deletes, since it asks first as every delete does.
 */
export function EditActions({
  leave,
  saving,
  canSave,
  onLeave,
  onSave,
  deletes,
}: {
  /** What letting the edit go says: Discard or Cancel. */
  leave: string;
  /** Whether its save is out. */
  saving: boolean;
  /** Whether the edit may be saved as it stands. */
  canSave: boolean;
  onLeave: () => void;
  onSave: () => void;
  /** The words of the Delete standing in Save's place, where saving the edit as it stands deletes what is saved (Delete script); its press asks first. */
  deletes?: string | undefined;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <Button variant={BUTTON_VARIANT.QUIET} disabled={saving} onClick={onLeave}>
        {leave}
      </Button>
      {deletes === undefined ? (
        <Button variant={BUTTON_VARIANT.PRIMARY} disabled={!canSave || saving} onClick={onSave}>
          {saving ? "Saving" : "Save"}
        </Button>
      ) : (
        <Button
          variant={BUTTON_VARIANT.DANGER}
          icon={<TrashIcon />}
          aria-haspopup="dialog"
          disabled={saving}
          onClick={onSave}
        >
          {deletes}
        </Button>
      )}
    </Inline>
  );
}
