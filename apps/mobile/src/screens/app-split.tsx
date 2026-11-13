// app-split.tsx -- the one split view a window wide enough for three columns stands over the tabs: the app sidebar, drawn once for every tab, beside the list and the page the tab standing hands it.

import { Screen, SplitView } from "@repo/ui-native";
import { usePlaceColumns } from "../place-columns.js";
import { SIDEBAR_PLACE, type SidebarPlace, useAppSidebar } from "./app-sidebar.js";
import { useSidebarTasks } from "./task-screens.js";

/**
 * The tabs' one split view: the app sidebar, with the place `place` names
 * selected, beside the list and the detail that place's root hands over
 * (`useHandColumns`), and the question a sidebar row's Mark done asks
 * first. Note that the list and the detail are drawn afresh for each place,
 * so the search field over a list starts from that list's own query, while
 * the sidebar stays, scrolled where it was. Note that a place whose root has
 * handed nothing yet, as a tab opened for the first time, stands its columns
 * empty for that frame rather than taking them away, since a split view
 * that loses its middle column is a different view and is drawn anew.
 */
export function AppSplit({ place }: { readonly place: SidebarPlace | undefined }) {
  const standing = place ?? SIDEBAR_PLACE.INBOX;
  const columns = usePlaceColumns(standing);
  const tasks = useSidebarTasks();
  const sidebar = useAppSidebar(standing, tasks, columns?.openTask);

  return (
    <>
      <Screen>
        <SplitView
          {...sidebar}
          content={columns?.content ?? null}
          contentBar={columns?.contentBar}
          detail={columns?.detail ?? null}
          detailBar={columns?.detailBar}
          columnsKey={standing}
        />
      </Screen>
      {tasks.ask}
    </>
  );
}
