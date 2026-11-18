import type { ReactNode } from "react";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { ForwardIcon } from "../../icons/lucide-glyphs.js";
import type { ShownError } from "../../reported-failure.js";
import { CARD_PRESS_CORNER, CardPress } from "../card-press/card-press.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import {
  SETTINGS_ROW_CONTROLS,
  SettingsRow,
  type SettingsRowControl,
  type SettingsRowDensity,
  type SettingsRowIndent,
  type SettingsRowLead,
} from "./settings-row.js";

/**
 * settings-link-row.tsx -- a settings row that opens a page of its own, as an integration's row its page: pressed anywhere, it opens it, and it ends in a ›.
 *
 * The row is `SettingsRow` as it stands, its words, its leading mark, and
 * what rides its label's line (an account's name) drawn as any row's. Its
 * press is the row's whole box (`CardPress` over it), a step inside the
 * card's edge so its hover's wash, its pressed fill, and the keyboard's
 * ring stand clear of the card's corner; it is a real button named by the
 * row's label and described by its description, so Tab reaches it and a
 * reader hears it as the row. The › stands last in the row's `end`, in the
 * column a ⋯ or a fold's chevron stands in on every other row, and says
 * nothing a reader does not already hear from the button.
 *
 * A row may carry one control before its ›, a Connect or a Reconnect,
 * which stands over the press: a press on it is its own and opens nothing,
 * and Tab reaches it after the row. It keeps beside the words until the row
 * is narrow, as a list of integrations' rows do, so the ›s of a card stand
 * in one column, and under 380px it drops below them as any card's row does.
 */

/** The › a row that opens a page ends in, standing where a ⋯ or a fold's chevron stands on the rows around it. */
function OpenGlyph(): React.JSX.Element {
  return (
    <span className="ui-settings-link-row-glyph flex w-control flex-none justify-center">
      <GlyphSlot size={ICON_SIZE.MEDIUM}>
        <ForwardIcon />
      </GlyphSlot>
    </span>
  );
}

/** A row named `label` that opens a page on `onOpen` when pressed anywhere but its `control`. */
export function SettingsLinkRow({
  label,
  description,
  leading,
  adornment,
  error,
  density,
  indent,
  lead,
  landed,
  onOpen,
  control,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The face or mark the row leads with, before its words. */
  leading?: ReactNode;
  /** What rides the label's line after it without naming the row: an account's name. */
  adornment?: ReactNode;
  /** What went wrong with the last write, and the failure beneath it, or nothing while none did. */
  error?: ShownError | undefined;
  density?: SettingsRowDensity | undefined;
  indent?: SettingsRowIndent | undefined;
  lead?: SettingsRowLead | undefined;
  /** Whether the row just arrived, which lights it once. */
  landed?: boolean | undefined;
  /** Opens the row's page. */
  onOpen: () => void;
  /** The row's one control, a Connect or a Reconnect, handed its ids, whose own press opens nothing. */
  control?: ((control: SettingsRowControl) => ReactNode) | undefined;
}): React.JSX.Element {
  return (
    <SettingsRow
      label={label}
      description={description}
      leading={leading}
      adornment={adornment}
      error={error}
      density={density}
      indent={indent}
      lead={lead}
      landed={landed}
      controls={SETTINGS_ROW_CONTROLS.BESIDE_UNTIL_NARROW}
      press={(ids) => (
        <CardPress
          labelledBy={ids.labelId}
          aria-describedby={ids["aria-describedby"]}
          corner={CARD_PRESS_CORNER.WITHIN}
          onPress={() => onOpen()}
        >
          {null}
        </CardPress>
      )}
      end={() => <OpenGlyph />}
    >
      {control}
    </SettingsRow>
  );
}
