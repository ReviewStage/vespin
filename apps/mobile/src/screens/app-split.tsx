// app-split.tsx -- the one split view a window wide enough for three columns stands over the tabs: the app sidebar, drawn once for every tab, beside the list and the page the tab standing hands it, each tab's kept where it was left.

import { KeptColumns, type KeptView, Screen, SplitView } from "@repo/ui-native";
import { InFrontProvider, type PlaceColumns, usePlaceColumns } from "../place-columns.js";
import { SIDEBAR_PLACE, type SidebarPlace, useAppSidebar } from "./app-sidebar.js";
import { useSidebarTasks } from "./task-screens.js";

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
 * (`useHandColumns`), and the question a sidebar row's Mark done asks
 * first. Note that every place handed so far keeps its list drawn, hidden
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
 * stands and the detail's comes back as it goes.
 */
export function AppSplit({
  place,
  front,
}: {
  readonly place: SidebarPlace | undefined;
  readonly front: boolean;
}) {
  const standing = place ?? SIDEBAR_PLACE.INBOX;
  const inbox = usePlaceColumns(SIDEBAR_PLACE.INBOX);
  const tasks = usePlaceColumns(SIDEBAR_PLACE.TASKS);
  const search = usePlaceColumns(SIDEBAR_PLACE.SEARCH);

  const handed = [
    [SIDEBAR_PLACE.INBOX, inbox],
    [SIDEBAR_PLACE.TASKS, tasks],
    [SIDEBAR_PLACE.SEARCH, search],
  ] as const;

  const held = new Map<SidebarPlace, PlaceColumns>(
    handed.flatMap(([each, columns]) => (columns === undefined ? [] : [[each, columns] as const])),
  );

  const columns = held.get(standing);
  const sidebarTasks = useSidebarTasks();
  const sidebar = useAppSidebar(standing, sidebarTasks, columns?.openTask);

  return (
    <>
      <Screen>
        <SplitView
          {...sidebar}
          content={<KeptColumns shown={standing} views={keptViews(held, standing, front)} />}
          contentBar={columns?.contentBar}
          detail={<InFrontProvider value={front}>{columns?.detail}</InFrontProvider>}
          detailBar={columns?.detailBar}
          searchKey={standing}
        />
      </Screen>
      {sidebarTasks.ask}
    </>
  );
}
