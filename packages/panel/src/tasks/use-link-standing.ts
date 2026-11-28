import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import {
  LINK_DESTINATION,
  type LinkDestination,
  taskLinkStep,
  withTaskId,
} from "@repo/features/link-grammar";
import {
  githubPageAsked,
  type LinkStanding,
  linkStandingOf,
} from "@repo/features/link-standing-model";
import { MENTION_KIND, type Mention, type NumberedTaskIdOf } from "@repo/features/mention-link";
import type { PlainLinkNames } from "@repo/features/place-chip-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import type { TaskListCollections } from "@repo/host/task-list-following";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { linkStandingQuery } from "../live-reads.js";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import { appStateIn, selectWorkspaces, useAppStateSlice } from "../use-app-state.js";
import { useKnownNames } from "./use-known-names.js";
import { useTaskFound } from "./use-task-outside.js";

/**
 * use-link-standing.ts -- a GitHub pull request or issue a link in the app's words names, as its chip says it: its key, its title, where it stands, who opened it, and a pull request's lines added and removed, read through the workspace's own GitHub App.
 *
 * The workspace is the one the words are of: the plan's, where they are a
 * plan's, else the one the place drawing them names, as the window's Inbox
 * names an item's own, its plan's or its agent's (`WordsWorkspace`), else the
 * one their mentions are written under.
 * Words that name neither, as an Inbox item whose workspace the service did
 * not name, read nothing, since a page read through another workspace's
 * connection would be drawn in the wrong one. A pull request or a GitHub
 * issue is held by the host while a chip draws it (`LIVE_READ.LINK_STANDINGS`),
 * by the workspace and the link's own address, read through the workspace's
 * GitHub App on the service, and only where that workspace has the App, so a
 * chip in a workspace without it asks nothing. Until it first answers, or
 * where it never does, a repository the App does not reach among them, the
 * chip says what the address says, as it always has. A chip drawn again, as a
 * description's text is when a section opens in its editor and when it closes, says
 * the last answer at once while the host asks again, rather than its address
 * until the read lands; and an answer is drawn only while that workspace
 * still has the App, so a workspace that disconnects stops drawing it. A
 * Linear issue's chip asks nothing and says what its address says.
 */

/** Where the words a chip stands in are: the plan's id, none off a plan, and the workspace's slug its mentions are written under. */
export interface ChipWhere {
  readonly taskId: string | undefined;
  readonly workspace: string;
}

/**
 * The workspace words drawn off a plan's page are of, where the place
 * drawing them knows it, as the window's Inbox knows an item's: by its id,
 * since a workspace an older service answered may have no slug. None where
 * it does not know it, so a link there reads nothing rather than another
 * workspace's.
 */
const WordsWorkspaceContext = createContext<string | undefined>(undefined);

/** Hands the words under it the workspace they are of, by its id. */
export const WordsWorkspace = WordsWorkspaceContext.Provider;

/** The address a mention asks GitHub about, where it is a link to GitHub. */
function githubAddressOf(mention: Mention): string | undefined {
  // Note that a well-known site's page names no provider to ask.
  if (mention.kind !== MENTION_KIND.LINK || !("provider" in mention)) return undefined;

  return mention.provider === INTEGRATION_PROVIDER.GITHUB ? mention.url : undefined;
}

/** Whether the workspace has the connection an ask is read through: an active GitHub installation. */
function connectedFor(workspace: Workspace | undefined): workspace is Workspace {
  return workspace?.github?.active === true;
}

/** The workspaces of the document; none before the first read. */
function useWorkspaces(): readonly Workspace[] | undefined {
  return useAppStateSlice(selectWorkspaces);
}

/** The workspace of the task given, else the one named by its id; none where neither is listed. */
function workspaceOf(
  workspaces: readonly Workspace[] | undefined,
  task: TaskSummary | undefined,
  namedId: string | undefined,
): Workspace | undefined {
  const listed = workspaces ?? [];

  return (
    listed.find((each) => each.id === task?.workspaceId) ??
    listed.find((each) => each.id === namedId)
  );
}

/** The workspace the words a chip stands in are of: the plan's, else the one the place drawing them names, else the one their mentions are written under; none where they name none. */
function wordsWorkspace(
  workspaces: readonly Workspace[] | undefined,
  task: TaskSummary | undefined,
  where: ChipWhere,
  namedId: string | undefined,
): Workspace | undefined {
  return (
    workspaceOf(workspaces, task, namedId) ?? workspaceOfSlug(workspaces ?? [], where.workspace)
  );
}

/** The workspace the words a chip stands in are of (`wordsWorkspace`), its plan read by id from the task list's collections. */
export function useWordsWorkspace(where: ChipWhere): Workspace | undefined {
  const task = useTaskListRow(useTaskListCollections().tasks, where.taskId);

  return wordsWorkspace(useWorkspaces(), task, where, useContext(WordsWorkspaceContext));
}

/**
 * The id of the task a link names by its number, `…/task/42`: the one of
 * that number in the workspace the link's first step names among the
 * reader's own (`workspaceOfSlug`), among the tasks the window lists, else
 * as the service finds it (`useTaskFound`), which reads it into the list;
 * none where it names no number, while the service is asked, or where it
 * finds none.
 */
export function useNumberedTaskId(
  workspace: string,
  number: number | undefined,
): string | undefined {
  const workspaces = useWorkspaces();
  const { tasks } = useTaskListCollections();
  const named = workspaces === undefined ? undefined : workspaceOfSlug(workspaces, workspace);
  const namedId = named?.id;

  const { data: numbered, isReady } = useLiveQuery((q) =>
    namedId === undefined || number === undefined
      ? undefined
      : q
          .from({ task: tasks })
          .where(({ task }) => and(eq(task.workspaceId, namedId), eq(task.number, number)))
          .findOne(),
  );

  const listed = numbered?.id;

  // Note that the service is asked only once the window's list stands and lists no such task, so nothing is asked while every task is live.
  const asked =
    workspaces !== undefined &&
    number !== undefined &&
    (namedId === undefined || (isReady && listed === undefined));

  const found = useTaskFound(asked ? { workspace, number } : undefined);

  return listed ?? found;
}

/** The id of the task a link names by its number among the tasks `tasks` lists in the workspaces given (`useNumberedTaskId`); none where it lists none. */
function numberedTaskIdIn(
  workspaces: readonly Workspace[] | undefined,
  tasks: TaskListCollections["tasks"],
  { workspace, number }: { readonly workspace: string; readonly number: number },
): string | undefined {
  if (workspaces === undefined) return undefined;
  const named = workspaceOfSlug(workspaces, workspace);

  if (named === undefined) return undefined;

  for (const task of tasks.values()) {
    if (task.workspaceId === named.id && task.number === number) return task.id;
  }

  return undefined;
}

/** The id of the task a link names by its number among the tasks the window lists now (`useNumberedTaskId`), the workspaces read off the document `client` holds, for a press that cannot wait a render; nothing redraws for it. */
export function numberedTaskIdNow(
  client: QueryClient,
  collections: TaskListCollections,
): NumberedTaskIdOf {
  return (task) => numberedTaskIdIn(appStateIn(client)?.tasks.workspaces, collections.tasks, task);
}

/** How the id of the task a link names by its number is found among the tasks the window lists (`useNumberedTaskId`), for words pasted, read as they are pasted. */
export function useNumberedTaskIdOf(): NumberedTaskIdOf {
  const workspaces = useWorkspaces();
  const { tasks } = useTaskListCollections();

  return (task) => numberedTaskIdIn(workspaces, tasks, task);
}

/**
 * What the window holds to say a place of ours an address spells bare in
 * plain words by its chip's name (`@repo/features/place-chip-model`'s
 * `namedPlainLinks`), as a row's preview says one: the names it holds now,
 * and the id of a task a link names by its number among the tasks it lists.
 * It is made again as the names move, so a preview drawn before the list is
 * read says the task's title once it is.
 */
export function usePlainLinkNames(): PlainLinkNames {
  const known = useKnownNames();
  const workspaces = useWorkspaces();
  const { tasks } = useTaskListCollections();

  return useMemo(
    () => ({ known, taskIdOf: (task) => numberedTaskIdIn(workspaces, tasks, task) }),
    [known, workspaces, tasks],
  );
}

/** The places a task's links name it in, which a link written by the task's number names it in too. */
const NUMBERED_PLACES: ReadonlySet<LinkDestination["kind"]> = new Set([
  LINK_DESTINATION.TASK,
  LINK_DESTINATION.SECTION,
  LINK_DESTINATION.COMMENT,
  LINK_DESTINATION.VERSION,
  LINK_DESTINATION.PAGE,
]);

/**
 * A place naming its task by its id, named by the task's number
 * (`taskLinkStep`) where the window lists the task with one in the
 * workspace its link is written under, `workspace`, since a number names a
 * task only in its own workspace; any other place as it is.
 */
function numberedPlaceIn(
  workspaces: readonly Workspace[] | undefined,
  tasks: TaskListCollections["tasks"],
  place: LinkDestination,
  workspace: string,
): LinkDestination {
  if (!NUMBERED_PLACES.has(place.kind) || !("taskId" in place)) return place;
  const task = tasks.get(place.taskId);

  if (workspaces === undefined || task?.number === undefined) return place;
  const home = workspaceOfSlug(workspaces, workspace);

  return home?.id === task.workspaceId ? withTaskId(place, taskLinkStep(task)) : place;
}

/** How a place's link is written by its task's number where the window lists one (`numberedPlaceIn`), as Copy link writes it, read as it is written. */
export function useNumberedPlace(): (place: LinkDestination, workspace: string) => LinkDestination {
  const workspaces = useWorkspaces();
  const { tasks } = useTaskListCollections();

  return (place, workspace) => numberedPlaceIn(workspaces, tasks, place, workspace);
}

/** The id of the workspace the words a chip stands in are of (`wordsWorkspace`); none where they name none. */
export function useWordsWorkspaceId(where: ChipWhere): string | undefined {
  return useWordsWorkspace(where)?.id;
}

/**
 * What GitHub holds of the pull request or issue `address` names, read
 * through `workspace`; none for any other address, while unread or
 * unconnected, or where GitHub holds no such page. The host holds it while
 * it is drawn (`LIVE_READ.LINK_STANDINGS`), by the workspace and the
 * address, so it is drawn again at once.
 */
function useStandingAt(
  workspace: Workspace | undefined,
  address: string | undefined,
): LinkStanding | undefined {
  const asked = address === undefined ? undefined : githubPageAsked(address);

  // Note that a standing stands only for the workspace and the connection it was read through, so a disconnect or another workspace holds none.
  const link =
    asked !== undefined && address !== undefined && connectedFor(workspace)
      ? { workspaceId: workspace.id, address }
      : undefined;

  const { data: rows } = useQuery(linkStandingQuery(link));
  const page = asked?.page;
  const repository = asked?.repository;
  const number = asked?.number;

  return useMemo(
    () =>
      page === undefined || repository === undefined || number === undefined || rows === undefined
        ? undefined
        : linkStandingOf({ page, repository, number }, rows),
    [page, repository, number, rows],
  );
}

/** What GitHub holds of the page a link mention names, through the workspace `where` stands in (`useStandingAt`). */
export function useLinkStanding(mention: Mention, where: ChipWhere): LinkStanding | undefined {
  const workspace = useWordsWorkspace(where);

  return useStandingAt(workspace, githubAddressOf(mention));
}

/** What GitHub holds of the page `address` names, read through the workspace of the task given, or else the workspace named where the place names none (`useStandingAt`). */
export function usePlaceStanding(
  place: { readonly taskId: string | null; readonly workspaceId?: string | undefined },
  address: string | undefined,
): LinkStanding | undefined {
  const task = useTaskListRow(useTaskListCollections().tasks, place.taskId ?? undefined);
  const workspace = workspaceOf(useWorkspaces(), task, place.workspaceId);

  return useStandingAt(workspace, address);
}
