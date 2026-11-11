import { useState } from "react";
import { PlusIcon } from "../../icons/lucide-glyphs.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { TEXT_FIELD_FONT, TextField, type TextFieldFont } from "../text-field/text-field.js";

/**
 * settings-add-row.tsx -- a Settings card's row that adds one item in place: a field and its Add, as an allowlist takes a command (prototype).
 *
 * The field spans the row and Add stands at its end, out until something
 * is typed; Enter adds as Add does, and the field empties for the next.
 * It stands first in its card, so what it adds lands right under it.
 */
export function SettingsAddRow({
  label,
  placeholder,
  verb = "Add",
  font = TEXT_FIELD_FONT.BODY,
  onAdd,
}: {
  /** The field's accessible name, since the row draws no label of its own. */
  label: string;
  placeholder: string;
  /** Add's words. */
  verb?: string | undefined;
  /** The face the field's words are set in: the monospace one for a command. */
  font?: TextFieldFont | undefined;
  /** Adds what was typed, trimmed and never empty. */
  onAdd: (value: string) => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState("");
  const value = typed.trim();
  const add = () => {
    if (value === "") return;
    onAdd(value);
    setTyped("");
  };
  return (
    <div className="ui-settings-add-row box-border flex min-h-settings-row min-w-0 items-center gap-control-gap px-settings-row-inline py-settings-row-block">
      <div className="min-w-0 flex-1">
        <TextField
          label={label}
          placeholder={placeholder}
          font={font}
          spellCheck={false}
          value={typed}
          onChange={setTyped}
          onEnter={add}
        />
      </div>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<PlusIcon />}
        disabled={value === ""}
        onClick={add}
      >
        {verb}
      </Button>
    </div>
  );
}
