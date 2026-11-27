/**
 * section-icon-ask.tsx -- where a sidebar section's icon is changed: the icon picker a screen stands for its sections' headers, which a header's Change icon asks for by the section it heads, and the icons this phone picked last, which its Recent offers.
 *
 * A header stands inside a SwiftUI list, where no sheet can stand, so the
 * screen listing it stands one picker (`SectionIconAsking`) and its headers
 * ask it through `useSectionIconAsk`, as a Manager's row asks for its face
 * (`face-ask.tsx`). The icons picked last are kept as the wire carries them
 * (`taskSectionIconSchema`), each glyph in the color it was picked in,
 * newest first, in the app's `NSUserDefaults` for the next launch, as the
 * panel keeps the icons a Mac chose last.
 */

import { recentIcons } from "@repo/features/section-icon-model";
import { type TaskSectionIcon, taskSectionIconSchema } from "@repo/features/task-section-wire";
import { heldValue, RECENT_ICONS_MOST, SectionIconSheet, useHeldValue } from "@repo/ui-native";
import { Option, Schema } from "effect";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { Settings } from "react-native";

/** The defaults key the icons picked last are kept under. */
const RECENT_KEY = "sectionIconsRecent";

/** The list kept at launch, none where the defaults hold nothing readable, such as a build that kept another shape. */
const decodeKept = Schema.decodeUnknownOption(Schema.Array(taskSectionIconSchema));

/** The icons picked last as the phone holds them now, newest first. */
const recent = heldValue(
  Option.getOrElse(decodeKept(Settings.get(RECENT_KEY)), (): readonly TaskSectionIcon[] => []),
);

/** Puts `picked` at the head of the icons picked last, for this launch and the next. */
function keepRecentIcon(picked: TaskSectionIcon): void {
  const next = recentIcons(recent.read(), picked, RECENT_ICONS_MOST);

  Settings.set({ [RECENT_KEY]: next });
  recent.set(next);
}

/** Opens the icon picker over a section: the icon it wears, and what hears the icon picked, or null for Remove icon. */
export type SectionIconAsk = (
  icon: TaskSectionIcon | undefined,
  onPick: (icon: TaskSectionIcon | null) => void,
) => void;

/** The picker the screen stands for its headers; none outside one. */
const SectionIconAskContext = createContext<SectionIconAsk | undefined>(undefined);

/** The section the picker stands over: the icon it wore as it opened, and what hears the pick. */
type Asked = {
  readonly icon: TaskSectionIcon | undefined;
  readonly onPick: (icon: TaskSectionIcon | null) => void;
};

/**
 * The screen's section icon picker, which a header under it opens over its
 * section (`useSectionIconAsk`), Done changing the icon at once, as the
 * panel's picker does, and keeping it among Recent.
 */
export function SectionIconAsking({ children }: { readonly children: ReactNode }) {
  const [asked, setAsked] = useState<Asked | undefined>(undefined);
  const recentShown = useHeldValue(recent);

  const ask = useCallback<SectionIconAsk>((icon, onPick) => setAsked({ icon, onPick }), []);

  return (
    <SectionIconAskContext value={ask}>
      {children}
      <SectionIconSheet
        icon={asked?.icon}
        recent={recentShown}
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onPick={(picked) => {
          if (picked !== null) keepRecentIcon(picked);
          asked?.onPick(picked);
        }}
      />
    </SectionIconAskContext>
  );
}

/** What opens the screen's section icon picker; none on a screen that stands none. */
export function useSectionIconAsk(): SectionIconAsk | undefined {
  return useContext(SectionIconAskContext);
}
