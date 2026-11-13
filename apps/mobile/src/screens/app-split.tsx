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
import {
  clearDetail,
  DetailPlaceProvider,
  type HeldPage,
  keepDetailPath,
  PageKeyProvider,
  useDetailStack,
} from "../detail-stack.js";
import { InFrontProvider, type PlaceColumns, usePlaceColumns } from "../place-columns.js";
import {
  SIDEBAR_PLACE,
  type SidebarPlace,
  useAppSidebar,
  useComposeAction,
} from "./app-sidebar.js";
import { PushedPageView } from "./pushed-pages.js";
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
 * The pages a place pushed over its detail, each in its place and standing
 * in front only where it is the one on top and the split view stands.
 */
function stackPages(place: SidebarPlace, pages: readonly HeldPage[], front: boolean) {
  const top = pages.at(-1)?.key;

  return pages.map(({ key, page }) => ({
    key,
    view: (
      <DetailPlaceProvider value={place}>
        <PageKeyProvider value={key}>
          <InFrontProvider value={front && key === top}>
            <PushedPageView page={page} />
          </InFrontProvider>
        </PageKeyProvider>
      </DetailPlaceProvider>
    ),
  }));
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
 * back, with New task's compose beside it, as Mail keeps both over the
 * message rather than over its list; the page's main acts stand in the same
 * bar. Expanded, the bar keeps only Collapse and the page's own acts, as
 * Mail's full-screen message does, since New task belongs to the list the
 * page stands beside and stays on ⌘N. With nothing picked the bar holds
 * New task alone, since a lone page has nothing to stand across the window,
 * as Mail shows expand only over an open message. A page opened from the detail, such as a task's agent or its pull
 * request, is pushed over it inside the detail's own column, with a Back
 * there, as Mail opens a message's related pages, so the sidebar and the
 * list stand beside it; each place keeps its own pages, which go as another
 * row is picked (`detail-stack.ts`).
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

  const stack = useDetailStack(standing);
  const root = columns?.root;
  // Note that pages pushed over a detail no longer standing are let go, so a row picked again later opens on its own page alone.
  const stale = stack.pages.length > 0 && stack.over !== root;
  useEffect(() => {
    if (stale) clearDetail(standing);
  }, [stale, standing]);
  const pages = stale ? [] : stack.pages;
  // Note that Collapse stays while the page stands alone even once nothing is picked, so the columns always have a way back.
  const lead = detailOnly ? [expand] : root === undefined ? [compose] : [expand, compose];

  return (
    <Screen>
      <SplitView
        {...sidebar}
        content={<KeptColumns shown={standing} views={keptViews(kept, standing, front)} />}
        contentBar={columns?.contentBar}
        detail={
          <DetailPlaceProvider value={standing}>
            <InFrontProvider value={front && pages.length === 0}>{columns?.detail}</InFrontProvider>
          </DetailPlaceProvider>
        }
        detailBar={{ ...columns?.detailBar, lead }}
        detailStack={{
          pages: stackPages(standing, pages, front),
          onPathChange: (path) => keepDetailPath(standing, path),
        }}
        searchKey={standing}
        detailOnly={detailOnly}
        onDetailOnlyChange={setDetailOnly}
      />
    </Screen>
  );
}
