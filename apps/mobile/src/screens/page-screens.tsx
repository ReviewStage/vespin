// page-screens.tsx -- a page an agent showed on its task, opened whole in the app's one web view, from the agent's transcript or the task's Overview.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { VERB } from "@repo/features/words";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  DetailPage,
  EmptyState,
  GLYPH,
  glyphSymbol,
  HostedFill,
  Screen,
  SealedPage,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { usePageHtml } from "../agents/use-agent.js";
import { PUSHED_PAGE, useHandToDetail } from "../detail-stack.js";
import { appStateQuery } from "../host/app-state-query.js";
import { openInSafari } from "../open-link.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useTasksWorkspace } from "../tasks/use-tasks.js";

/** What stands in a page's place while it is read, and where it could not be. */
const PAGE_WORDS = {
  READING: "Reading the page",
  FAILED: "The page could not be read.",
  MORE: "More",
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

/** A page's version, by its task and its workspace, and the name it is opened under until its own is read. */
type PageOpened = {
  readonly workspaceId: string | undefined;
  readonly taskId: string | undefined;
  readonly pageId: string;
  readonly version: number;
  readonly title: string;
};

/**
 * One version of a page, opened whole in the app's one web view, sealed
 * from the network and from navigation, under the system's header naming
 * it, with a ⋯ that opens it in the browser, or, `inColumn`, as a page
 * pushed over a split view's detail under the column's own bar. It reads
 * until its task is known.
 */
export function PageScreen({
  workspaceId,
  taskId,
  pageId,
  version,
  title,
  inColumn = false,
}: PageOpened & {
  /** Whether it stands pushed over a split view's detail rather than on a stack over the window. */
  readonly inColumn?: boolean | undefined;
}) {
  useSurfaceOpen(PRODUCT_SURFACE.PAGE, pageId);
  const read = usePageHtml(taskId, pageId, version);
  const address = usePageAddress(workspaceId, taskId, pageId);
  const named = "title" in read && read.title !== "" ? read.title : title;

  const empty = (
    <EmptyState
      title={"failed" in read ? PAGE_WORDS.FAILED : PAGE_WORDS.READING}
      symbol={"failed" in read ? GLYPH.FAILED : GLYPH.PAGE}
      loading={!("failed" in read)}
    />
  );

  if (inColumn) {
    const menu =
      address === undefined
        ? undefined
        : {
            label: PAGE_WORDS.MORE,
            symbol: GLYPH.MORE,
            choices: [],
            actions: [
              {
                label: VERB.OPEN_IN_BROWSER,
                symbol: GLYPH.OPEN_EXTERNALLY,
                onPress: () => openInSafari(address),
              },
            ],
          };

    return (
      <DetailPage bar={{ name: named, menu }}>
        {"html" in read ? (
          <HostedFill>
            <SealedPage html={read.html} title={named} />
          </HostedFill>
        ) : (
          empty
        )}
      </DetailPage>
    );
  }

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
      {"html" in read ? <SealedPage html={read.html} title={named} /> : <Screen>{empty}</Screen>}
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

  const handed = useHandToDetail({
    kind: PUSHED_PAGE.TASK_PAGE,
    pageId: id,
    taskId: task,
    workspaceId: workspace === "" ? undefined : workspace,
    version: Number(version),
    title,
  });

  if (handed) return null;

  return (
    <TaskPage
      pageId={id}
      taskId={task}
      workspaceId={workspace === "" ? undefined : workspace}
      version={Number(version)}
      title={title}
    />
  );
}

/** A page a task's Overview lists, in its task's own workspace, or the one chosen where it names none; `inColumn` pushed over a split view's detail. */
export function TaskPage({
  workspaceId,
  inColumn,
  ...opened
}: Omit<PageOpened, "taskId"> & {
  readonly taskId: string;
  readonly inColumn?: boolean | undefined;
}) {
  const chosen = useTasksWorkspace();

  return <PageScreen {...opened} workspaceId={workspaceId ?? chosen?.id} inColumn={inColumn} />;
}
