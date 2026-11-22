/**
 * use-mention-offer.ts -- what an `@` being typed offers in a composer or a description, as the panel's mention picker offers it: the place's agents, tasks, people, the description's sections, pages, the task's repository's files and folders, threads, automations, pull requests, dates and machines, and each pick sent as the mention's link the panel writes.
 *
 * An `@` starting the word the caret stands in offers, with nothing typed
 * after it, what the task suggests (its own agents, threads, pull requests
 * and pages, as the panel's Suggested holds them) and then the workspace's
 * people, the reader first; with words typed, the date they name, then the
 * workspace's agents, tasks and people, the task's pages, the workspace's
 * threads and the task's pull requests the words find, as
 * `@repo/features/mention-offer` groups and scores them, each row wearing
 * the mark the chip a pick writes leads with (`useChipMarkOf`), a pull
 * request its state's and a thread its ask's. Every composer draws pills
 * (`PillField`), so the word is the one its caret stands in, as the field
 * tells it; a pick puts the mention's pill in its place, already the link
 * the panel's chip writes, and a kind's row or the crumb rewrites the word
 * (`@people:`, or back to `@`). The people and the task's pages are
 * followed only while an `@` is being typed.
 */

import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { automationTriggerText } from "@repo/features/automation-list-model";
import { readerZone } from "@repo/features/date-mention";
import { DEVICE_PLATFORM_NAME } from "@repo/features/device-platform";
import { entityOfDestination } from "@repo/features/entity-kind";
import { inboxLineKind } from "@repo/features/inbox-list-model";
import {
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  linkWorkspaceStep,
  MENTION_SIGIL,
} from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { MENTION_FROM, typedMentionKind } from "@repo/features/mention-kind";
import {
  automationCandidate,
  dateCandidates,
  descriptionCandidates,
  isKindChoice,
  MENTION_NO_MATCH,
  MENTION_OFFER_KIND,
  type MentionCandidate,
  type MentionOffered,
  type MentionOfferFrom,
  type MentionOfferKind,
  type MentionOfferRow,
  machineCandidates,
  mentionOffer,
  type PickedMention,
  pathCandidates,
  type RepositoryPath,
} from "@repo/features/mention-offer";
import { agentName } from "@repo/features/model-label";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import { TASK_TREE_ENTRY } from "@repo/features/task-wire";
import { sinceText } from "@repo/features/time-format";
import { taskKey } from "@repo/features/workspace-key";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BUZZ,
  buzz,
  CHIP_MARK,
  type ChipMark,
  GLYPH,
  type Glyph,
  INBOX_LINE_LOOK,
  type MentionCrumb,
  type MentionSuggestion,
  type MentionSuggestionGroup,
  PULL_REQUEST_LOOK,
  useChipMarkOf,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useWorkspaceAutomations } from "./automations/use-automations.js";
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
import { useOfferedWorkspaceMachines } from "./workspace-machines.js";

/** What a person's row says after their name where it is the reader, as the panel's picker says it. */
const YOU = "You";

/** What a pull request's row says after its name where no agent is named for it, in the panel's words. */
const PULL_REQUEST_DETAIL = "Pull request";

/** The glyph each kind's row leads with, as the panel's rows lead with their kind's. */
const KIND_GLYPH = {
  [MENTION_OFFER_KIND.AGENT]: GLYPH.AGENT,
  [MENTION_OFFER_KIND.TASK]: GLYPH.TASK,
  [MENTION_OFFER_KIND.PERSON]: GLYPH.PERSON,
  [MENTION_OFFER_KIND.SECTION]: GLYPH.HEADING,
  [MENTION_OFFER_KIND.PAGE]: GLYPH.PAGE,
  [MENTION_OFFER_KIND.FILE]: GLYPH.FILE,
  [MENTION_OFFER_KIND.FOLDER]: GLYPH.FOLDER,
  [MENTION_OFFER_KIND.THREAD]: GLYPH.THREAD,
  [MENTION_OFFER_KIND.AUTOMATION]: GLYPH.AUTOMATION,
  [MENTION_OFFER_KIND.PULL_REQUEST]: GLYPH.PULL_REQUEST,
  [MENTION_OFFER_KIND.DATE]: GLYPH.DATE,
  [MENTION_OFFER_KIND.MACHINE]: GLYPH.MAC,
} as const satisfies Record<MentionOfferKind, Glyph>;

/** The glyph each kind's row under Browse, and its crumb, lead with, as the panel's kind rows lead with theirs. */
const FROM_GLYPH = {
  [MENTION_FROM.AGENTS]: GLYPH.AGENT,
  [MENTION_FROM.TASKS]: GLYPH.TASK,
  [MENTION_FROM.PEOPLE]: GLYPH.PEOPLE,
  [MENTION_FROM.DESCRIPTION]: GLYPH.FILE_TEXT,
  [MENTION_FROM.PAGES]: GLYPH.PAGE,
  [MENTION_FROM.FILES]: GLYPH.REPOSITORY,
  [MENTION_FROM.THREADS]: GLYPH.THREAD,
  [MENTION_FROM.AUTOMATIONS]: GLYPH.AUTOMATION,
  [MENTION_FROM.PULL_REQUESTS]: GLYPH.PULL_REQUEST,
  [MENTION_FROM.DATES]: GLYPH.DATE,
  [MENTION_FROM.MACHINES]: GLYPH.MAC,
} as const satisfies Record<MentionOfferFrom, Glyph>;

/** The repository's paths a task's `@` offers, read once per task and repository, as the panel holds them for the window's life. */
const PATHS_QUERY_ROOT = "mention-repository-paths";

/** The paths of the repository the task names, the whole tree at its default branch; a refusal fails the read, never an empty repository. */
async function repositoryPaths(
  acts: ReturnType<typeof useHostActs>,
  taskId: string,
): Promise<readonly RepositoryPath[]> {
  const answer = await acts[ACT_KIND.TASKS_TREE]({ taskId, path: "", recursive: true });

  if (!("folder" in answer)) throw new Error("The repository's paths were not read.");

  return answer.folder.entries.map((entry) => ({
    path: entry.name,
    folder: entry.kind === TASK_TREE_ENTRY.FOLDER,
  }));
}

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

/** A thread an `@` offers, and whether it is the task's own, which Suggested holds. */
interface ThreadCandidate extends MentionCandidate {
  readonly own: boolean;
}

/** What an `@` word offers, and each row's mark by the link a pick writes. */
interface Offered {
  readonly offer: MentionOffered;
  readonly marks: ReadonlyMap<string, ChipMark>;
}

/** No offer: what stands before the place's workspace is known. */
const NO_OFFER: MentionOffered = { narrowed: undefined, groups: [] };

/** A row as the list draws it: a kind's by its query, which names it uniquely in its group, its chevron saying a press narrows to it. */
function suggestion(row: MentionOfferRow, marks: ReadonlyMap<string, ChipMark>): MentionSuggestion {
  if (isKindChoice(row)) {
    return { id: row.query, glyph: FROM_GLYPH[row.from], name: row.name, opens: true };
  }

  return {
    id: row.id,
    glyph: KIND_GLYPH[row.kind],
    mark: marks.get(row.target),
    name: row.name,
    detail: row.detail,
  };
}

/** What an `@` being typed offers, what stands where nothing matches, and the press that writes one. */
export interface MentionsOffered {
  readonly groups: readonly MentionSuggestionGroup[];
  readonly empty: string | undefined;
  /** The kind the list is narrowed to, and the press back to every kind; none for every kind. */
  readonly crumb: MentionCrumb | undefined;
  readonly pick: (group: string, id: string) => void;
}

/** A field that draws pills: the `@` word its caret stands in, and the door that puts a picked mention's pill in its place. */
export interface MentionPills {
  readonly word: { readonly query: string } | undefined;
  readonly pick: (mention: PickedMention) => void;
  /** Writes plain words in the `@` word's place, the caret after them, as a kind's row writes `@people:`. */
  readonly rewrite: (words: string) => void;
}

/**
 * What the `@` word the caret of the field drawing `pills` stands in
 * offers in the place, a pick putting the mention's pill there; none while
 * no `@` word stands, or before the place's workspace is known.
 */
export function useMentionOffer(
  place: {
    readonly workspaceId: string | undefined;
    readonly taskId: string | undefined;
    /** The agent whose composer it is, which its own `@` never offers, as the panel's leaves it out. */
    readonly agentId?: string | undefined;
    /** The words of the task's description being edited, whose sections its `@` offers, the task itself standing among them rather than among the tasks, as the panel's description offers them. */
    readonly description?: string | undefined;
  },
  pills: MentionPills,
): MentionsOffered | undefined {
  const { workspaceId, taskId, agentId, description } = place;
  const { word } = pills;
  const asking = word !== undefined && workspaceId !== undefined;
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const step = linkWorkspaceStep(workspaceId, workspaces);
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const acts = useHostActs();
  const members = useListedMembers(asking ? workspaceId : undefined);
  // Note that the workspace's automations and machines are followed only while an `@` is typed, as its members are.
  const automations = useWorkspaceAutomations(asking ? workspaceId : undefined).rows;
  const machines = useOfferedWorkspaceMachines(asking ? workspaceId : undefined);
  // Note that the tasks and agents are read only while an `@` is typed, as its members are, so a change to any of the account's while none is, as each step of a working agent's turn makes, draws the composer's page nothing again.
  const agents = useListedAgents(asking);
  const tasks = useListedTasks(asking);
  // Note that the task's pages are followed only while an `@` is typed, as its members are.
  useLiveFollow(asking ? taskId : undefined, (id) =>
    acts[ACT_KIND.TASKS_PAGES_FOLLOW]({ taskId: id }),
  );
  const held = useQuery({ ...appStateQuery, select: useMemo(() => heldOf(taskId), [taskId]) }).data;
  // Note that the task's repository's paths are read once an `@` is typed and held while the app runs, as the panel holds them, since a repository's files rarely move while a word is typed.
  const repository = tasks.find((task) => task.id === taskId)?.repository ?? null;

  const { data: paths } = useQuery({
    queryKey: [PATHS_QUERY_ROOT, taskId, repository],
    enabled: asking && taskId !== undefined && repository !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: () => repositoryPaths(acts, taskId ?? ""),
  });

  const taskPullRequests = useTaskListRow(useTaskListCollections().taskPullRequests, taskId);
  const markOf = useChipMarkOf();

  const { offer, marks } = useMemo((): Offered => {
    if (!asking || step === undefined) return { offer: NO_OFFER, marks: new Map() };
    const now = Date.now();
    // Each row's mark by the link a pick writes, as the chip it becomes leads with it.
    const marks = new Map<string, ChipMark>();

    const marked = (destination: LinkDestination): string => {
      const target = linkOf(destination, step);
      const mark = markOf(entityOfDestination(destination));

      if (mark !== undefined) marks.set(target, mark);

      return target;
    };

    const ownAgents = agents.filter(
      (agent) =>
        agent.workspaceId === workspaceId && agent.archivedAt === undefined && agent.id !== agentId,
    );

    const agentRow = (agent: (typeof ownAgents)[number]): MentionCandidate => ({
      id: agent.id,
      kind: MENTION_OFFER_KIND.AGENT,
      name: agentName(agent),
      target: marked({ kind: LINK_DESTINATION.AGENT, agentId: agent.id }),
    });

    const ownTasks = tasks.filter((task) => task.workspaceId === workspaceId);
    const taskNamed = new Map(ownTasks.map((task) => [task.id, task.name]));

    const keyOf = (number: number | undefined) =>
      workspace === undefined || number === undefined ? undefined : taskKey(workspace.name, number);

    const described = ownTasks.find((task) => task.id === taskId);
    // Note that a description's task stands as its description whole rather than among the tasks, as the panel's does.
    const describing = description === undefined ? undefined : described;

    const taskRows = ownTasks.flatMap((task): MentionCandidate[] => {
      if (task === describing) return [];
      const key = keyOf(task.number);

      return [
        {
          id: task.id,
          kind: MENTION_OFFER_KIND.TASK,
          name: task.name,
          detail: key,
          key,
          target: marked({ kind: LINK_DESTINATION.TASK, taskId: task.id }),
        },
      ];
    });

    const sections =
      describing === undefined || description === undefined
        ? []
        : descriptionCandidates(
            { taskId: describing.id, name: describing.name, key: keyOf(describing.number) },
            description,
            { workspace: step, repository: null },
          );

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
          : items.map((item) => ({ item, holder, own: threadTaskId === taskId }));
      })
      .sort(
        (one, other) =>
          Number(other.own) - Number(one.own) || other.item.updatedAt - one.item.updatedAt,
      )
      .map(({ item, holder, own }): ThreadCandidate => {
        // Note that a thread is linked by itself alone, as the panel's mention writes it.
        const target = linkOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId: item.id }, step);

        // Note that a thread wears what its last line asks, as its Inbox row does, and a plain message keeps the thread's glyph.
        const look = INBOX_LINE_LOOK[inboxLineKind(item)];

        if (look !== undefined) {
          marks.set(target, { kind: CHIP_MARK.GLYPH, glyph: look.symbol, tone: look.tone });
        }

        return {
          id: item.id,
          kind: MENTION_OFFER_KIND.THREAD,
          name: item.title,
          detail: holder,
          terms: [holder],
          target,
          own,
        };
      });

    // Note that a pull request with no address yet offers nothing, since a pick writes its GitHub address.
    const pullRequests = (taskPullRequests?.pullRequests ?? []).flatMap(
      (pullRequest): MentionCandidate[] => {
        const { url } = pullRequest;

        if (url === undefined) return [];
        const publisher = ownAgents.find((agent) => agent.id === pullRequest.agentId);
        const look = PULL_REQUEST_LOOK[pullRequestMarkState(pullRequest)];
        marks.set(url, { kind: CHIP_MARK.GLYPH, glyph: look.symbol, tone: look.tone });

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
        target: marked({ kind: LINK_DESTINATION.PERSON, userId: member.userId }),
      })),
      description: sections,
      pages,
      files: pathCandidates(paths ?? [], { workspace: step, repository }),
      threads,
      automations: (automations ?? []).map((automation) =>
        automationCandidate(
          automation,
          automationTriggerText(automation.trigger, automation.repositories ?? []),
          step,
        ),
      ),
      pullRequests,
      machines: machineCandidates(
        machines.map((machine) => ({
          id: machine.id,
          name: machine.name,
          ownerId: machine.connectedBy,
          terms: [
            members.find((member) => member.userId === machine.connectedBy)?.name,
            machine.platform === undefined ? undefined : DEVICE_PLATFORM_NAME[machine.platform],
          ].filter((term) => term !== undefined),
        })),
        members.find((member) => member.you)?.userId,
        { workspace: step, repository: null },
      ),
      dates: (words: string) =>
        dateCandidates(words, now, readerZone(), { workspace: step, repository: null }),
    };

    return { offer: mentionOffer(sources, word.query), marks };
  }, [
    markOf,
    asking,
    step,
    agents,
    tasks,
    members,
    automations,
    machines,
    paths,
    repository,
    workspaceId,
    taskId,
    agentId,
    description,
    workspace,
    word,
    held,
    taskPullRequests,
  ]);

  if (!asking) return undefined;
  const { groups, narrowed } = offer;

  // Note that once the words run past a space with nothing found, the offer closes, as the panel's list closes, so a sentence that began with an `@` goes on unhindered.
  if (groups.length === 0 && word.query.includes(" ")) return undefined;

  // The `@` word written anew as `@` and `query`, as a kind's row narrows the list and its crumb widens it.
  const retype = (query: string) => pills.rewrite(`${MENTION_SIGIL}${query}`);

  const typed = typedMentionKind(word.query);

  const crumb =
    narrowed === undefined || typed === undefined
      ? undefined
      : {
          name: narrowed.name,
          glyph: FROM_GLYPH[narrowed.from],
          // Note that the way back keeps the words searched and deletes the `kind:`, as the panel's crumb does.
          onBack: () => retype(word.query.slice(typed.entry.length)),
        };

  return {
    groups: groups.map((group) => ({
      title: group.title,
      rows: group.rows.map((row) => suggestion(row, marks)),
    })),
    empty: groups.length === 0 ? MENTION_NO_MATCH : undefined,
    crumb,
    pick: (title, id) => {
      const row = groups
        .find((group) => group.title === title)
        ?.rows.find((each) => (isKindChoice(each) ? each.query : each.id) === id);

      if (row === undefined) return;
      buzz(BUZZ.SELECTION);

      if (isKindChoice(row)) return retype(row.query);
      pills.pick({ name: row.written ?? row.name, target: row.target });
    },
  };
}
