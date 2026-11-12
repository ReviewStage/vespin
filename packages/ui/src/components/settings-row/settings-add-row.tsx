import { useId } from "react";
import { PlusIcon } from "../../icons/lucide-glyphs.js";
import type { ShownError } from "../../reported-failure.js";
import { said } from "../../said.js";
import { ANNOUNCE } from "../announcer/announcer.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { ErrorLine } from "../error-line/error-line.js";
import { TEXT_FIELD_FONT, TextField, type TextFieldFont } from "../text-field/text-field.js";

/**
 * settings-add-row.tsx -- a Settings card's row that adds one item in place: a field and its Add, as a list of commands takes one more.
 *
 * The field spans the row and Add, outlined, stands at its end, out until
 * something is typed; Enter adds as Add does. It stands first in its card,
 * so what it adds lands right under it. Its owner holds what is typed and
 * empties it once the add is kept; while the add is out Add stands busy
 * and the field takes nothing, and a refusal stands under the row, said as
 * an alert and describing the field, until its owner clears it.
 */
export function SettingsAddRow({
  label,
  placeholder,
  value,
  verb = "Add",
  busyVerb = "Adding",
  font = TEXT_FIELD_FONT.BODY,
  busy = false,
  error,
  onChange,
  onAdd,
}: {
  /** The field's accessible name, since the row draws no label of its own. */
  label: string;
  placeholder: string;
  /** What is typed. */
  value: string;
  /** Add's words. */
  verb?: string | undefined;
  /** Add's words while the add is out. */
  busyVerb?: string | undefined;
  /** The face the field's words are set in: the monospace one for a command. */
  font?: TextFieldFont | undefined;
  /** Whether an add is out, which stands Add busy and holds the field. */
  busy?: boolean | undefined;
  /** Why the last add was refused, under the row; none while nothing was. */
  error?: ShownError | undefined;
  onChange: (value: string) => void;
  /** Adds what was typed, trimmed and never empty. */
  onAdd: (value: string) => void;
}): React.JSX.Element {
  const errorId = `${useId()}error`;
  const typed = value.trim();
  const failed = error !== undefined && said(error.words);

  const add = () => {
    if (typed === "" || busy) return;
    onAdd(typed);
  };

  return (
    <div className="ui-settings-add-row box-border min-w-0 px-settings-row-inline py-settings-row-block">
      <div className="flex min-h-control min-w-0 items-center gap-control-gap">
        <div className="min-w-0 flex-1">
          <TextField
            label={label}
            placeholder={placeholder}
            font={font}
            spellCheck={false}
            autoCorrect={false}
            readOnly={busy}
            invalid={failed}
            describedBy={failed ? errorId : undefined}
            value={value}
            onChange={onChange}
            onEnter={add}
          />
        </div>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<PlusIcon />}
          disabled={typed === ""}
          busy={busy}
          busyLabel={busyVerb}
          onClick={add}
        >
          {verb}
        </Button>
      </div>
      <ErrorLine id={errorId} level={ANNOUNCE.ALERT} error={failed ? error : undefined} />
    </div>
  );
}
