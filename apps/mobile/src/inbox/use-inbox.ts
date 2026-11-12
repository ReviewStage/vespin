/**
 * use-inbox.ts -- the Inbox as the app's screens read and act on it: its listing under a scope and a search, the scope kept across launches, a thread found by its id, its read marks, and its files read into what the system draws them from.
 *
 * What the list holds, in what order, and what each row says are the list
 * model's (`@repo/features/inbox-list-model`), which the panel's Inbox reads
 * too, over the holders the host's document groups
 * (`@repo/host/app-state-reads`' `selectInboxGroupsIn`); this only reads them
 * into the app's Query client and sends the panel's acts on the host's port,
 * each thread drawn with the reader's sends still out (`use-thread-answer.ts`).
 */

import { AGENT_CALL_FAILURE, INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { sizeLabel } from "@repo/features/attachment-model";
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
  taskHolder,
  waitsOnReaderNow,
} from "@repo/features/inbox-list-model";
import type { InboxItem, InboxItemHome } from "@repo/features/inbox-wire";
import { markedNote, NOT_RESOLVED, REMIND_REFUSED } from "@repo/features/inbox-write-words";
import { LIVE_READ } from "@repo/features/live-wire";
import { searchTokens } from "@repo/features/search-tokens";
import { TASKS_READ } from "@repo/features/tasks-view";
import { MP4_TYPE } from "@repo/features/video-signature";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  INBOX_FEED,
  type InboxFeed,
  inboxFeedHolds,
  selectInboxFeed,
  selectInboxGroupsIn,
  selectInboxReader,
  selectTaskListStatus,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { BUZZ } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings } from "react-native";
import { cachedFile, cachedVideo } from "../cached-media.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { dismissThreadNotifications } from "../notification-task.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";
import { refusedWords, SETTLE, useSendsDrawn, useSettleUndo } from "./use-thread-answer.js";

/** What a thread's videos and files are named under among the app's caches. */
const INBOX_MEDIA_PREFIX = "inbox";

/** The defaults key the Inbox's scope is kept under, as the panel keeps its window's. */
const INBOX_SCOPE_KEY = "inboxScope";

/** No file of a thread read yet. */
const NOTHING_READ: ThreadMediaRead = { sources: new Map(), sizes: new Map() };

/** No holder read yet. */
const NO_GROUPS: ReturnType<ReturnType<typeof selectInboxGroupsIn>> = [];

type UseChosenInboxResult = {
  readonly groups: ReturnType<ReturnType<typeof selectInboxGroupsIn>>;
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

  const { data: groups = NO_GROUPS } = useQuery({
    ...appStateQuery,
    select: selectInboxGroupsIn(chosen?.id),
  });

  return { groups: useSendsDrawn(groups), chosen, workspaces: workspaces.length };
}

/** The holders of the chosen workspace's Inbox items alone (`useChosenInbox`). */
function useInboxGroups(): ReturnType<ReturnType<typeof selectInboxGroupsIn>> {
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
  readonly unread: readonly string[];
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

  return useMemo(() => {
    const standing = inboxAtNow(groups, Date.now());

    const listed = inboxList(standing, {
      show,
      chosen,
      readerId,
      whose: MINE,
      search: searchTokens(search),
    }).items;

    const unread = listed.filter(({ item }) => isUnread(item)).map(({ item }) => item.id);

    return { listed, feed, counts: inboxCounts(standing, readerId, MINE), unread, readerId };
  }, [groups, readerId, feed, show, search, chosen]);
}

/**
 * How many threads wait on the reader, which the Inbox's tab carries, as the
 * panel's Inbox counts them (`waitsOnReaderNow`): every open thread that is
 * theirs and not its agent's turn, a notice among them, but one whose
 * reminder is still ahead.
 */
export function useInboxBadge(): number {
  const groups = useInboxGroups();
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const now = Date.now();

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
 * the service says the account may not read it.
 */
export function useInboxThread(id: string | undefined): UseInboxThreadResult {
  const { data: read = NO_GROUPS } = useQuery({
    ...appStateQuery,
    select: selectInboxGroupsIn(undefined),
  });

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

  const home = useItemHome(id, lookedFor);
  const homed = useHomeGroups(lookedFor ? home : undefined);
  const outside = useSendsDrawn(homed.groups);
  const listed = inFeed ?? (lookedFor ? listedIn(outside, id) : undefined);

  const feed = lookedFor
    ? listed !== undefined || home === null
      ? answered
      : homed.read
    : listed !== undefined || !held || tasksRead === TASKS_READ.READY
      ? answered
      : tasksRead === TASKS_READ.FAILED
        ? INBOX_FEED.FAILED
        : INBOX_FEED.READING;

  return { listed, readerId, feed };
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

/**
 * Where the thread `id` stands, as the service says, read once while
 * `asked`, as a link by its id alone is opened: its task and agent; null
 * where the account may not read it or no answer came; none while it is read
 * or not asked.
 */
function useItemHome(id: string | undefined, asked: boolean): InboxItemHome | null | undefined {
  const acts = useHostActs();

  const { data } = useQuery({
    queryKey: [ITEM_HOME_KEY, id],
    enabled: asked && id !== undefined,
    queryFn: (): Promise<InboxItemHome | null> =>
      acts[ACT_KIND.AGENTS_INBOX_ITEM_HOME]({ itemId: id ?? "" }).then(
        (answer) => ("failure" in answer ? null : answer),
        (cause: unknown) => {
          console.error("Where the thread stands was not read.", cause);

          return null;
        },
      ),
  });

  return asked ? data : undefined;
}

/** A task's own inbox as one group, and where its read stands. */
interface HomeGroups {
  readonly groups: readonly InboxGroup[];
  readonly read: InboxFeed;
}

/** No group of a task's own inbox. */
const NO_HOME_GROUPS: readonly InboxGroup[] = [];

/**
 * The inbox of the task `home` names, followed while it is named, as one
 * group under that task as the task list holds it, and where its read
 * stands: still read until it answered, or refused. No group where none is
 * named, the read has not answered, or the task list holds no such task.
 */
function useHomeGroups(home: InboxItemHome | null | undefined): HomeGroups {
  const acts = useHostActs();
  const taskId = home === null || home === undefined ? undefined : home.planId;
  useLiveFollow(taskId, (id) =>
    acts[ACT_KIND.AGENTS_INBOX_FOLLOW]({ kind: INBOX_SCOPE_KIND.PLAN, id }),
  );

  const heldRead = useCallback(
    (state: AppStateSnapshot) =>
      taskId === undefined
        ? undefined
        : state[LIVE_READ.HOLDER_INBOX][INBOX_SCOPE_KIND.PLAN][taskId],
    [taskId],
  );

  const taskOf = useCallback(
    (state: AppStateSnapshot) =>
      taskId === undefined ? undefined : state.tasks.tasks.find((task) => task.id === taskId),
    [taskId],
  );

  const { data: read } = useQuery({ ...appStateQuery, select: heldRead });
  const { data: task } = useQuery({ ...appStateQuery, select: taskOf });
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

  return { groups, read: home === undefined ? INBOX_FEED.READING : stands };
}

/** Says on the console an act the host refused, which the next delivery of the document corrects. */
function refused(what: string): (cause: unknown) => void {
  return (error) => console.error(`${what} did not go.`, error);
}

/** The Inbox's own acts, as the panel's sends them: a thread marked read or unread, its reminder set or cleared, an open one resolved from its row, every thread listed marked read, the feed read again, and the task list that holds its threads read again. */
export function useInboxActs(): {
  readonly mark: (itemId: string, unread: boolean) => void;
  /** Sets the thread's reminder for an instant, or clears it where `until` is null, which the host draws at once, as it draws a mark. */
  readonly remind: (itemId: string, until: number | null) => void;
  /** Resolves an open thread against the revision its row drew, as the thread's own Resolve does, buzzing as it lands or is refused, and offering Undo once it went. */
  readonly resolve: (item: InboxItem) => void;
  readonly markAll: (itemIds: readonly string[]) => void;
  readonly refresh: () => Promise<void>;
  readonly refreshTasks: () => Promise<void>;
} {
  const acts = useHostActs();
  const write = useWrite();
  const settled = useSettleUndo();

  return useMemo(
    () => ({
      mark: (itemId, unread) => {
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
            done: () => settled(item, clientKey, SETTLE.RESOLVE),
          },
        );
      },
      markAll: (itemIds) => {
        if (itemIds.length === 0) return;
        write(() => acts[ACT_KIND.AGENTS_INBOX_READ_ALL]({ itemIds: [...itemIds] }), {
          refused: (answer) =>
            "failure" in answer ? markedNote(false, 0, itemIds.length) : undefined,
          retry: true,
          went: BUZZ.SUCCESS,
        });
      },
      refresh: () =>
        acts[ACT_KIND.AGENTS_INBOX_ITEMS_RETRY]().catch(refused("Reading the inbox again")),
      refreshTasks: () =>
        acts[ACT_KIND.TASKS_REFRESH]().catch(refused("Reading the task list again")),
    }),
    [acts, write, settled],
  );
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
  readonly sources: ReadonlyMap<string, string>;
  readonly sizes: ReadonlyMap<string, string>;
}

/** What a file of the thread is read into, by its kind: a picture's `data:` address, or a video's or another file's address under the app's caches. */
function sourceOf(
  each: InboxMessageMedia,
  read: { readonly contentType: string; readonly base64: string },
): Promise<string> {
  switch (each.kind) {
    case INBOX_MEDIA.VIDEO:
      return cachedVideo(INBOX_MEDIA_PREFIX, each.attachmentId, read.contentType, read.base64);
    case INBOX_MEDIA.FILE:
      return cachedFile(
        INBOX_MEDIA_PREFIX,
        each.attachmentId,
        each.name,
        each.mediaType,
        read.base64,
      );
    case INBOX_MEDIA.PICTURE:
      return Promise.resolve(`data:${read.contentType};base64,${read.base64}`);
  }
}

/**
 * What each of a thread's files is drawn from, by its attachment, read once
 * through the host as the panel reads one (`AGENTS_INBOX_ATTACHMENT`): a
 * picture as a `data:` address, a video, asked for as its MP4 copy, as a
 * file of the app's caches, since the system's player reads a file, which an
 * older recording with no copy answers as a WebM the player cannot play, and
 * any other file, such as a PDF, as a file of the app's caches under its own
 * name, which its viewer and the share sheet read; with each one's size in
 * words, which a file's chip says. One still on its way, or that could not
 * be read, is absent. Note that each file is asked for once while
 * the thread stands, whatever `media` list names it, because the thread's
 * item is made anew on every change to it, its read mark as it opens among
 * them, and each read carries the whole file; one whose read failed is asked
 * for again on the thread's next change.
 */
export function useThreadMedia(
  itemId: string | undefined,
  media: readonly InboxMessageMedia[],
): ThreadMediaRead {
  const acts = useHostActs();
  const [read, setRead] = useState<ThreadMediaRead>(NOTHING_READ);

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

      // A read that fails is forgotten, so the thread's next change asks for it again.
      const forget = (cause: unknown) => {
        if (asked.current.itemId === itemId) ids.delete(each.attachmentId);
        refused("Reading a thread's file")(cause);
      };

      // A video is asked for as the MP4 copy iOS's player plays, which an older recording kept without one answers as its WebM.
      const playable = each.kind === INBOX_MEDIA.VIDEO ? ({ playable: MP4_TYPE } as const) : {};
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
          const size = sizeLabel(answer.base64);
          setRead((held) => ({
            sources: new Map(held.sources).set(each.attachmentId, source),
            sizes: new Map(held.sizes).set(each.attachmentId, size),
          }));
        })
        .catch(forget);
    }
  }, [acts, itemId, media]);

  return read;
}
