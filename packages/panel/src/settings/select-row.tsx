import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type {
  ChipWidth,
  FootRow,
  RowActions,
  SettingsRowDensity,
  SettingsRowIndent,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { useEffect } from "react";
import { refusalShown } from "../failure-report.js";
import { PickerRow } from "./picker-row.js";
import type { RowChange } from "./row-write.js";

/** What the menu says when a search over a short fixed set matches nothing, which it has no search to say. */
const NO_MATCH = "No options match";

/**
 * A settings pop-up: its name, optional why, and one value from a small fixed
 * set, picked from the app's own menu with no search, since a set this short
 * is read whole. The visible name names the chip and the why describes it.
 * A row that writes takes its caller's write (`row-write.ts`), resting until
 * it answers and drawing the pick ahead where the write reads one back, as a
 * switch does, and a refused one stands under the row, in its own error line;
 * a row that moves a draft takes a plain change.
 */
export function SelectRow<Value extends string | number>({
  label,
  labelReplayUnmasked,
  detail,
  value,
  options,
  parse,
  placeholder,
  anchor,
  busy: restBusy,
  density,
  indent,
  leading,
  width,
  error,
  action,
  foot,
  pickOther,
  write,
  onChange,
}: RowChange<Value> & {
  label: string;
  /** Whether its name is the app's own words, which a screen recording shows as they read; masked where none is named. */
  labelReplayUnmasked?: boolean | undefined;
  detail?: string | undefined;
  value: Value;
  /** Each option's token and words, the faces or glyph it shows where it has some, what it does under its name where that is said, and why it cannot be picked now where it cannot. */
  options: readonly {
    value: Value;
    label: string;
    faces?: React.ReactNode;
    icon?: React.ReactNode;
    hint?: string | undefined;
    /** A short word after its name, such as how a voice presents; none where its name says it all. */
    tag?: string | undefined;
    disabled?: string | undefined;
    /** The heading the option is listed under in the menu; none lists it under no heading. */
    section?: string | undefined;
    /** Whether its words are a person's own, as a sound they named, kept masked in a screen recording. */
    masked?: boolean | undefined;
    /** Acts on the option's own thing, which its ⋯ opens in the menu, as a sound's Rename and Remove. */
    actions?: RowActions | undefined;
  }[];
  parse: (raw: string) => Value | undefined;
  /** The empty search field's words, for a set long enough that its menu searches; none reads it whole. */
  placeholder?: string | undefined;
  /** The id a pressed search result lands on: marked on the chip itself, which then takes the keyboard. */
  anchor?: string;
  /**
   * A sibling write in flight. Two pop-ups that store one setting share a
   * rest so one save cannot finish behind the other.
   */
  busy?: boolean;
  /** How the row stands; in a settings card where none is named. */
  density?: SettingsRowDensity | undefined;
  /** Whether the row stands inset under the row above, one of its things. */
  indent?: SettingsRowIndent | undefined;
  /** The glyph the row leads with, where what it sets has one. */
  leading?: React.ReactNode;
  /** How wide its chip stands; the settings column where none is named. */
  width?: ChipWidth | undefined;
  /** What stops the caller's own save at this row, said where no write of the row's was refused. */
  error?: ShownError | undefined;
  /** A control of the row's own beside the pop-up, as a Play beside a sound; none where the pop-up stands alone. */
  action?: React.ReactNode;
  /** Rows pinned under the menu's list that act rather than pick, as a sound's Upload; none where the menu only picks. */
  foot?: readonly FootRow[] | undefined;
  /** Answers a pick of an option its owner handles itself rather than as the value, true where it did, as a sound of the account's own is chosen. */
  pickOther?: ((id: string) => boolean) | undefined;
}): React.JSX.Element {
  const run = write === undefined ? onChange : write.run;
  const ahead = write?.ahead;
  const agreed = write !== undefined && !write.busy && ahead !== undefined && ahead.value === value;
  // Note that a pick drawn ahead of its answer is let go of once the stored value agrees, so the row then follows the store again, other windows' changes included.
  useEffect(() => {
    if (agreed) write.settle();
  }, [agreed, write]);
  const shown = ahead === undefined ? value : ahead.value;
  const chosen = options.find((option) => option.value === shown);

  return (
    <PickerRow
      label={label}
      labelReplayUnmasked={labelReplayUnmasked}
      detail={detail}
      saves={write?.savedAt}
      error={refusalShown(write?.refusal, FAILURE_SURFACE.SETTING_WRITE) ?? error}
      density={density}
      indent={indent}
      leading={leading}
      width={width}
      action={action}
      value={String(shown)}
      valueLabel={chosen?.label ?? String(shown)}
      valueReplayMasked={chosen?.masked === true}
      valueIcon={chosen?.faces ?? chosen?.icon}
      rows={options.map((option) => ({
        id: String(option.value),
        label: option.label,
        ...(option.faces === undefined ? undefined : { faces: option.faces }),
        ...(option.icon === undefined ? undefined : { icon: option.icon }),
        ...(option.hint === undefined ? undefined : { detail: option.hint, detailUnder: true }),
        ...(option.tag === undefined ? undefined : { detail: option.tag }),
        disabled: option.disabled,
        section: option.section,
        replayMasked: option.masked,
        actions: option.actions,
      }))}
      foot={foot}
      placeholder={placeholder}
      noMatch={NO_MATCH}
      // Note that a select's options are a fixed set, the app's own words.
      replayUnmasked
      anchor={anchor}
      disabled={write?.busy === true || Boolean(restBusy)}
      onPick={(id) => {
        if (pickOther?.(id) === true) return;
        const next = parse(id);

        if (next !== undefined) run(next);
      }}
    />
  );
}
