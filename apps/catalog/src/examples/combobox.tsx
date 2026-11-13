import {
  APP_ICON_SIZE,
  AppIcon,
  COMBOBOX_LIST_HEIGHT,
  Combobox,
  ComboboxList,
  ComboboxListBox,
  type ComboboxOption,
  ComboboxOptionItem,
  ComposeIcon,
  comboboxOptionId,
  DocumentIcon,
  FolderIcon,
  MARK_PROVIDER,
  ProviderMark,
  SearchField,
  useComboboxField,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * combobox.tsx -- a Combobox narrowing synthetic issues under a heading, with
 * the words as typed offered after them, open on a query; in a narrow
 * column with a long title; and a list standing alone on a popover, as an
 * editor's `@` hangs one, a row that opens a further list wearing its
 * chevron, and its note where nothing matches, and the apps on the
 * developer's Mac it offers, each by its icon, or a screen's glyph where
 * the Mac drew none yet; and a list too short to
 * search, holding the keys itself, with a model that cannot be chosen now,
 * the one chosen checked, and a note after them; and rows a list engine of
 * the app's owns, each drawn as `ComboboxOptionItem`, the second lit as the
 * engine's `aria-selected` says, in the box the engine owns too
 * (`ComboboxListBox`); and that box filling a short card under a search
 * row, as ⌘K's results do, scrolling inside itself.
 */

/** Synthetic issues, as a tracker would list them. */
const ISSUES = [
  { id: "eng-1", key: "ENG-1", title: "Restack the deploy queue", state: "Todo" },
  {
    id: "eng-2",
    key: "ENG-2",
    title: "Add support for stacked pull requests",
    state: "In Progress",
  },
  { id: "ops-7", key: "OPS-7", title: "Rotate the deploy key", state: "Backlog" },
] as const;

/** A field over the issues its words match, holding its own words and active option as a caller would. */
function Issues({ start }: { start: string }): React.JSX.Element {
  const [value, setValue] = useState(start);
  const [active, setActive] = useState(0);
  const [shut, setShut] = useState(false);
  const words = value.trim().toLowerCase();

  const issues: ComboboxOption[] = ISSUES.flatMap((issue) =>
    words === "" || !issue.title.toLowerCase().includes(words)
      ? []
      : [
          {
            id: issue.id,
            label: issue.title,
            icon: <ProviderMark provider={MARK_PROVIDER.LINEAR} />,
            detail: `${issue.key} · ${issue.state}`,
          },
        ],
  );

  const typed: ComboboxOption = {
    id: "typed",
    label: `Create task “${value.trim()}”`,
    icon: <ComposeIcon />,
    hint: "⌘⏎",
  };

  return (
    <Combobox
      label="Task name"
      listLabel="Issues"
      placeholder="Task name, or search issues"
      value={value}
      onChange={(next) => {
        setValue(next);
        setActive(0);
        setShut(false);
      }}
      groups={[{ label: "Issues", options: issues }, { options: [typed] }]}
      open={!shut && issues.length > 0}
      active={active}
      onActiveChange={setActive}
      onChoose={() => setShut(true)}
      onEscape={() => setShut(true)}
    />
  );
}

/** Synthetic mentions, as an editor's `@` would offer them: a file, a folder, and the kind a press narrows to. */
const MENTIONS: readonly ComboboxOption[] = [
  { id: "readme", label: "README.md", icon: <DocumentIcon />, detail: "docs" },
  { id: "src", label: "src/", icon: <FolderIcon />, detail: "packages/ui" },
  { id: "files", label: "Files and folders", icon: <FolderIcon />, detail: "2 files", opens: true },
];

/** A synthetic app's icon, a rounded square with a phone in it, as a Mac's app sends one. */
const PHONE_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#1d6fe0"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="13" fill="url(#a)"/><rect x="22" y="12" width="20" height="40" rx="5" fill="#0b0d12"/><rect x="24" y="15" width="16" height="34" rx="3" fill="#e8f2ff"/></svg>',
)}`;

/** A synthetic notes app's icon, a yellow-headed page. */
const NOTES_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="13" fill="#fff" stroke="#d8d8d8"/><path d="M4 17a13 13 0 0 1 13-13h30a13 13 0 0 1 13 13v5H4z" fill="#f7c948"/><rect x="12" y="32" width="40" height="3" rx="1.5" fill="#c9c9c9"/><rect x="12" y="42" width="30" height="3" rx="1.5" fill="#c9c9c9"/></svg>',
)}`;

/** Synthetic apps on the developer's Mac, as an agent's `@` offers them: running first, one always allowed, and one installed whose icon is still being read. */
const APPS: readonly ComboboxOption[] = [
  {
    id: "simulator",
    label: "Simulator",
    icon: <AppIcon src={PHONE_ICON} size={APP_ICON_SIZE.LINE} />,
    detail: "Running",
  },
  {
    id: "notes",
    label: "Notes",
    icon: <AppIcon src={NOTES_ICON} size={APP_ICON_SIZE.LINE} />,
    detail: "Always allowed",
  },
  { id: "xcode", label: "Xcode", icon: <AppIcon size={APP_ICON_SIZE.LINE} /> },
];

/** A list standing alone over `options`, holding its own active option as an editor's caller would. */
function Mentions({
  options,
  group = "Files and folders",
}: {
  options: readonly ComboboxOption[];
  group?: string;
}): React.JSX.Element {
  const [active, setActive] = useState(0);

  return (
    <div className="catalog-popover catalog-column">
      <ComboboxList
        label="Mention"
        groups={options.length === 0 ? [] : [{ label: group, options }]}
        active={active}
        onActiveChange={setActive}
        onChoose={setActive}
        empty="Nothing matches"
      />
    </div>
  );
}

/** Synthetic models, as a picker would list them: one not on the plan, and the one chosen. */
const MODELS: readonly ComboboxOption[] = [
  { id: "opus", label: "Opus", detail: "High", current: true },
  { id: "sonnet", label: "Sonnet", hint: "Not on this plan", disabled: true, current: false },
  { id: "haiku", label: "Haiku", hint: "⌘3", current: false },
];

/** A list with no field, steering itself as a picker too short to search does. */
function Models(): React.JSX.Element {
  const [active, setActive] = useState(0);

  const keys = useComboboxField({
    open: true,
    active,
    count: MODELS.length,
    skipped: (index) => MODELS[index]?.disabled === true,
    controls: "catalog-models",
    activeId: comboboxOptionId("catalog-models", active),
    onActiveChange: setActive,
    onChoose: setActive,
  });

  return (
    <div className="catalog-popover catalog-column">
      <ComboboxList
        id="catalog-models"
        label="Model"
        groups={[{ label: "Models", options: MODELS }]}
        active={active}
        onActiveChange={setActive}
        onChoose={setActive}
        steer={keys}
        note="Reading more models…"
      />
    </div>
  );
}

/** Rows as a list engine (cmdk) would hand them through its `asChild`, in the box it owns, the second the engine's selected one. */
function EngineRows(): React.JSX.Element {
  return (
    <div className="catalog-popover catalog-column">
      <ComboboxListBox aria-label="Results">
        <ComboboxOptionItem
          option={{ id: "new-task", label: "New task", icon: <ComposeIcon />, hint: "⌘N" }}
          aria-selected={false}
        />
        <ComboboxOptionItem
          option={{ id: "readme", label: "README.md", icon: <DocumentIcon />, detail: "docs" }}
          aria-selected
        />
        <ComboboxOptionItem
          option={{ id: "src", label: "src/", icon: <FolderIcon />, detail: "packages/ui" }}
          aria-selected={false}
        />
        <ComboboxOptionItem
          option={{
            id: "task",
            lead: "ACME-42",
            label: "Teammate invitations",
            icon: <DocumentIcon />,
            detail: "relay",
          }}
          aria-selected={false}
        />
      </ComboboxListBox>
    </div>
  );
}

/** Synthetic files, more than a short card holds, as a palette's Files filter lists them. */
const FILES = Array.from({ length: 12 }, (_, index) => ({
  id: `file-${index}`,
  label: `notes-${index + 1}.md`,
  icon: <DocumentIcon />,
  detail: "docs/notes",
}));

/** An engine's box filling a short card under its search row, as ⌘K's results fill its card, scrolling inside itself. */
function EngineFill(): React.JSX.Element {
  return (
    <div className="catalog-popover catalog-column catalog-palette">
      <SearchField label="Search files" value="notes" onChange={() => undefined} />
      <ComboboxListBox aria-label="Files" height={COMBOBOX_LIST_HEIGHT.FILL}>
        {FILES.map((option, index) => (
          <ComboboxOptionItem key={option.id} option={option} aria-selected={index === 0} />
        ))}
      </ComboboxListBox>
    </div>
  );
}

function Comboboxes(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="combobox-open" title="Narrowing issues, the words as typed after them">
        <div className="catalog-column">
          <Issues start="deploy" />
        </div>
      </CatalogSection>
      <CatalogSection id="combobox-narrow" title="Narrow column, long title">
        <div className="catalog-narrow">
          <Issues start="stacked" />
        </div>
      </CatalogSection>
      <CatalogSection id="combobox-list" title="A list standing alone, under an editor's words">
        <Mentions options={MENTIONS} />
      </CatalogSection>
      <CatalogSection id="combobox-list-empty" title="A list standing alone, nothing matching">
        <Mentions options={[]} />
      </CatalogSection>
      <CatalogSection
        id="combobox-list-apps"
        title="The apps on the developer's Mac, under an agent's words"
      >
        <Mentions options={APPS} group="Apps" />
      </CatalogSection>
      <CatalogSection
        id="combobox-list-steered"
        title="A list with no field: a dimmed option, the chosen one, and a note"
      >
        <Models />
      </CatalogSection>
      <CatalogSection id="combobox-engine-rows" title="Rows and a box a list engine owns">
        <EngineRows />
      </CatalogSection>
      <CatalogSection
        id="combobox-engine-fill"
        title="A list engine's box filling a short card, scrolling inside itself"
      >
        <EngineFill />
      </CatalogSection>
    </>
  );
}

export const COMBOBOX_EXAMPLE: Example = {
  id: "combobox",
  title: "Combobox",
  Render: Comboboxes,
};
