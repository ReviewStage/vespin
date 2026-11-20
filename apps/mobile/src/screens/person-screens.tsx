// person-screens.tsx -- one person's page in the workspace the phone works in, as the panel's person page draws it: who they are there, then their agents at work, what waits on them, the tasks assigned to them and the rest they created, and their other agents, with Copy link, Copy email, and Manage in its ⋯.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { openItems, waitsOnReaderNow } from "@repo/features/inbox-list-model";
import { inboxWaitsOn } from "@repo/features/inbox-wire";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import {
  agentStarter,
  PERSON_TASKS_SHOWN,
  type PersonAgent,
  personPage,
  personPageEmpty,
  personRef,
} from "@repo/features/person-page-model";
import {
  PERSON_PAGE_WORDS,
  PERSON_SECTION_WORDS,
  personWords,
} from "@repo/features/person-page-words";
import { TASKS_READ } from "@repo/features/tasks-view";
import { readingWords } from "@repo/features/words";
import { WORKSPACE_ROLE_WORDS } from "@repo/features/workspace-role";
import {
  type FormerMember,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { INBOX_FEED, selectAccount, selectInboxFeed } from "@repo/host/app-state-reads";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  BAR_TITLE,
  type BarMenu,
  BUZZ,
  buzz,
  EmptyState,
  GLYPH,
  glyphSymbol,
  LIST_LOOK,
  ListSection,
  PersonHead,
  RowList,
  Screen,
  useColors,
  useMinute,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import {
  useHostActs,
  useListedAgents,
  useListedTasks,
  useTaskListCollections,
  useTaskListRows,
} from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useInboxGroupsIn } from "../inbox/inbox-groups.js";
import { useInboxShown } from "../inbox/inbox-shown.js";
import { useInboxActs } from "../inbox/use-inbox.js";
import { useMemberPictures } from "../member-pictures.js";
import { SETTINGS_ROUTE } from "../settings-button.js";
import { stackMenuItems } from "../stack-bar-menu.js";
import { useOnOwnTab } from "../tab-route.js";
import {
  agentLine,
  type ReadListing,
  type TaskAgentLine,
  useListingAsks,
  useTasksListing,
} from "../tasks/use-tasks.js";
import { heldPeople } from "../workspace-people.js";
import { useRemind } from "./inbox-remind.js";
import { InboxItemRows } from "./inbox-screens.js";
import {
  StatusQuestionAsk,
  TaskAgentRow,
  TaskRows,
  useAgentRowAsk,
  useTaskRowDoors,
} from "./task-screens.js";

/** Where the task list's read stands, which says whether the page may yet list something of theirs. */
function selectListStatus(state: AppStateSnapshot) {
  return state.tasks.listStatus;
}

/** Who left a workspace whose members read names nobody. */
const NOBODY_LEFT: readonly FormerMember[] = [];

/** The words the page's ⋯ copies say where the copy did not go. */
const COPY_FAILED = "The copy did not go.";

/** Who the person is to the workspace, as the page's head says under their name: their role and email, that they left, or that nobody names them. */
function headLine(
  member: Pick<WorkspaceMember, "role" | "email"> | undefined,
  left: boolean,
): string {
  if (member !== undefined) {
    return [WORKSPACE_ROLE_WORDS[member.role], member.email]
      .filter((part) => part !== "")
      .join(" · ");
  }

  return left ? PERSON_PAGE_WORDS.FORMER : PERSON_PAGE_WORDS.OUTSIDE;
}

/** Copies `words` with the system's tap of success, or says on the console why it could not. */
function copy(words: string): void {
  setStringAsync(words)
    .then(() => buzz(BUZZ.SUCCESS))
    .catch((cause: unknown) => {
      console.error(COPY_FAILED, cause);
      buzz(BUZZ.ERROR);
    });
}

/**
 * The page's ⋯, as the panel's offers it: Copy link and Copy email for a
 * member, in one group, then Manage in workspace settings for the
 * workspace's owners and admins, which opens the member's page in
 * Settings, where their role is changed and they are removed.
 */
function personMenu({
  link,
  email,
  manage,
}: {
  readonly link: string | undefined;
  readonly email: string | undefined;
  readonly manage: (() => void) | undefined;
}): BarMenu | undefined {
  const copies = [
    ...(link === undefined
      ? []
      : [
          {
            label: APP_SHORTCUTS[APP_COMMAND.COPY_LINK].label,
            symbol: GLYPH.LINK,
            onPress: () => copy(link),
          },
        ]),
    ...(email === undefined || email === ""
      ? []
      : [{ label: PERSON_PAGE_WORDS.COPY_EMAIL, symbol: GLYPH.EMAIL, onPress: () => copy(email) }]),
  ];

  const manages =
    manage === undefined
      ? []
      : [{ actions: [{ label: PERSON_PAGE_WORDS.MANAGE, symbol: GLYPH.PEOPLE, onPress: manage }] }];

  if (copies.length === 0 && manages.length === 0) return undefined;

  return {
    label: PERSON_PAGE_WORDS.PERSON,
    symbol: GLYPH.MORE,
    choices: [],
    actions: copies,
    groups: manages,
  };
}

/** The person's page in the workspace the phone works in, by the `id` its route names. */
export function PersonScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const read = useTasksListing("");
  const { workspace } = read;

  if (workspace === undefined) {
    return (
      <Screen>
        <EmptyState title={readingWords("the workspace")} symbol={GLYPH.PERSON} loading />
      </Screen>
    );
  }

  return <PersonPage key={workspace.id} read={read} workspace={workspace} userId={id} />;
}

/**
 * The page, as `PersonScreen` describes it, from what the phone already
 * holds of the workspace: its members, followed here as Settings' Members
 * follows them, its task list and the agents on it, and its Inbox
 * (`@repo/features/person-page-model`), so it reads nothing of its own and
 * shows a teammate only what the Tasks tab and the Inbox already show.
 * Each section lists its newest few, counting all the phone holds, and a
 * section with nothing in it is left out. The workspace's automations and a
 * person's machines, which the panel's page lists too, are the desktop's and
 * the web's.
 */
function PersonPage({
  read,
  workspace,
  userId,
}: {
  /** The Tasks listing its task rows act through, as the Tasks tab's do. */
  readonly read: ReadListing;
  readonly workspace: Workspace;
  readonly userId: string;
}) {
  const acts = useHostActs();
  const router = useRouter();
  const colors = useColors();
  const onOwnTab = useOnOwnTab();
  const now = useMinute();
  const workspaceId = workspace.id;
  useLiveFollow(workspaceId, (each) =>
    acts[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId: each }),
  );

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldPeople(workspaceId), [workspaceId]),
  });

  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const readerId = account === undefined ? undefined : signedInAccountId(account);
  const you = userId === readerId;
  const pictureOf = useMemberPictures();
  const rows = held?.members?.rows;
  const members = rows?.members;
  // Note that a read naming nobody who left omits them, so who left stands as nobody once the members are read, as the panel's directory reads it.
  const former = rows === undefined ? undefined : (rows.former ?? NOBODY_LEFT);
  const member = members?.find((each) => each.userId === userId);
  const left = former?.find((each) => each.userId === userId);

  // The workspace's tasks and the agents on them, as the panel's page reads its listed workspace's.
  const listedTasks = useListedTasks();
  const listedAgents = useListedAgents();
  const collections = useTaskListCollections();
  const pullRequests = useTaskListRows(collections.agentPullRequests);

  const tasks = useMemo(
    () => listedTasks.filter((task) => task.workspaceId === workspaceId),
    [listedTasks, workspaceId],
  );

  const page = useMemo(
    () => personPage(userId, tasks, listedAgents),
    [userId, tasks, listedAgents],
  );

  // Named as the members read names them, else as the list does, else as who left; nobody's name until one does.
  const name = (member ?? personRef(userId, tasks, listedAgents) ?? left)?.name;

  // Every open Inbox thread of the workspace waiting on them, on the reader's own page only once it waits on them now, as the panel's page lists them.
  const inboxShown = useInboxShown();
  const groups = useInboxGroupsIn(workspaceId);

  const { data: feed = INBOX_FEED.READING } = useQuery({
    ...appStateQuery,
    select: selectInboxFeed,
  });

  // Note that an Inbox turned off names nothing, so the page waits only on one shown.
  const inboxRead = !inboxShown || feed !== INBOX_FEED.READING;

  const waiting = useMemo(
    () =>
      inboxShown
        ? openItems(groups).filter(
            ({ item }) =>
              (inboxWaitsOn(item)?.userId ?? agentStarter(listedAgents, item.agentId)) === userId &&
              (!you || waitsOnReaderNow(item, readerId, now)),
          )
        : [],
    [inboxShown, groups, listedAgents, userId, you, readerId, now],
  );

  const waitingByAgent = useMemo(() => {
    const counts = new Map<string, number>();

    for (const { item } of waiting) counts.set(item.agentId, (counts.get(item.agentId) ?? 0) + 1);

    return counts;
  }, [waiting]);

  const line = (each: PersonAgent): TaskAgentLine =>
    agentLine(each.agent, waitingByAgent, pullRequests);

  // A task's row acts as on the Tasks tab: Done or Canceled asks first where it stops agents, and a delete always asks.
  const doors = useTaskRowDoors(workspaceId);
  const { listing, status, deletion } = useListingAsks(read, doors);
  const { data: listStatus } = useQuery({ ...appStateQuery, select: selectListStatus });
  const listRead = listStatus === TASKS_READ.READY;
  const { mark, resolve, refresh, refreshTasks } = useInboxActs();
  const remind = useRemind();
  const asking = useAgentRowAsk();

  // What a press on each row opens, by the row's id: a task's page, a thread, or an agent's page, each pushed on this tab.
  const routes = useMemo(
    () =>
      new Map<string, string>([
        ...[...page.assigned, ...page.created].map(
          (task) =>
            [task.id, iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId: task.id })] as const,
        ),
        ...waiting.map(
          ({ holder, item }) =>
            [
              item.id,
              iosAppRouteOf({
                kind: LINK_DESTINATION.INBOX_ITEM,
                taskId: holder.task.id,
                itemId: item.id,
              }),
            ] as const,
        ),
        ...[...page.working, ...page.agents].map(
          ({ agent }) => [agent.id, iosAgentRoute(agent.id)] as const,
        ),
      ]),
    [page, waiting],
  );

  const open = (rowId: string) => {
    const route = routes.get(rowId);

    if (route !== undefined) router.push(onOwnTab(route));
  };

  const manages =
    member !== undefined &&
    (workspace.role === WORKSPACE_ROLE.OWNER || workspace.role === WORKSPACE_ROLE.ADMIN);

  const menu = personMenu({
    link: linkOf({ kind: LINK_DESTINATION.PERSON, userId }, workspace.slug ?? workspace.id),
    email: member?.email,
    manage: manages
      ? () => router.push({ pathname: SETTINGS_ROUTE.MEMBER, params: { userId } })
      : undefined,
  });

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const membersRead = members !== undefined && former !== undefined;
  const failed = held?.members?.failed === true;

  const bar = (
    <>
      <Stack.Screen
        options={{
          title: name ?? "",
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      {menu === undefined || name === undefined ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon={glyphSymbol(menu.symbol)} accessibilityLabel={menu.label}>
            {stackMenuItems(menu)}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
    </>
  );

  // Note that nobody is said to be outside the workspace until its members and those who left are read, since only those reads may say so; a read that failed says why rather than wait.
  if (name === undefined) {
    return (
      <>
        {bar}
        <Screen>
          {membersRead ? (
            <EmptyState title={PERSON_PAGE_WORDS.OUTSIDE} symbol={GLYPH.NOT_FOUND} />
          ) : failed ? (
            <EmptyState
              title={personWords(PERSON_SECTION_WORDS.UNREAD, you)}
              symbol={GLYPH.FAILED}
            />
          ) : (
            <EmptyState title={readingWords("their profile")} symbol={GLYPH.PERSON} loading />
          )}
        </Screen>
      </>
    );
  }

  // Note that the page is said to hold nothing of theirs only once the task list and the Inbox have answered, since either may yet name something; until then an empty page stands the system's bare spinner under the head.
  const empty = personPageEmpty(page) && waiting.length === 0;

  const answered = listRead && inboxRead;

  const assigned = page.assigned.slice(0, PERSON_TASKS_SHOWN);
  const created = page.created.slice(0, PERSON_TASKS_SHOWN);

  const agentRows = (agents: readonly PersonAgent[]) =>
    agents.map((each) => (
      <TaskAgentRow
        key={each.agent.id}
        line={line(each)}
        task={each.agent.taskId === null ? undefined : tasksById.get(each.agent.taskId)}
        named
        asking={asking}
      />
    ));

  return (
    <>
      {bar}
      <Screen>
        <RowList
          look={LIST_LOOK.DETAIL}
          onSelect={open}
          onRefresh={async () => {
            await Promise.all([refresh(), refreshTasks()]);
          }}
          empty={
            empty && !answered ? (
              <EmptyState
                title={readingWords(you ? "your tasks" : "their tasks")}
                symbol={GLYPH.TASK}
                loading
              />
            ) : undefined
          }
        >
          <ListSection
            footer={empty && answered ? personWords(PERSON_SECTION_WORDS.NOTHING, you) : undefined}
          >
            <PersonHead
              id={userId}
              name={name}
              picture={pictureOf(userId)}
              line={headLine(member, left !== undefined)}
            />
          </ListSection>
          {page.working.length === 0 ? null : (
            <ListSection title={PERSON_PAGE_WORDS.WORKING} count={page.working.length}>
              {agentRows(page.working)}
            </ListSection>
          )}
          {waiting.length === 0 ? null : (
            <ListSection
              title={personWords(PERSON_SECTION_WORDS.WAITING, you)}
              count={waiting.length}
            >
              <InboxItemRows
                listed={waiting}
                readerId={readerId}
                pictureOf={pictureOf}
                onMark={mark}
                remindMenu={remind.itemMenu}
                onResolve={resolve}
              />
            </ListSection>
          )}
          {assigned.length === 0 ? null : (
            <ListSection
              title={personWords(PERSON_SECTION_WORDS.ASSIGNED, you)}
              count={page.assigned.length}
            >
              <TaskRows tasks={assigned} listing={listing} />
            </ListSection>
          )}
          {created.length === 0 ? null : (
            <ListSection
              title={personWords(PERSON_SECTION_WORDS.CREATED, you)}
              count={page.created.length}
            >
              <TaskRows tasks={created} listing={listing} />
            </ListSection>
          )}
          {page.agents.length === 0 ? null : (
            <ListSection title={PERSON_PAGE_WORDS.AGENTS} count={page.agents.length}>
              {agentRows(page.agents)}
            </ListSection>
          )}
        </RowList>
      </Screen>
      <StatusQuestionAsk question={status} />
      <StatusQuestionAsk question={deletion} />
      {remind.sheet}
    </>
  );
}
