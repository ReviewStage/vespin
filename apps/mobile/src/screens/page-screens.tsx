// page-screens.tsx -- a page an agent showed on its task, opened whole in the app's one web view, from the agent's transcript or the task's Overview.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { VERB } from "@repo/features/words";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { EmptyState, GLYPH, glyphSymbol, Screen, SealedPage } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { usePageHtml } from "../agents/use-agent.js";
import { appStateQuery } from "../host/app-state-query.js";
import { openInSafari } from "../open-link.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useTasksWorkspace } from "../tasks/use-tasks.js";

/** What stands in a page's place while it is read, and where it could not be. */
const PAGE_WORDS = {
  READING: "Reading the page",
  FAILED: "The page could not be read.",
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
    { kind: LINK_DESTINATION.PAGE, planId: taskId, pageId },
    workspace.slug ?? workspace.id,
  );
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
  version,
  title,
}: {
  readonly workspaceId: string | undefined;
  readonly taskId: string | undefined;
  readonly pageId: string;
  readonly version: number;
  readonly title: string;
}) {
  useSurfaceOpen(PRODUCT_SURFACE.PAGE, pageId);
  const read = usePageHtml(taskId, pageId, version);
  const address = usePageAddress(workspaceId, taskId, pageId);
  const named = "title" in read && read.title !== "" ? read.title : title;

  return (
    <>
      <Stack.Screen options={{ title: named }} />
      {address === undefined ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel="More">
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
      {"html" in read ? (
        <SealedPage html={read.html} title={named} />
      ) : (
        <Screen>
          <EmptyState
            title={"failed" in read ? PAGE_WORDS.FAILED : PAGE_WORDS.READING}
            symbol={"failed" in read ? GLYPH.FAILED : GLYPH.PAGE}
            loading={!("failed" in read)}
          />
        </Screen>
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

  const chosen = useTasksWorkspace();

  return (
    <PageScreen
      workspaceId={workspace === "" ? chosen?.id : workspace}
      taskId={task}
      pageId={id}
      version={Number(version)}
      title={title}
    />
  );
}
