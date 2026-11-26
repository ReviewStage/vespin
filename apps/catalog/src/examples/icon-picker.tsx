import {
  IconButton,
  IconPicker,
  IconPickerChoice,
  IconPickerDrawer,
  IconPickerGroup,
  type IconPickerGroupDrawer,
  NOTE_LINE_LOOK,
  NoteLine,
} from "@repo/ui";
import {
  BookmarkIcon,
  BugIcon,
  FlagIcon,
  HeartIcon,
  type LucideIcon,
  RocketIcon,
  StarIcon,
  ZapIcon,
} from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * icon-picker.tsx -- the app's one icon picker, its frame alone: a search
 * over named groups of choices in rows of ten, the one chosen pressed, the
 * arrows walking the grid, and Enter in the search picking the first found;
 * Flag opens a drawer under its row, as a section glyph's colors stand; a
 * section's icon picker and a Manager's face picker are drawn in it.
 */

/** The inks the drawer offers a flag in, as a section glyph's colors are offered. */
const FLAG_INKS = [
  { label: "Flag in the text's ink", ink: "text-foreground" },
  { label: "Flag in the quiet ink", ink: "text-muted-foreground" },
] as const;

/** The glyphs the example offers, under the group each stands in. */
const GROUPS: readonly { name: string; glyphs: readonly { label: string; Glyph: LucideIcon }[] }[] =
  [
    {
      name: "Marks",
      glyphs: [
        { label: "Star", Glyph: StarIcon },
        { label: "Bookmark", Glyph: BookmarkIcon },
        { label: "Flag", Glyph: FlagIcon },
        { label: "Heart", Glyph: HeartIcon },
      ],
    },
    {
      name: "Work",
      glyphs: [
        { label: "Rocket", Glyph: RocketIcon },
        { label: "Zap", Glyph: ZapIcon },
        { label: "Bug", Glyph: BugIcon },
      ],
    },
  ];

/** The drawer under Flag's row while it stands open: the flag in each ink, a press choosing it. */
function flagDrawer(
  glyphs: readonly { label: string }[],
  open: boolean,
  onChoose: (label: string) => void,
  onClose: () => void,
): IconPickerGroupDrawer | undefined {
  const after = glyphs.findIndex((glyph) => glyph.label === "Flag");

  if (!open || after === -1) return undefined;

  return {
    after,
    content: (
      <IconPickerDrawer label="Flag ink" onClose={onClose}>
        {FLAG_INKS.map(({ label, ink }) => (
          <IconButton
            key={label}
            icon={<FlagIcon className={ink} />}
            label={label}
            roving
            onClick={() => onChoose("Flag")}
          />
        ))}
      </IconPickerDrawer>
    ),
  };
}

function IconPickers(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState("Star");
  const [flagOpen, setFlagOpen] = useState(false);
  const words = query.trim().toLowerCase();

  const shown = GROUPS.flatMap((group) => {
    const glyphs = group.glyphs.filter((glyph) => glyph.label.toLowerCase().includes(words));

    return glyphs.length === 0 ? [] : [{ ...group, glyphs }];
  });

  const labels = shown.flatMap((group) => group.glyphs.map((glyph) => glyph.label));
  const stop = labels.includes(chosen) ? chosen : labels[0];

  return (
    <CatalogSection id="icon-picker" title="Picking">
      <IconPicker searchLabel="Search icons" query={query} onQuery={setQuery} legend="Icons">
        {shown.length === 0 ? (
          <NoteLine look={NOTE_LINE_LOOK.LIST}>No icons match.</NoteLine>
        ) : (
          shown.map((group) => (
            <IconPickerGroup
              key={group.name}
              name={group.name}
              drawer={flagDrawer(
                group.glyphs,
                flagOpen,
                (label) => {
                  setChosen(label);
                  setFlagOpen(false);
                },
                () => setFlagOpen(false),
              )}
            >
              {group.glyphs.map(({ label, Glyph }) => (
                <IconPickerChoice
                  key={label}
                  label={label}
                  pressed={label === chosen}
                  stop={label === stop}
                  face={<Glyph />}
                  onPress={() => (label === "Flag" ? setFlagOpen((was) => !was) : setChosen(label))}
                />
              ))}
            </IconPickerGroup>
          ))
        )}
      </IconPicker>
    </CatalogSection>
  );
}

export const ICON_PICKER_EXAMPLE: Example = {
  id: "icon-picker",
  title: "Icon picker",
  Render: IconPickers,
};
