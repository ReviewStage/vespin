// manager-screens.tsx -- a Manager's overview, pushed from its chat: what it is doing at a glance, the agents it started, and the pull requests they opened, as the desktop's page stands them beside the chat.

import { iosAgentRoute, iosRepositoryPullRequestRoute } from "@repo/features/ios-app-links";
import { pullRequestAddressOf } from "@repo/features/link-grammar";
import { type ManagerPullRequest, managerOverview } from "@repo/features/manager-overview-model";
import { agentName } from "@repo/features/model-label";
import type { PersonAgent } from "@repo/features/person-page-model";
import { pullRequestMarkLabel, pullRequestMarkState } from "@repo/features/pull-request-model";
import { countWords, readingWords } from "@repo/features/words";
import {
  BAR_TITLE,
  EmptyState,
  GLYPH,
  LIST_LOOK,
  LinkRow,
  ListSection,
  PULL_REQUEST_LOOK,
  RowList,
  Screen,
  useColors,
  useMinute,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { useShownAgent } from "../agents/use-agent.js";
import {
  useListedAgents,
  useListedTasks,
  useTaskListCollections,
  useTaskListRows,
} from "../host/host-provider.js";
import { useInboxActs } from "../inbox/use-inbox.js";
import { openInSafari } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";
import { agentLine, useWaiting } from "../tasks/use-tasks.js";
import { TaskAgentRow, useAgentRowAsk } from "./task-screens.js";

/** What the page and its sections are called, in the desktop overview's words. */
const OVERVIEW_WORDS = {
  TITLE: "Overview",
  COUNTS: "At a glance",
  AGENTS: "Agents",
  PULL_REQUESTS: "Pull requests",
  NOTHING_YET: "Nothing started yet",
  NOTHING_YET_HINT: "The agents this Manager starts and the pull requests they open stand here.",
} as const;

/** What stands between the counts in their line. */
const COUNT_PART = " · ";

/** What the counts line names each count, as the desktop's does. */
const COUNT_NOUN = {
  WORKING: { one: "agent working", many: "agents working" },
  OPEN: { one: "pull request open", many: "pull requests open" },
  DONE: { one: "done this week", many: "done this week" },
} as const;

/** The counts line: its agents at work, its pull requests open, and its tasks done this week. */
function countsWords(overview: ReturnType<typeof managerOverview>): string {
  return [
    countWords(overview.working, COUNT_NOUN.WORKING),
    countWords(overview.openPullRequests, COUNT_NOUN.OPEN),
    countWords(overview.doneThisWeek.length, COUNT_NOUN.DONE),
  ].join(COUNT_PART);
}

/** A pull request's row: its state's glyph, its title, and its number at the line's end, a press opening it on its own screen, or on GitHub where its address names no pull request. */
function PullRequestRow({
  each,
  onOpen,
}: {
  readonly each: ManagerPullRequest;
  readonly onOpen: (each: ManagerPullRequest) => void;
}) {
  const { pullRequest } = each;
  const look = PULL_REQUEST_LOOK[pullRequestMarkState(pullRequest)];

  return (
    <LinkRow
      symbol={look.symbol}
      label={pullRequest.title}
      detail={`#${pullRequest.number} · ${pullRequestMarkLabel(pullRequest)}`}
      onPress={() => onOpen(each)}
    />
  );
}

/**
 * A Manager's overview, named by the route's `id`: one line counting its
 * agents at work, its pull requests open, and its tasks done this week, then
 * the agents it started, those at work first, each the row a task's Agents
 * lists, opening its page, and the pull requests they opened, the open ones
 * first, each opening its own screen. Everything is read from what the phone
 * already holds of the task list (`@repo/features/manager-overview-model`),
 * as the desktop's overview reads what its window follows, so it reads
 * nothing of its own. A pull reads the list again.
 */
export function ManagerOverviewScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const colors = useColors();
  const now = useMinute();
  const manager = useShownAgent(id);
  const workspaceId = manager?.workspaceId;
  const listedTasks = useListedTasks();
  const listedAgents = useListedAgents();
  const pullRequests = useTaskListRows(useTaskListCollections().agentPullRequests);
  const waiting = useWaiting(workspaceId);
  const { refreshTasks } = useInboxActs();
  const asking = useAgentRowAsk();

  const tasks = useMemo(
    () => listedTasks.filter((task) => task.workspaceId === workspaceId),
    [listedTasks, workspaceId],
  );

  const overview = useMemo(
    () => managerOverview({ managerId: id, tasks, agents: listedAgents, pullRequests, now }),
    [id, tasks, listedAgents, pullRequests, now],
  );

  const agentIds = new Set(overview.agents.map(({ agent }) => agent.id));

  const open = (rowId: string) => {
    if (agentIds.has(rowId)) router.push(onOwnTab(iosAgentRoute(rowId)));
  };

  const openPullRequest = ({ pullRequest, agent }: ManagerPullRequest) => {
    const named = pullRequestAddressOf(pullRequest.url);

    // Note that a line whose address names no pull request of GitHub's opens it there, as Safari reads it.
    if (named === undefined) {
      openInSafari(pullRequest.url);

      return;
    }

    router.push(
      onOwnTab(
        iosRepositoryPullRequestRoute({ workspaceId: agent.workspaceId, ...named }, agent.id),
      ),
    );
  };

  const agentRows = (agents: readonly PersonAgent[]) =>
    agents.map(({ agent, task }) => (
      <TaskAgentRow
        key={agent.id}
        line={agentLine(agent, waiting.byAgent, pullRequests)}
        task={task}
        named
        asking={asking}
      />
    ));

  const bar = (
    <Stack.Screen
      options={{
        title: OVERVIEW_WORDS.TITLE,
        ...(manager === undefined ? undefined : { headerBackTitle: agentName(manager) }),
        headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
      }}
    />
  );

  if (manager === undefined) {
    return (
      <>
        {bar}
        <Screen>
          <EmptyState title={readingWords("the Manager")} symbol={GLYPH.AGENT} loading />
        </Screen>
      </>
    );
  }

  const empty = overview.agents.length === 0 && overview.pullRequests.length === 0;

  return (
    <>
      {bar}
      <Screen>
        <RowList look={LIST_LOOK.DETAIL} onSelect={open} onRefresh={refreshTasks}>
          <ListSection title={OVERVIEW_WORDS.COUNTS} footer={countsWords(overview)}>
            {null}
          </ListSection>
          {empty ? (
            <ListSection footer={OVERVIEW_WORDS.NOTHING_YET_HINT}>
              <EmptyState title={OVERVIEW_WORDS.NOTHING_YET} symbol={GLYPH.AGENT} />
            </ListSection>
          ) : null}
          {overview.agents.length === 0 ? null : (
            <ListSection title={OVERVIEW_WORDS.AGENTS} count={overview.agents.length}>
              {agentRows(overview.agents)}
            </ListSection>
          )}
          {overview.pullRequests.length === 0 ? null : (
            <ListSection title={OVERVIEW_WORDS.PULL_REQUESTS} count={overview.pullRequests.length}>
              {overview.pullRequests.map((each) => (
                <PullRequestRow key={each.pullRequest.url} each={each} onOpen={openPullRequest} />
              ))}
            </ListSection>
          )}
        </RowList>
      </Screen>
    </>
  );
}
