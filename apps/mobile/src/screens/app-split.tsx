// app-split.tsx -- the one split view a window wide enough for three columns stands over the tabs: the app sidebar, drawn once for every tab, beside the list and the page the tab standing hands it, each tab's kept where it was left.

import {
  type BarAction,
  GLYPH,
  KeptColumns,
  type KeptView,
  Screen,
  SplitView,
} from "@repo/ui-native";
import { useEffect, useState } from "react";
import { InFrontProvider, type PlaceColumns, usePlaceColumns } from "../place-columns.js";
import {
  SIDEBAR_PLACE,
  type SidebarPlace,
  useAppSidebar,
  useComposeAction,
} from "./app-sidebar.js";
import { useSidebarTasks } from "./task-screens.js";

/** A sidebar pick's place, and the place the route stood in when it was made. */
type HeldPick = { readonly place: SidebarPlace; readonly over: SidebarPlace | undefined };

/** What Mail's expand button is heard as, standing the page alone across the window and bringing the columns back. */
const EXPAND_WORDS = { EXPAND: "Expand", COLLAPSE: "Collapse" } as const;

/** The places, in the order their columns stand kept. */
const PLACES = [SIDEBAR_PLACE.INBOX, SIDEBAR_PLACE.TASKS, SIDEBAR_PLACE.SEARCH] as const;

/** Each handed place's list, standing in front only where it is the place shown and the split view is. */
function keptViews(
  held: ReadonlyMap<SidebarPlace, PlaceColumns>,
  shown: SidebarPlace,
  front: boolean,
): readonly KeptView[] {
  return PLACES.flatMap((place) => {
    const columns = held.get(place);

    if (columns === undefined) return [];

    return [
      {
        key: place,
        view: <InFrontProvider value={front && place === shown}>{columns.content}</InFrontProvider>,
      },
    ];
  });
}

/**
 * The tabs' one split view: the app sidebar, with the place `place` names
 * selected, beside the list and the detail that place's root hands over
 * (`useHandColumns`), the list's bar ending in New task. Note that every place handed so far keeps its list drawn, hidden
 * behind the one shown, so a tab comes back scrolled where it was left, as
 * Mail keeps each mailbox, while the sidebar stays where it is. Note that
 * the detail column draws the shown place's page alone, because a page such
 * as a thread's publishes its own bar items, which SwiftUI takes from a
 * hidden view as readily as from a shown one.
 * Note that a place whose root has handed nothing yet, as a tab opened for
 * the first time, stands its columns empty for that frame rather than taking
 * them away, since a split view that loses its middle column is a different
 * view and is drawn anew. Its detail stands in front only while the split
 * view does (`front`), so a pushed page's Handoff activity wins while it
 * stands and the detail's comes back as it goes. Note that a sidebar pick
 * stands at once, its place's columns and its row selected, until the route
 * moves, because the tab's route answers a few renders after the press,
 * which iPadOS 26 drew as most of a second. The detail's bar leads with
 * Mail's expand button, which stands the page alone across the window and
 * back, and the page's main acts stand in the same bar.
 */
export function AppSplit({
  place,
  front,
}: {
  readonly place: SidebarPlace | undefined;
  readonly front: boolean;
}) {
  const inbox = usePlaceColumns(SIDEBAR_PLACE.INBOX);
  const tasks = usePlaceColumns(SIDEBAR_PLACE.TASKS);
  const search = usePlaceColumns(SIDEBAR_PLACE.SEARCH);

  const handed = [
    [SIDEBAR_PLACE.INBOX, inbox],
    [SIDEBAR_PLACE.TASKS, tasks],
    [SIDEBAR_PLACE.SEARCH, search],
  ] as const;

  const kept = new Map<SidebarPlace, PlaceColumns>(
    handed.flatMap(([each, columns]) => (columns === undefined ? [] : [[each, columns] as const])),
  );

  const [held, hold] = useState<HeldPick | undefined>(undefined);
  // Note that a moved route drops the hold outright, so the route's own place stands from then on.
  useEffect(() => hold(undefined), [place]);
  const pick = held !== undefined && held.over === place ? held : undefined;
  const standing = pick?.place ?? place ?? SIDEBAR_PLACE.INBOX;
  const columns = kept.get(standing);
  const compose = useComposeAction();
  // Note that the page stands alone until a person brings the columns back, by this button or the system's sidebar button, as Mail's expand holds.
  const [detailOnly, setDetailOnly] = useState(false);

  const expand: BarAction = detailOnly
    ? { label: EXPAND_WORDS.COLLAPSE, symbol: GLYPH.COLLAPSE, onPress: () => setDetailOnly(false) }
    : { label: EXPAND_WORDS.EXPAND, symbol: GLYPH.EXPAND, onPress: () => setDetailOnly(true) };

  const sidebar = useAppSidebar(standing, useSidebarTasks(), (picked) =>
    hold({ place: picked, over: place }),
  );

  return (
    <Screen>
      <SplitView
        {...sidebar}
        content={<KeptColumns shown={standing} views={keptViews(kept, standing, front)} />}
        contentBar={{ ...columns?.contentBar, action: compose }}
        detail={<InFrontProvider value={front}>{columns?.detail}</InFrontProvider>}
        detailBar={{ ...columns?.detailBar, expand }}
        searchKey={standing}
        detailOnly={detailOnly}
        onDetailOnlyChange={setDetailOnly}
      />
    </Screen>
  );
}
