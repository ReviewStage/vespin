// inbox-screens.tsx -- the Inbox's list and its thread: the Stack's two screens in a compact window, one split view in a regular one.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { inboxAttachmentOf, inboxPictureDestination } from "@repo/features/inbox-attachment-link";
import {
  ANSWER_TONE,
  INBOX_MEDIA,
  INBOX_NOT_READ,
  INBOX_READ_MARK,
  INBOX_SCOPES,
  INBOX_SHOW,
  INBOX_SHOW_EMPTY,
  INBOX_SHOW_LABEL,
  INBOX_WHOSE,
  type InboxCounts,
  type InboxListed,
  type InboxShow,
  inboxLineKind,
  inboxMemberName,
  inboxPreview,
  inboxSettledStanding,
  inboxThreadMessages,
  isDone,
  isUnread,
  MARK_ALL_READ,
  READING_INBOX,
  RETRY,
  SEARCH_INBOX,
} from "@repo/features/inbox-list-model";
import { INBOX_STATUS, inboxWaitsOn } from "@repo/features/inbox-wire";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { cardTitle } from "@repo/features/plain-words";
import {
  INBOX_FEED,
  type InboxFeed,
  selectAgentTitles,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  type BarMenu,
  DOCK_ROOM,
  EmptyState,
  GlassDock,
  LIST_LOOK,
  type ListLook,
  ListRow,
  type MarkdownVideo,
  PATH_PART,
  ROW_ACTION_TONE,
  RowList,
  type Scope,
  ScopePills,
  Screen,
  SplitView,
  THREAD_MEDIA,
  type ThreadMessage,
  ThreadPage,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
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
import { useThreadAnswer } from "../inbox/use-thread-answer.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { SettingsBarButton, useSettingsAccount } from "../settings-button.js";
import { SPLIT_TAB, useHandToSplit, useSplitSelection } from "../split-route.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";
import { OpenAskCard, ThreadComposer, threadMenu } from "./inbox-ask.js";

/** The Inbox's name, at its head and on its back button. */
const INBOX_TITLE = "Inbox";

/** What the thread's column says before a thread is picked, in a regular window. */
const SELECT_A_THREAD = "Select a thread";

/** What a pushed thread's screen says where the feed, once read, holds no such thread, such as one a link names that was deleted. */
const THREAD_NOT_FOUND = "This thread isn't in your inbox";

/** The scopes whose pill carries its count, the two that say how much waits. */
const COUNTED_SCOPES: ReadonlySet<InboxShow> = new Set([INBOX_SHOW.NEEDS_ME, INBOX_SHOW.OPEN]);

/** The bar's menu of the Inbox's other acts, a round glass ⋯ as iOS draws a toolbar's menu. */
const MORE = { label: "More", symbol: "ellipsis" } as const;

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
      {listed.map((each) => (
        <InboxRow key={each.item.id} listed={each} readerId={readerId} onMark={onMark} />
      ))}
    </RowList>
  );
}

/**
 * One Inbox item's row: the task's ring and name, the thread's title, and
 * the line of what it asks led by its glyph, with the teammate it waits on
 * before the time; a swipe from the leading edge marks it read or unread.
 * The one row every list of Inbox items draws, the Search tab's among them.
 */
export function InboxRow({
  listed,
  readerId,
  onMark,
}: {
  readonly listed: InboxListed;
  readonly readerId: string | undefined;
  readonly onMark: (itemId: string, unread: boolean) => void;
}) {
  const { holder, item } = listed;
  const unread = isUnread(item);
  const waitsOn = inboxWaitsOn(item);
  return (
    <ListRow
      id={item.id}
      title={cardTitle(item.title)}
      task={{
        name: holder.task.name,
        status: holder.task.status,
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

/** The Inbox's scopes as its pills, the one shown filled, Questions and Open with their counts. */
function scopePills(
  show: InboxShow,
  choose: (show: InboxShow) => void,
  counts: InboxCounts,
): readonly Scope[] {
  return INBOX_SCOPES.map((scope) => ({
    label: INBOX_SHOW_LABEL[scope],
    count: COUNTED_SCOPES.has(scope) ? counts[scope] : undefined,
    selected: scope === show,
    onPress: () => choose(scope),
  }));
}

/** The Inbox's ⋯ menu: Mark all as read. */
function moreMenu(
  unread: readonly string[],
  markAll: (itemIds: readonly string[]) => void,
): BarMenu {
  return {
    ...MORE,
    choices: [],
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

/**
 * A thread's page from its item: its path, its subject, each message with
 * its files as they are read, the open ask's card under them, and the box
 * at its foot that answers or replies, with Resolve in its ⋯ menu. A compact
 * window's pushed screen docks the box over the screen's foot, above the
 * keyboard, and holds the menu in the stack's bar; a split view's detail
 * stands both in its own column.
 */
function ThreadDetail({
  listed,
  readerId,
  inStack = false,
}: {
  readonly listed: InboxListed;
  readonly readerId: string | undefined;
  /** Whether it is a compact window's pushed screen, whose stack's bar names the path. */
  readonly inStack?: boolean;
}) {
  const colors = useColors();
  const { holder, item } = listed;
  const openLink = useOpenLink();
  const titles = useAgentTitles();
  const agentName = titles.get(item.agentId) ?? UNTITLED_AGENT;
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
  const { workspaceId } = holder.task;
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  // A video the system's player cannot read opens with its thread on vespin.dev in Safari, which plays it.
  const openOnWeb = () => {
    const place = {
      kind: LINK_DESTINATION.INBOX_ITEM,
      planId: holder.task.id,
      itemId: item.id,
    } as const;
    const address = linkOf(place, workspace?.slug ?? workspace?.id ?? workspaceId ?? "");
    openInSafari(address);
  };
  const sources = useThreadMedia(item.id, media);
  useReadOnOpen(listed);
  const answer = useThreadAnswer(listed);
  const menu = threadMenu(item, answer);
  const drawn: readonly ThreadMessage[] = messages.map((message) => ({
    ...message,
    stamp:
      message.stamp === undefined
        ? undefined
        : { words: message.stamp.words, ahead: message.stamp.tone === ANSWER_TONE.AHEAD },
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
  const path = [holder.task.name, agentName];
  const page = (
    <ThreadPage
      path={path}
      status={holder.task.status}
      title={cardTitle(item.title)}
      messages={drawn}
      repository={holder.task.repository}
      onOpenLink={openLink}
      pictureSource={pictureSource}
      videoAt={videoAt}
      standing={item.status === INBOX_STATUS.OPEN ? undefined : inboxSettledStanding(item)}
      ask={<OpenAskCard item={item} answer={answer} />}
      {...(inStack
        ? { footRoom: DOCK_ROOM }
        : { menu, foot: <ThreadComposer item={item} answer={answer} inColumn /> })}
    />
  );
  if (!inStack) return page;
  return (
    <>
      <Stack.Screen
        options={{
          title: path.join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      {menu === undefined ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon={menu.symbol} accessibilityLabel={menu.label}>
            {menu.actions.map((action) => (
              <Stack.Toolbar.MenuAction
                key={action.label}
                icon={action.symbol}
                onPress={action.onPress}
              >
                {action.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
      <GlassDock bar={<ThreadComposer item={item} answer={answer} />}>
        <Screen>{page}</Screen>
      </GlassDock>
    </>
  );
}

/** What stands where a thread named by its id is not drawn: that the feed is still read, that it could not be, with Retry, or that it holds no such thread. */
function ThreadNotDrawn({ feed }: { readonly feed: InboxFeed }) {
  const { refresh, refreshTasks } = useInboxActs();
  if (feed === INBOX_FEED.READING) return <EmptyState title={READING_INBOX} symbol="tray" />;
  if (feed === INBOX_FEED.FAILED) {
    return (
      <EmptyState
        title={INBOX_NOT_READ}
        symbol="exclamationmark.triangle"
        action={{
          label: RETRY,
          // The feed or the task list that holds the thread failed, so both are read again.
          onPress: () => void Promise.all([refresh(), refreshTasks()]),
        }}
      />
    );
  }
  return <EmptyState title={THREAD_NOT_FOUND} symbol="tray" />;
}

/**
 * A split view's detail: the thread the list selected, read by its id as a
 * pushed screen reads it, so a link to a thread of a workspace the list does
 * not show still opens it, and one still read, refused, or missing says so.
 */
function ThreadColumn({ id }: { readonly id: string }) {
  const { listed, readerId, feed } = useInboxThread(id);
  if (listed === undefined) return <ThreadNotDrawn feed={feed} />;
  return <ThreadDetail listed={listed} readerId={readerId} />;
}

/** What the list screens share: the scope and its pills, the search, the listing under both, and the acts on it. */
function useInboxScreen(chosen?: string | undefined) {
  const { show, choose } = useInboxScope();
  const [search, setSearch] = useState("");
  const listing = useInboxListing({ show, search, chosen });
  const acts = useInboxActs();
  const scopes = scopePills(show, choose, listing.counts);
  const menu = moreMenu(listing.unread, acts.markAll);
  return { show, search, setSearch, listing, acts, scopes, menu };
}

// A compact window: the list under the Stack's inline title and the scope
// pills, the account's photo opening Settings at the bar's leading edge, and
// its search and its ⋯ menu as round glass buttons at its trailing one, each
// row pushing its thread as the Stack's next screen.
function InboxStackList() {
  const router = useRouter();
  const { show, search, setSearch, listing, acts, scopes, menu } = useInboxScreen();
  return (
    <>
      <Stack.Screen options={{ title: INBOX_TITLE }}>
        <Stack.SearchBar
          placeholder={SEARCH_INBOX}
          placement="integratedButton"
          allowToolbarIntegration={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      </Stack.Screen>
      <SettingsBarButton />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={menu.symbol} accessibilityLabel={menu.label}>
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
      </Stack.Toolbar>
      <Screen>
        <ScopePills scopes={scopes}>
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
        </ScopePills>
      </Screen>
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the list
// under its scope pills as the split view's sidebar, the account's photo, its
// search and ⋯ menu in the sidebar's bar, and the selected thread beside it.
// The Stack's header steps aside, since the split view draws each column's
// navigation bar itself.
function InboxSplitScreen({
  selected,
  select,
}: {
  readonly selected: string | undefined;
  readonly select: (id: string) => void;
}) {
  const { show, search, setSearch, listing, acts, scopes, menu } = useInboxScreen(selected);
  const account = useSettingsAccount();
  useSurfaceOpen(selected === undefined ? undefined : PRODUCT_SURFACE.THREAD, selected);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <SplitView
          sidebar={
            <ScopePills scopes={scopes}>
              {listing.listed.length === 0 ? (
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
                  onSelect={select}
                  onRefresh={acts.refresh}
                  onMark={acts.mark}
                />
              )}
            </ScopePills>
          }
          detail={
            selected === undefined ? (
              <EmptyState title={SELECT_A_THREAD} symbol="tray" />
            ) : (
              <ThreadColumn key={selected} id={selected} />
            )
          }
          sidebarAccount={account}
          sidebarMenu={menu}
          sidebarSearch={{ placeholder: SEARCH_INBOX, onChange: setSearch }}
        />
      </Screen>
    </>
  );
}

/** The Inbox tab's root screen: its list, laid out by the window's size class. */
export function InboxListScreen() {
  const sizeClass = useWindowSizeClass();
  const { selected, select } = useSplitSelection(SPLIT_TAB.INBOX);
  useSurfaceOpen(PRODUCT_SURFACE.INBOX);
  return sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
    <InboxSplitScreen selected={selected} select={select} />
  ) : (
    <InboxStackList />
  );
}

/** The Inbox's pushed screen: one thread, named by the route's `id`, its path small in the bar over its heading. */
export function InboxThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listed, readerId, feed } = useInboxThread(id);
  const handed = useHandToSplit(SPLIT_TAB.INBOX, id);
  useSurfaceOpen(handed ? undefined : PRODUCT_SURFACE.THREAD, id);
  if (handed) return null;
  return (
    <>
      <Stack.Screen
        options={{ headerBackTitle: INBOX_TITLE, ...(listed === undefined ? { title: "" } : {}) }}
      />
      {listed !== undefined ? (
        <ThreadDetail listed={listed} readerId={readerId} inStack />
      ) : (
        <Screen>
          <ThreadNotDrawn feed={feed} />
        </Screen>
      )}
    </>
  );
}
