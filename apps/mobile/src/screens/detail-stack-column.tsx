// detail-stack-column.tsx -- a place's detail as a split view stands it with its own stack of pushed pages, in three columns beside the app sidebar and in two beside the list alike.

import type { DetailStack } from "@repo/ui-native";
import { type ComponentType, createContext, type ReactNode, useContext, useEffect } from "react";
import {
  clearDetail,
  DetailPlaceProvider,
  type HeldPage,
  keepDetailPath,
  PageKeyProvider,
  type PushedPage,
  useDetailStack,
} from "../detail-stack.js";
import { InFrontProvider } from "../place-columns.js";
import type { SidebarPlace } from "./app-sidebar.js";

/** What draws one pushed page in a detail's column (`PushedPageView`). */
type PageDrawer = ComponentType<{ readonly page: PushedPage }>;

/** Draws nothing, before the tabs' layout hands the drawer. */
function NoPage() {
  return null;
}

/**
 * What draws a pushed page, which the tabs' layout hands down. Note that it
 * is handed rather than imported, because the screens that stand a split
 * view are themselves among the pages it draws, such as a task's.
 */
const PageDrawerContext = createContext<PageDrawer>(NoPage);

/** Hands what draws a pushed page to every split view under it. */
export const PageDrawerProvider = PageDrawerContext.Provider;

/** A place's detail as a split view stands it: its root wrapped to push over itself, and the stack `SplitView` takes. */
type StackColumn = {
  readonly wrap: (detail: ReactNode) => ReactNode;
  readonly detailStack: DetailStack;
};

/** What a split view's detail stands for: the id of its picked row, none with nothing picked. */
export type DetailRoot = { readonly id: string | undefined };

/**
 * The pages a place pushed over its detail, each in its place and standing
 * in front only where it is the one on top and the split view stands.
 */
function stackPages(
  PageView: PageDrawer,
  place: SidebarPlace,
  pages: readonly HeldPage[],
  front: boolean,
) {
  const top = pages.at(-1)?.key;

  return pages.map(({ key, page }) => ({
    key,
    view: (
      <DetailPlaceProvider value={place}>
        <PageKeyProvider value={key}>
          <InFrontProvider value={front && key === top}>
            <PageView page={page} />
          </InFrontProvider>
        </PageKeyProvider>
      </DetailPlaceProvider>
    ),
  }));
}

/**
 * A place's detail as a split view stands it with its own stack, in three
 * columns beside the app sidebar and in two beside the list alike: `wrap`
 * stands the detail's root in its place, so a page it opens is pushed over
 * it there, and `detailStack` is what `SplitView` takes. `root` names what
 * the detail stands for, such as the picked thread, and the pages pushed
 * over another root are let go, so a row picked again later opens on its
 * own page alone; none while the split view doesn't know it yet, as in the
 * frame a rotation first stands the app sidebar, which lets nothing go. The
 * root stands in front only while no page covers it.
 */
export function useDetailStackColumn(
  place: SidebarPlace,
  root: DetailRoot | undefined,
  front: boolean,
): StackColumn {
  const PageView = useContext(PageDrawerContext);
  const stack = useDetailStack(place);
  const stale = root !== undefined && stack.pages.length > 0 && stack.over !== root.id;
  useEffect(() => {
    if (stale) clearDetail(place);
  }, [stale, place]);
  const pages = stale ? [] : stack.pages;

  return {
    wrap: (detail) => (
      <DetailPlaceProvider value={place}>
        <InFrontProvider value={front && pages.length === 0}>{detail}</InFrontProvider>
      </DetailPlaceProvider>
    ),
    detailStack: {
      pages: stackPages(PageView, place, pages, front),
      onPathChange: (path) => keepDetailPath(place, path),
    },
  };
}
