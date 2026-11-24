/**
 * use-inbox.ts -- the Inbox as the app's screens read and act on it: its listing under a scope and a search, the scope kept across launches, a thread found by its id, its read marks, and its files read into what the system draws them from.
 *
 * What the list holds, in what order, and what each row says are the list
 * model's (`@repo/features/inbox-list-model`), which the panel's Inbox reads
 * too, over the holders the host's document groups
 * (`inbox-groups.ts`); this only reads them
 * into the app's Query client and sends the panel's acts on the host's port,
 * each thread drawn with the reader's sends still out (`use-thread-answer.ts`).
 */

import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  INBOX_SCOPE_KIND,
} from "@repo/features/agent-view";
import { base64Bytes } from "@repo/features/agent-wire";
import { PRODUCT_PICTURE_FROM, PRODUCT_PICTURE_KIND } from "@repo/features/analytics";
import { sizeLabel } from "@repo/features/attachment-model";
import { base64PictureSize, type ImageDimensions } from "@repo/features/image-signature";
import {
  INBOX_MEDIA,
  INBOX_SHOW,
  type InboxCounts,
  type InboxGroup,
  type InboxListed,
  type InboxMessageMedia,
  type InboxShow,
  inboxAtNow,
  inboxCounts,
  inboxGroup,
  inboxList,
  isUnread,
  MINE,
  settledOnRead,
  taskHolder,
  waitsOnReaderNow,
} from "@repo/features/inbox-list-model";
import {
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  type InboxItemHome,
} from "@repo/features/inbox-wire";
import {
  acknowledgedNote,
  closedNote,
  markedNote,
  NOT_ACKNOWLEDGED,
  NOT_RESOLVED,
  REMIND_REFUSED,
} from "@repo/features/inbox-write-words";
import type { InboxHeldFile } from "@repo/features/inbox-writes";
import { LIVE_READ } from "@repo/features/live-wire";
import { formatBytes } from "@repo/features/number-format";
import { searchTokens } from "@repo/features/search-tokens";
import { TASKS_READ } from "@repo/features/tasks-view";
import { MP4_TYPE } from "@repo/features/video-signature";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  answerKeeper,
  INBOX_FEED,
  type InboxFeed,
  inboxFeedHolds,
  selectInboxFeed,
  selectInboxReader,
  selectTaskListStatus,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { BUZZ, heldValue, useHeldValue } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Predicate } from "effect";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings } from "react-native";
import {
  cachedFile,
  cachedPicture,
  cachedPlayed,
  KEPT_MEDIA,
  type KeptMedia,
  keptMedia,
  keptPictureSize,
} from "../cached-media.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useTaskListCollections, useTaskListRow } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { dismissThreadNotifications } from "../notification-task.js";
import { usePictureShownCount } from "../picture-shown.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";
import { useInboxGroupsIn } from "./inbox-groups.js";
import { useInboxShown } from "./inbox-shown.js";
import {
  refusedWords,
  SETTLE,
  type SettledThread,
  useSendsDrawn,
  useSettleUndo,
} from "./use-thread-answer.js";

/** What a thread's videos and files are named under among the app's caches. */
const INBOX_MEDIA_PREFIX = "inbox";

/** The defaults key the Inbox's scope is kept under, as the panel keeps its window's. */
const INBOX_SCOPE_KEY = "inboxScope";

/** No file of a thread read yet. */
const NOTHING_READ: ThreadMediaRead = {
  sources: new Map(),
  sizes: new Map(),
  pictureSizes: new Map(),
};

/** How one close of a batch resolve came back: taken, answered but not taken, as for a thread settled already, or never answered. */
const CLOSE_WENT = {
  TAKEN: "taken",
  UNTAKEN: "untaken",
  UNREACHED: "unreached",
} as const;

type UseChosenInboxResult = {
  readonly groups: readonly InboxGroup[];
  readonly chosen: Workspace | undefined;
  readonly workspaces: number;
};

/**
 * Every holder of Inbox items in the workspace chosen in Settings, as the
 * panel's Inbox lists the chosen workspace's alone, heard anew as another is
 * chosen; every workspace's before the account's workspaces are read. With
 * them, the workspace chosen and how many the account has, which the Inbox
 * widget names (`inbox-widget/`).
 */
export function useChosenInbox(): UseChosenInboxResult {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  const groups = useInboxGroupsIn(chosen?.id);

  return { groups: useSendsDrawn(groups), chosen, workspaces: workspaces.length };
}

/** The holders of the chosen workspace's Inbox items alone (`useChosenInbox`). */
function useInboxGroups(): readonly InboxGroup[] {
  return useChosenInbox().groups;
}

/** The scope kept, or Open, the panel's own first scope, where none was ever chosen. */
function keptScope(): InboxShow {
  const kept: unknown = Settings.get(INBOX_SCOPE_KEY);

  return Object.values(INBOX_SHOW).find((show) => show === kept) ?? INBOX_SHOW.OPEN;
}

type UseInboxScopeResult = {
  readonly show: InboxShow;
  readonly choose: (show: InboxShow) => void;
};

/** The Inbox's scope, kept in the app's defaults across launches, and the choice of another. */
export function useInboxScope(): UseInboxScopeResult {
  const [show, setShow] = useState(keptScope);

  const choose = (next: InboxShow) => {
    Settings.set({ [INBOX_SCOPE_KEY]: next });
    setShow(next);
  };

  return { show, choose };
}

/** What the Inbox lists: its rows in the list's order, what each scope counts, whether any row is unread, the reader they were read for, and where the feed they come from stands. */
export interface InboxListing {
  readonly listed: readonly InboxListed[];
  readonly feed: InboxFeed;
  readonly counts: InboxCounts;
  readonly readerId: string | undefined;
}

/**
 * The Inbox under `show`, narrowed by `search`, the reader's own items alone
 * as the panel's Inbox lists them until told otherwise, the item `chosen`
 * kept among them whatever the scope, as the panel keeps the item its pane
 * shows. Note that a reminder is weighed on the clock as the list is drawn,
 * so an item comes back the next time the document moves after it comes due.
 */
export function useInboxListing(view: {
  readonly show: InboxShow;
  readonly search: string;
  readonly chosen?: string | undefined;
}): InboxListing {
  const groups = useInboxGroups();
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });

  const { data: feed = INBOX_FEED.READING } = useQuery({
    ...appStateQuery,
    select: selectInboxFeed,
  });

  const { show, search, chosen } = view;
  // Note that the last listing is kept where the new one lists the same rows, because a new array resets every row its list holds (`RowForEach`), as a pick in a split view's list would on each press.
  const [keep] = useState(answerKeeper<InboxListing>);

  return useMemo(() => {
    const standing = inboxAtNow(groups, Date.now());

    const listed = inboxList(standing, {
      show,
      chosen,
      readerId,
      whose: MINE,
      search: searchTokens(search),
    }).items;

    return keep({ listed, feed, counts: inboxCounts(standing, readerId, MINE), readerId });
  }, [keep, groups, readerId, feed, show, search, chosen]);
}

/** The threads either side of the thread in front, by id, and how its screen opens one; none at an end. */
export interface FrontSteps {
  readonly previous?: string | undefined;
  readonly next?: string | undefined;
  readonly go: (id: string) => void;
}

/** No thread in front to step from. */
const NO_STEPS: FrontSteps = { go: () => undefined };

/** The steps in front, with the screen that stands them; none where no screen does. */
interface StoodSteps {
  readonly owner: symbol | undefined;
  readonly steps: FrontSteps;
}

/**
 * The steps the thread in front offers, which the screen drawing it stands
 * and the iPad's K and J read. Note that it holds only what that screen draws
 * now, kept by it and told to every reader as it moves, rather than a list's
 * order kept for later, so a search or a scope the screen narrows narrows the
 * steps too, and a screen covered or gone takes its steps with it.
 */
const frontSteps = heldValue<StoodSteps>({ owner: undefined, steps: NO_STEPS });

/** Stands `steps` as the front's for `owner`, or takes them down where `steps` is none and `owner` still stands them, telling every reader. */
function standFrontSteps(owner: symbol, steps: FrontSteps | undefined): void {
  if (steps === undefined && frontSteps.read().owner !== owner) return;
  frontSteps.set(steps === undefined ? { owner: undefined, steps: NO_STEPS } : { owner, steps });
}

/**
 * Stands the threads either side of the thread a screen draws as the steps
 * in front while it is `shown`, opening one through `go`, and takes them down
 * as it is covered or leaves, unless another screen stood its own since.
 */
export function useStandFrontSteps(
  steps: { readonly previous?: string | undefined; readonly next?: string | undefined },
  go: (id: string) => void,
  shown: boolean,
): void {
  const [owner] = useState(() => Symbol("front steps"));
  // Note that the screen's latest way to open a thread is read at the press, so the steps stand anew only as the threads either side move.
  const latestGo = useRef(go);
  useEffect(() => {
    latestGo.current = go;
  });

  const { previous, next } = steps;
  useEffect(() => {
    if (!shown) return;
    standFrontSteps(owner, { previous, next, go: (id) => latestGo.current(id) });

    return () => standFrontSteps(owner, undefined);
  }, [owner, shown, previous, next]);
}

/** The steps the thread in front offers, read anew as its screen stands them. */
export function useFrontSteps(): FrontSteps {
  return useHeldValue(frontSteps, (stood) => stood.steps);
}

/**
 * How many threads wait on the reader, which the Inbox's tab carries, as the
 * panel's Inbox counts them (`waitsOnReaderNow`): every open thread that is
 * theirs and not its agent's turn, a notice among them, but one whose
 * reminder is still ahead; none while the member turned the Inbox off,
 * since no Inbox stands to carry it.
 */
export function useInboxBadge(): number {
  const groups = useInboxGroups();
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const shown = useInboxShown();
  const now = Date.now();

  if (!shown) return 0;

  return groups.reduce(
    (count, { items }) =>
      count + items.filter((item) => waitsOnReaderNow(item, readerId, now)).length,
    0,
  );
}

type UseInboxThreadResult = {
  readonly listed: InboxListed | undefined;
  readonly readerId: string | undefined;
  readonly feed: InboxFeed;
  /** Reads again what the thread waits on where it failed: where it stands, its task's own inbox, or the feed and the task list. */
  readonly retry: () => void;
};

/**
 * One thread by its id, with what holds it, wherever it stands in the
 * account's feed, and where that feed stands; none where the feed holds no
 * such thread, or has not answered yet. Note that a thread the feed holds
 * whose task the task list has not read yet stands as still reading, and as
 * refused where that read failed, rather than as missing; once the list is
 * read, one still with no holder is missing, as a holder an older service
 * leaves out is. Note too that every
 * workspace's threads are searched, not only the chosen workspace's the list
 * shows, so a link to a thread of another workspace still opens it.
 *
 * A thread the feed, once answered, does not hold, such as a teammate's or
 * one long settled that a link names by its id alone, is found as the
 * panel's route finds it: the service says where it stands
 * (`AGENTS_INBOX_ITEM_HOME`), and its task's own inbox is followed while the
 * thread is shown (`AGENTS_INBOX_FOLLOW`), the thread drawn from that read,
 * still reading until it answers, refused where it failed, and missing where
 * the service says the account may not read it. Its Try again reads anew
 * whichever read failed, as the panel's Try again does.
 */
export function useInboxThread(id: string | undefined): UseInboxThreadResult {
  const acts = useHostActs();

  const read = useInboxGroupsIn(undefined);

  const groups = useSendsDrawn(read);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });

  const { data: answered = INBOX_FEED.READING } = useQuery({
    ...appStateQuery,
    select: selectInboxFeed,
  });

  const holds = useCallback((state: AppStateSnapshot) => inboxFeedHolds(state, id), [id]);
  const { data: held = false } = useQuery({ ...appStateQuery, select: holds });

  const { data: tasksRead = TASKS_READ.IDLE } = useQuery({
    ...appStateQuery,
    select: selectTaskListStatus,
  });

  const inFeed = useMemo(() => listedIn(groups, id), [groups, id]);

  // Note that only a thread the answered feed does not hold is looked for, so a thread still read, or one whose task is still read, waits as it did.
  const lookedFor =
    id !== undefined && inFeed === undefined && !held && answered === INBOX_FEED.ANSWERED;

  const { home, again } = useItemHome(id, lookedFor);
  const found = home === undefined || Predicate.isString(home) ? undefined : home;
  const homed = useHomeGroups(found?.taskId ?? undefined);
  const outside = useSendsDrawn(homed.groups);
  const listed = inFeed ?? (lookedFor ? listedIn(outside, id) : undefined);

  const feed = !lookedFor
    ? listed !== undefined || !held || tasksRead === TASKS_READ.READY
      ? answered
      : tasksRead === TASKS_READ.FAILED
        ? INBOX_FEED.FAILED
        : INBOX_FEED.READING
    : listed !== undefined || home === HOME_READ.MISSING
      ? answered
      : home === undefined
        ? INBOX_FEED.READING
        : home === HOME_READ.FAILED
          ? INBOX_FEED.FAILED
          : homed.read !== INBOX_FEED.ANSWERED
            ? homed.read
            : // Note that a task's inbox read before the task list holds its task waits on that list, as a thread of the feed does.
              tasksRead === TASKS_READ.READY
              ? answered
              : tasksRead === TASKS_READ.FAILED
                ? INBOX_FEED.FAILED
                : INBOX_FEED.READING;

  // Try again reads anew what failed: where the thread stands, its task's own inbox, or the feed and the task list that hold it.
  const retry = () => {
    if (lookedFor && home === HOME_READ.FAILED) again();
    else if (lookedFor && homed.read === INBOX_FEED.FAILED) homed.again();
    else {
      acts[ACT_KIND.AGENTS_INBOX_ITEMS_RETRY]().catch(refused("Reading the inbox again"));
      acts[ACT_KIND.TASKS_REFRESH]().catch(refused("Reading the task list again"));
    }
  };

  return { listed, readerId, feed, retry };
}

/** The thread `id` names among `groups`, with what holds it; none where none holds it. */
function listedIn(
  groups: readonly {
    readonly holder: InboxListed["holder"];
    readonly items: readonly InboxItem[];
  }[],
  id: string | undefined,
): InboxListed | undefined {
  for (const { holder, items } of groups) {
    const item = items.find((each) => each.id === id);

    if (item !== undefined) return { holder, item };
  }

  return undefined;
}

/** What the read of where a thread stands is kept under, by the thread's id. */
const ITEM_HOME_KEY = "inbox-item-home";

/** Where a thread stands where the service named no place for it: not readable by the account, or not answered. */
const HOME_READ = {
  MISSING: "missing",
  FAILED: "failed",
} as const;

/** Where a thread stands, as the service said: its task and agent, or that the account may not read it, or that no answer came. */
type HomeRead = InboxItemHome | (typeof HOME_READ)[keyof typeof HOME_READ];

/** Where a thread stands as read once, and how to read it again. */
interface ItemHome {
  /** None while it is read or not asked. */
  readonly home: HomeRead | undefined;
  readonly again: () => void;
}

/**
 * Where the thread `id` stands, as the service says, read once while
 * `asked`, as a link by its id alone is opened: its task and agent, missing
 * where the account may not read it, or failed where no answer came, which
 * `again` reads anew.
 */
function useItemHome(id: string | undefined, asked: boolean): ItemHome {
  const acts = useHostActs();

  const { data, refetch, isFetching } = useQuery({
    queryKey: [ITEM_HOME_KEY, id],
    enabled: asked && id !== undefined,
    queryFn: (): Promise<HomeRead> =>
      acts[ACT_KIND.AGENTS_INBOX_ITEM_HOME]({ itemId: id ?? "" }).then(
        (answer) =>
          "failure" in answer
            ? answer.failure === AGENT_CALL_FAILURE.NOT_FOUND
              ? HOME_READ.MISSING
              : HOME_READ.FAILED
            : answer,
        (cause: unknown) => {
          console.error("Where the thread stands was not read.", cause);

          return HOME_READ.FAILED;
        },
      ),
  });

  return {
    // Note that a read asked again stands as still read, rather than as the failure it is read again for.
    home: !asked || (isFetching && data === HOME_READ.FAILED) ? undefined : data,
    again: () =>
      void refetch().catch((cause: unknown) =>
        console.error("Where the thread stands was not read again.", cause),
      ),
  };
}

/** A task's own inbox as one group, where its read stands, and how to read it again. */
interface HomeGroups {
  readonly groups: readonly InboxGroup[];
  readonly read: InboxFeed;
  readonly again: () => void;
}

/** No group of a task's own inbox. */
const NO_HOME_GROUPS: readonly InboxGroup[] = [];

/**
 * The inbox of the task `taskId` names, followed while it is named, as one
 * group under that task as the task list holds it, where its read stands,
 * still read until it answered, or refused, and its Try again. No group
 * where none is named, the read has not answered, or the task list holds no
 * such task.
 */
function useHomeGroups(taskId: string | undefined): HomeGroups {
  const acts = useHostActs();
  useLiveFollow(taskId, (id) =>
    acts[ACT_KIND.AGENTS_INBOX_FOLLOW]({ kind: INBOX_SCOPE_KIND.TASK, id }),
  );

  const heldRead = useCallback(
    (state: AppStateSnapshot) =>
      taskId === undefined
        ? undefined
        : state[LIVE_READ.HOLDER_INBOX][INBOX_SCOPE_KIND.TASK][taskId],
    [taskId],
  );

  const { data: read } = useQuery({ ...appStateQuery, select: heldRead });
  const task = useTaskListRow(useTaskListCollections().tasks, taskId);
  const rows = read?.rows;

  const groups = useMemo(
    () =>
      task === undefined || rows === undefined
        ? NO_HOME_GROUPS
        : [inboxGroup(taskHolder(task), rows)],
    [task, rows],
  );

  const stands =
    read?.failed === true
      ? INBOX_FEED.FAILED
      : rows === undefined
        ? INBOX_FEED.READING
        : INBOX_FEED.ANSWERED;

  return {
    groups,
    read: stands,
    again: () => {
      if (taskId === undefined) return;
      acts[ACT_KIND.AGENTS_INBOX_RETRY]({ kind: INBOX_SCOPE_KIND.TASK, id: taskId }).catch(
        refused("Reading the thread's task inbox again"),
      );
    },
  };
}

/** Says on the console an act the host refused, which the next delivery of the document corrects. */
function refused(what: string): (cause: unknown) => void {
  return (error) => console.error(`${what} did not go.`, error);
}

/** How one Got it a read mark sent was answered: taken; passed over as settled first by someone else, which is what the mark asked; or left open because the agent changed the thread first. */
const NOD_WENT = { TAKEN: "taken", SETTLED: "settled", CHANGED: "changed" } as const;

/** A Got it's answer, or why none came: the host's failure, or no answer at all. */
type NodWent = (typeof NOD_WENT)[keyof typeof NOD_WENT] | NodUnanswered;

/** Why a Got it came back with no answer the service gave. */
interface NodUnanswered {
  readonly failure: AgentCallFailure;
}

/** Whether a Got it came back with no answer, so its Try again may send it again. */
function unanswered(went: NodWent | undefined): went is NodUnanswered {
  return Predicate.isObject(went);
}

/**
 * The Inbox's own acts, as the panel's sends them: a thread marked read or
 * unread, its reminder set or cleared, an open one resolved from its row,
 * every thread listed marked read, the feed read again, and the task list
 * that holds its threads read again. Marking threads read by hand, one,
 * several or every one, also acknowledges each of the reader's own notices
 * among them that opening would (`settledOnRead`), as the panel's marks do
 * (`use-inbox-read-marks.ts`), so a thread that asks nothing stops waiting on
 * them; a question keeps waiting, and so does a notice put away under a
 * reminder still ahead. The notices go as Got it does, with one Undo that
 * has them wait again.
 */
export function useInboxActs(): {
  /** Marks a thread read or unread, a notice marked read acknowledged too. */
  readonly mark: (item: InboxItem, unread: boolean) => void;
  /** Sets the thread's reminder for an instant, or clears it where `until` is null, which the host draws at once, as it draws a mark. */
  readonly remind: (itemId: string, until: number | null) => void;
  /** Resolves an open thread against the revision its row drew, as the thread's own Resolve does, buzzing as it lands or is refused, and offering Undo once it went. */
  readonly resolve: (item: InboxItem) => void;
  /** Marks every thread given that is unread as read, and acknowledges the notices among them. */
  readonly markAll: (items: readonly InboxItem[]) => void;
  /** Marks several threads read or unread at once, as one write, saying how many the service took where it refused some; those marked read acknowledged as one does. */
  readonly markMany: (items: readonly InboxItem[], unread: boolean) => void;
  /** Sets or clears the reminder of several threads at once, as one write. */
  readonly remindMany: (itemIds: readonly string[], until: number | null) => void;
  /** Resolves several open threads at once, each against the revision its row drew, as one write, offering one Undo that takes back every one that went. */
  readonly resolveMany: (items: readonly InboxItem[]) => void;
  readonly refresh: () => Promise<void>;
  readonly refreshTasks: () => Promise<void>;
} {
  const acts = useHostActs();
  const write = useWrite();
  const settled = useSettleUndo();
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });

  return useMemo(() => {
    // Note that each nod goes at the revision the thread was marked on, so an agent's change since is never acknowledged unseen, and one settled first by someone else is passed over quietly, since what the mark asked already stands.
    const nodRead = (items: readonly InboxItem[]) => {
      const now = Date.now();

      const keyed: readonly SettledThread[] = items.flatMap((item) =>
        settledOnRead(item, readerId, now) ? [{ item, key: randomUUID() }] : [],
      );

      if (keyed.length === 0) return;
      // Note that Try again sends again only the nods no answer reached, under the same keys, so none goes twice; one the agent changed first was answered and never takes.
      let pending = keyed;
      let taken: readonly SettledThread[] = [];
      let changed = 0;
      let failure: AgentCallFailure | undefined;
      write(
        () =>
          Promise.all(
            pending.map(({ item, key }) =>
              Promise.resolve(
                acts[ACT_KIND.AGENTS_INBOX_ANSWER]({
                  itemId: item.id,
                  revision: item.revision,
                  reply: INBOX_REPLY.ACKNOWLEDGED,
                  clientKey: key,
                }),
              ).then(
                (answer): NodWent =>
                  "failure" in answer
                    ? { failure: answer.failure }
                    : answer.taken
                      ? NOD_WENT.TAKEN
                      : answer.item.status === INBOX_STATUS.OPEN
                        ? NOD_WENT.CHANGED
                        : NOD_WENT.SETTLED,
                (): NodWent => ({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
              ),
            ),
          ).then((answers) => {
            taken = [...taken, ...pending.filter((_, at) => answers[at] === NOD_WENT.TAKEN)];
            changed += answers.filter((answer) => answer === NOD_WENT.CHANGED).length;
            failure = answers.find(unanswered)?.failure;
            pending = pending.filter((_, at) => unanswered(answers[at]));

            return answers;
          }),
        {
          // Note that a nod no answer reached says why and offers Try again, the Undo coming once they go, since the one notice draws Try again or Undo, never both; one the agent changed first says so, in the Undo's notice where others went.
          refused: () => {
            if (pending.length === 0 && (changed === 0 || taken.length > 0)) return undefined;

            if (keyed.length === 1) {
              return failure === undefined ? NOT_ACKNOWLEDGED : refusedWords(failure);
            }

            return acknowledgedNote(taken.length, pending.length + changed);
          },
          retry: () => pending.length > 0,
          done: () => {
            if (taken.length === 0) return;
            settled(
              taken,
              SETTLE.ACKNOWLEDGE,
              changed === 0 ? undefined : acknowledgedNote(taken.length, changed),
            );
          },
        },
      );
    };

    return {
      mark: (item, unread) => {
        const itemId = item.id;

        if (!unread) nodRead([item]);
        write(() => acts[ACT_KIND.AGENTS_INBOX_READ_STATE]({ itemId, unread }), {
          refused: (answer) => ("failure" in answer ? markedNote(unread, 0, 1) : undefined),
          retry: true,
          subject: { kind: WRITE_SUBJECT.THREAD_READ, id: itemId },
        });
      },
      remind: (itemId, until) => {
        write(() => acts[ACT_KIND.AGENTS_INBOX_REMIND]({ itemId, until }), {
          refused: (answer) =>
            "failure" in answer
              ? until === null
                ? REMIND_REFUSED.CLEAR
                : REMIND_REFUSED.SET
              : undefined,
          retry: true,
          subject: { kind: WRITE_SUBJECT.THREAD_REMINDER, id: itemId },
          went: BUZZ.SUCCESS,
        });
      },
      resolve: (item) => {
        // Note that one key stands for the press, so Try again resolves the thread once.
        const clientKey = randomUUID();
        write(
          () =>
            acts[ACT_KIND.AGENTS_INBOX_CLOSE]({
              itemId: item.id,
              revision: item.revision,
              clientKey,
            }),
          {
            refused: (answer) =>
              "failure" in answer
                ? refusedWords(answer.failure)
                : answer.taken
                  ? undefined
                  : NOT_RESOLVED[answer.item.status],
            unanswered: refusedWords(AGENT_CALL_FAILURE.UNANSWERED),
            // Note that a thread answered or resolved already offers no Try again, which could never take.
            retry: (answer) => "failure" in answer,
            went: BUZZ.SUCCESS,
            // Note that a Try again that went offers Undo as the first send's would.
            done: () => settled([{ item, key: clientKey }], SETTLE.RESOLVE),
          },
        );
      },
      markAll: (items) => {
        nodRead(items);
        const itemIds = items.flatMap((item) => (isUnread(item) ? [item.id] : []));

        if (itemIds.length === 0) return;
        write(() => acts[ACT_KIND.AGENTS_INBOX_READ_ALL]({ itemIds: [...itemIds] }), {
          refused: (answer) =>
            "failure" in answer ? markedNote(false, 0, itemIds.length) : undefined,
          retry: true,
          went: BUZZ.SUCCESS,
        });
      },
      markMany: (items, unread) => {
        if (items.length === 0) return;

        if (!unread) nodRead(items);
        const itemIds = items.map((item) => item.id);
        // Note that Try again sends only the marks that did not land, and the note counts every mark that did.
        let pending = itemIds;
        let marked = 0;
        write(
          () =>
            Promise.all(
              pending.map((itemId) =>
                Promise.resolve(acts[ACT_KIND.AGENTS_INBOX_READ_STATE]({ itemId, unread })).then(
                  (answer) => !("failure" in answer),
                  () => false,
                ),
              ),
            ).then((landed) => {
              marked += landed.filter(Boolean).length;
              pending = pending.filter((_, at) => landed[at] !== true);

              return pending.length;
            }),
          {
            refused: (left) => (left === 0 ? undefined : markedNote(unread, marked, left)),
            retry: true,
            subject: itemIds.map((id) => ({ kind: WRITE_SUBJECT.THREAD_READ, id })),
            went: BUZZ.SUCCESS,
          },
        );
      },
      remindMany: (itemIds, until) => {
        if (itemIds.length === 0) return;
        // Note that Try again sends only the reminders that did not land.
        let pending = itemIds;
        write(
          () =>
            Promise.all(
              pending.map((itemId) =>
                Promise.resolve(acts[ACT_KIND.AGENTS_INBOX_REMIND]({ itemId, until })).then(
                  (answer) => !("failure" in answer),
                  () => false,
                ),
              ),
            ).then((set) => {
              pending = pending.filter((_, at) => set[at] !== true);

              return pending.length;
            }),
          {
            refused: (left) =>
              left === 0 ? undefined : until === null ? REMIND_REFUSED.CLEAR : REMIND_REFUSED.SET,
            retry: true,
            subject: itemIds.map((id) => ({ kind: WRITE_SUBJECT.THREAD_REMINDER, id })),
            went: BUZZ.SUCCESS,
          },
        );
      },
      resolveMany: (items) => {
        const open = items.filter((item) => item.status === INBOX_STATUS.OPEN);

        if (open.length === 0) return;
        // Note that one key stands for each thread's press, so the closes never go twice, and Try again sends again only the closes no answer reached, under the same keys; one the service answered untaken never takes.
        const keyed: readonly SettledThread[] = open.map((item) => ({ item, key: randomUUID() }));
        let pending = keyed;
        let taken: readonly SettledThread[] = [];
        write(
          () =>
            Promise.all(
              pending.map(({ item, key }) =>
                Promise.resolve(
                  acts[ACT_KIND.AGENTS_INBOX_CLOSE]({
                    itemId: item.id,
                    revision: item.revision,
                    clientKey: key,
                  }),
                ).then(
                  (answer) =>
                    "failure" in answer
                      ? CLOSE_WENT.UNREACHED
                      : answer.taken
                        ? CLOSE_WENT.TAKEN
                        : CLOSE_WENT.UNTAKEN,
                  () => CLOSE_WENT.UNREACHED,
                ),
              ),
            ).then((went) => {
              taken = [...taken, ...pending.filter((_, at) => went[at] === CLOSE_WENT.TAKEN)];
              pending = pending.filter((_, at) => went[at] === CLOSE_WENT.UNREACHED);

              return went;
            }),
          {
            // Note that a resolve with closes no answer reached says how many went and offers Try again for the rest, since the one notice draws Try again or Undo, never both; the Undo once they go covers every close taken. One none of whose closes went says so, and one whose untaken closes were answered says how many in the notice that offers the Undo.
            refused: () =>
              pending.length > 0
                ? closedNote(taken.length, keyed.length - taken.length)
                : taken.length === 0
                  ? closedNote(0, keyed.length)
                  : undefined,
            retry: () => pending.length > 0,
            went: BUZZ.SUCCESS,
            done: () =>
              settled(
                taken,
                SETTLE.RESOLVE,
                taken.length === keyed.length
                  ? undefined
                  : closedNote(taken.length, keyed.length - taken.length),
              ),
          },
        );
      },
      refresh: () =>
        acts[ACT_KIND.AGENTS_INBOX_ITEMS_RETRY]().catch(refused("Reading the inbox again")),
      refreshTasks: () =>
        acts[ACT_KIND.TASKS_REFRESH]().catch(refused("Reading the task list again")),
    };
  }, [acts, write, settled, readerId]);
}

/**
 * Marks the thread read once it is opened, as the panel's pane does, and
 * once again each time it is opened anew; a thread read already is told
 * nothing. Its notifications still shown are removed as it opens, read or
 * not, since the thread is on screen.
 */
export function useReadOnOpen(listed: InboxListed | undefined): void {
  const acts = useHostActs();
  const id = listed?.item.id;
  const unread = listed !== undefined && isUnread(listed.item);
  // Note that the mark is sent as a thread opens, never again as it is read, so only the thread's id moves it.
  useEffect(() => {
    if (id === undefined) return;

    // Note that the mark goes quietly, whatever comes back, since no person pressed for it.
    if (unread)
      acts[ACT_KIND.AGENTS_INBOX_READ_STATE]({ itemId: id, unread: false }).catch(
        refused("The mark"),
      );
    dismissThreadNotifications(id).catch((cause: unknown) =>
      console.error("The thread's notifications were not removed.", cause),
    );
  }, [id]);
}

/** A thread's files as read: what each is drawn from, and how big each is, in words, by its attachment. */
interface ThreadMediaRead {
  /** What each file is drawn from, by its attachment: an address once read, `null` once its read failed, and absent while it is on its way. */
  readonly sources: ReadonlyMap<string, string | null>;
  readonly sizes: ReadonlyMap<string, string>;
  /** The size each picture's header states, in pixels, by its attachment, which it stands at before it decodes. */
  readonly pictureSizes: ReadonlyMap<string, ImageDimensions>;
}

/** A thread's files as read, and what reads one that failed again. */
export interface ThreadFiles extends ThreadMediaRead {
  /** Reads a file whose read failed again, by its attachment, standing it on its way meanwhile. */
  readonly retry: (attachmentId: string) => void;
}

/** What a file of the thread is read into, by its kind: its address under the app's caches, or a picture's `data:` address where no file can be named for its type. */
async function sourceOf(
  each: InboxMessageMedia,
  read: { readonly contentType: string; readonly base64: string },
): Promise<string> {
  switch (each.kind) {
    case INBOX_MEDIA.VIDEO:
    case INBOX_MEDIA.AUDIO:
      return cachedPlayed(INBOX_MEDIA_PREFIX, each.attachmentId, read.contentType, read.base64);
    case INBOX_MEDIA.FILE:
      return cachedFile(
        INBOX_MEDIA_PREFIX,
        each.attachmentId,
        each.name,
        each.mediaType,
        read.base64,
      );
    case INBOX_MEDIA.PICTURE: {
      // Note that a picture is written to a file as it lands, as an agent's is, so a press opens Quick Look on that file at once rather than hashing and writing its bytes first.
      const written = await cachedPicture(
        INBOX_MEDIA_PREFIX,
        each.attachmentId,
        read.contentType,
        read.base64,
      );

      return written ?? `data:${read.contentType};base64,${read.base64}`;
    }
  }
}

/** A kept picture's size in pixels, as its file's header states it; none for any other kind of file. */
function keptPictureSizeOf(
  each: InboxMessageMedia,
  kept: KeptMedia,
): Promise<ImageDimensions | undefined> {
  return each.kind === INBOX_MEDIA.PICTURE && kept.kind === KEPT_MEDIA.PICTURE
    ? keptPictureSize(kept.uri)
    : Promise.resolve(undefined);
}

/** A picture's size in pixels, as its header states it, read from a file the service answered; none for any other kind of file. */
function readPictureSize(each: InboxMessageMedia, base64: string): ImageDimensions | undefined {
  return each.kind === INBOX_MEDIA.PICTURE ? base64PictureSize(base64) : undefined;
}

/** The files read with one more landed: what it is drawn from, its size in words, and a picture's size in pixels, as its header states it. */
function withRead(
  held: ThreadMediaRead,
  each: InboxMessageMedia,
  source: string,
  size: string,
  pictureSize: ImageDimensions | undefined,
): ThreadMediaRead {
  return {
    sources: new Map(held.sources).set(each.attachmentId, source),
    sizes: new Map(held.sizes).set(each.attachmentId, size),
    pictureSizes:
      pictureSize === undefined
        ? held.pictureSizes
        : new Map(held.pictureSizes).set(each.attachmentId, pictureSize),
  };
}

/**
 * What each of a thread's files is drawn from, by its attachment, read once
 * through the host as the panel reads one (`AGENTS_INBOX_ATTACHMENT`): a
 * picture as a `data:` address, a video or a sound clip, asked for as its
 * MP4 copy, as a file of the app's caches, since the system's player reads a
 * file, which an older recording with no copy answers as a WebM the player
 * cannot play, and an Ogg clip before the service keeps its copy as the Ogg,
 * and
 * any other file, such as a PDF, as a file of the app's caches under its own
 * name, which its viewer and the share sheet read; with each one's size in
 * words, which a file's chip says. One still on its way is absent, and one
 * that could not be read is `null` until `retry` reads it again. Note that each file is asked for once while
 * the thread stands, whatever `media` list names it, because the thread's
 * item is made anew on every change to it, its read mark as it opens among
 * them, and each read carries the whole file; one whose read failed is asked
 * for again only by its Try again, since the thread's next change, such as
 * its read mark, would otherwise read the whole file again unseen.
 */
export function useThreadMedia(
  itemId: string | undefined,
  media: readonly InboxMessageMedia[],
  pending?: (itemId: string, attachmentId: string) => InboxHeldFile | undefined,
): ThreadFiles {
  const acts = useHostActs();
  const shown = usePictureShownCount(PRODUCT_PICTURE_KIND.INBOX);
  const [read, setRead] = useState<ThreadMediaRead>(NOTHING_READ);
  // How many times a file was read again, which asks the effect to read what was let go.
  const [retries, setRetries] = useState(0);

  // The thread the files were asked for, and the attachments asked for on it.
  const asked = useRef<{ readonly itemId: string | undefined; readonly ids: Set<string> }>({
    itemId: undefined,
    ids: new Set(),
  });

  useEffect(() => {
    if (itemId === undefined) return;

    if (asked.current.itemId !== itemId) {
      asked.current = { itemId, ids: new Set() };
      setRead(NOTHING_READ);
    }

    const { ids } = asked.current;

    for (const each of media) {
      if (ids.has(each.attachmentId)) continue;
      ids.add(each.attachmentId);

      // Note that a read that fails is marked failed, so its file says so with Try again rather than spinning on, and stays asked until Try again lets it go.
      const failed = (cause: unknown) => {
        refused("Reading a thread's file")(cause);

        if (asked.current.itemId !== itemId) return;
        setRead((held) => ({
          ...held,
          sources: new Map(held.sources).set(each.attachmentId, null),
        }));
      };

      // Note that a file of a reply still on its way is drawn from the reply's own bytes, since the service names its files only once a read carries the reply.
      const held = pending?.(itemId, each.attachmentId);

      if (held !== undefined) {
        void sourceOf(each, held)
          .then((source) => {
            if (asked.current.itemId !== itemId) return;
            setRead((was) => withRead(was, each, source, sizeLabel(held.base64), held.pictureSize));
          })
          .catch(failed);
        continue;
      }

      const askedAt = performance.now();

      // Note that a picture, a video, or a clip shown before draws from the file its first read wrote, asking the host nothing; a file such as a PDF stands under its own name, so it is read as before.
      const kept =
        each.kind === INBOX_MEDIA.FILE
          ? undefined
          : keptMedia(INBOX_MEDIA_PREFIX, each.attachmentId);

      if (kept !== undefined) {
        void keptPictureSizeOf(each, kept)
          .then((pictureSize) => {
            if (asked.current.itemId !== itemId) return;
            setRead((was) => withRead(was, each, kept.uri, formatBytes(kept.bytes), pictureSize));

            if (kept.kind === KEPT_MEDIA.PICTURE) {
              shown(PRODUCT_PICTURE_FROM.KEPT, askedAt, kept.bytes);
            }
          })
          .catch(failed);
        continue;
      }

      // A video or a sound clip is asked for as the MP4 copy iOS's player plays, which only a recording or an Ogg clip is kept with: one kept without it, an older recording's WebM or any other clip, is answered as it is.
      const played = each.kind === INBOX_MEDIA.VIDEO || each.kind === INBOX_MEDIA.AUDIO;
      const playable = played ? ({ playable: MP4_TYPE } as const) : {};
      acts[ACT_KIND.AGENTS_INBOX_ATTACHMENT]({
        itemId,
        attachmentId: each.attachmentId,
        ...playable,
      })
        .then(async (answer) => {
          // A read that lands once another thread stands is that thread's no longer.
          if (asked.current.itemId !== itemId) return;

          if (!("base64" in answer)) throw new Error(`The file was not read: ${answer.failure}.`);
          const source = await sourceOf(each, answer);

          if (asked.current.itemId !== itemId) return;
          setRead((held) =>
            withRead(
              held,
              each,
              source,
              sizeLabel(answer.base64),
              readPictureSize(each, answer.base64),
            ),
          );

          if (each.kind === INBOX_MEDIA.PICTURE) {
            shown(PRODUCT_PICTURE_FROM.READ, askedAt, base64Bytes(answer.base64));
          }
        })
        .catch(failed);
    }
  }, [acts, itemId, media, retries, pending, shown]);

  const retry = useCallback((attachmentId: string) => {
    asked.current.ids.delete(attachmentId);
    setRead((held) => {
      const sources = new Map(held.sources);
      sources.delete(attachmentId);

      return { ...held, sources };
    });
    setRetries((count) => count + 1);
  }, []);

  // Note that a picture of a reply still held is drawn from its bytes, at the size read from its header as it was sent, in the render that first draws it, rather than after the read above lands, so its bubble never stands as a spinner or at another shape first.
  const drawn = useMemo(
    () =>
      media.reduce((was, each) => {
        const bytes =
          itemId === undefined ||
          each.kind !== INBOX_MEDIA.PICTURE ||
          read.sources.has(each.attachmentId)
            ? undefined
            : pending?.(itemId, each.attachmentId);

        return bytes === undefined
          ? was
          : withRead(
              was,
              each,
              `data:${bytes.contentType};base64,${bytes.base64}`,
              sizeLabel(bytes.base64),
              bytes.pictureSize,
            );
      }, read),
    [itemId, media, pending, read],
  );

  return { ...drawn, retry };
}
