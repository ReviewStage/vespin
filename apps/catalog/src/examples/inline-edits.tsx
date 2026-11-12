import {
  BUTTON_VARIANT,
  Button,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditLook,
  RenamableName,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * inline-edits.tsx -- an InlineEdit showing a name and renaming it in
 * place, as a field bare across its line and bare in a well that rings it,
 * a name renamed by pressing it, and a long name in a narrow column.
 */

/** A name the example renames in place, as a list renames a row. */
function Renamed({ start, look }: { start: string; look: InlineEditLook }): React.JSX.Element {
  const [name, setName] = useState(start);
  const [editing, setEditing] = useState(false);

  const edit = (
    <InlineEdit
      value={name}
      label="Task name"
      editing={editing}
      maxLength={120}
      look={look}
      onEnd={({ value }) => {
        setEditing(false);

        if (value !== undefined) setName(value);
      }}
    />
  );

  return (
    <div className="catalog-inline-edit">
      {look === INLINE_EDIT_LOOK.WELL && editing ? (
        <span className="catalog-inline-edit-well">{edit}</span>
      ) : (
        edit
      )}
      {editing ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} onClick={() => setEditing(true)}>
          Rename
        </Button>
      )}
    </div>
  );
}

/** A name renamed by pressing it, as a settings row's is: a press opens the field in its place, Return keeps what was typed. */
function PressedName({ start }: { start: string }): React.JSX.Element {
  const [name, setName] = useState(start);
  const [editing, setEditing] = useState(false);

  return (
    <RenamableName
      value={name}
      label="Name"
      editing={editing}
      onBegin={() => setEditing(true)}
      onEnd={({ value }) => {
        setEditing(false);

        if (value !== undefined) setName(value);
      }}
    />
  );
}

function InlineEdits(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="inline-edit-field" title="As a field">
        <div className="catalog-column">
          <Renamed start="Ship the beta" look={INLINE_EDIT_LOOK.FIELD} />
        </div>
      </CatalogSection>
      <CatalogSection id="inline-edit-well" title="In a well">
        <Renamed start="Review the launch plan" look={INLINE_EDIT_LOOK.WELL} />
      </CatalogSection>
      <CatalogSection id="renamable-name" title="Renamed by pressing the name">
        <PressedName start="Dev server" />
      </CatalogSection>
      <CatalogSection id="inline-edit-narrow" title="Narrow column, long name">
        <div className="catalog-narrow">
          <Renamed
            start="A task whose name runs well past its column"
            look={INLINE_EDIT_LOOK.FIELD}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const INLINE_EDITS_EXAMPLE: Example = {
  id: "inline-edits",
  title: "Inline edits",
  Render: InlineEdits,
};
