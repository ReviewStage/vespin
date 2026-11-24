import { type ReactNode, useEffect, useState } from "react";
import { IconButton } from "../button/button.js";
import {
  DISCLOSURE_BODY,
  DISCLOSURE_TURN,
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
import { SettingsRowFoldPress } from "./settings-row-press.js";

/**
 * settings-row-fold.tsx -- a settings row that folds open what it owns under its words, as a GitHub account its repositories.
 *
 * The row is `SettingsRow` as it stands, its glyph a `⌄` in the row's
 * `end`, a quiet `IconButton` before any ⋯ the row holds, so every page
 * reads `[controls] [⌄] [⋯]` and a `›` is left to a row that opens a page.
 * The glyph turns to point up as the fold opens (`DISCLOSURE_TURN.DOWN`),
 * says whether it is open in `aria-expanded`, and is the keyboard's one
 * stop for the fold; the pointer and a finger open and close it from a
 * press anywhere on the row (`SettingsRowFoldPress`), the row's controls
 * keeping their own presses. The fold
 * stands in the row's own `below`, inside the row's rule and inset to its
 * words, so what it holds reads as part of the row rather than a box of its
 * own in the card. It opens and closes on the disclosure's motion
 * (`useDisclosureFold`): a press unrolls the body and fades it in, a close
 * rolls it up as it fades, and reduced motion holds it still at the tokens; a
 * fold drawn open from the start replays nothing.
 *
 * What it folds open is its caller's, whole: a GitHub account's
 * repositories as `RepositoryLines` lists them, which scrolls its own.
 *
 * A row that owns whole rows rather than a list, as an integration its
 * accounts or channels, folds them with `SettingsRowsFold`: the same
 * glyph, which the head row stands among its controls or in its `end`,
 * always before its ⋯, and the rows after it in a box of
 * their own, each a row of the card in its own right, ruled as the card's
 * own (settings-section.css). The head row is pressed whole as a fold row
 * is. They open and close on the same motion, the
 * box being the fold's body. Note that a closed fold hides its rows rather
 * than letting them go, because a row keeps what it is waiting on, such as
 * a refusal still to be said under a picker, while the fold is closed.
 */

/**
 * A row named `label` that folds `children` open under its words, its
 * glyph named `foldLabel`, open at first where `defaultOpen` says, and
 * the row's ⋯ (`actions`) after the glyph in its end; what rides its
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
  /** The glyph's name, which a sighted reader has from the row ("Repositories of acme"). */
  foldLabel: string;
  defaultOpen?: boolean | undefined;
  /** The row's ⋯ or another glyph-wide press, handed its ids, standing after the glyph in the row's end. */
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
      <SettingsRowFoldPress value={state.toggle}>
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
              <IconButton
                icon={<DisclosureChevron turn={DISCLOSURE_TURN.DOWN} />}
                label={foldLabel}
                aria-expanded={state.open}
                onClick={state.toggle}
              />
              {actions?.(ids)}
            </>
          )}
        >
          {control}
        </SettingsRow>
      </SettingsRowFoldPress>
    </DisclosureScope>
  );
}

/**
 * A head row and the rows it owns under it, closed until a press on the
 * head row or its glyph: `head` draws the row, handed the glyph (named
 * `label`) to stand among its controls or in its `end`, before any ⋯ it
 * holds, or, where there are no `rows` to fold, the glyph's room alone, so
 * a value it ends in stands in one column with the values of the rows that
 * fold; beside any other control, or where no row of the section draws a
 * glyph there, that room stands nowhere (`SettingsRowActSlot`). A head that stands its glyph among its
 * controls, before its ⋯, rather than last asks for no room (`room` false),
 * since its ⋯ already ends the row's column, and is handed nothing where it
 * folds nothing. A head that folds nothing is pressed as a plain row is.
 * Each new `opened` opens it, as a link landing on what it folds asks.
 */
export function SettingsRowsFold({
  label,
  head,
  rows,
  room = true,
  opened,
}: {
  /** The glyph's name, which a sighted reader has from the head row ("GitHub's accounts"). */
  label: string;
  /** The head row, handed the glyph to draw before its ⋯. */
  head: (chevron: ReactNode) => ReactNode;
  /** The rows the fold owns, or nothing where it owns none now. */
  rows?: ReactNode;
  /** Whether a head that folds nothing is handed the glyph's room, as one whose glyph stands last is; false where it stands among its controls, before the row's ⋯. */
  room?: boolean | undefined;
  /** The ask that opens it, a new one each time it is asked; none where nothing asked. */
  opened?: number | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { state, details } = useDisclosureFold(false, { open, onOpenChange: setOpen });
  const folds = rows !== undefined && rows !== null && rows !== false;
  useEffect(() => {
    if (opened !== undefined) setOpen(true);
  }, [opened]);

  return (
    <DisclosureScope state={state}>
      <SettingsRowFoldPress value={folds ? state.toggle : undefined}>
        {head(
          folds ? (
            <IconButton
              icon={<DisclosureChevron turn={DISCLOSURE_TURN.DOWN} />}
              label={label}
              aria-expanded={state.open}
              onClick={state.toggle}
            />
          ) : room ? (
            <SettingsRowActSlot />
          ) : null,
        )}
      </SettingsRowFoldPress>
      {/* Note that the rows stay drawn while closed, only hidden, so each keeps what it waits on; the body is the root's own child, which disclosure.css unrolls and rolls up. */}
      {folds ? (
        <div
          className="ui-settings-rows-fold"
          hidden={!state.drawn}
          data-disclosure={details["data-disclosure"]}
        >
          <div ref={state.body} className="ui-disclosure-body" inert={state.leaving}>
            {rows}
          </div>
        </div>
      ) : null}
    </DisclosureScope>
  );
}
