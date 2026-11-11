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

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  INBOX_MEDIA,
  INBOX_SHOW,
  type InboxCounts,
  type InboxListed,
  type InboxMessageMedia,
  type InboxShow,
  inboxAtNow,
  inboxCounts,
  inboxList,
  isUnread,
  MINE,
  waitsOnReaderNow,
} from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { markedNote, REMIND_REFUSED } from "@repo/features/inbox-write-words";
import { searchTokens } from "@repo/features/search-tokens";
import { TASKS_READ } from "@repo/features/tasks-view";
import { MP4_TYPE } from "@repo/features/video-signature";
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
import { cachedVideo } from "../cached-media.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { dismissThreadNotifications } from "../notification-task.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";
import { NOT_RESOLVED, refusedWords, useSendsDrawn } from "./use-thread-answer.js";

/** What a thread's videos are named under among the app's caches. */
const INBOX_MEDIA_PREFIX = "inbox";

/** The defaults key the Inbox's scope is kept under, as the panel keeps its window's. */
const INBOX_SCOPE_KEY = "inboxScope";

/** No holder read yet. */
const NO_GROUPS: ReturnType<ReturnType<typeof selectInboxGroupsIn>> = [];

/**
 * Every holder of Inbox items in the workspace chosen in Settings, as the
 * panel's Inbox lists the chosen workspace's alone, heard anew as another is
 * chosen; every workspace's before the account's workspaces are read.
 */
function useInboxGroups(): ReturnType<ReturnType<typeof selectInboxGroupsIn>> {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  const { data: groups = NO_GROUPS } = useQuery({
    ...appStateQuery,
    select: selectInboxGroupsIn(chosen?.id),
  });
  return useSendsDrawn(groups);
}

/** The scope kept, or Open, the panel's own first scope, where none was ever chosen. */
function keptScope(): InboxShow {
  const kept: unknown = Settings.get(INBOX_SCOPE_KEY);
  return Object.values(INBOX_SHOW).find((show) => show === kept) ?? INBOX_SHOW.OPEN;
}

/** The Inbox's scope, kept in the app's defaults across launches, and the choice of another. */
export function useInboxScope(): {
  readonly show: InboxShow;
  readonly choose: (show: InboxShow) => void;
} {
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
 */
export function useInboxThread(id: string | undefined): {
  readonly listed: InboxListed | undefined;
  readonly readerId: string | undefined;
  readonly feed: InboxFeed;
} {
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
  const listed = useMemo(() => {
    for (const { holder, items } of groups) {
      const item = items.find((each) => each.id === id);
      if (item !== undefined) return { holder, item };
    }
    return undefined;
  }, [groups, id]);
  const feed =
    listed !== undefined || !held || tasksRead === TASKS_READ.READY
      ? answered
      : tasksRead === TASKS_READ.FAILED
        ? INBOX_FEED.FAILED
        : INBOX_FEED.READING;
  return { listed, readerId, feed };
}

/** Says on the console an act the host refused, which the next delivery of the document corrects. */
function refused(what: string): (error: unknown) => void {
  return (error) => console.error(`${what} did not go.`, error);
}

/** The Inbox's own acts, as the panel's sends them: a thread marked read or unread, its reminder set or cleared, an open one resolved from its row, every thread listed marked read, the feed read again, and the task list that holds its threads read again. */
export function useInboxActs(): {
  readonly mark: (itemId: string, unread: boolean) => void;
  /** Sets the thread's reminder for an instant, or clears it where `until` is null, which the host draws at once, as it draws a mark. */
  readonly remind: (itemId: string, until: number | null) => void;
  /** Resolves an open thread against the revision its row drew, as the thread's own Resolve does, buzzing as it lands or is refused. */
  readonly resolve: (item: InboxItem) => void;
  readonly markAll: (itemIds: readonly string[]) => void;
  readonly refresh: () => Promise<void>;
  readonly refreshTasks: () => Promise<void>;
} {
  const acts = useHostActs();
  const write = useWrite();
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
    [acts, write],
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
    dismissThreadNotifications(id).catch((error: unknown) =>
      console.error("The thread's notifications were not removed.", error),
    );
  }, [id]);
}

/**
 * What each of a thread's files is drawn from, by its attachment, read once
 * through the host as the panel reads one (`AGENTS_INBOX_ATTACHMENT`): a
 * picture as a `data:` address, and a video, asked for as its MP4 copy, as a
 * file of the app's caches, since the system's player reads a file, which an
 * older recording with no copy answers as a WebM the player cannot play; one still on its way, or that
 * could not be read, is absent. Note that each file is asked for once while
 * the thread stands, whatever `media` list names it, because the thread's
 * item is made anew on every change to it, its read mark as it opens among
 * them, and each read carries the whole file; one whose read failed is asked
 * for again on the thread's next change.
 */
export function useThreadMedia(
  itemId: string | undefined,
  media: readonly InboxMessageMedia[],
): ReadonlyMap<string, string> {
  const acts = useHostActs();
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map());
  // The thread the files were asked for, and the attachments asked for on it.
  const asked = useRef<{ readonly itemId: string | undefined; readonly ids: Set<string> }>({
    itemId: undefined,
    ids: new Set(),
  });
  useEffect(() => {
    if (itemId === undefined) return;
    if (asked.current.itemId !== itemId) {
      asked.current = { itemId, ids: new Set() };
      setSources(new Map());
    }
    const { ids } = asked.current;
    for (const each of media) {
      if (ids.has(each.attachmentId)) continue;
      ids.add(each.attachmentId);
      // A read that fails is forgotten, so the thread's next change asks for it again.
      const forget = (error: unknown) => {
        if (asked.current.itemId === itemId) ids.delete(each.attachmentId);
        refused("Reading a thread's file")(error);
      };
      // A video is asked for as the MP4 copy iOS's player plays, which an older recording kept without one answers as its WebM.
      const playable = each.kind === INBOX_MEDIA.VIDEO ? ({ playable: MP4_TYPE } as const) : {};
      acts[ACT_KIND.AGENTS_INBOX_ATTACHMENT]({
        itemId,
        attachmentId: each.attachmentId,
        ...playable,
      })
        .then(async (read) => {
          // A read that lands once another thread stands is that thread's no longer.
          if (asked.current.itemId !== itemId) return;
          if (!("base64" in read)) throw new Error(`The file was not read: ${read.failure}.`);
          const source =
            each.kind === INBOX_MEDIA.VIDEO
              ? await cachedVideo(
                  INBOX_MEDIA_PREFIX,
                  each.attachmentId,
                  read.contentType,
                  read.base64,
                )
              : `data:${read.contentType};base64,${read.base64}`;
          if (asked.current.itemId !== itemId) return;
          setSources((held) => new Map(held).set(each.attachmentId, source));
        })
        .catch(forget);
    }
  }, [acts, itemId, media]);
  return sources;
}
