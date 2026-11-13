// inbox-screens.tsx -- the Inbox's list and its thread: the Stack's two screens in a compact window, one split view in a regular one.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { isVideoType } from "@repo/features/conversation-picture-wire";
import { RESOLVE } from "@repo/features/inbox-ask-words";
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
import { INBOX_STATUS, type InboxItem, inboxWaitsOn } from "@repo/features/inbox-wire";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { threadActivity } from "@repo/features/ios-system-activity";
import { LINK_DESTINATION, linkOf, linkWorkspaceStep } from "@repo/features/link-grammar";
import type { ModelProvider } from "@repo/features/models-wire";
import { cardTitle } from "@repo/features/plain-words";
import { CHOOSE_AN_ITEM_WORDS, SELECTION_WORDS, selectedWords } from "@repo/features/words";
import {
  INBOX_FEED,
  type InboxFeed,
  selectAgentHarnesses,
  selectAgentNames,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  type BarAction,
  type BarMenu,
  EmptyState,
  GLYPH,
  GlassDock,
  glyphSymbol,
  LIST_LOOK,
  type ListLook,
  ListRow,
  type MarkdownVideo,
  menuWithout,
  PATH_PART,
  previewMessages,
  ROW_ACTION_TONE,
  type RowChoosing,
  RowForEach,
  RowList,
  SCOPE_LOOK,
  type Scope,
  ScopePicker,
  Screen,
  SplitView,
  scopeMenu,
  THREAD_MEDIA,
  type ThreadMedia,
  type ThreadMessage,
  ThreadPage,
  ThreadPreview,
  UNDER_SPLIT_SCREEN,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useInboxChoosing } from "../inbox/inbox-choosing.js";
import {
  useInboxActs,
  useInboxListing,
  useInboxScope,
  useInboxThread,
  useReadOnOpen,
  useThreadMedia,
} from "../inbox/use-inbox.js";
import { useThreadAnswer } from "../inbox/use-thread-answer.js";
import { useKeeping } from "../keeping.js";
import { type PictureOf, useMemberPictures } from "../member-pictures.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useHandColumns, useInFront } from "../place-columns.js";
import { useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { SPLIT_TAB, useHandToSplit, useSplitSelection } from "../split-route.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab, useOnTab } from "../tab-route.js";
import { useLinkStandings } from "../tasks/use-link-standings.js";
import { useThreeColumns, useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import { SIDEBAR_PLACE, useListColumn, useListLook } from "./app-sidebar.js";
import {
  NO_THREAD_ACTS,
  OpenAskCard,
  openAskFiles,
  ThreadComposer,
  threadActs,
  threadMenu,
} from "./inbox-ask.js";
import { REMIND_ME, useRemindSheet } from "./inbox-remind.js";

/** The Inbox's name, at its head and on its back button. */
const INBOX_TITLE = "Inbox";

/** What a pushed thread's screen says where the feed, once read, holds no such thread, such as one a link names that was deleted. */
const THREAD_NOT_FOUND = "This thread isn't in your inbox";

/** What the scopes' control is heard as by VoiceOver, before the scope chosen. */
const SCOPE_LABEL = "Filter";

/** The scopes whose pill carries its count, the two that say how much waits. */
const COUNTED_SCOPES: ReadonlySet<InboxShow> = new Set([INBOX_SHOW.NEEDS_ME, INBOX_SHOW.OPEN]);

/** The bar's menu of the Inbox's other acts, a round glass ⋯ as iOS draws a toolbar's menu. */
const MORE = { label: "More", symbol: GLYPH.MORE } as const;

/** What a thread's path opens, as the panel's crumbs open its task and its agent. */
const PATH_OPENS = { TASK: "Open task", AGENT: "Open agent" } as const;

/** What ends Select mode, as the system's own Done does. */
const SELECT_DONE = "Done";

/** What a video the words draw in place is heard as, its file's name being the words' own alt. */
const VIDEO_LABEL = "Video";

/** No agent's name held. */
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** What an agent is called where the task list does not hold it, as the panel's tab names one it cannot find. */
const UNLISTED_AGENT = "Agent";

/** How many of a thread's newest messages its row reads for its preview: more than the preview draws, since a file sent alone says nothing there. */
const PREVIEW_TAIL = 6;

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
  readonly onRemind: (item: InboxItem) => void;
  readonly onResolve: (item: InboxItem) => void;
  /** The list's Select mode, while it stands in one. */
  readonly choosing?: RowChoosing | undefined;
};

/**
 * The Inbox's rows, each as the panel's row: the task's ring and name, the
 * thread's title, and the line of what it asks led by its glyph, with the
 * teammate it waits on before the time, or when its reminder comes back in
 * the time's place; a swipe from the leading edge marks it read or unread, a
 * swipe from the trailing edge resolves it or opens Remind me, and a long
 * press lifts its preview over the same acts.
 */
function InboxRows({
  look,
  listed,
  readerId,
  selected,
  onSelect,
  onRefresh,
  onMark,
  onRemind,
  onResolve,
  choosing,
}: InboxRowsProps) {
  // The members' pictures, read once for every row rather than once a row.
  const pictureOf = useMemberPictures();

  return (
    <RowList
      look={look}
      selected={selected}
      onSelect={onSelect}
      onRefresh={onRefresh}
      choosing={choosing}
    >
      <InboxItemRows
        listed={listed}
        readerId={readerId}
        pictureOf={pictureOf}
        onMark={onMark}
        onRemind={onRemind}
        onResolve={onResolve}
      />
    </RowList>
  );
}

type InboxRowActs = {
  readonly readerId: string | undefined;
  /** Each member's picture by their id, read once by the list the row stands in. */
  readonly pictureOf: PictureOf;
  readonly onMark: (itemId: string, unread: boolean) => void;
  /** Opens Remind me on the thread, which a swipe from the trailing edge offers. */
  readonly onRemind: (item: InboxItem) => void;
  /** Resolves the open thread, which a full swipe from the trailing edge runs. */
  readonly onResolve: (item: InboxItem) => void;
};

/**
 * A run of Inbox items, each on its own `InboxRow`, recycled as the list
 * scrolls, so an Inbox of a thousand threads mounts only the rows near the
 * screen: the one run every list of Inbox items draws, the Search tab's
 * among them.
 */
export function InboxItemRows({
  listed,
  ...acts
}: InboxRowActs & { readonly listed: readonly InboxListed[] }) {
  return (
    <RowForEach data={listed} keyOf={(each) => each.item.id}>
      {(each) => <InboxRow listed={each} {...acts} />}
    </RowForEach>
  );
}

/**
 * One Inbox item's row: the task's ring and name, the thread's title, and
 * the line of what it asks led by its glyph, with the teammate it waits on
 * before the time, and when its reminder comes due; a swipe from the leading
 * edge marks it read or unread, and one from the trailing edge resolves it
 * while it stands open, which a full swipe runs, or opens Remind me. A long
 * press lifts its preview, the thread's newest messages, over the same acts.
 * On an iPad it drags out as its vespin.dev link.
 */
function InboxRow({
  listed,
  readerId,
  pictureOf,
  onMark,
  onRemind,
  onResolve,
}: InboxRowActs & { readonly listed: InboxListed }) {
  const { holder, item } = listed;
  const unread = isUnread(item);
  const waitsOn = inboxWaitsOn(item);
  const agentName = useAgentNames().get(item.agentId) ?? UNLISTED_AGENT;
  const harness = useAgentHarness(item.agentId);
  const title = cardTitle(item.title);
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspaceStep = linkWorkspaceStep(holder.task.workspaceId, workspaces);

  // Note that only the thread's tail is read for its preview, since the preview draws its newest few messages alone.
  const messages = useMemo(
    () =>
      previewMessages(
        inboxThreadMessages(
          item.thread === undefined ? item : { ...item, thread: item.thread.slice(-PREVIEW_TAIL) },
          agentName,
          readerId,
        ),
        pictureOf,
        harness,
      ),
    [item, agentName, readerId, pictureOf, harness],
  );

  const resolve =
    item.status === INBOX_STATUS.OPEN
      ? [
          {
            label: RESOLVE,
            symbol: GLYPH.RESOLVED,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => onResolve(item),
          } as const,
        ]
      : [];

  return (
    <ListRow
      id={item.id}
      title={title}
      task={{
        name: holder.task.name,
        status: holder.task.status,
      }}
      line={inboxLineKind(item)}
      summary={inboxPreview(item, (member) => inboxMemberName(member, readerId))}
      unread={unread}
      done={isDone(item)}
      face={
        waitsOn === undefined || waitsOn.userId === readerId
          ? undefined
          : { name: waitsOn.name, picture: pictureOf(waitsOn.userId) }
      }
      at={item.updatedAt}
      due={item.remindAt}
      trailingActions={[
        ...resolve,
        { ...REMIND_ME, tone: ROW_ACTION_TONE.NEUTRAL, onPress: () => onRemind(item) },
      ]}
      leadingActions={[
        {
          label: unread ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
          symbol: unread ? GLYPH.MARK_READ : GLYPH.MARK_UNREAD,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => onMark(item.id, !unread),
        },
      ]}
      link={linkOf(
        { kind: LINK_DESTINATION.INBOX_ITEM, planId: holder.task.id, itemId: item.id },
        workspaceStep,
      )}
      preview={
        <ThreadPreview
          title={title}
          task={{ name: holder.task.name, status: holder.task.status }}
          messages={messages}
        />
      }
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
  if (feed === INBOX_FEED.READING)
    return <EmptyState title={READING_INBOX} symbol={GLYPH.INBOX} loading />;

  if (feed === INBOX_FEED.FAILED) {
    return (
      <EmptyState
        title={INBOX_NOT_READ}
        symbol={GLYPH.FAILED}
        action={{ label: RETRY, onPress: onRetry }}
      />
    );
  }

  if (search.trim() !== "") {
    return <EmptyState title={noMatchWords(search.trim())} symbol={GLYPH.SEARCH} />;
  }

  return <EmptyState title={INBOX_SHOW_EMPTY[INBOX_WHOSE.MINE][show]} symbol={GLYPH.INBOX} />;
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

/** The Inbox's ⋯ menu: Select, which turns the list to Select mode as Mail's menu does, and Mark all as read. */
function moreMenu(
  unread: readonly string[],
  markAll: (itemIds: readonly string[]) => void,
  select: { readonly listed: boolean; readonly onSelect: () => void },
): BarMenu {
  return {
    ...MORE,
    choices: [],
    actions: [
      {
        label: SELECTION_WORDS.SELECT,
        symbol: GLYPH.SELECT,
        disabled: !select.listed,
        onPress: select.onSelect,
      },
      {
        label: MARK_ALL_READ,
        symbol: GLYPH.MARK_ALL_READ,
        disabled: unread.length === 0,
        onPress: () => markAll(unread),
      },
    ],
  };
}

/**
 * What the Inbox offers for the threads chosen in Select mode, as the panel's
 * selection does (`inbox-selection.tsx`): Mark as read while one is unread,
 * else Mark as unread; Remind me, its time set on every one; and Resolve
 * while one is open, each taking only the threads it would change. Each act
 * lets Select mode go, as Mail's do. None while nothing is chosen.
 */
function chosenActs(
  chosen: readonly InboxItem[],
  acts: ReturnType<typeof useInboxActs>,
  remind: ReturnType<typeof useRemindSheet>,
  stop: () => void,
): readonly BarAction[] {
  if (chosen.length === 0) return [];
  const unread = chosen.filter(isUnread);
  const open = chosen.filter((item) => item.status === INBOX_STATUS.OPEN);
  const marking = unread.length > 0 ? unread : chosen;

  const resolve =
    open.length === 0
      ? []
      : [
          {
            label: RESOLVE,
            symbol: GLYPH.RESOLVED,
            onPress: () => {
              acts.resolveMany(open);
              stop();
            },
          },
        ];

  return [
    {
      label: unread.length > 0 ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
      symbol: unread.length > 0 ? GLYPH.MARK_READ : GLYPH.MARK_UNREAD,
      onPress: () => {
        acts.markMany(
          marking.map((item) => item.id),
          unread.length === 0,
        );
        stop();
      },
    },
    { ...REMIND_ME, onPress: () => remind.openMany(chosen, stop) },
    ...resolve,
  ];
}

/** Every agent's name the document holds, by the agent's id, as the panel names it. */
function useAgentNames(): ReadonlyMap<string, string> {
  const { data = NO_NAMES } = useQuery({ ...appStateQuery, select: selectAgentNames });

  return data;
}

/** The harness an agent runs in, as the document holds its model, whose mark its tile wears; none before the agent is listed. */
function useAgentHarness(agentId: string): ModelProvider | undefined {
  const { data } = useQuery({ ...appStateQuery, select: selectAgentHarnesses });

  return data?.get(agentId);
}

/**
 * Where a thread stands: a compact window's pushed screen, whose stack's bar
 * names the path and which draws its own Remind me sheet, or a split view's
 * detail, which opens the sheet its screen draws outside the split view.
 */
type ThreadPlace =
  | { readonly inStack: true }
  | {
      readonly inStack: false;
      readonly onRemind: (item: InboxItem) => void;
      /** Selects another thread in the split view, such as one the box just started. */
      readonly onOpen: (id: string) => void;
    };

/**
 * A thread's page from its item: its path, its subject, each message with
 * its files as they are read, the open ask's card under them, and the box
 * at its foot that answers or replies, with Remind me and Resolve in its ⋯
 * menu. A compact window's pushed screen docks the box over the screen's
 * foot, above the keyboard, and holds the menu in the stack's bar; a split
 * view's detail stands both in its own column.
 *
 * Note that a split view's detail draws no Remind me sheet of its own, and
 * opens its screen's instead, because the column stacks whatever it is
 * handed one under the other, so a sheet beside the page would take half
 * the column's height.
 */
function ThreadDetail({
  listed,
  readerId,
  place,
}: {
  readonly listed: InboxListed;
  readonly readerId: string | undefined;
  readonly place: ThreadPlace;
}) {
  const colors = useColors();
  const { holder, item } = listed;
  const openLink = useOpenLink();
  const agentName = useAgentNames().get(item.agentId) ?? UNLISTED_AGENT;
  const harness = useAgentHarness(item.agentId);
  const pictureOf = useMemberPictures();

  const messages = useMemo(
    () => inboxThreadMessages(item, agentName, readerId),
    [item, agentName, readerId],
  );

  // Note that a file its words draw, or its open ask's options carry, is read beside the files drawn after them, since its bytes come the same way.
  const media = useMemo(
    () => [
      ...messages.flatMap((message) => [
        ...message.media,
        ...message.drawn.map(({ kind, attachmentId }) => ({
          kind,
          attachmentId,
          name: "",
          mediaType: "",
        })),
      ]),
      ...openAskFiles(item).map((file) => ({
        kind: isVideoType(file.mediaType) ? INBOX_MEDIA.VIDEO : INBOX_MEDIA.PICTURE,
        attachmentId: file.attachmentId,
        name: "",
        mediaType: file.mediaType,
      })),
    ],
    [messages, item],
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
  const workspaceStep = linkWorkspaceStep(workspaceId, workspaces);

  // A video the system's player cannot read opens with its thread on vespin.dev in Safari, which plays it.
  const openOnWeb = () => {
    const place = {
      kind: LINK_DESTINATION.INBOX_ITEM,
      planId: holder.task.id,
      itemId: item.id,
    } as const;

    openInSafari(linkOf(place, workspaceStep));
  };

  const { sources, sizes } = useThreadMedia(item.id, media);
  useReadOnOpen(listed);
  useScreenActivity((all) => threadActivity(listed, all));
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const onTab = useOnTab();

  // Whether this thread still stands, so a start that answers after the reader left it opens nothing over where they went.
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;

    return () => {
      shown.current = false;
    };
  }, []);

  const navigation = useNavigation();
  const inFront = useInFront();

  // Whether this thread stands in front now, read when a start answers rather than when it was sent, since the reader may have switched tabs meanwhile.
  const front = useRef(inFront);
  useEffect(() => {
    front.current = inFront;
  }, [inFront]);

  // A thread the box started opens in this one's place, as the panel opens it, while this one still stands in front: a stack's screen covered by another stays mounted, as a wide window's split view keeps each tab's thread drawn behind the one shown.
  const openStarted = (id: string) => {
    if (!shown.current || !navigation.isFocused() || !front.current) return;

    if (place.inStack) router.replace(onOwnTab(`/inbox/${encodeURIComponent(id)}`));
    else place.onOpen(id);
  };

  const answer = useThreadAnswer(listed, openStarted);
  const remind = useRemindSheet();
  const inboxActs = useInboxActs();
  const keeping = useKeeping();
  const inStack = place.inStack;
  const openRemind = place.inStack ? remind.open : place.onRemind;

  const doors = {
    onMark: (unread: boolean) => inboxActs.mark(item.id, unread),
    onRemind: () => openRemind(item),
    onCopyLink: () =>
      keeping.copyWords(
        linkOf(
          { kind: LINK_DESTINATION.INBOX_ITEM, planId: holder.task.id, itemId: item.id },
          workspaceStep,
        ),
      ),
  };

  const menu = threadMenu(item, answer, doors);
  // Note that a split view's detail bar stands the thread's main acts as glyphs, as Mail's stands Reply and Trash, and ⋯ keeps the rest; a compact window's stack keeps them all in ⋯.
  const acts = threadActs(item, answer, doors);

  // Note that the path opens its task and its agent as pages pushed over the thread, as the panel's crumbs open them; a compact window's stack names the path as its plain title, which can hold no menu, so there they lead the ⋯ menu instead.
  const pathActions = [
    {
      label: PATH_OPENS.TASK,
      symbol: GLYPH.TASK,
      onPress: () =>
        router.push(onTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, planId: holder.task.id }))),
    },
    {
      label: PATH_OPENS.AGENT,
      symbol: GLYPH.AGENT,
      onPress: () => router.push(onTab(iosAgentRoute(item.agentId))),
    },
  ] as const;

  const messageWords = useMemo(() => messages.map((message) => message.words), [messages]);

  const drawn: readonly ThreadMessage[] = messages.map((message) => ({
    ...message,
    writer: {
      ...message.writer,
      picture: message.writer.agent ? undefined : pictureOf(message.writer.userId),
      harness: message.writer.agent ? harness : undefined,
    },
    stamp:
      message.stamp === undefined
        ? undefined
        : { words: message.stamp.words, ahead: message.stamp.tone === ANSWER_TONE.AHEAD },
    media: message.media.map((each): ThreadMedia => {
      const source = sources.get(each.attachmentId);
      const key = each.attachmentId;

      if (each.kind === INBOX_MEDIA.VIDEO) {
        return {
          kind: THREAD_MEDIA.VIDEO,
          key,
          source,
          label: each.name,
          onOpenElsewhere: openOnWeb,
        };
      }

      if (each.kind === INBOX_MEDIA.FILE) {
        const size = sizes.get(key);

        return {
          kind: THREAD_MEDIA.FILE,
          key,
          source,
          name: each.name,
          mediaType: each.mediaType,
          size,
        };
      }

      return { kind: THREAD_MEDIA.PICTURE, key, source, alt: each.name };
    }),
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

  // A chip's pull request in the thread is read through its task's own workspace, as the panel's Inbox reads it.
  const linkStanding = useLinkStandings(
    messageWords,
    holder.task.repository,
    workspaces.find((each) => each.id === workspaceId),
  );

  const page = (
    <ThreadPage
      path={path}
      status={holder.task.status}
      pathActions={pathActions}
      title={cardTitle(item.title)}
      messages={drawn}
      repository={holder.task.repository}
      onOpenLink={openLink}
      pictureSource={pictureSource}
      videoAt={videoAt}
      linkStanding={linkStanding}
      standing={item.status === INBOX_STATUS.OPEN ? undefined : inboxSettledStanding(item)}
      ask={
        <OpenAskCard
          item={item}
          answer={answer}
          doors={{
            source: (attachmentId) => sources.get(attachmentId),
            openPage: (page) =>
              openLink(
                linkOf(
                  {
                    kind: LINK_DESTINATION.PAGE,
                    planId: page.place.taskId,
                    pageId: page.pageId,
                  },
                  workspaceStep,
                ),
              ),
            openLink,
            openVideoElsewhere: openOnWeb,
          }}
        />
      }
      {...(inStack
        ? {}
        : {
            acts,
            menu: menuWithout(menu, acts),
            foot: <ThreadComposer item={item} answer={answer} agentName={agentName} inColumn />,
          })}
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
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={glyphSymbol(menu.symbol)} accessibilityLabel={menu.label}>
          <Stack.Toolbar.Menu inline>
            {pathActions.map((action) => (
              <Stack.Toolbar.MenuAction
                key={action.label}
                icon={glyphSymbol(action.symbol)}
                onPress={action.onPress}
              >
                {action.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          {menu.actions.map((action) => (
            <Stack.Toolbar.MenuAction
              key={action.label}
              icon={glyphSymbol(action.symbol)}
              onPress={action.onPress}
            >
              {action.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <GlassDock bar={<ThreadComposer item={item} answer={answer} agentName={agentName} />}>
        <Screen>{page}</Screen>
      </GlassDock>
      {remind.sheet}
    </>
  );
}

/** What stands where a thread named by its id is not drawn: that it is still read, that it could not be, with Retry, or that no such thread is the account's to read. */
function ThreadNotDrawn({
  feed,
  onRetry,
}: {
  readonly feed: InboxFeed;
  readonly onRetry: () => void;
}) {
  if (feed === INBOX_FEED.READING)
    return <EmptyState title={READING_INBOX} symbol={GLYPH.INBOX} loading />;

  if (feed === INBOX_FEED.FAILED) {
    return (
      <EmptyState
        title={INBOX_NOT_READ}
        symbol={GLYPH.FAILED}
        action={{ label: RETRY, onPress: onRetry }}
      />
    );
  }

  return <EmptyState title={THREAD_NOT_FOUND} symbol={GLYPH.NOT_FOUND} />;
}

/**
 * A split view's detail: the thread the list selected, read by its id as a
 * pushed screen reads it, so a link to a thread of a workspace the list does
 * not show still opens it, and one still read, refused, or missing says so.
 */
function ThreadColumn({
  id,
  onRemind,
  onOpen,
}: {
  readonly id: string;
  readonly onRemind: (item: InboxItem) => void;
  readonly onOpen: (id: string) => void;
}) {
  const { listed, readerId, feed, retry } = useInboxThread(id);

  if (listed === undefined) return <ThreadNotDrawn feed={feed} onRetry={retry} />;

  return (
    <ThreadDetail
      listed={listed}
      readerId={readerId}
      place={{ inStack: false, onRemind, onOpen }}
    />
  );
}

/** The list's search words and how to change them, held by the tab's root screen above its two layouts. */
type InboxSearch = { readonly search: string; readonly setSearch: (search: string) => void };

/** What the list screens share: the scope and its pills, the search, the listing under both, and the acts on it. */
function useInboxScreen({ search, setSearch }: InboxSearch, chosen?: string | undefined) {
  const { show, choose } = useInboxScope();
  const listing = useInboxListing({ show, search, chosen });
  const acts = useInboxActs();
  const scopes = scopePills(show, choose, listing.counts);
  const remind = useRemindSheet();
  const selecting = useInboxChoosing();

  const menu = moreMenu(listing.unread, acts.markAll, {
    listed: listing.listed.length > 0,
    onSelect: selecting.start,
  });

  // Note that only the threads still listed stand chosen, so a thread a scope, a search, or the service took away is never acted on unseen.
  const picked = selecting.choosing.on ? selecting.choosing.chosen : [];

  const pickedItems = listing.listed
    .filter(({ item }) => picked.includes(item.id))
    .map(({ item }) => item);

  const choosing = selecting.choosing.on
    ? {
        rows: {
          chosen: pickedItems.map((item) => item.id),
          onChoose: selecting.choose,
        } satisfies RowChoosing,
        title:
          pickedItems.length === 0 ? SELECTION_WORDS.SELECT : selectedWords(pickedItems.length),
        acts: chosenActs(pickedItems, acts, remind, selecting.stop),
        done: { label: SELECT_DONE, onPress: selecting.stop } satisfies BarAction,
      }
    : undefined;

  return { show, search, setSearch, listing, acts, scopes, menu, remind, choosing };
}

// A compact window: the list under its scopes' segmented control, the account's photo
// opening Settings and the workspace switcher beside it at the bar's leading
// edge, and its search and its ⋯ menu as round
// glass buttons at its trailing one, each row pushing its thread as the Stack's
// next screen.
function InboxStackList(words: InboxSearch) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const switcher = useWorkspaceSwitcher();

  const { show, search, setSearch, listing, acts, scopes, menu, remind, choosing } =
    useInboxScreen(words);

  const field = useRefilledSearchField(search);

  // Note that Select mode names how many are chosen in the title's place, stands Done where ⋯ stood, and its acts in a bar at the foot, the tab bar stepping aside for it (`useInboxChoosingOn`), as Photos does.
  return (
    <>
      <Stack.Screen options={{ title: choosing?.title ?? INBOX_TITLE }}>
        {choosing !== undefined ? null : (
          <Stack.SearchBar
            ref={field}
            placeholder={SEARCH_INBOX}
            placement="integratedButton"
            allowToolbarIntegration={false}
            onChangeText={(event) => setSearch(event.nativeEvent.text)}
            onCancelButtonPress={() => setSearch("")}
          />
        )}
      </Stack.Screen>
      {choosing !== undefined ? null : <SettingsBarButton switcher={switcher} />}
      <Stack.Toolbar placement="right">
        {choosing !== undefined ? (
          <Stack.Toolbar.Button variant="done" onPress={choosing.done.onPress}>
            {choosing.done.label}
          </Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Menu icon={glyphSymbol(menu.symbol)} accessibilityLabel={menu.label}>
            {menu.actions.map((action) => (
              <Stack.Toolbar.MenuAction
                key={action.label}
                icon={glyphSymbol(action.symbol)}
                disabled={action.disabled === true}
                onPress={action.onPress}
              >
                {action.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        )}
      </Stack.Toolbar>
      {choosing === undefined ? null : (
        <Stack.Toolbar placement="bottom">
          {choosing.acts.flatMap((act, at) => [
            ...(at === 0 ? [] : [<Stack.Toolbar.Spacer key={at} />]),
            // Note that a glyph is named as an asset rather than a symbol, because the bottom bar loads `icon` as an SF Symbol alone, which drew our Lucide glyphs as empty glass.
            <Stack.Toolbar.Button
              key={act.label}
              accessibilityLabel={act.label}
              onPress={act.onPress}
            >
              {act.symbol === undefined ? null : (
                <Stack.Toolbar.Icon xcasset={act.symbol} renderingMode="template" />
              )}
            </Stack.Toolbar.Button>,
          ])}
        </Stack.Toolbar>
      )}
      <Screen>
        <ScopePicker label={SCOPE_LABEL} scopes={scopes}>
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
              onSelect={(id) =>
                router.push(
                  onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId: id })),
                )
              }
              onRefresh={acts.refresh}
              onMark={acts.mark}
              onRemind={remind.open}
              onResolve={acts.resolve}
              choosing={choosing?.rows}
            />
          )}
        </ScopePicker>
      </Screen>
      {remind.sheet}
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the list
// under its scopes' menu picker, since the column cuts segments short, with
// its search and ⋯ menu in its bar and the selected thread beside it. Where
// the window is wide enough for three columns, the two are handed to the
// tabs' one split view, which stands them beside the app sidebar, as Mail
// stands its mailboxes, a mailbox's mail, and a message, and this root draws
// nothing of its own under it; otherwise the root stands its own split view.
// The Stack's header steps aside, since the split view draws each column's
// navigation bar itself.
function InboxSplitScreen({
  selected,
  select,
  words,
}: {
  readonly selected: string | undefined;
  readonly select: (id: string) => void;
  readonly words: InboxSearch;
}) {
  const { show, search, setSearch, listing, acts, scopes, menu, remind, choosing } = useInboxScreen(
    words,
    selected,
  );

  const threeColumns = useThreeColumns();
  const look = useListLook();
  useSurfaceOpen(selected === undefined ? undefined : PRODUCT_SURFACE.THREAD, selected);

  const rows =
    listing.listed.length === 0 ? (
      <InboxEmpty
        show={show}
        search={search}
        feed={listing.feed}
        onRetry={() => void acts.refresh()}
      />
    ) : (
      <InboxRows
        look={look}
        listed={listing.listed}
        readerId={listing.readerId}
        selected={selected}
        onSelect={select}
        onRefresh={acts.refresh}
        onMark={acts.mark}
        onRemind={remind.open}
        onResolve={acts.resolve}
        choosing={choosing?.rows}
      />
    );

  // Note that beside the app sidebar the scopes leave the list for Mail's filter button in its bar, so the list starts at its first thread; a two-column window keeps the menu picker over the list.
  const list = {
    view: threeColumns ? (
      rows
    ) : (
      <ScopePicker label={SCOPE_LABEL} scopes={scopes} look={SCOPE_LOOK.MENU}>
        {rows}
      </ScopePicker>
    ),
    // Note that Select mode names how many are chosen in the column's title, stands Done where ⋯ stood, and its acts in the column's own bar at its foot.
    bar:
      choosing === undefined
        ? {
            title: INBOX_TITLE,
            filter: threeColumns ? scopeMenu(SCOPE_LABEL, scopes) : undefined,
            menu,
            search: { placeholder: SEARCH_INBOX, text: search, onChange: setSearch },
          }
        : { title: choosing.title, action: choosing.done, foot: choosing.acts },
  };

  const detail =
    selected === undefined ? (
      <EmptyState title={CHOOSE_AN_ITEM_WORDS} symbol={GLYPH.INBOX} />
    ) : (
      <ThreadColumn key={selected} id={selected} onRemind={remind.open} onOpen={select} />
    );

  // Note that with no thread picked the detail's bar keeps the thread's acts, dimmed, as Mail's bar stands over No Message Selected; a picked thread's page stands its own.
  const detailBar = selected === undefined ? { acts: NO_THREAD_ACTS } : undefined;

  const first = useListColumn(list);
  useHandColumns(
    SIDEBAR_PLACE.INBOX,
    threeColumns ? { content: list.view, contentBar: list.bar, detail, detailBar } : undefined,
  );

  return (
    <>
      <Stack.Screen options={threeColumns ? UNDER_SPLIT_SCREEN : { headerShown: false }} />
      {threeColumns ? null : (
        <Screen>
          <SplitView {...first} detail={detail} detailBar={detailBar} />
        </Screen>
      )}
      {remind.sheet}
    </>
  );
}

/** The Inbox tab's root screen: its list, laid out by the window's size class, its search held here so a rotation or a fold keeps it. */
export function InboxListScreen() {
  const sizeClass = useWindowSizeClass();
  const { selected, select } = useSplitSelection(SPLIT_TAB.INBOX);
  const [search, setSearch] = useState("");
  useSurfaceOpen(PRODUCT_SURFACE.INBOX);

  return sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
    <InboxSplitScreen selected={selected} select={select} words={{ search, setSearch }} />
  ) : (
    <InboxStackList search={search} setSearch={setSearch} />
  );
}

/** The Inbox's pushed screen: one thread, named by the route's `id`, its path small in the bar over its heading. */
export function InboxThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listed, readerId, feed, retry } = useInboxThread(id);
  const handed = useHandToSplit(SPLIT_TAB.INBOX, id);
  useSurfaceOpen(handed ? undefined : PRODUCT_SURFACE.THREAD, id);

  if (handed) return null;

  return (
    <>
      <Stack.Screen
        options={{ headerBackTitle: INBOX_TITLE, ...(listed === undefined && { title: "" }) }}
      />
      {listed !== undefined ? (
        <ThreadDetail listed={listed} readerId={readerId} place={{ inStack: true }} />
      ) : (
        <Screen>
          <ThreadNotDrawn feed={feed} onRetry={retry} />
        </Screen>
      )}
    </>
  );
}
