import {
  BUTTON_VARIANT,
  Button,
  Inline,
  PlusIcon,
  SETTINGS_SKELETON_CONTROL,
  SettingsDialog,
  type SettingsDialogSection,
  SettingsDialogSkeleton,
  SettingsRow,
  SettingsRowValue,
  SettingsSection,
  type SettingsSectionSkeletonLayout,
  Switch,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * settings-dialog.tsx -- a Manager's settings in a dialog, its sections
 * listed down the card's start and the one chosen beside them, each of its
 * rows saving itself; and the same dialog while its section's rows are read,
 * its list whole and placeholder sections in the section's place. At a
 * phone's width each opens on its list, and a section pressed there stands in
 * the list's room under the way back to it.
 */

/** The sections a Manager's settings hold. */
const SECTION = {
  GENERAL: "general",
  PEOPLE: "people",
  AUTOMATIONS: "automations",
  MEMORY: "memory",
} as const;

type Section = (typeof SECTION)[keyof typeof SECTION];

const SECTIONS: readonly SettingsDialogSection<Section>[] = [
  { id: SECTION.GENERAL, title: "General" },
  { id: SECTION.PEOPLE, title: "People" },
  { id: SECTION.AUTOMATIONS, title: "Automations" },
  { id: SECTION.MEMORY, title: "Memory" },
];

/** What People's rows land as while they are read: three people, each with a switch. */
const PEOPLE_LAYOUT: readonly SettingsSectionSkeletonLayout[] = [
  {
    headed: true,
    rows: [
      { described: true, controls: [SETTINGS_SKELETON_CONTROL.SWITCH] },
      { described: true, controls: [SETTINGS_SKELETON_CONTROL.VALUE] },
      { described: true, controls: [SETTINGS_SKELETON_CONTROL.SWITCH] },
    ],
  },
];

/** A switch that keeps its own state, named for its row. */
function HeldSwitch({
  label,
  on: initial,
  describedBy,
}: {
  label: string;
  on: boolean;
  describedBy: string | undefined;
}): React.JSX.Element {
  const [on, setOn] = useState(initial);

  return <Switch checked={on} label={label} describedBy={describedBy} onChange={setOn} />;
}

/** A row ending in a switch of its own. */
function SwitchRow({
  label,
  description,
  on = true,
}: {
  label: string;
  description?: string;
  on?: boolean;
}): React.JSX.Element {
  return (
    <SettingsRow label={label} description={description}>
      {(control) => <HeldSwitch label={label} on={on} describedBy={control["aria-describedby"]} />}
    </SettingsRow>
  );
}

/** A row ending in a value it names. */
function ValueRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <SettingsRow label={label}>{() => <SettingsRowValue>{value}</SettingsRowValue>}</SettingsRow>
  );
}

/** The section `section`, as its own `SettingsSection`s. */
function SectionBody({ section }: { section: Section }): React.JSX.Element {
  switch (section) {
    case SECTION.GENERAL:
      return (
        <>
          <SettingsSection>
            <ValueRow label="Name" value="Release Manager" />
            <ValueRow label="Model" value="Opus 5.5" />
            <ValueRow label="Repository" value="acme/web" />
          </SettingsSection>
          <SettingsSection>
            <SettingsRow label="Archive" description="It stops and leaves the sidebar.">
              {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Archive</Button>}
            </SettingsRow>
            <SettingsRow label="Delete" description="Its conversation goes for good.">
              {() => <Button variant={BUTTON_VARIANT.DANGER}>Delete</Button>}
            </SettingsRow>
          </SettingsSection>
        </>
      );
    case SECTION.PEOPLE:
      return (
        <SettingsSection
          title="Followers"
          caption="It can use their Macs if they let it."
          action={
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />}>
              Add person
            </Button>
          }
        >
          <SwitchRow label="You" description="Let this Manager use my machines" />
          <SettingsRow label="Grace Hopper" description="Owner">
            {() => <SettingsRowValue>Always</SettingsRowValue>}
          </SettingsRow>
          <SwitchRow
            label="Alan Turing"
            description="Let this Manager use my machines"
            on={false}
          />
        </SettingsSection>
      );
    case SECTION.AUTOMATIONS:
      return (
        <SettingsSection title="Runs here">
          <SwitchRow label="Morning triage" description="Every weekday at 9:00" />
          <SwitchRow label="Weekly release notes" description="Fridays at 16:00" on={false} />
        </SettingsSection>
      );
    case SECTION.MEMORY:
      return (
        <SettingsSection title="Its own">
          <ValueRow label="Releases go out from the release branch." value="12 recalls" />
          <ValueRow label="A hotfix is cherry-picked onto it." value="3 recalls" />
        </SettingsSection>
      );
  }
}

/** A Manager's settings, opened from its button on General. */
function LoadedDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>(SECTION.GENERAL);

  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Manager settings…
      </Button>
      <SettingsDialog
        open={open}
        title="Release Manager"
        sections={SECTIONS}
        current={section}
        onChoose={setSection}
        onDismiss={() => setOpen(false)}
      >
        <SectionBody section={section} />
      </SettingsDialog>
    </>
  );
}

/** The same dialog on People while its rows are read. */
function ReadingDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>(SECTION.PEOPLE);

  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        While it reads…
      </Button>
      <SettingsDialogSkeleton
        open={open}
        title="Release Manager"
        sections={SECTIONS}
        current={section}
        onChoose={setSection}
        onDismiss={() => setOpen(false)}
        label="Reading the people"
        layouts={PEOPLE_LAYOUT}
      />
    </>
  );
}

function SettingsDialogs(): React.JSX.Element {
  return (
    <CatalogSection id="settings-dialog-states" title="Settings dialog">
      <Inline>
        <LoadedDialog />
        <ReadingDialog />
      </Inline>
    </CatalogSection>
  );
}

export const SETTINGS_DIALOG_EXAMPLE: Example = {
  id: "settings-dialog",
  title: "Settings dialog",
  Render: SettingsDialogs,
};
