import { type ReactNode, useState } from "react";
import { IconButton } from "../button/button.js";
import {
  DISCLOSURE_BODY,
  DisclosureBody,
  DisclosureChevron,
  DisclosureScope,
  useDisclosureFold,
} from "../disclosure/disclosure.js";
import {
  SettingsRow,
  SettingsRowActSlot,
  type SettingsRowControl,
  type SettingsRowControls,
  type SettingsRowIndent,
} from "./settings-row.js";

/**
 * settings-row-fold.tsx -- a settings row that folds open what it owns under its words, as a GitHub account its repositories.
 *
 * The row is `SettingsRow` as it stands, its chevron last in the row's
 * `end`, a quiet `IconButton` after any ⋯ the row holds, so every fold
 * row's chevron stands in one column on the name's line at any width,
 * which turns as the fold opens and
 * says whether it is open in `aria-expanded`. The fold
 * stands in the row's own `below`, inside the row's rule and inset to its
 * words, so what it holds reads as part of the row rather than a box of its
 * own in the card. It opens and closes on the disclosure's motion
 * (`useDisclosureFold`): a press unrolls the body and fades it in, a close
 * fades it out first, and reduced motion holds it still at the tokens; a
 * fold drawn open from the start replays nothing.
 *
 * What it folds open is its caller's, whole: a GitHub account's
 * repositories as `RepositoryLines` lists them, which scrolls its own.
 *
 * A row that owns whole rows rather than a list, as an integration its
 * accounts or channels, folds them with `SettingsRowsFold`: the same
 * chevron, which the head row stands last in its `end`, and the rows after it in a box of
 * their own, each a row of the card in its own right, ruled as the card's
 * own (settings-section.css). Note that a closed fold hides its rows rather
 * than letting them go, because a row keeps what it is waiting on, such as
 * a refusal still to be said under a picker, while the fold is closed.
 */

/**
 * A row named `label` that folds `children` open under its words, its
 * chevron named `foldLabel`, open at first where `defaultOpen` says, and
 * the row's ⋯ (`actions`) before the chevron in its end; what rides its
 * label's line (`adornment`) and its controls (`control`) stand as a plain
 * row's do, as a run action's Default badge and its Discard and Save.
 */
export function SettingsFoldRow({
  label,
  adornment,
  description,
  leading,
  indent,
  foldLabel,
  defaultOpen = false,
  actions,
  controls,
  control,
  children,
}: {
  label: ReactNode;
  /** What rides the label's line after it without naming the row: a badge. */
  adornment?: ReactNode;
  description?: ReactNode;
  /** The face or mark the row leads with, past which what the fold holds starts. */
  leading?: ReactNode;
  indent?: SettingsRowIndent | undefined;
  /** The chevron's name, which a sighted reader has from the row ("Repositories of acme"). */
  foldLabel: string;
  defaultOpen?: boolean | undefined;
  /** The row's ⋯ or another glyph-wide press, handed its ids, standing before the chevron in the row's end. */
  actions?: ((control: SettingsRowControl) => ReactNode) | undefined;
  /** Where its controls stand where they would leave its words less than a legible stretch. */
  controls?: SettingsRowControls | undefined;
  /** The row's controls, handed its ids, on the name's line before its end. */
  control?: ((control: SettingsRowControl) => ReactNode) | undefined;
  /** What the fold holds. */
  children: ReactNode;
}): React.JSX.Element {
  const { state, details } = useDisclosureFold(defaultOpen);

  return (
    <DisclosureScope state={state}>
      <SettingsRow
        label={label}
        adornment={adornment}
        description={description}
        controls={controls}
        leading={leading}
        indent={indent}
        below={
          state.drawn
            ? () => (
                <div
                  className="ui-settings-row-fold min-w-0"
                  data-disclosure={details["data-disclosure"]}
                >
                  <DisclosureBody inset={DISCLOSURE_BODY.NONE}>{children}</DisclosureBody>
                </div>
              )
            : undefined
        }
        end={(ids) => (
          <>
            {actions?.(ids)}
            <IconButton
              icon={<DisclosureChevron />}
              label={foldLabel}
              aria-expanded={state.open}
              onClick={state.toggle}
            />
          </>
        )}
      >
        {control}
      </SettingsRow>
    </DisclosureScope>
  );
}

/**
 * A head row and the rows it owns under it, closed until its chevron is
 * pressed: `head` draws the row, handed the chevron (named `label`) to
 * stand last in the row's `end`, or, where there are no `rows` to fold, the
 * chevron's room alone, so the controls of every row in the card end in one
 * column whether it folds or not.
 */
export function SettingsRowsFold({
  label,
  head,
  rows,
}: {
  /** The chevron's name, which a sighted reader has from the head row ("GitHub's accounts"). */
  label: string;
  /** The head row, handed the chevron to draw last in its `end`. */
  head: (chevron: ReactNode) => ReactNode;
  /** The rows the fold owns, or nothing where it owns none now. */
  rows?: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const folds = rows !== undefined && rows !== null && rows !== false;

  return (
    <>
      {head(
        folds ? (
          <IconButton
            icon={<DisclosureChevron open={open} />}
            label={label}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          />
        ) : (
          <SettingsRowActSlot />
        ),
      )}
      {folds ? (
        <div className="ui-settings-rows-fold" hidden={!open}>
          {rows}
        </div>
      ) : null}
    </>
  );
}
