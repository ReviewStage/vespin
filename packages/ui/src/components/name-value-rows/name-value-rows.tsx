import type { ClipboardEvent, ReactNode } from "react";
import { TrashIcon } from "../../icons/lucide-glyphs.js";
import { inputProblem } from "../../reported-failure.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import { FormField } from "../form-field/form-field.js";
import { SecretField } from "../secret-field/secret-field.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { TEXT_FIELD_FONT, TextField } from "../text-field/text-field.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * name-value-rows.tsx -- names and their values entered a pair to a line, as environment variables are added: a Name and a Value heading their columns, each line's Remove at its end.
 *
 * Each line is a name field in the code face and a value field beside it,
 * masked as a secret is (`SecretField`) where `secret` says so, or plain in
 * the code face; a line's problem stands under its name as a field's error,
 * and a line's note, what saving it will do, as its description. Remove
 * stands at the end of every line while there is more than one.
 *
 * A paste into a name field that holds lines of `NAME=value` is the
 * caller's (`onPasteLines`): it answers whether it took them, as a `.env`
 * pasted whole is spread a pair to a line, and one it took never lands in
 * the field. Any other paste lands as typing does. Each line's fields are
 * named to a reader by the columns' headings, which stand once above them.
 */

/** One line: the key it is kept by, its name and value, and what is wrong with it or what saving it does. */
export interface NameValueRow {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  /** What is wrong with the name; nothing while it is fine. */
  readonly problem?: string | undefined;
  /** What saving the line will do, said under its name. */
  readonly note?: ReactNode;
}

/** The grid the lines stand in: the name, the wider value, and Remove's room. */
const GRID =
  "ui-name-value-rows grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-start gap-x-control-gap gap-y-ui-8";

/** A column's heading over its fields. */
function ColumnHead({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Text as="span" variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} aria-hidden="true">
      {children}
    </Text>
  );
}

/** The words a paste carries, as the clipboard holds them, line breaks and all. */
function pastedText(event: ClipboardEvent<HTMLElement>): string {
  return event.clipboardData.getData("text");
}

export function NameValueRows({
  rows,
  secret,
  namePlaceholder,
  disabled = false,
  onName,
  onValue,
  onRemove,
  onPasteLines,
}: {
  rows: readonly NameValueRow[];
  /** Whether the values are masked as secrets are. */
  secret: boolean;
  namePlaceholder: string;
  disabled?: boolean | undefined;
  onName: (key: string, name: string) => void;
  onValue: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  /** Takes the lines a paste into a name field holds, answering whether it took them. */
  onPasteLines: (key: string, text: string) => boolean;
}): React.JSX.Element {
  const removable = rows.length > 1;

  return (
    <div className={GRID}>
      <ColumnHead>Name</ColumnHead>
      <ColumnHead>Value</ColumnHead>
      <span />
      {rows.map((row, at) => (
        <NameValueLine
          key={row.key}
          row={row}
          first={at === 0}
          secret={secret}
          namePlaceholder={namePlaceholder}
          disabled={disabled}
          removable={removable}
          onName={onName}
          onValue={onValue}
          onRemove={onRemove}
          onPasteLines={onPasteLines}
        />
      ))}
    </div>
  );
}

function NameValueLine({
  row,
  first,
  secret,
  namePlaceholder,
  disabled,
  removable,
  onName,
  onValue,
  onRemove,
  onPasteLines,
}: {
  row: NameValueRow;
  first: boolean;
  secret: boolean;
  namePlaceholder: string;
  disabled: boolean;
  removable: boolean;
  onName: (key: string, name: string) => void;
  onValue: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  onPasteLines: (key: string, text: string) => boolean;
}): React.JSX.Element {
  const valueLabel = <VisuallyHidden>Value</VisuallyHidden>;

  return (
    <>
      {/* Note that a paste is heard before it lands, because a one-line field drops the line breaks a `.env` is read by. */}
      <div
        onPasteCapture={(event) => {
          if (onPasteLines(row.key, pastedText(event))) event.preventDefault();
        }}
      >
        <FormField
          label={<VisuallyHidden>Name</VisuallyHidden>}
          error={inputProblem(row.problem)}
          description={row.note}
        >
          {(control) => (
            <TextField
              field={control}
              font={TEXT_FIELD_FONT.MONO}
              placeholder={namePlaceholder}
              autoCorrect={false}
              spellCheck={false}
              autoFocus={first}
              disabled={disabled}
              value={row.name}
              onChange={(name) => onName(row.key, name)}
            />
          )}
        </FormField>
      </div>
      {secret ? (
        <SecretField
          label={valueLabel}
          disabled={disabled}
          value={row.value}
          onChange={(value) => onValue(row.key, value)}
        />
      ) : (
        <FormField label={valueLabel}>
          {(control) => (
            <TextField
              field={control}
              font={TEXT_FIELD_FONT.MONO}
              autoCorrect={false}
              spellCheck={false}
              disabled={disabled}
              value={row.value}
              onChange={(value) => onValue(row.key, value)}
            />
          )}
        </FormField>
      )}
      {/* Note that Remove stands on its line's field, a field's height tall under the gap a field's hidden label leaves (`Field`), so a line's problem under its name moves it nowhere. */}
      {removable ? (
        <span className="ui-name-value-remove mt-ui-6 flex h-control items-center">
          <IconButton
            icon={<TrashIcon />}
            label={row.name === "" ? "Remove this line" : `Remove ${row.name}`}
            size={BUTTON_SIZE.CONTROL}
            disabled={disabled}
            onClick={() => onRemove(row.key)}
          />
        </span>
      ) : (
        <span />
      )}
    </>
  );
}
