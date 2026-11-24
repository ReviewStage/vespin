// page-screens.tsx -- a page an agent showed on its task, opened whole in the app's one web view, from the agent's transcript or the task's Overview.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { VERB } from "@repo/features/words";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { BUTTON_LOOK, EmptyState, GLYPH, glyphSymbol, Screen, SealedPage } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { usePageHtml } from "../agents/use-agent.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { openInSafari } from "../open-link.js";
import { usePageShownCount } from "../page-shown.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useFoundTask } from "../tasks/use-found-task.js";
import { useTasksWorkspace } from "../tasks/use-tasks.js";

/** What stands in a page's place where it could not be read. */
const PAGE_WORDS = {
  FAILED: "The page could not be read.",
  MORE: "More",
  TRY_AGAIN: "Try again",
} as const;

/** The page's address on vespin.dev, under its workspace and its task; none until both are read. */
function usePageAddress(
  workspaceId: string | undefined,
  taskId: string | undefined,
  pageId: string,
): string | undefined {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspace = workspaces.find(({ id }) => id === workspaceId);

  if (workspace === undefined || taskId === undefined) return undefined;

  return linkOf(
    { kind: LINK_DESTINATION.PAGE, taskId: taskId, pageId },
    workspace.slug ?? workspace.id,
  );
}

/** A page's version, by its task and its workspace, and the name it is opened under until its own is read; a link names no version, so it opens at the newest. */
type PageOpened = {
  readonly workspaceId: string | undefined;
  readonly taskId: string | undefined;
  readonly pageId: string;
  readonly version: number | undefined;
  readonly title: string;
  /** Whether the page's task was found nowhere, so the page can never be read. */
  readonly lost?: boolean;
};

/** A route's version as its screen opens it: the number it names, or none for a link, which names none. */
export function openedVersion(version: string): number | undefined {
  return version === "" ? undefined : Number(version);
}

/**
 * The version a page opens at: the one its opener named, else the newest
 * the task's pages hold, as the panel opens a page's link, those pages
 * followed while the page stands; none until they are read, and `missing`
 * where they hold no such page or could not be read.
 */
function useVersionOf(taskId: string | undefined, pageId: string, named: number | undefined) {
  const acts = useHostActs();
  const follows = named === undefined ? taskId : undefined;
  useLiveFollow(follows, (id) => acts[ACT_KIND.TASKS_PAGES_FOLLOW]({ taskId: id }));

  const { data: held } = useQuery({
    ...appStateQuery,
    select: (state) =>
      follows === undefined ? undefined : state[LIVE_READ.PAGES][PAGE_OWNER.TASK][follows],
  });

  if (named !== undefined) return { version: named, missing: false };
  const pages = held?.rows;
  const newest = pages?.find(({ id }) => id === pageId)?.version;

  // Note that pages the service could not read count as missing until a later answer brings them, as the follow tries again on its own, rather than reading for good.
  return {
    version: newest,
    missing: pages === undefined ? held?.failed === true : newest === undefined,
  };
}

/**
 * One version of a page, opened whole in the app's one web view, sealed
 * from the network and from navigation, under the system's header naming
 * it, with a ⋯ that opens it in the browser. It reads until its task is
 * known.
 */
export function PageScreen({
  workspaceId,
  taskId,
  pageId,
  version: asked,
  title,
  lost = false,
}: PageOpened) {
  useSurfaceOpen(PRODUCT_SURFACE.PAGE, pageId);
  const { version, missing } = useVersionOf(taskId, pageId, asked);
  const html = usePageHtml(taskId, pageId, version);
  const { again } = html;
  const read = missing || lost ? { failed: true as const } : html.read;
  const address = usePageAddress(workspaceId, taskId, pageId);
  const named = "title" in read && read.title !== "" ? read.title : title;
  const shown = usePageShownCount(asked !== undefined, "html" in read);

  const failed = (
    <EmptyState
      title={PAGE_WORDS.FAILED}
      symbol={GLYPH.FAILED}
      action={{ label: PAGE_WORDS.TRY_AGAIN, onPress: again, look: BUTTON_LOOK.BORDERED }}
    />
  );

  return (
    <>
      <Stack.Screen options={{ title: named }} />
      {address === undefined ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel={PAGE_WORDS.MORE}>
            <Stack.Toolbar.MenuAction
              icon={glyphSymbol(GLYPH.OPEN_EXTERNALLY)}
              onPress={() => openInSafari(address)}
            >
              {VERB.OPEN_IN_BROWSER}
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
      {/* Note that the page stands as the screen's root, outside its SwiftUI host, since the web view sizes itself to the screen. */}
      {/* Note that the web view is drawn while the page is still read, its loading ground over it, so WebKit starts beside the read rather than after it. */}
      {"failed" in read ? (
        <Screen>{failed}</Screen>
      ) : (
        <SealedPage html={"html" in read ? read.html : undefined} title={named} onLoaded={shown} />
      )}
    </>
  );
}

/** A page a task's Overview lists, opened by its task, its id, and the version the list holds, in the task's own workspace, which a later workspace switch leaves as it is. */
export function TaskPageScreen() {
  const {
    id = "",
    task = "",
    workspace = "",
    version = "",
    title = "",
  } = useLocalSearchParams<{
    id: string;
    task: string;
    workspace: string;
    version: string;
    title: string;
  }>();

  return (
    <TaskPage
      pageId={id}
      taskId={task}
      workspaceId={workspace === "" ? undefined : workspace}
      version={openedVersion(version)}
      title={title}
    />
  );
}

/**
 * A page a task's Overview lists or a link names, in the workspace its route
 * names, by id or as a link's slug, or the one chosen where it names none.
 * A task a link names by number is found first, as a task's link finds one
 * (`useFoundTask`), and one found nowhere says the page could not be read.
 */
function TaskPage({
  workspaceId: named,
  taskId,
  ...opened
}: Omit<PageOpened, "taskId"> & { readonly taskId: string }) {
  const chosen = useTasksWorkspace();
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspace = named === undefined ? chosen : workspaceOfSlug(workspaces, named);
  const found = useFoundTask(taskId, named ?? chosen?.id);

  return (
    <PageScreen
      {...opened}
      workspaceId={workspace?.id ?? chosen?.id}
      taskId={found.taskId}
      lost={found.taskId === undefined && !found.seeking}
    />
  );
}
