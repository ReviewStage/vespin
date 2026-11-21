/**
 * use-taskless-inbox-groups.ts -- the threads of agents on no task, as the window's Inbox lists them: each agent's items under the agent, named as every place names it.
 *
 * The account's feed tells an item on no task under the agent that posted
 * it (`AppInboxItems`'s `agents`). Each such agent is named from the task
 * list where it carries it, and else from its one read by its id
 * (`agentPageQueryOptions`), so its row leads with the agent's name where a
 * task's row leads with the task's. An agent not read yet, or of another
 * workspace than the one listed, lists nothing, as a task not listed yet
 * lists nothing; every workspace's stands while none is listed, as every
 * task's does (`use-inbox-slices.ts`).
 */

import type { AgentPageAnswerView } from "@repo/features/agent-view";
import type { ListedAgent } from "@repo/features/agent-wire";
import {
  agentHolder,
  type InboxAgentHolder,
  type InboxGroup,
  type InboxHolderAgent,
  inboxGroup,
} from "@repo/features/inbox-list-model";
import { agentName } from "@repo/features/model-label";
import type { CatalogModel } from "@repo/features/models-wire";
import { inArray, useLiveQuery } from "@tanstack/react-db";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { inboxItemsQuery } from "../live-reads.js";
import { useTaskListCollections } from "../task-list-collections.js";
import { agentPageQueryOptions } from "./agent-reads.js";

/** No agent on no task holding items. */
const NO_GROUPS: readonly InboxGroup<InboxAgentHolder>[] = [];

/** No agent's items, before the feed first answers. */
const NO_AGENTS: Readonly<Record<string, readonly unknown[]>> = {};

/** An agent as an Inbox names it, from what the list or its own read holds of it. */
type NamedSource = Pick<ListedAgent, "id" | "workspaceId" | "repository" | "face"> &
  Parameters<typeof agentName>[0];

/** The agents the reads answered, each as its page names it. Note that it is one function for every render, so the reads' answers are combined again only as they move. */
function answeredAgents(
  reads: readonly { readonly data?: AgentPageAnswerView | undefined }[],
): readonly NamedSource[] {
  return reads.flatMap(({ data }) => (data === undefined || "failure" in data ? [] : [data.agent]));
}

/** Whether any of the reads has not answered yet. Note that it answers a boolean, so its holder is drawn again only as it flips. */
function anyPending(reads: readonly { readonly isPending: boolean }[]): boolean {
  return reads.some((read) => read.isPending);
}

/** Whether two namings of an agent say the same, so its holder, and every row drawn of it, stays as it was. */
function sameAgent(a: InboxHolderAgent, b: InboxHolderAgent): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.model === b.model &&
    a.workspaceId === b.workspaceId &&
    a.repository === b.repository &&
    a.face?.character === b.face?.character &&
    a.face?.color === b.face?.color
  );
}

/** The agents on no task the Inbox lists, and where the account's feed they are told in stands. */
export interface TasklessInboxGroups {
  readonly groups: readonly InboxGroup<InboxAgentHolder>[];
  /** Whether the feed, or the read naming an agent it holds items of, has not answered yet, so an agent's items may still be on their way. */
  readonly pending: boolean;
  /** Whether the feed refused, so the list offers to read it again whether or not a task holds items. */
  readonly failed: boolean;
}

/**
 * Every agent on no task the feed holds items of in `workspaceId`, or in any
 * while none is named, each with its items, the agents named from the list
 * followed live first, where it carries them (`carried`), and else from their
 * own read; and where the feed stands, since a
 * reader whose only threads stand on no task is told the feed's state by
 * nothing else.
 */
export function useTasklessInboxGroups(
  workspaceId: string | undefined,
  carried: boolean,
  models: readonly CatalogModel[] | undefined,
): TasklessInboxGroups {
  const feed = useQuery(inboxItemsQuery());
  const fed = feed.data?.agents;
  const ids = useMemo(() => Object.keys(fed ?? NO_AGENTS), [fed]);
  const { agents } = useTaskListCollections();

  // Note that the agents are read as what names them alone, and only those the feed holds, so a step of any agent's turn tells the query nothing.
  const { data: listed } = useLiveQuery((q) =>
    carried
      ? q
          .from({ agent: agents })
          .where(({ agent }) => inArray(agent.id, ids))
          .select(({ agent }) => ({
            id: agent.id,
            workspaceId: agent.workspaceId,
            repository: agent.repository,
            face: agent.face,
            title: agent.title,
            automationName: agent.automationName,
            model: agent.model,
          }))
      : undefined,
  );

  const byId = useMemo(
    () =>
      new Map(
        (listed ?? []).map(
          ({ id, workspaceId, repository, title, model, face, automationName }) => {
            const source: NamedSource = {
              id,
              workspaceId,
              repository,
              title,
              model,
              ...(face === undefined ? undefined : { face }),
              ...(automationName === undefined ? undefined : { automationName }),
            };

            return [id, source] as const;
          },
        ),
      ),
    [listed],
  );

  // Note that only an agent the list does not carry is read by its id.
  const unlisted = ids.filter((id) => !byId.has(id));

  const pages = useQueries({
    queries: unlisted.map((agentId) => agentPageQueryOptions(agentId)),
    combine: answeredAgents,
  });

  // Note that an agent being named lists nothing yet, so a thread of its that a link opens waits on it rather than reading as missing.
  const naming = useQueries({
    queries: unlisted.map((agentId) => agentPageQueryOptions(agentId)),
    combine: anyPending,
  });

  // The holders named last, by agent, so an agent named the same is held by the very holder it was.
  const kept = useRef(new Map<string, InboxHolderAgent>());

  const groups = useMemo(() => {
    if (fed === undefined) return NO_GROUPS;
    const sources = new Map<string, NamedSource>(byId);

    for (const page of pages) if (!sources.has(page.id)) sources.set(page.id, page);

    return Object.entries(fed).flatMap(([agentId, items]) => {
      const source = sources.get(agentId);

      if (source === undefined) return [];

      if (workspaceId !== undefined && source.workspaceId !== workspaceId) return [];

      const named: InboxHolderAgent = {
        id: agentId,
        name: agentName(source, models),
        model: source.model,
        workspaceId: source.workspaceId,
        repository: source.repository,
        ...(source.face === undefined ? undefined : { face: source.face }),
      };

      const was = kept.current.get(agentId);
      const agent = was !== undefined && sameAgent(was, named) ? was : named;
      kept.current.set(agentId, agent);

      return [inboxGroup(agentHolder(agent), items)];
    });
  }, [fed, workspaceId, byId, pages, models]);

  return { groups, pending: feed.isPending || naming, failed: feed.isError };
}
