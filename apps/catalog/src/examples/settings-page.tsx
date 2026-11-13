import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BackButton,
  BUTTON_VARIANT,
  Button,
  EmptyState,
  MoreButton,
  PlugIcon,
  SETTINGS_PAGE_WIDTH,
  SETTINGS_SECTION_FRAME,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  Switch,
  TOOLBAR_LOOK,
  type ToolbarLook,
} from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
} from "@repo/ui/data-table";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * settings-page.tsx -- a page of sections with a Reset at the end of its
 * title's line, tall enough to scroll inside its frame; and the same page
 * in a frame narrower than the 480px a desktop page insets less under, its
 * long title pushing the Reset below it; the page on a phone, its way back
 * and a ⋯ holding its Reset in its bar's corners; a page whose content is an empty
 * state, standing in the room under its title; and a page at the wide
 * measure holding a table of records, its head following it.
 */

function HeldSwitch({ label, describedBy }: { label: string; describedBy: string | undefined }) {
  const [on, setOn] = useState(true);

  return <Switch checked={on} label={label} describedBy={describedBy} onChange={setOn} />;
}

function SwitchRow({ label, description }: { label: string; description?: string }) {
  return (
    <SettingsRow label={label} description={description}>
      {(control) => <HeldSwitch label={label} describedBy={control["aria-describedby"]} />}
    </SettingsRow>
  );
}

function Page({ title, look }: { title: string; look?: ToolbarLook }): React.JSX.Element {
  return (
    <SettingsPage
      title={title}
      look={look}
      lead={
        look === TOOLBAR_LOOK.PHONE ? (
          <BackButton label="Settings" place="settings" onBack={() => undefined} />
        ) : undefined
      }
      actions={
        // A phone's corner holds one control, so its reset stands in a ⋯, as the app's does.
        look === TOOLBAR_LOOK.PHONE ? (
          <MoreButton thing={title} onClick={() => undefined} />
        ) : (
          <Button variant={BUTTON_VARIANT.QUIET}>Reset</Button>
        )
      }
    >
      <SettingsSection title="General">
        <SwitchRow
          label="Launch at login"
          description={`${PRODUCT_NAME} opens with the Mac, in the menu bar.`}
        />
        <SwitchRow
          label="Show captions"
          description="Words the call hears stand under its video."
        />
      </SettingsSection>
      <SettingsSection title="Agents">
        <SwitchRow
          label="Archive a run once its pull request merges"
          description="Runs whose branch merged stop showing in the sidebar."
        />
        <SettingsRow label="Repositories">
          {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Choose repositories</Button>}
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Notifications">
        <SwitchRow label="Play a sound when a run finishes" />
        <SwitchRow label="Notify me when a run needs an answer" />
      </SettingsSection>
      <SettingsSection title="Account">
        <SettingsRow label="Sign out" description="dev@example.com">
          {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Sign out</Button>}
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
}

interface Note {
  readonly id: string;
  readonly words: string;
  readonly savedBy: string;
  readonly recalls: number;
  readonly last: string;
}

const NOTES: readonly Note[] = [
  {
    id: "deploys",
    words: "Deployments go out from the release branch, and a hotfix is cherry-picked onto it.",
    savedBy: "Ship the release notes",
    recalls: 42,
    last: "2 hours ago",
  },
  {
    id: "tests",
    words: "The store tests run against an in-memory database, so they need no server.",
    savedBy: "Audit the test suite",
    recalls: 7,
    last: "Yesterday",
  },
];

const noteColumn = createDataTableColumnHelper<Note>();

const NOTE_COLUMNS = noteColumn.columns([
  noteColumn.accessor((note) => note.words, {
    id: "words",
    header: "Note",
    meta: { kind: DATA_TABLE_COLUMN_KIND.PROSE },
    sortFn: "text",
  }),
  noteColumn.accessor((note) => note.savedBy, {
    id: "savedBy",
    header: "Saved by",
    sortFn: "text",
  }),
  noteColumn.accessor((note) => note.recalls, {
    id: "recalls",
    header: "Recalls",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    sortFn: "basic",
    sortDescFirst: true,
  }),
  noteColumn.display({ id: "last", header: "Last recalled", cell: ({ row }) => row.original.last }),
]);

function SettingsPages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="settings-page-wide" title="A page that scrolls">
        <div className="catalog-settings-frame">
          <Page title="General" />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-page-narrow" title="Narrower than 480px, a long title">
        <div className="catalog-settings-frame catalog-settings-frame-narrow">
          <Page title="Agents and their pull requests" />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-page-phone" title="On a phone, its actions ending the bar">
        <div className="catalog-settings-frame catalog-settings-frame-narrow">
          <Page title="General" look={TOOLBAR_LOOK.PHONE} />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-page-empty" title="An empty state filling the page">
        <div className="catalog-settings-frame">
          <SettingsPage title="Experimental">
            <EmptyState icon={<PlugIcon />}>Nothing to try out right now.</EmptyState>
          </SettingsPage>
        </div>
      </CatalogSection>
      <CatalogSection
        id="settings-page-wide-measure"
        title="At the wide measure, a table of records"
      >
        <div className="catalog-settings-frame catalog-settings-frame-wide">
          <SettingsPage title="Notes" width={SETTINGS_PAGE_WIDTH.WIDE}>
            <SettingsSection frame={SETTINGS_SECTION_FRAME.NONE}>
              <DataTable
                label="Notes"
                columns={NOTE_COLUMNS}
                rows={NOTES}
                getRowId={(note) => note.id}
                empty=""
                minWidth={DATA_TABLE_MIN_WIDTH.WIDE}
              />
            </SettingsSection>
          </SettingsPage>
        </div>
      </CatalogSection>
    </>
  );
}

export const SETTINGS_PAGE_EXAMPLE: Example = {
  id: "settings-page",
  title: "Settings page",
  Render: SettingsPages,
};
