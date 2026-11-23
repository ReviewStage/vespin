import { IconPicker, IconPickerChoice, IconPickerGroup, NOTE_LINE_LOOK, NoteLine } from "@repo/ui";
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
 * a section's icon picker and a Manager's face picker are drawn in it.
 */

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

function IconPickers(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState("Star");
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
            <IconPickerGroup key={group.name} name={group.name}>
              {group.glyphs.map(({ label, Glyph }) => (
                <IconPickerChoice
                  key={label}
                  label={label}
                  pressed={label === chosen}
                  stop={label === stop}
                  face={<Glyph />}
                  onPress={() => setChosen(label)}
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
