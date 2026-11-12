import { LINK_DESTINATION, type LinkDestination, linkOf } from "@repo/features/link-grammar";
import { APP_COMMAND, type KeyedCommand } from "@repo/settings/shortcuts";
import { createContext, useContext } from "react";
import { appPlatform, opensTabs } from "./app-platform.js";
import { commandAction, PANEL_COMMAND } from "./command-items.js";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import type { MenuAction } from "./desktop/action-menu.js";
import {
  SHORTCUT_SUBJECT,
  shortcutSubject,
  useShortcutTarget,
  useShortcutTargetsOf,
} from "./shortcut-target.js";
import { useNumberedPlace } from "./tasks/use-link-standing.js";

/**
 * copy-link-item.tsx -- Copy link as any menu offers it: the item every thing's ⋯ and right-click menu holds, copying the thing's app link and saying Link copied, with Open in new tab under it in a browser.
 *
 * A menu names its thing by place (`@repo/features/link-grammar`), and the
 * item writes it under the workspace the surface's links are written in,
 * which the surface hands down: a task's page its workspace's slug, an
 * agent's page its agent's. Where none is handed down, as in a test of
 * one surface or a place whose workspace is not yet read, the item stands
 * nowhere rather than copy a link that names no workspace. A task's place
 * is written by the task's number where the window lists it with one
 * (`useNumberedPlace`), as the address bar writes it. The item prints
 * ⇧⌘C only where its link is the one the chord would copy now, the open or
 * focused thing's (`links-at-hand.ts`); every other row's prints nothing.
 *
 * In a browser, whose tabs the window can open (`opensTabs`), the same link
 * opens in a tab of its own: on a middle-click on a row that goes to it, as
 * on a link, and from Open in new tab, which stands under Copy link in every
 * menu that offers it (`linkItems`). The Mac app has no tabs, so it offers
 * neither.
 */

/** The key a link's Copy link prints where it is the one the chord copies now. */
const COPY_LINK_KEYS: readonly KeyedCommand[] = [APP_COMMAND.COPY_LINK];

const LinkWorkspaceContext = createContext<string | undefined>(undefined);

/** Hands the workspace a surface's links are written under, by slug, or by id until the workspaces are read. */
export const LinkWorkspaceProvider = LinkWorkspaceContext.Provider;

/** The workspace the surface hands down for its links; none where it hands down none. */
export function useLinkWorkspace(): string | undefined {
  return useContext(LinkWorkspaceContext);
}

/** Holds the links ⇧⌘C copies now, the first at hand outside the side panel and in it, as the keys' targets (`shortcut-target.ts`), for as long as the window's Copy link stands. */
export function useHoldChordLinks(outside: string | undefined, inPanel: string | undefined): void {
  useShortcutTarget(
    outside === undefined ? undefined : shortcutSubject(SHORTCUT_SUBJECT.LINK, outside),
    COPY_LINK_KEYS,
  );
  useShortcutTarget(
    inPanel === undefined ? undefined : shortcutSubject(SHORTCUT_SUBJECT.LINK, inPanel),
    COPY_LINK_KEYS,
  );
}

/** Opens `link`, an app link, in a tab of its own, which a middle-click on a row going to it takes; none where the window opens no tabs. */
export function openInTabOf(link: string): (() => void) | undefined {
  return opensTabs() ? () => appPlatform().openInTab?.(link) : undefined;
}

/**
 * Copy link, copying `link`, an app link, through `copy`, the window's menu
 * copy (`useCopyToast`), printing ⇧⌘C where the chord copies the same link
 * (`useHoldChordLinks`); and under it Open in new tab, opening
 * the link in a tab of its own, where the window opens tabs: the items every
 * menu offering a thing's link draws, so no menu offers one without the
 * other. Note that a GitHub address is no app link and is offered as Copy
 * GitHub link (`PANEL_COMMAND.COPY_GITHUB_LINK`), and a link's own
 * right-click keeps its browser's Copy link (`link-menu.tsx`).
 */
export function linkItems(
  copy: (words: string, label: string) => void,
  link: string,
): MenuAction[] {
  const subject = shortcutSubject(SHORTCUT_SUBJECT.LINK, link);

  const copied = commandAction(
    PANEL_COMMAND.COPY_LINK,
    () => copy(link, LINK_COPY.COPIED),
    subject,
  );

  const open = openInTabOf(link);

  return open === undefined
    ? [copied]
    : [copied, commandAction(PANEL_COMMAND.OPEN_IN_NEW_TAB, open, subject)];
}

/** The copy of a place's link under the workspace the surface hands down, saying Link copied; none where it hands down none. */
export function useCopyLink(): ((place: LinkDestination) => void) | undefined {
  const workspace = useContext(LinkWorkspaceContext);
  const copy = useCopyToast();
  const numbered = useNumberedPlace();

  return workspace === undefined
    ? undefined
    : (place) => copy(linkOf(numbered(place, workspace), workspace), LINK_COPY.COPIED);
}

/** A place's link under the workspace the surface hands down, by the task's number where the window lists one; none where it hands down none. */
export function usePlaceLink(): (place: LinkDestination) => string | undefined {
  const workspace = useContext(LinkWorkspaceContext);
  const numbered = useNumberedPlace();

  return (place) =>
    workspace === undefined ? undefined : linkOf(numbered(place, workspace), workspace);
}

/** Copy link and Open in new tab for a place (`linkItems`), under the workspace the surface hands down; none where it hands down none. */
export function useLinkItems(): (place: LinkDestination) => MenuAction[] {
  const linkOfPlace = usePlaceLink();
  const copy = useCopyToast();
  // Note that Copy link prints ⇧⌘C as the chord's link changes, so whoever draws it is drawn again as it does.
  useShortcutTargetsOf(APP_COMMAND.COPY_LINK);

  return (place) => {
    const link = linkOfPlace(place);

    return link === undefined ? [] : linkItems(copy, link);
  };
}

/** Opens a place in a tab of its own, under the workspace the surface hands down, which a middle-click on the row going to it takes; none where it hands down none or the window opens no tabs. */
export function useOpenInTab(): (place: LinkDestination) => (() => void) | undefined {
  const linkOfPlace = usePlaceLink();

  return (place) => {
    const link = linkOfPlace(place);

    return link === undefined ? undefined : openInTabOf(link);
  };
}

/** The place an agent is linked by, its own whichever task it works on, which its reader finds by the agent. */
export function agentPlace(agentId: string): LinkDestination {
  return { kind: LINK_DESTINATION.AGENT, agentId };
}
