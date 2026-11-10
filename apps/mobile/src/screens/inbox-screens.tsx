// inbox-screens.tsx -- the Inbox's list and its thread: the Stack's two screens in a compact window, one split view in a regular one.

import { inboxAttachmentOf, inboxPictureDestination } from "@repo/features/inbox-attachment-link";
import {
  holderName,
  INBOX_HOLDER,
  INBOX_MEDIA,
  INBOX_NOT_READ,
  INBOX_READ_MARK,
  INBOX_SCOPES,
  INBOX_SHOW_EMPTY,
  INBOX_SHOW_LABEL,
  INBOX_WHOSE,
  type InboxListed,
  type InboxShow,
  inboxLineKind,
  inboxMemberName,
  inboxPreview,
  inboxThreadMessages,
  isDone,
  isUnread,
  MARK_ALL_READ,
  READING_INBOX,
  RETRY,
  SEARCH_INBOX,
} from "@repo/features/inbox-list-model";
import { inboxWaitsOn } from "@repo/features/inbox-wire";
import { iosAppRouteOf } from "@repo/features/ios-app-links";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import { cardTitle } from "@repo/features/plain-words";
import {
  INBOX_FEED,
  type InboxFeed,
  selectAgentTitles,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import {
  type BarAction,
  type BarMenu,
  EmptyState,
  LIST_LOOK,
  type ListLook,
  ListRow,
  type MarkdownPlace,
  type MarkdownVideo,
  ROW_ACTION_TONE,
  RowList,
  Screen,
  SplitView,
  THREAD_MEDIA,
  type ThreadMessage,
  ThreadPage,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { openURL } from "expo-linking";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import {
  useInboxActs,
  useInboxListing,
  useInboxScope,
  useInboxThread,
  useReadOnOpen,
  useThreadMedia,
} from "../inbox/use-inbox.js";
import { useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";

/** The Inbox's name, at its head and on its back button. */
const INBOX_TITLE = "Inbox";

/** What the thread's column says before a thread is picked, in a regular window. */
const SELECT_A_THREAD = "Select a thread";

/** What a pushed thread's screen says where the feed, once read, holds no such thread, such as one a link names that was deleted. */
const THREAD_NOT_FOUND = "This thread isn't in your inbox";

/** What a video the words draw in place is heard as, its file's name being the words' own alt. */
const VIDEO_LABEL = "Video";

/** No agent's title held. */
const NO_TITLES: ReadonlyMap<string, string> = new Map();

/** What an agent is called where the document holds no title for it yet. */
const UNTITLED_AGENT = "Agent";

/** What the list's search says where it finds nothing. */
function noMatchWords(search: string): string {
  return `No items match “${search}”.`;
}

/** A link a message names opened where it goes: a place the app draws on its own screen, and anything else in Safari. */
function useOpenPlace(): (place: MarkdownPlace) => void {
  const router = useRouter();
  return (place) => {
    const route = iosAppRouteOf(place.place);
    if (route !== undefined) {
      router.push(route);
      return;
    }
    openURL(place.href).catch((error: unknown) => console.error("The link did not open.", error));
  };
}

type InboxRowsProps = {
  readonly look: ListLook;
  readonly listed: readonly InboxListed[];
  readonly readerId: string | undefined;
  readonly selected?: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onMark: (itemId: string, unread: boolean) => void;
};

/**
 * The Inbox's rows, each as the panel's row: the task's ring and name, the
 * thread's title, and the line of what it asks led by its glyph, with the
 * teammate it waits on before the time; a swipe from the leading edge marks
 * it read or unread, and a long press offers the same.
 */
function InboxRows({
  look,
  listed,
  readerId,
  selected,
  onSelect,
  onRefresh,
  onMark,
}: InboxRowsProps) {
  return (
    <RowList
      look={look}
      selected={selected}
      onSelect={onSelect}
      onRefresh={onRefresh}
      title={look === LIST_LOOK.SIDEBAR ? INBOX_TITLE : undefined}
    >
      {listed.map(({ holder, item }) => {
        const unread = isUnread(item);
        const waitsOn = inboxWaitsOn(item);
        return (
          <ListRow
            key={item.id}
            id={item.id}
            title={cardTitle(item.title)}
            task={{
              name: holderName(holder),
              status: holder.kind === INBOX_HOLDER.TASK ? holder.task.status : undefined,
            }}
            line={inboxLineKind(item)}
            summary={inboxPreview(item, (member) => inboxMemberName(member, readerId))}
            unread={unread}
            done={isDone(item)}
            face={waitsOn === undefined || waitsOn.userId === readerId ? undefined : waitsOn.name}
            at={item.updatedAt}
            leadingActions={[
              {
                label: unread ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
                symbol: unread ? "envelope.open" : "envelope.badge",
                tone: ROW_ACTION_TONE.ACCENT,
                onPress: () => onMark(item.id, !unread),
              },
            ]}
          />
        );
      })}
    </RowList>
  );
}

/**
 * What the list stands where it lists nothing: that the account's feed is
 * still on its first read, or could not be read, with Retry, rather than an
 * empty Inbox over threads not yet read; else nothing its search found, or
 * nothing its scope holds.
 */
function InboxEmpty({
  show,
  search,
  feed,
  onRetry,
}: {
  readonly show: InboxShow;
  readonly search: string;
  readonly feed: InboxFeed;
  readonly onRetry: () => void;
}) {
  if (feed === INBOX_FEED.READING) return <EmptyState title={READING_INBOX} symbol="tray" />;
  if (feed === INBOX_FEED.FAILED) {
    return (
      <EmptyState
        title={INBOX_NOT_READ}
        symbol="exclamationmark.triangle"
        action={{ label: RETRY, onPress: onRetry }}
      />
    );
  }
  if (search.trim() !== "") {
    return <EmptyState title={noMatchWords(search.trim())} symbol="magnifyingglass" />;
  }
  return <EmptyState title={INBOX_SHOW_EMPTY[INBOX_WHOSE.MINE][show]} symbol="tray" />;
}

/** The Inbox's View options: its scopes, the one shown checked, and Mark all as read under them. */
function viewOptions(
  show: InboxShow,
  choose: (show: InboxShow) => void,
  unread: readonly string[],
  markAll: (itemIds: readonly string[]) => void,
): BarMenu {
  return {
    label: "View options",
    symbol: "line.3.horizontal.decrease.circle",
    choices: INBOX_SCOPES.map((scope) => ({
      label: INBOX_SHOW_LABEL[scope],
      on: scope === show,
      onPress: () => choose(scope),
    })),
    actions: [
      {
        label: MARK_ALL_READ,
        symbol: "envelope.open",
        disabled: unread.length === 0,
        onPress: () => markAll(unread),
      },
    ],
  };
}

/** Every agent's title the document holds, by the agent's id. */
function useAgentTitles(): ReadonlyMap<string, string> {
  const { data = NO_TITLES } = useQuery({ ...appStateQuery, select: selectAgentTitles });
  return data;
}

/** A thread's page from its item: its path, its subject, and each message with its files as they are read. */
function ThreadDetail({
  listed,
  readerId,
}: {
  readonly listed: InboxListed;
  readonly readerId: string | undefined;
}) {
  const { holder, item } = listed;
  const openPlace = useOpenPlace();
  const titles = useAgentTitles();
  const agentName =
    titles.get(item.agentId) ??
    (holder.kind === INBOX_HOLDER.AGENT ? holder.agent.agentTitle : null) ??
    UNTITLED_AGENT;
  const messages = useMemo(
    () => inboxThreadMessages(item, agentName, readerId),
    [item, agentName, readerId],
  );
  // Note that a file its words draw is read beside the files drawn after them, since its bytes come the same way.
  const media = useMemo(
    () =>
      messages.flatMap((message) => [
        ...message.media,
        ...message.drawn.map(({ kind, attachmentId }) => ({
          kind,
          attachmentId,
          name: "",
          mediaType: "",
        })),
      ]),
    [messages],
  );
  // The videos the words draw in place, by attachment.
  const drawnVideos = useMemo(
    () =>
      new Set(
        messages.flatMap((message) =>
          message.drawn
            .filter(({ kind }) => kind === INBOX_MEDIA.VIDEO)
            .map(({ attachmentId }) => attachmentId),
        ),
      ),
    [messages],
  );
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspaceId =
    holder.kind === INBOX_HOLDER.TASK ? holder.task.workspaceId : holder.agent.workspaceId;
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  // A video the system's player cannot read opens with its thread on vespin.dev in Safari, which plays it.
  const openOnWeb = () => {
    const place =
      holder.kind === INBOX_HOLDER.TASK
        ? { kind: LINK_PLACE.INBOX_ITEM, planId: holder.task.id, itemId: item.id }
        : { kind: LINK_PLACE.INBOX_ITEM, agentId: holder.agent.agentId, itemId: item.id };
    const address = linkOf(place, workspace?.slug ?? workspace?.id ?? workspaceId ?? "");
    openURL(address).catch((error: unknown) => console.error("The thread did not open.", error));
  };
  const sources = useThreadMedia(item.id, media);
  useReadOnOpen(listed);
  const drawn: readonly ThreadMessage[] = messages.map((message) => ({
    ...message,
    media: message.media.map((each) =>
      each.kind === INBOX_MEDIA.VIDEO
        ? {
            kind: THREAD_MEDIA.VIDEO,
            key: each.attachmentId,
            source: sources.get(each.attachmentId),
            label: each.name,
            onOpenElsewhere: openOnWeb,
          }
        : {
            kind: THREAD_MEDIA.PICTURE,
            key: each.attachmentId,
            source: sources.get(each.attachmentId),
            alt: each.name,
          },
    ),
  }));
  // Note that a picture the words name by one of the thread's own files is drawn from its bytes as read, and any other from the address it names.
  const pictureSource = (written: string): string | undefined => {
    const named = inboxAttachmentOf(inboxPictureDestination(written));
    return named === undefined || named.itemId !== item.id
      ? written
      : sources.get(named.attachmentId);
  };
  // A video the words name as a picture is played where they name it, from its bytes as read.
  const videoAt = (written: string): MarkdownVideo | undefined => {
    const named = inboxAttachmentOf(inboxPictureDestination(written));
    if (named === undefined || named.itemId !== item.id || !drawnVideos.has(named.attachmentId)) {
      return undefined;
    }
    return {
      source: sources.get(named.attachmentId),
      label: VIDEO_LABEL,
      onOpenElsewhere: openOnWeb,
    };
  };
  return (
    <ThreadPage
      path={[holderName(holder), agentName]}
      status={holder.kind === INBOX_HOLDER.TASK ? holder.task.status : undefined}
      title={cardTitle(item.title)}
      messages={drawn}
      repository={
        holder.kind === INBOX_HOLDER.TASK ? holder.task.repository : holder.agent.repository
      }
      onOpenPlace={openPlace}
      pictureSource={pictureSource}
      videoAt={videoAt}
    />
  );
}

/** What the list screens share: the scope, the search, the listing under both, and the acts on it. */
function useInboxScreen(chosen?: string | undefined) {
  const { show, choose } = useInboxScope();
  const [search, setSearch] = useState("");
  const listing = useInboxListing({ show, search, chosen });
  const acts = useInboxActs();
  const menu = viewOptions(show, choose, listing.unread, acts.markAll);
  return { show, search, setSearch, listing, acts, menu };
}

type InboxListScreenProps = {
  /** The act the list's bar holds beside its menu, such as Settings. */
  readonly barAction?: BarAction | undefined;
};

// A compact window: the list under the Stack's large title, its search in the
// header and its View options and Settings in the bar, each row pushing its
// thread as the Stack's next screen.
function InboxStackList({ barAction }: InboxListScreenProps) {
  const router = useRouter();
  const { show, search, setSearch, listing, acts, menu } = useInboxScreen();
  return (
    <>
      <Stack.Screen options={{ title: INBOX_TITLE, headerLargeTitle: true }}>
        <Stack.SearchBar
          placeholder={SEARCH_INBOX}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      </Stack.Screen>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={menu.symbol} accessibilityLabel={menu.label}>
          <Stack.Toolbar.Menu inline title={menu.label}>
            {menu.choices.map((choice) => (
              <Stack.Toolbar.MenuAction
                key={choice.label}
                isOn={choice.on}
                onPress={choice.onPress}
              >
                {choice.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          {menu.actions.map((action) => (
            <Stack.Toolbar.MenuAction
              key={action.label}
              icon={action.symbol}
              disabled={action.disabled === true}
              onPress={action.onPress}
            >
              {action.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        {barAction === undefined ? null : (
          <Stack.Toolbar.Button
            icon={barAction.symbol}
            accessibilityLabel={barAction.label}
            onPress={barAction.onPress}
          >
            {barAction.label}
          </Stack.Toolbar.Button>
        )}
      </Stack.Toolbar>
      <Screen>
        {listing.listed.length === 0 ? (
          <InboxEmpty
            show={show}
            search={search}
            feed={listing.feed}
            onRetry={() => void acts.refresh()}
          />
        ) : (
          <InboxRows
            look={LIST_LOOK.PLAIN}
            listed={listing.listed}
            readerId={listing.readerId}
            onSelect={(id) => router.push(`/inbox/${encodeURIComponent(id)}`)}
            onRefresh={acts.refresh}
            onMark={acts.mark}
          />
        )}
      </Screen>
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the list
// as the split view's sidebar, its search and View options in the sidebar's
// bar, and the selected thread beside it. The Stack's header steps aside,
// since the split view draws each column's navigation bar itself.
function InboxSplitScreen({ barAction }: InboxListScreenProps) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const { show, search, setSearch, listing, acts, menu } = useInboxScreen(selected);
  const chosen = listing.listed.find(({ item }) => item.id === selected);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <SplitView
          sidebar={
            listing.listed.length === 0 ? (
              <InboxEmpty
                show={show}
                search={search}
                feed={listing.feed}
                onRetry={() => void acts.refresh()}
              />
            ) : (
              <InboxRows
                look={LIST_LOOK.SIDEBAR}
                listed={listing.listed}
                readerId={listing.readerId}
                selected={selected}
                onSelect={setSelected}
                onRefresh={acts.refresh}
                onMark={acts.mark}
              />
            )
          }
          detail={
            chosen === undefined ? (
              <EmptyState title={SELECT_A_THREAD} symbol="tray" />
            ) : (
              <ThreadDetail key={chosen.item.id} listed={chosen} readerId={listing.readerId} />
            )
          }
          sidebarAction={barAction}
          sidebarMenu={menu}
          sidebarSearch={{ placeholder: SEARCH_INBOX, onChange: setSearch }}
        />
      </Screen>
    </>
  );
}

/** The Inbox tab's root screen: its list, laid out by the window's size class. */
export function InboxListScreen({ barAction }: InboxListScreenProps) {
  const sizeClass = useWindowSizeClass();
  return sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
    <InboxSplitScreen barAction={barAction} />
  ) : (
    <InboxStackList barAction={barAction} />
  );
}

/** The Inbox's pushed screen: one thread, named by the route's `id`, its back button naming the Inbox. */
export function InboxThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listed, readerId, feed } = useInboxThread(id);
  const { refresh, refreshTasks } = useInboxActs();
  return (
    <>
      <Stack.Screen options={{ title: "", headerBackTitle: INBOX_TITLE }} />
      <Screen>
        {listed !== undefined ? (
          <ThreadDetail listed={listed} readerId={readerId} />
        ) : feed === INBOX_FEED.READING ? (
          <EmptyState title={READING_INBOX} symbol="tray" />
        ) : feed === INBOX_FEED.FAILED ? (
          <EmptyState
            title={INBOX_NOT_READ}
            symbol="exclamationmark.triangle"
            action={{
              label: RETRY,
              // The feed or the task list that holds the thread failed, so both are read again.
              onPress: () => void Promise.all([refresh(), refreshTasks()]),
            }}
          />
        ) : (
          <EmptyState title={THREAD_NOT_FOUND} symbol="tray" />
        )}
      </Screen>
    </>
  );
}
