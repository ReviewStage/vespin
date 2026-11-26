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
 * (`@people:`, or back to `@`). What the place offers is followed only
 * while its field holds the keyboard or an `@` is being typed.
 */

import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { automationTriggerText } from "@repo/features/automation-list-model";
import { readerZone } from "@repo/features/date-mention";
import { DEVICE_PLATFORM_NAME } from "@repo/features/device-platform";
import { entityOfDestination } from "@repo/features/entity-kind";
import { inboxRowOf } from "@repo/features/inbox-digest";
import { inboxLineKind } from "@repo/features/inbox-list-model";
import {
  LINK_DESTINATION,
  type LinkDestination,
  linkWorkspaceStep,
  MENTION_SIGIL,
} from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { MENTION_FROM, typedMentionKind } from "@repo/features/mention-kind";
import {
  agentCandidate,
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
  type MentionSources,
  machineCandidates,
  mentionOffer,
  mentionPaths,
  type PickedMention,
  pageCandidate,
  pathCandidates,
  personCandidate,
  pullRequestCandidate,
  type RepositoryPath,
  taskCandidate,
  threadCandidate,
} from "@repo/features/mention-offer";
import { agentName } from "@repo/features/model-label";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import { TASK_TREE_ENTRY } from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectInboxHoldings, selectWorkspaces } from "@repo/host/app-state-reads";
import { INBOX_WHOLE, inboxHoldingsOfRows } from "@repo/host/inbox-rows";
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
import { useDeferredValue, useMemo } from "react";
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
import { useInboxRows } from "./inbox/inbox-rows.js";
import { useListedMembers } from "./member-pictures.js";
import { useModelCatalog } from "./tasks/use-start.js";
import { useWorkspaceMachines } from "./workspace-machines.js";

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
  [MENTION_OFFER_KIND.SKILL]: GLYPH.SKILL,
  [MENTION_OFFER_KIND.APP]: GLYPH.COMPUTER_USE,
  [MENTION_OFFER_KIND.COMPUTER]: GLYPH.COMPUTER_USE,
  [MENTION_OFFER_KIND.SERVER]: GLYPH.PLUG,
  [MENTION_OFFER_KIND.TOOL]: GLYPH.PLUG,
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
  [MENTION_FROM.SKILLS]: GLYPH.SKILL,
  [MENTION_FROM.APPS]: GLYPH.COMPUTER_USE,
  [MENTION_FROM.SERVERS]: GLYPH.PLUG,
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

/** The entity an agent's, a task's, or a person's row names by its id, whose chip's mark the row wears. */
const ROW_DESTINATION = {
  [MENTION_OFFER_KIND.AGENT]: (agentId: string) => ({ kind: LINK_DESTINATION.AGENT, agentId }),
  [MENTION_OFFER_KIND.TASK]: (taskId: string) => ({ kind: LINK_DESTINATION.TASK, taskId }),
  [MENTION_OFFER_KIND.PERSON]: (userId: string) => ({ kind: LINK_DESTINATION.PERSON, userId }),
} as const satisfies Partial<Record<MentionOfferKind, (id: string) => LinkDestination>>;

/** Each agent's, task's and person's row's entity, by the link a pick writes. */
function namedOf(rows: readonly MentionCandidate[]): ReadonlyMap<string, LinkDestination> {
  return new Map(
    rows.flatMap((row): [string, LinkDestination][] =>
      row.kind === MENTION_OFFER_KIND.AGENT ||
      row.kind === MENTION_OFFER_KIND.TASK ||
      row.kind === MENTION_OFFER_KIND.PERSON
        ? [[row.target, ROW_DESTINATION[row.kind](row.id)]]
        : [],
    ),
  );
}

/** No offer: what stands before the place's workspace is known, or before the words typed are taken up. */
const NO_OFFER: MentionOffered = { narrowed: undefined, groups: [] };

/** The rows an `@` may offer in the place, built once each time what the place reads moves rather than at each key, and what each row's mark is worked out from as it is drawn. */
interface Candidates {
  /** Every kind's rows but the description's sections and the dates, which the words typed shape. */
  readonly sources: Omit<MentionSources, "description" | "dates">;
  /** The entity each row's link names, whose chip's mark its row wears, worked out only for the rows drawn. */
  readonly named: ReadonlyMap<string, LinkDestination>;
  /** The mark a row wears that is no entity's chip mark, as a thread's ask and a pull request's state, by the link a pick writes. */
  readonly marks: ReadonlyMap<string, ChipMark>;
}

/** A row as the list draws it: a kind's by its query, which names it uniquely in its group, its chevron saying a press narrows to it. */
function suggestion(
  row: MentionOfferRow,
  markOfTarget: (target: string) => ChipMark | undefined,
): MentionSuggestion {
  if (isKindChoice(row)) {
    return { id: row.query, glyph: FROM_GLYPH[row.from], name: row.name, opens: true };
  }

  return {
    id: row.id,
    glyph: KIND_GLYPH[row.kind],
    mark: markOfTarget(row.target),
    name: row.name,
    detail: row.detail,
    // Note that a folder's row walks into it rather than naming it, as the panel's → does; the folder heads its own list to be named.
    opens: row.walk !== undefined,
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
  /** Whether the field holds the keyboard, from which what an `@` offers is read, so its rows stand read by the time one is typed. */
  readonly focused?: boolean | undefined;
  readonly pick: (mention: PickedMention) => void;
  /** Writes plain words in the `@` word's place, the caret after them, as a kind's row writes `@people:`. */
  readonly rewrite: (words: string) => void;
}

/**
 * What the `@` word the caret of the field drawing `pills` stands in
 * offers in the place, a pick putting the mention's pill there; none while
 * no `@` word stands, or before the place's workspace is known. Note that
 * what the place offers is read from the moment its field takes the
 * keyboard, so its kinds stand read when the `@` is typed rather than
 * popping in under it, and a kind still being read keeps its row in place
 * (`pending`). The rows are built once each time what is read moves, and
 * each key only searches them, on a deferred copy of the words, so a
 * keystroke never waits on the account's thousands of tasks; a row's mark
 * is worked out only for the rows drawn.
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
  // Note that the place's rows are read while its field holds the keyboard as well as while an `@` is typed, and nothing is read otherwise, so a change to any of the account's while the field is idle, as each step of a working agent's turn makes, draws the composer's page nothing again.
  const reading = asking || (pills.focused === true && workspaceId !== undefined);
  const readWorkspace = reading ? workspaceId : undefined;
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const step = linkWorkspaceStep(workspaceId, workspaces);
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const acts = useHostActs();
  const members = useListedMembers(readWorkspace);
  const automations = useWorkspaceAutomations(readWorkspace).rows;
  const machines = useWorkspaceMachines(readWorkspace).machines;
  const agents = useListedAgents(reading);
  const tasks = useListedTasks(reading);
  useLiveFollow(reading ? taskId : undefined, (id) =>
    acts[ACT_KIND.TASKS_PAGES_FOLLOW]({ taskId: id }),
  );
  const held = useQuery({ ...appStateQuery, select: useMemo(() => heldOf(taskId), [taskId]) }).data;
  const told = useQuery({ ...appStateQuery, select: selectInboxHoldings }).data;
  // Note that where the account's database keeps the Inbox, its threads are read from there, every one, only while an `@` is typed.
  const keptRows = useInboxRows(reading && told?.stored === true ? INBOX_WHOLE : undefined);

  const heldThreads = useMemo(
    () =>
      told?.stored === true
        ? Object.fromEntries(inboxHoldingsOfRows(keptRows ?? [], told).read)
        : held?.threads,
    [told, keptRows, held],
  );
  // Note that the task's repository's paths are read once and held while the app runs, as the panel holds them, since a repository's files rarely move while a word is typed.

  const current = tasks.find((task) => task.id === taskId);
  const repository = current?.repository ?? null;
  const readsPaths = reading && taskId !== undefined && repository !== null;

  const { data: paths, isPending: pathsPending } = useQuery({
    queryKey: [PATHS_QUERY_ROOT, taskId, repository],
    enabled: readsPaths,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: () => repositoryPaths(acts, taskId ?? ""),
  });

  const taskPullRequests = useTaskListRow(useTaskListCollections().taskPullRequests, taskId);
  const markOf = useChipMarkOf();
  // Note that an agent with no title is named by its model as the catalog calls it, as the panel's rows name it, so a pick writes the name the desktop's would.
  const catalog = useModelCatalog();

  // The kinds whose rows are still on their way, which Browse keeps in place until they land.
  const pending = useMemo(() => {
    const unread: readonly [MentionOfferFrom, boolean][] = [
      [MENTION_FROM.AUTOMATIONS, automations === undefined],
      [MENTION_FROM.MACHINES, machines === undefined],
      [MENTION_FROM.PAGES, taskId !== undefined && held?.pages === undefined],
      [MENTION_FROM.FILES, readsPaths && pathsPending],
    ];

    return new Set(unread.flatMap(([from, waits]) => (waits ? [from] : [])));
  }, [automations, machines, taskId, held?.pages, readsPaths, pathsPending]);

  const candidates = useMemo((): Candidates | undefined => {
    if (!asking || step === undefined) return undefined;
    const now = Date.now();
    const marks = new Map<string, ChipMark>();

    const ownAgents = agents.filter(
      (agent) =>
        agent.workspaceId === workspaceId && agent.archivedAt === undefined && agent.id !== agentId,
    );

    const agentRow = (agent: (typeof ownAgents)[number]): MentionCandidate =>
      agentCandidate({ id: agent.id, name: agentName(agent, catalog?.models) }, step);

    const ownTasks = tasks.filter((task) => task.workspaceId === workspaceId);
    const taskNamed = new Map(ownTasks.map((task) => [task.id, task.name]));

    const keyOf = (number: number | undefined) =>
      workspace === undefined || number === undefined ? undefined : taskKey(workspace.name, number);

    // Note that a description's task stands as its description whole rather than among the tasks, as the panel's does.
    const describing = description === undefined ? undefined : taskId;

    const taskRows = ownTasks.flatMap((task): MentionCandidate[] =>
      task.id === describing ? [] : [taskCandidate(task, keyOf(task.number), step)],
    );

    const pages =
      taskId === undefined
        ? []
        : (held?.pages ?? []).map((page) => pageCandidate(page, taskId, now, step));

    // Note that the task's own threads come first, then the newest changed, as the panel's list orders them.
    const threads = Object.entries(heldThreads ?? {})
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
        const row = threadCandidate(item, holder, step);
        // Note that a thread wears what its last line asks, as its Inbox row does, and a plain message keeps the thread's glyph.
        const look = INBOX_LINE_LOOK[inboxLineKind(inboxRowOf(item))];

        if (look !== undefined) {
          marks.set(row.target, { kind: CHIP_MARK.GLYPH, glyph: look.symbol, tone: look.tone });
        }

        return { ...row, own };
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
          pullRequestCandidate(
            { url, number: pullRequest.number, title: pullRequest.title },
            publisher === undefined ? undefined : agentName(publisher),
          ),
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
      people: members.map((member) => personCandidate(member, member.you, step)),
      pages,
      files: mentionPaths(pathCandidates(paths ?? [], { workspace: step, repository })),
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
        (machines ?? []).map((machine) => ({
          id: machine.id,
          name: machine.name,
          ownerId: machine.connectedBy,
          terms: [
            members.find((member) => member.userId === machine.connectedBy)?.name,
            machine.platform === undefined ? undefined : DEVICE_PLATFORM_NAME[machine.platform],
          ].filter((term) => term !== undefined),
        })),
        {
          readerId: members.find((member) => member.you)?.userId,
          followerIds: new Set((current?.followers ?? []).map((follower) => follower.userId)),
        },
        { workspace: step, repository: null },
      ),
      pending,
    };

    // Note that only the workspace's agents, tasks and people wear their entity's chip mark, never the description whole, which names its task too.
    const named = namedOf([...sources.agents, ...sources.tasks, ...sources.people]);

    return { sources, named, marks };
  }, [
    catalog,
    asking,
    step,
    agents,
    tasks,
    members,
    automations,
    machines,
    paths,
    repository,
    current,
    workspaceId,
    taskId,
    agentId,
    description,
    workspace,
    held,
    heldThreads,
    taskPullRequests,
    pending,
  ]);

  // Note that the words are searched on a deferred copy of them, so a key draws the field at once and the search over every row follows when React has the time, the list showing the last words' rows meanwhile.
  const query = useDeferredValue(word?.query);
  const describedName = current?.name;
  const describedNumber = current?.number;

  const offer = useMemo((): MentionOffered => {
    if (candidates === undefined || step === undefined || query === undefined) return NO_OFFER;

    const sections =
      description === undefined || taskId === undefined || describedName === undefined
        ? []
        : descriptionCandidates(
            {
              taskId,
              name: describedName,
              key:
                workspace === undefined || describedNumber === undefined
                  ? undefined
                  : taskKey(workspace.name, describedNumber),
            },
            description,
            { workspace: step, repository: null },
            `${MENTION_SIGIL}${query}`,
          );

    const dates = (words: string) =>
      dateCandidates(words, Date.now(), readerZone(), { workspace: step, repository: null });

    return mentionOffer({ ...candidates.sources, description: sections, dates }, query);
  }, [candidates, step, query, description, taskId, describedName, describedNumber, workspace]);

  if (!asking || query === undefined) return undefined;
  const { groups, narrowed } = offer;

  // Note that once the words run past a space with nothing found, the offer closes, as the panel's list closes, so a sentence that began with an `@` goes on unhindered.
  if (groups.length === 0 && query.includes(" ")) return undefined;

  // The `@` word written anew as `@` and `words`, as a kind's row narrows the list and its crumb widens it.
  const retype = (words: string) => pills.rewrite(`${MENTION_SIGIL}${words}`);

  const typed = typedMentionKind(query);

  // A drawn row's mark: the one it was handed, else its entity's chip mark, worked out now for the few rows drawn.
  const markOfTarget = (target: string): ChipMark | undefined => {
    const own = candidates?.marks.get(target);

    if (own !== undefined) return own;
    const destination = candidates?.named.get(target);

    return destination === undefined ? undefined : markOf(entityOfDestination(destination));
  };

  const crumb =
    narrowed === undefined || typed === undefined
      ? undefined
      : {
          name: narrowed.name,
          glyph: FROM_GLYPH[narrowed.from],
          // Note that the way back keeps the words searched and deletes the `kind:`, as the panel's crumb does.
          // Note that a folder walked into steps back out to the folder it stands in.
          onBack: () => retype(narrowed.back ?? query.slice(typed.entry.length)),
        };

  return {
    groups: groups.map((group) => ({
      title: group.title,
      rows: group.rows.map((row) => suggestion(row, markOfTarget)),
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

      if (row.walk !== undefined) return retype(row.walk);
      pills.pick({ name: row.written ?? row.name, target: row.target });
    },
  };
}
