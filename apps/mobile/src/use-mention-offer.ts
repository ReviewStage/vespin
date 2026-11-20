/**
 * use-mention-offer.ts -- what an `@` being typed offers in a composer, as the panel's mention picker offers it: the place's agents, tasks, people, pages, threads, pull requests and dates, and each pick sent as the mention's link.
 *
 * An `@` starting the word the words end with offers, with nothing typed
 * after it, what the task suggests (its own agents, threads, pull requests
 * and pages, as the panel's Suggested holds them) and then the workspace's
 * people, the reader first; with words typed, the date they name, then the
 * workspace's agents, tasks and people, the task's pages, the workspace's
 * threads and the task's pull requests the words find, as
 * `@repo/features/mention-offer` groups and scores them. In a field that
 * draws pills (`PillField`), the word is the one its caret stands in, as the
 * field tells it, and a pick puts the mention's pill in its place, already
 * the link the panel's chip writes. In the system's field, which draws no
 * chip and hands no caret, the word is the one the words end with, a pick
 * writes `@Name ` in its place, and the send writes each picked `@Name`
 * still standing as that link (`[@Name](https://vespin.dev/…)`, a pull
 * request's GitHub address, a date's `mention://date`). The people and the
 * task's pages are followed only while an `@` is being typed.
 */

import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { readerZone } from "@repo/features/date-mention";
import { LINK_DESTINATION, linkOf, linkWorkspaceStep } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  atWordEnding,
  dateCandidates,
  MENTION_NO_MATCH,
  MENTION_OFFER_KIND,
  type MentionCandidate,
  type MentionGroup,
  type MentionOfferKind,
  mentionGroups,
  type PickedMention,
  withMentionLinks,
  wordsWithPick,
} from "@repo/features/mention-offer";
import { agentName } from "@repo/features/model-label";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { sinceText } from "@repo/features/time-format";
import { taskKey } from "@repo/features/workspace-key";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { BUZZ, buzz, GLYPH, type Glyph, type MentionSuggestionGroup } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import {
  useHostActs,
  useListedAgents,
  useListedTasks,
  useTaskListCollections,
  useTaskListRow,
} from "./host/host-provider.js";
import { useLiveFollow } from "./host/live-follow.js";
import { useListedMembers } from "./member-pictures.js";

/** What a person's row says after their name where it is the reader, as the panel's picker says it. */
const YOU = "You";

/** What a pull request's row says after its name where no agent is named for it, in the panel's words. */
const PULL_REQUEST_DETAIL = "Pull request";

/** The glyph each kind's row leads with, as the panel's rows lead with their kind's. */
const KIND_GLYPH = {
  [MENTION_OFFER_KIND.AGENT]: GLYPH.AGENT,
  [MENTION_OFFER_KIND.TASK]: GLYPH.TASK,
  [MENTION_OFFER_KIND.PERSON]: GLYPH.PERSON,
  [MENTION_OFFER_KIND.PAGE]: GLYPH.PAGE,
  [MENTION_OFFER_KIND.THREAD]: GLYPH.THREAD,
  [MENTION_OFFER_KIND.PULL_REQUEST]: GLYPH.PULL_REQUEST,
  [MENTION_OFFER_KIND.DATE]: GLYPH.DATE,
} as const satisfies Record<MentionOfferKind, Glyph>;

/** What a page's row says after its name, as the panel's: a version past its first, else when it was shown. */
function pageDetail(version: number, at: number, now: number): string {
  return version > 1 ? `Version ${version}` : sinceText(at, now);
}

/** The task's pages and the account's Inbox threads, as the host holds them, as a `select`. */
function heldOf(taskId: string | undefined) {
  return (state: AppStateSnapshot) => ({
    pages: taskId === undefined ? undefined : state[LIVE_READ.PAGES][PAGE_OWNER.TASK][taskId]?.rows,
    threads: state[LIVE_READ.INBOX_ITEMS].rows?.[INBOX_SCOPE_KIND.TASK],
  });
}

/** What an `@` being typed offers, what stands where nothing matches, and the press that writes one. */
export interface MentionsOffered {
  readonly groups: readonly MentionSuggestionGroup[];
  readonly empty: string | undefined;
  readonly pick: (group: string, id: string) => void;
}

/** A field that draws pills: the `@` word its caret stands in, and the door that puts a picked mention's pill in its place. */
export interface MentionPills {
  readonly word: { readonly query: string } | undefined;
  readonly pick: (mention: PickedMention) => void;
}

/** What `useMentionOffer` hands its composer: the offer while an `@` is typed, and the words as they are sent, each pick written as its link. */
export interface MentionOffer {
  readonly offered: MentionsOffered | undefined;
  readonly sendable: (words: string) => string;
}

/**
 * What the `@` word `words` end with offers in the place, a pick handing
 * the words with the name written in to `onWords`, or, in a field drawing
 * `pills`, what the word its caret stands in offers, a pick putting the
 * mention's pill there; none while no `@` word stands, or before the
 * place's workspace is known.
 */
export function useMentionOffer(
  words: string,
  onWords: (words: string) => void,
  place: { readonly workspaceId: string | undefined; readonly taskId: string | undefined },
  pills?: MentionPills | undefined,
): MentionOffer {
  const { workspaceId, taskId } = place;
  const ending = useMemo(() => atWordEnding(words), [words]);
  const word = pills === undefined ? ending : pills.word;
  const asking = word !== undefined && workspaceId !== undefined;
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const step = linkWorkspaceStep(workspaceId, workspaces);
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const acts = useHostActs();
  const members = useListedMembers(asking ? workspaceId : undefined);
  const agents = useListedAgents();
  const tasks = useListedTasks();
  // Note that the task's pages are followed only while an `@` is typed, as its members are.
  useLiveFollow(asking ? taskId : undefined, (id) =>
    acts[ACT_KIND.TASKS_PAGES_FOLLOW]({ taskId: id }),
  );
  const held = useQuery({ ...appStateQuery, select: useMemo(() => heldOf(taskId), [taskId]) }).data;
  const taskPullRequests = useTaskListRow(useTaskListCollections().taskPullRequests, taskId);
  // The mentions picked into the words, which the send writes as their links where they still stand.
  const picked = useRef<PickedMention[]>([]);

  const groups = useMemo((): readonly MentionGroup[] => {
    if (!asking || step === undefined) return [];
    const now = Date.now();

    const ownAgents = agents.filter(
      (agent) => agent.workspaceId === workspaceId && agent.archivedAt === undefined,
    );

    const agentRow = (agent: (typeof ownAgents)[number]): MentionCandidate => ({
      id: agent.id,
      kind: MENTION_OFFER_KIND.AGENT,
      name: agentName(agent),
      target: linkOf({ kind: LINK_DESTINATION.AGENT, agentId: agent.id }, step),
    });

    const ownTasks = tasks.filter((task) => task.workspaceId === workspaceId);
    const taskNamed = new Map(ownTasks.map((task) => [task.id, task.name]));

    const taskRows = ownTasks.map((task): MentionCandidate => {
      const key =
        workspace === undefined || task.number === undefined
          ? undefined
          : taskKey(workspace.name, task.number);

      return {
        id: task.id,
        kind: MENTION_OFFER_KIND.TASK,
        name: task.name,
        detail: key,
        key,
        target: linkOf({ kind: LINK_DESTINATION.TASK, taskId: task.id }, step),
      };
    });

    const pages = (taskId === undefined ? [] : (held?.pages ?? [])).map(
      (page): MentionCandidate => ({
        id: page.id,
        kind: MENTION_OFFER_KIND.PAGE,
        name: page.title,
        detail: pageDetail(page.version, page.at, now),
        target: linkOf(
          { kind: LINK_DESTINATION.PAGE, taskId: taskId ?? "", pageId: page.id },
          step,
        ),
      }),
    );

    // Note that the task's own threads come first, then the newest changed, as the panel's list orders them.
    const threads = Object.entries(held?.threads ?? {})
      .flatMap(([threadTaskId, items]) => {
        const holder = taskNamed.get(threadTaskId);

        return holder === undefined
          ? []
          : items.map((item) => ({ item, threadTaskId, holder, own: threadTaskId === taskId }));
      })
      .sort(
        (one, other) =>
          Number(other.own) - Number(one.own) || other.item.updatedAt - one.item.updatedAt,
      )
      .map(({ item, threadTaskId, holder, own }): MentionCandidate & { readonly own: boolean } => ({
        id: item.id,
        kind: MENTION_OFFER_KIND.THREAD,
        name: item.title,
        detail: holder,
        terms: [holder],
        target: linkOf(
          { kind: LINK_DESTINATION.INBOX_ITEM, taskId: threadTaskId, itemId: item.id },
          step,
        ),
        own,
      }));

    // Note that a pull request with no address yet offers nothing, since a pick writes its GitHub address.
    const pullRequests = (taskPullRequests?.pullRequests ?? []).flatMap(
      (pullRequest): MentionCandidate[] => {
        const { url } = pullRequest;

        if (url === undefined) return [];
        const publisher = ownAgents.find((agent) => agent.id === pullRequest.agentId);

        return [
          {
            id: url,
            kind: MENTION_OFFER_KIND.PULL_REQUEST,
            name: `#${pullRequest.number} ${pullRequest.title}`,
            detail: publisher === undefined ? PULL_REQUEST_DETAIL : agentName(publisher),
            terms: [PULL_REQUEST_DETAIL],
            target: url,
          },
        ];
      },
    );

    const sources = {
      suggested: [
        ...ownAgents.filter((agent) => agent.taskId === taskId).map(agentRow),
        ...threads.filter((thread) => thread.own),
        ...pullRequests,
        ...pages,
      ],
      agents: ownAgents.map(agentRow),
      tasks: taskRows,
      people: members.map((member) => ({
        id: member.userId,
        kind: MENTION_OFFER_KIND.PERSON,
        name: member.name,
        detail: member.you ? YOU : member.email,
        terms: [member.email],
        target: linkOf({ kind: LINK_DESTINATION.PERSON, userId: member.userId }, step),
      })),
      pages,
      threads,
      pullRequests,
      dates: dateCandidates(word.query, now, readerZone(), { workspace: step, repository: null }),
    };

    return mentionGroups(sources, word.query);
  }, [
    asking,
    step,
    agents,
    tasks,
    members,
    workspaceId,
    taskId,
    workspace,
    word,
    held,
    taskPullRequests,
  ]);

  // Note that a field drawing pills holds each mention as its link already, so its words go as they stand.
  const sendable = (text: string) =>
    pills === undefined ? withMentionLinks(text, picked.current) : text;

  if (!asking) return { offered: undefined, sendable };

  // Note that once the words run past a space with nothing found, the offer closes, as the panel's list closes, so a sentence that began with an `@` goes on unhindered.
  if (groups.length === 0 && word.query.includes(" ")) return { offered: undefined, sendable };

  return {
    offered: {
      groups: groups.map((group) => ({
        title: group.title,
        rows: group.rows.map(({ id, kind, name, detail }) => ({
          id,
          glyph: KIND_GLYPH[kind],
          name,
          detail,
        })),
      })),
      empty: groups.length === 0 ? MENTION_NO_MATCH : undefined,
      pick: (title, id) => {
        const row = groups
          .find((group) => group.title === title)
          ?.rows.find((each) => each.id === id);

        if (row === undefined) return;
        const mention = { name: row.name, target: row.target };
        buzz(BUZZ.SELECTION);

        if (pills !== undefined) return pills.pick(mention);

        if (ending === undefined) return;
        picked.current = [...picked.current, mention];
        onWords(wordsWithPick(words, ending.start, row.name));
      },
    },
    sendable,
  };
}
