// inbox-screens.tsx -- the Inbox's list and its thread: the Stack's two screens in a compact window, one split view in a regular one.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { isAudioType, isVideoType } from "@repo/features/conversation-picture-wire";
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
  inboxScopeInstead,
  inboxSettledStanding,
  inboxThreadEventsShown,
  inboxThreadMessages,
  isDone,
  isUnread,
  MARK_ALL_READ,
  READING_INBOX,
  SEARCH_INBOX,
} from "@repo/features/inbox-list-model";
import {
  filesLost,
  UNDELIVERED_FILES_LOST,
  type UndeliveredReply,
} from "@repo/features/inbox-undelivered";
import { INBOX_STATUS, type InboxItem, inboxWaitsOn } from "@repo/features/inbox-wire";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { threadActivity } from "@repo/features/ios-system-activity";
import { LINK_DESTINATION, linkOf, linkWorkspaceStep } from "@repo/features/link-grammar";
import { agentName as agentNameOf, providerOf } from "@repo/features/model-label";
import type { ModelProvider } from "@repo/features/models-wire";
import { cardTitle } from "@repo/features/plain-words";
import type { TaskSummary } from "@repo/features/task-wire";
import {
  CHOOSE_AN_ITEM_WORDS,
  NO_RESULTS_HINT,
  noResultsForWords,
  PATH_OPENS,
  SELECTION_WORDS,
  selectedWords,
} from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { INBOX_FEED, type InboxFeed, selectWorkspaces } from "@repo/host/app-state-reads";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  BAR_TITLE,
  type BarAction,
  type BarFootItem,
  type BarMenu,
  BUTTON_LOOK,
  EmptyState,
  GLYPH,
  GlassDock,
  glyphSymbol,
  isBarMenu,
  LIST_LOOK,
  type ListLook,
  ListRow,
  type ListScopes,
  type MarkdownVideo,
  menuWithout,
  NoSelection,
  PATH_PART,
  previewMessages,
  ROW_ACTION_TONE,
  type RowChoosing,
  RowForEach,
  RowList,
  type RowSubmenu,
  type Scope,
  Screen,
  SplitView,
  THREAD_MEDIA,
  type ThreadMedia,
  type ThreadMessage,
  ThreadPage,
  ThreadPreview,
  type ThreadUndelivered,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppReadyCount } from "../app-ready.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useTaskListCollections, useTaskListRow } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useInboxChoosing } from "../inbox/inbox-choosing.js";
import {
  useInboxActs,
  useInboxListing,
  useInboxScope,
  useInboxThread,
  useReadOnOpen,
  useStandFrontSteps,
  useThreadMedia,
} from "../inbox/use-inbox.js";
import {
  pendingThreadFile,
  type ThreadAnswer,
  useThreadAnswer,
  useUndeliveredShown,
} from "../inbox/use-thread-answer.js";
import { useKeeping } from "../keeping.js";
import { type PictureOf, useMemberFaces, useMemberPictures } from "../member-pictures.js";
import { NotificationAsk } from "../notification-ask.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useReplyDrawnCount } from "../reply-drawn.js";
import { useHeldSearchPlacement, useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { SPLIT_TAB, useHandToSplit, useSplitSelection } from "../split-route.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab } from "../tab-route.js";
import { useLinkStandings } from "../tasks/use-link-standings.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import {
  PLUS_TAB,
  useComposeAction,
  useDetailColumnBar,
  useListColumn,
  useSplitBuild,
} from "./app-sidebar.js";
import {
  NO_THREAD_ACTS,
  OpenAskCard,
  openAskFiles,
  ThreadComposer,
  threadActs,
  threadMenu,
} from "./inbox-ask.js";
import { useRemind } from "./inbox-remind.js";

/** The Inbox's name, at its head and on its back button. */
const INBOX_TITLE = "Inbox";

/** The act under a read that failed, as the app's other failures say it, rather than the panel's Retry. */
const TRY_AGAIN = "Try again";

/** What a pushed thread's screen says where the feed, once read, holds no such thread, such as one a link names that was deleted. */
const THREAD_NOT_FOUND = "This thread isn't in your inbox";

/** What the scopes' control is heard as by VoiceOver, before the scope chosen. */
const SCOPE_LABEL = "Filter";

/** The scopes whose pill carries its count, the two that say how much waits. */
const COUNTED_SCOPES: ReadonlySet<InboxShow> = new Set([INBOX_SHOW.NEEDS_ME, INBOX_SHOW.OPEN]);

/** The bar's menu of the Inbox's other acts, a round glass ⋯ as iOS draws a toolbar's menu. */
const MORE = { label: "More", symbol: GLYPH.MORE } as const;

/** What ends Select mode, as the system's own Done does. */
const SELECT_DONE = "Done";

/** What a dimmed bar act does when pressed, which the system never lets happen. */
const doNothing = (): void => undefined;

/** What a video or a sound clip the words draw in place is heard as, where the words give it no alt. */
const PLAYED_LABEL = {
  [INBOX_MEDIA.VIDEO]: "Video",
  [INBOX_MEDIA.AUDIO]: "Sound clip",
} as const;

/** The panel's pager words, said by VoiceOver for an open thread's arrows. */
const STEP_WORDS = {
  PREVIOUS: APP_SHORTCUTS[APP_COMMAND.PREVIOUS_INBOX_ITEM].label,
  NEXT: APP_SHORTCUTS[APP_COMMAND.NEXT_INBOX_ITEM].label,
} as const;

/**
 * The order of rows handed to a thread about to open, by its id: the compact
 * list's rows as they stood when one was opened, its scope and its search
 * among them, or the order an arrow stepped from, so an open thread's arrows
 * step through what the reader was looking at, as the panel's K and J step
 * through the list held on screen. Note that each thread takes its own order
 * as it opens and keeps it, so a thread opened over another, such as from a
 * link in it, never moves the one under it; a thread handed none, such as one
 * a notification opened, steps through the kept scope's live rows instead.
 */
const handedOrders = new Map<string, readonly string[]>();

/** What an agent is called where the task list does not hold it, as the panel's tab names one it cannot find. */
const UNLISTED_AGENT = "Agent";

/** How many of a thread's newest messages its row reads for its preview: more than the preview draws, since a file sent alone says nothing there. */
const PREVIEW_TAIL = 6;

/** How an open ask's option file is read beside the thread's own: a recording, a sound clip, or a picture. */
function askFileKind(mediaType: string) {
  if (isVideoType(mediaType)) return INBOX_MEDIA.VIDEO;

  return isAudioType(mediaType) ? INBOX_MEDIA.AUDIO : INBOX_MEDIA.PICTURE;
}

type InboxRowsProps = {
  readonly look: ListLook;
  readonly listed: readonly InboxListed[];
  readonly readerId: string | undefined;
  readonly selected?: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onMark: (item: InboxItem, unread: boolean) => void;
  readonly remindMenu: (item: InboxItem) => RowSubmenu;
  readonly onResolve: (item: InboxItem) => void;
  /** The list's Select mode, while it stands in one. */
  readonly choosing?: RowChoosing | undefined;
  /** The Inbox's scopes, standing as the list's first row. */
  readonly scopes?: ListScopes | undefined;
  /** What stands over the list while it lists no thread: why, and the way on. */
  readonly empty?: ReactNode | undefined;
  /** Starts Select mode with the threads the system ticked at once, such as by a two-finger drag. */
  readonly onChooseStart: (ids: readonly string[]) => void;
};

/**
 * The Inbox's rows, each as the panel's row: the task's ring and name, the
 * thread's title, and the line of what it asks led by its glyph, with the
 * teammate it waits on before the time, or when its reminder comes back in
 * the time's place; a swipe from the leading edge marks it read or unread, a
 * swipe from the trailing edge resolves it or opens Remind me's times, and a long
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
  remindMenu,
  onResolve,
  choosing,
  scopes,
  empty,
  onChooseStart,
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
      lead={<NotificationAsk />}
      scopes={scopes}
      empty={empty}
      onChooseStart={onChooseStart}
    >
      <InboxItemRows
        listed={listed}
        readerId={readerId}
        pictureOf={pictureOf}
        onMark={onMark}
        remindMenu={remindMenu}
        onResolve={onResolve}
      />
    </RowList>
  );
}

/**
 * The thread a row draws: its item, and of the task holding it only what the
 * row says (its id and workspace for the link, its name and status for the
 * line above the title). Note that the row takes them one by one rather than
 * the task, because a task read or moved anew, such as by the read an opened
 * task sends, is a new object, which drew every row of the task again for
 * words that stood as they were.
 */
type InboxRowThread = {
  readonly item: InboxItem;
  readonly taskId: string;
  readonly workspaceId: TaskSummary["workspaceId"];
  readonly taskName: string;
  readonly taskStatus: TaskSummary["status"];
};

type InboxRowActs = {
  readonly readerId: string | undefined;
  /** Each member's picture by their id, read once by the list the row stands in. */
  readonly pictureOf: PictureOf;
  readonly onMark: (item: InboxItem, unread: boolean) => void;
  /** Remind me's times on the thread, a menu a swipe from the trailing edge opens. */
  readonly remindMenu: (item: InboxItem) => RowSubmenu;
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
      {({ holder: { task }, item }) => (
        <InboxRow
          item={item}
          taskId={task.id}
          workspaceId={task.workspaceId}
          taskName={task.name}
          taskStatus={task.status}
          {...acts}
        />
      )}
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
function InboxRowView({
  item,
  taskId,
  workspaceId,
  taskName,
  taskStatus,
  readerId,
  pictureOf,
  onMark,
  remindMenu,
  onResolve,
}: InboxRowActs & InboxRowThread) {
  // Note that the row reads neither the minute nor the day: its time moves on inside `ListRow`, and Remind me's menu, handed in, moves on as the day turns (`useRemind`).
  const unread = isUnread(item);
  const waitsOn = inboxWaitsOn(item);
  const { name: agentName, harness } = useAgentLabel(item.agentId);
  const title = cardTitle(item.title);
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspaceStep = linkWorkspaceStep(workspaceId, workspaces);
  const keeping = useKeeping();

  const link = linkOf(
    { kind: LINK_DESTINATION.INBOX_ITEM, taskId, itemId: item.id },
    workspaceStep,
  );

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
            tone: ROW_ACTION_TONE.DONE,
            onPress: () => onResolve(item),
          } as const,
        ]
      : [];

  const mark = {
    label: unread ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
    symbol: unread ? GLYPH.MARK_READ : GLYPH.MARK_UNREAD,
    tone: ROW_ACTION_TONE.READ,
    onPress: () => onMark(item, !unread),
  } as const;

  return (
    <ListRow
      id={item.id}
      title={title}
      task={{
        name: taskName,
        status: taskStatus,
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
      trailingActions={[...resolve, remindMenu(item)]}
      leadingActions={[mark]}
      link={link}
      // Note that the long press holds the panel's row menu in its order (`useInboxItemActions`): Copy link, then Mark as read or unread, Remind me and Resolve, its swipes standing behind the swipe alone.
      menu={[
        [
          {
            label: APP_SHORTCUTS[APP_COMMAND.COPY_LINK].label,
            symbol: GLYPH.LINK,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => keeping.copyWords(link),
          },
        ],
        [mark, remindMenu(item), ...resolve],
      ]}
      preview={
        <ThreadPreview
          title={title}
          task={{ name: taskName, status: taskStatus }}
          messages={messages}
        />
      }
    />
  );
}

// Note that a row's props keep their identity while its thread stands, because
// a delivery to the Inbox otherwise draws every row again and holds the JS thread.
const InboxRow = memo(InboxRowView);

/**
 * What the list stands where it lists nothing: that the account's feed is
 * still on its first read, or could not be read, with Try again, rather than an
 * empty Inbox over threads not yet read; else nothing its search found, or
 * nothing its scope holds, with the press to the scope that holds something
 * (`inboxScopeInstead`), as the panel's empty Inbox offers it, so an empty
 * scope is never a dead end.
 */
function InboxEmpty({
  show,
  search,
  feed,
  counts,
  onRetry,
  onShow,
}: {
  readonly show: InboxShow;
  readonly search: string;
  readonly feed: InboxFeed;
  readonly counts: InboxCounts;
  readonly onRetry: () => void;
  readonly onShow: (show: InboxShow) => void;
}) {
  if (feed === INBOX_FEED.READING)
    return <EmptyState title={READING_INBOX} symbol={GLYPH.INBOX} loading />;

  if (feed === INBOX_FEED.FAILED) {
    return (
      <EmptyState
        title={INBOX_NOT_READ}
        symbol={GLYPH.FAILED}
        action={{ label: TRY_AGAIN, onPress: onRetry, look: BUTTON_LOOK.BORDERED }}
      />
    );
  }

  if (search.trim() !== "") {
    return (
      <EmptyState
        title={noResultsForWords(search)}
        symbol={GLYPH.SEARCH}
        description={NO_RESULTS_HINT}
      />
    );
  }

  const instead = inboxScopeInstead(show, counts);

  return (
    <EmptyState
      title={INBOX_SHOW_EMPTY[INBOX_WHOSE.MINE][show]}
      symbol={GLYPH.INBOX}
      action={
        instead === undefined
          ? undefined
          : {
              label: instead.label,
              onPress: () => onShow(instead.show),
              look: BUTTON_LOOK.BORDERED,
            }
      }
    />
  );
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

/** The scopes as the ⋯ menu's checked choices, each worded with its count as its pill was, the one shown checked, as Mail's menu checks its filter. */
function scopeChoices(scopes: readonly Scope[]): BarMenu["choices"] {
  return scopes.map((scope) => ({
    id: scope.label,
    label: scope.count === undefined ? scope.label : `${scope.label} ${scope.count}`,
    on: scope.selected,
    onPress: scope.onPress,
  }));
}

/** The Inbox's ⋯ menu: its scopes, the one shown checked, then Select, which turns the list to Select mode as Mail's menu does, and Mark all as read. */
function moreMenu(
  scopes: readonly Scope[],
  listed: readonly InboxListed[],
  markAll: (items: readonly InboxItem[]) => void,
  select: { readonly listed: boolean; readonly onSelect: () => void },
): BarMenu {
  return {
    ...MORE,
    choices: scopeChoices(scopes),
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
        disabled: !listed.some(({ item }) => isUnread(item)),
        onPress: () => markAll(listed.map(({ item }) => item)),
      },
    ],
  };
}

/** A menu standing dimmed while `dim` holds, so a bar keeps its place for it and VoiceOver hears it as dimmed, as Mail's edit bar stands Remind me until a message is chosen. */
function dimmedWhile(dim: boolean, menu: BarMenu): BarMenu {
  return dim ? { ...menu, disabled: true } : menu;
}

/**
 * What the Inbox offers for the threads chosen in Select mode, as the panel's
 * selection does (`inbox-selection.tsx`): Mark as read while one is unread,
 * else Mark as unread; Remind me, its time set on every one; and Resolve
 * while one is open, each taking only the threads it would change. Each act
 * lets Select mode go, as Mail's do. Note that every act keeps its place,
 * dimmed while it would change nothing, as Mail's edit bar stands its acts
 * dimmed until a message is chosen, so the bar never pops in on the first
 * tick nor shifts as Resolve comes and goes.
 */
function chosenActs(
  chosen: readonly InboxItem[],
  acts: ReturnType<typeof useInboxActs>,
  remind: ReturnType<typeof useRemind>,
  stop: () => void,
): readonly BarFootItem[] {
  const none = chosen.length === 0;
  const unread = chosen.filter(isUnread);
  const open = chosen.filter((item) => item.status === INBOX_STATUS.OPEN);
  const marking = unread.length > 0 ? unread : chosen;

  return [
    {
      label: unread.length > 0 || none ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
      symbol: unread.length > 0 || none ? GLYPH.MARK_READ : GLYPH.MARK_UNREAD,
      disabled: none,
      onPress: () => {
        if (none) return;
        acts.markMany(marking, unread.length === 0);
        stop();
      },
    },
    dimmedWhile(none, remind.menu(chosen, stop)),
    {
      label: RESOLVE,
      symbol: GLYPH.RESOLVED,
      disabled: open.length === 0,
      onPress: () => {
        if (open.length === 0) return;
        acts.resolveMany(open);
        stop();
      },
    },
  ];
}

/**
 * A menu's acts as the stack bar's own menu items, each with what it says
 * under its words, such as when a reminder's time comes due, dimmed or red
 * as the act asks. Note that it's
 * a function of elements rather than a component, because the bar's menu
 * takes only its own items as children.
 */
function toolbarMenuActions(menu: BarMenu) {
  const actions = menu.actions.map((action) => (
    <Stack.Toolbar.MenuAction
      key={action.label}
      {...(action.symbol === undefined ? {} : { icon: glyphSymbol(action.symbol) })}
      {...(action.detail === undefined ? {} : { subtitle: action.detail })}
      disabled={action.disabled === true}
      destructive={action.destructive === true}
      onPress={action.onPress}
    >
      {action.label}
    </Stack.Toolbar.MenuAction>
  ));

  if (menu.choices.length === 0) return actions;

  // Note that the choices stand as one inline section over the acts, each checked as the system checks a menu's picked item, as Mail's filter menu stands its choices over its other acts.
  return [
    <Stack.Toolbar.Menu key={SCOPE_LABEL} inline>
      {menu.choices.map((choice) => (
        <Stack.Toolbar.MenuAction
          key={choice.id ?? choice.label}
          isOn={choice.on}
          onPress={choice.onPress}
        >
          {choice.label}
        </Stack.Toolbar.MenuAction>
      ))}
    </Stack.Toolbar.Menu>,
    ...actions,
  ];
}

/** The name an agent is called by, as the panel names it, and the harness its model runs in, whose mark its tile wears, as the task list's collections hold it; the unlisted name and no harness before the agent is listed. */
function useAgentLabel(agentId: string): {
  readonly name: string;
  readonly harness: ModelProvider | undefined;
} {
  const agent = useTaskListRow(useTaskListCollections().agents, agentId);

  return agent === undefined
    ? { name: UNLISTED_AGENT, harness: undefined }
    : { name: agentNameOf(agent), harness: providerOf(agent.model) };
}

/** The threads either side of an open one, in the order it steps through, which it hands on with each step; none at an end. */
type ThreadSteps = {
  readonly order: readonly string[];
  readonly previous?: string | undefined;
  readonly next?: string | undefined;
};

/**
 * Where a thread stands: a compact window's pushed screen, whose stack's bar
 * names the thread and holds the path in its ⋯ menu, and which draws its own
 * Remind me sheet, or a split view's detail, which opens the sheet its screen
 * draws outside the split view.
 */
type ThreadPlace =
  | { readonly inStack: true; readonly steps: ThreadSteps }
  | {
      readonly inStack: false;
      /** Remind me's times on a thread, from its screen, which draws the picker sheet outside the split view. */
      readonly remindMenu: (item: InboxItem) => BarMenu;
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
 * Note that a split view's detail draws no Remind me picker of its own, and
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
  // Note that a pull request a thread names opens in the app by its task's workspace.
  const openLink = useOpenLink(holder.task.workspaceId);
  const { name: agentName, harness } = useAgentLabel(item.agentId);
  const pictureOf = useMemberPictures();

  // Note that the reader's replies that did not go stand at the thread's foot as their own messages, marked Not delivered, as the panel keeps them.
  const undelivered = useUndeliveredShown(item);

  const messages = useMemo(
    () => inboxThreadMessages(undelivered.item, agentName, readerId),
    [undelivered.item, agentName, readerId],
  );

  const hostActs = useHostActs();

  // Note that the closers are named from the thread's own workspace's members, followed here, since a link may open a thread outside the workspace the phone works in.
  useLiveFollow(holder.task.workspaceId, (id) =>
    hostActs[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId: id }),
  );

  const memberFace = useMemberFaces(holder.task.workspaceId);

  // What happened to the thread, its members named as the thread's own workspace names them, since a link may open a thread of another workspace than the one chosen.
  const events = useMemo(
    () =>
      inboxThreadEventsShown(item, {
        agentName,
        readerId,
        memberName: (userId) => memberFace(userId)?.name,
      }),
    [item, agentName, readerId, memberFace],
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
        kind: askFileKind(file.mediaType),
        attachmentId: file.attachmentId,
        name: "",
        mediaType: file.mediaType,
      })),
    ],
    [messages, item],
  );

  // The videos and sound clips the words draw in place, by attachment, with which each is.
  const drawnPlayed = useMemo(
    () =>
      new Map(
        messages.flatMap((message) =>
          message.drawn.flatMap(({ kind, attachmentId }) =>
            kind === INBOX_MEDIA.VIDEO || kind === INBOX_MEDIA.AUDIO
              ? [[attachmentId, kind] as const]
              : [],
          ),
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
      taskId: holder.task.id,
      itemId: item.id,
    } as const;

    openInSafari(linkOf(place, workspaceStep));
  };

  // Note that a reply's files sent from the phone are drawn from their own bytes until the read carries it and after, so a sent photo never waits on a read of itself.
  const pending = useCallback(
    (itemId: string, attachmentId: string) => pendingThreadFile(itemId, attachmentId, item.thread),
    [item.thread],
  );

  const { sources, sizes, pictureSizes, retry } = useThreadMedia(item.id, media, pending);
  useReplyDrawnCount(item.thread);
  useReadOnOpen(listed);
  useScreenActivity((all) => threadActivity(listed, all));
  const router = useRouter();
  const onOwnTab = useOnOwnTab();

  // Whether this thread still stands, so a start that answers after the reader left it opens nothing over where they went.
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;

    return () => {
      shown.current = false;
    };
  }, []);

  const navigation = useNavigation();

  // A thread the box started opens in this one's place only while this one is in front when the start answers, since the reader may have switched tabs or pushed a page over it meanwhile, and a covered screen stays mounted.
  const openStarted = (id: string) => {
    if (!shown.current || !navigation.isFocused()) return;

    if (place.inStack) router.replace(onOwnTab(`/inbox/${encodeURIComponent(id)}`));
    else place.onOpen(id);
  };

  // An arrow opens the thread above or below in this one's place, as Mail's message arrows do, so Back still lands on the list.
  const stepTo = (id: string | undefined) => {
    if (id === undefined || !place.inStack) return;
    handedOrders.set(id, place.steps.order);
    router.replace(onOwnTab(`/inbox/${encodeURIComponent(id)}`));
  };

  // Note that a pushed thread stands its arrows' steps for the iPad's K and J while it's the screen in front; a split view's list stands its own (`InboxSplitScreen`).
  const focused = useIsFocused();
  useStandFrontSteps(place.inStack ? place.steps : {}, stepTo, place.inStack && focused);

  const answer = useThreadAnswer(listed, readerId, openStarted);
  const remind = useRemind();
  const inboxActs = useInboxActs();
  const keeping = useKeeping();
  const inStack = place.inStack;
  const remindMenu = place.inStack ? remind.itemMenu : place.remindMenu;

  const doors = {
    onMark: (unread: boolean) => inboxActs.mark(item, unread),
    remind: remindMenu(item),
    onCopyLink: () =>
      keeping.copyWords(
        linkOf(
          { kind: LINK_DESTINATION.INBOX_ITEM, taskId: holder.task.id, itemId: item.id },
          workspaceStep,
        ),
      ),
  };

  const menu = threadMenu(item, answer, doors);
  // Note that a split view's detail bar stands the thread's main acts as glyphs, as Mail's stands Reply and Trash, and ⋯ keeps the rest; a compact window's stack keeps them all in ⋯.
  const acts = threadActs(item, answer, doors);

  // Note that the path opens its task and its agent as pages pushed over the thread on the stack it stands on, in any window, as the panel's crumbs open them, where the window stands a split view, the path heading the page over its title; a compact window's stack names the thread as its title, which can hold no menu, so there they lead the ⋯ menu instead, headed by the path.
  const pathActions = [
    {
      label: PATH_OPENS.TASK,
      symbol: GLYPH.TASK,
      onPress: () =>
        router.push(
          onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId: holder.task.id })),
        ),
    },
    {
      label: PATH_OPENS.AGENT,
      symbol: GLYPH.AGENT,
      onPress: () => router.push(onOwnTab(iosAgentRoute(item.agentId))),
    },
  ] as const;

  const messageWords = useMemo(() => messages.map((message) => message.words), [messages]);

  const undeliveredLines = new Map(undelivered.lines.map((line) => [line.key, line]));

  const drawn: readonly ThreadMessage[] = messages.map((message, index) => ({
    ...message,
    after: events.get(index),
    undelivered: undeliveredOf(undeliveredLines.get(message.id), answer),
    writer: {
      ...message.writer,
      id: message.writer.agent ? undefined : message.writer.userId,
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
      const onRetry = () => retry(key);

      if (each.kind === INBOX_MEDIA.VIDEO) {
        return {
          kind: THREAD_MEDIA.VIDEO,
          key,
          source,
          label: each.name,
          onOpenElsewhere: openOnWeb,
          onRetry,
        };
      }

      if (each.kind === INBOX_MEDIA.AUDIO) {
        return { kind: THREAD_MEDIA.AUDIO, key, source, label: each.name, onRetry };
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
          onRetry,
        };
      }

      return {
        kind: THREAD_MEDIA.PICTURE,
        key,
        source,
        alt: each.name,
        size: pictureSizes.get(key),
        onRetry,
      };
    }),
  }));

  // Note that a picture the words name by one of the thread's own files is drawn from its bytes as read, and any other from the address it names.
  const pictureSource = (written: string): string | null | undefined => {
    const named = inboxAttachmentOf(inboxPictureDestination(written));

    return named === undefined || named.itemId !== item.id
      ? written
      : sources.get(named.attachmentId);
  };

  // A picture the words name by one of the thread's own files is read again by its file; any other is drawn from its address and never fails a read of ours.
  const retryPicture = (written: string) => {
    const named = inboxAttachmentOf(inboxPictureDestination(written));

    if (named !== undefined && named.itemId === item.id) retry(named.attachmentId);
  };

  // A video or a sound clip the words name as a picture is played where they name it, from its bytes as read.
  const videoAt = (written: string): MarkdownVideo | undefined => {
    const named = inboxAttachmentOf(inboxPictureDestination(written));
    const kind = named?.itemId === item.id ? drawnPlayed.get(named.attachmentId) : undefined;

    if (named === undefined || kind === undefined) return undefined;

    return {
      source: sources.get(named.attachmentId),
      label: PLAYED_LABEL[kind],
      audio: kind === INBOX_MEDIA.AUDIO,
      onOpenElsewhere: openOnWeb,
      onRetry: () => retry(named.attachmentId),
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
      opening={events.get(-1)}
      repository={holder.task.repository}
      onOpenLink={openLink}
      pictureSource={pictureSource}
      onRetryPicture={retryPicture}
      videoAt={videoAt}
      linkStanding={linkStanding}
      standing={item.status === INBOX_STATUS.OPEN ? undefined : inboxSettledStanding(item)}
      ask={
        <OpenAskCard
          item={item}
          answer={answer}
          doors={{
            source: (attachmentId) => sources.get(attachmentId),
            retry,
            openPage: (page) =>
              openLink(
                linkOf(
                  {
                    kind: LINK_DESTINATION.PAGE,
                    taskId: page.place.taskId,
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
            pathInHead: true,
            acts,
            menu: menuWithout(menu, acts),
            foot: <ThreadComposer item={item} answer={answer} agentName={agentName} inColumn />,
          })}
    />
  );

  if (!inStack) return page;

  return (
    <>
      {/* Note that the stack's bar names the thread in the ink, as Messages names a conversation and the agent page names its agent, since the thread opens at its newest message with its heading out of sight; its path leads the ⋯ menu. */}
      <Stack.Screen
        options={{
          title: cardTitle(item.title),
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <Stack.Toolbar placement="right">
        {/* Note that the arrows and ⋯ stand in one bar, since a screen's last `Stack.Toolbar` of a placement replaces the ones before it, and an arrow at the list's end stands dimmed rather than gone, so the other one never moves under the thumb, as Mail's do. */}
        {/* Note that a glyph here is named as a symbol, as ⋯'s is, because a top bar loads an `xcasset` as a React Native image, which drew our Lucide symbol sets as empty glass. */}
        <Stack.Toolbar.Button
          accessibilityLabel={STEP_WORDS.PREVIOUS}
          disabled={place.steps.previous === undefined}
          icon={glyphSymbol(GLYPH.PREVIOUS_ITEM)}
          onPress={() => stepTo(place.steps.previous)}
        />
        <Stack.Toolbar.Button
          accessibilityLabel={STEP_WORDS.NEXT}
          disabled={place.steps.next === undefined}
          icon={glyphSymbol(GLYPH.NEXT_ITEM)}
          onPress={() => stepTo(place.steps.next)}
        />
        <Stack.Toolbar.Menu icon={glyphSymbol(menu.symbol)} accessibilityLabel={menu.label}>
          <Stack.Toolbar.Menu inline title={path.join(PATH_PART)}>
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
          {toolbarMenuActions(menu)}
          {(menu.submenus ?? []).map((submenu) => (
            <Stack.Toolbar.Menu
              key={submenu.label}
              title={submenu.label}
              icon={glyphSymbol(submenu.symbol)}
            >
              {toolbarMenuActions(submenu)}
            </Stack.Toolbar.Menu>
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

/** What a reply that did not go says under its words and offers, Retry where it can go as it stands; none for a message that went. */
function undeliveredOf(
  line: UndeliveredReply | undefined,
  answer: Pick<ThreadAnswer, "retryUndelivered" | "editUndelivered" | "deleteUndelivered">,
): ThreadUndelivered | undefined {
  if (line === undefined) return undefined;
  const { key } = line;
  const lost = filesLost(line);

  return {
    why: lost ? UNDELIVERED_FILES_LOST : line.why,
    newThread: line.startsThread === true,
    onRetry: lost ? undefined : () => answer.retryUndelivered(key),
    onEdit: () => answer.editUndelivered(key),
    onDelete: () => answer.deleteUndelivered(key),
  };
}

/** What stands where a thread named by its id is not drawn: that it is still read, that it could not be, with Try again, or that no such thread is the account's to read. */
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
        action={{ label: TRY_AGAIN, onPress: onRetry, look: BUTTON_LOOK.BORDERED }}
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
  remindMenu,
  onOpen,
}: {
  readonly id: string;
  readonly remindMenu: (item: InboxItem) => BarMenu;
  readonly onOpen: (id: string) => void;
}) {
  const { listed, readerId, feed, retry } = useInboxThread(id);

  if (listed === undefined) return <ThreadNotDrawn feed={feed} onRetry={retry} />;

  return (
    <ThreadDetail
      listed={listed}
      readerId={readerId}
      place={{ inStack: false, remindMenu, onOpen }}
    />
  );
}

/** What the tab's root screen holds above its two layouts, so a rotation or a fold keeps it: the list's search words and how to change them, and the Remind me picker sheet its rows' menus open. */
type InboxHeld = {
  readonly search: string;
  readonly setSearch: (search: string) => void;
  readonly remind: ReturnType<typeof useRemind>;
};

/** What the list screens share: the scope and its pills, the search, the listing under both, and the acts on it. */
function useInboxScreen({ search, setSearch, remind }: InboxHeld, chosen?: string | undefined) {
  const { show, choose } = useInboxScope();
  const listing = useInboxListing({ show, search, chosen });
  // Note that the Inbox shows the feed's answer once it lists rows, the kept ones drawn at launch among them, or once the feed answered with none in this scope.
  useAppReadyCount(listing.listed.length > 0 || listing.feed === INBOX_FEED.ANSWERED);
  const acts = useInboxActs();
  const scopes = scopePills(show, choose, listing.counts);
  const selecting = useInboxChoosing();

  const menu = moreMenu(scopes, listing.listed, acts.markAll, {
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
          pickedItems.length === 0
            ? SELECTION_WORDS.SELECT_ITEMS
            : selectedWords(pickedItems.length),
        acts: chosenActs(pickedItems, acts, remind, selecting.stop),
        // Note that Select all takes every thread listed, and Deselect all lets them go once all are chosen, as Mail's edit bar leads with them.
        all: (pickedItems.length === listing.listed.length && pickedItems.length > 0
          ? { label: SELECTION_WORDS.DESELECT_ALL, onPress: () => selecting.choose([]) }
          : {
              label: SELECTION_WORDS.SELECT_ALL,
              // Note that with nothing listed, such as under a search that finds nothing, Select all stands dimmed, so its press never lets go of the threads chosen before.
              disabled: listing.listed.length === 0,
              onPress: () => selecting.choose(listing.listed.map(({ item }) => item.id)),
            }) satisfies BarAction,
        done: { label: SELECT_DONE, onPress: selecting.stop } satisfies BarAction,
      }
    : undefined;

  return {
    show,
    choose,
    search,
    setSearch,
    listing,
    acts,
    menu,
    remind,
    choosing,
    chooseStart: selecting.choose,
  };
}

// A compact window: the list, the account's photo opening Settings and the
// workspace switcher beside it at the bar's leading edge, and its search and
// its ⋯ menu, which holds the scopes, as round glass buttons at its trailing
// one, each row pushing its thread as the Stack's next screen.
function InboxStackList(held: InboxHeld) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const switcher = useWorkspaceSwitcher();
  const compose = useComposeAction();

  const { show, choose, search, setSearch, listing, acts, menu, remind, choosing, chooseStart } =
    useInboxScreen(held);

  const field = useRefilledSearchField(search);
  const placement = useHeldSearchPlacement(search);

  // Note that Select mode names how many are chosen in the title's place, stands Select all where the switcher stood and Done where ⋯ stood, and its acts in a bar at the foot, the tab bar stepping aside for it (`useInboxChoosingOn`), as Photos does. Done is the bar's plain word, as Mail's is, since ending a selection commits nothing.
  return (
    <>
      <Stack.Screen options={{ title: choosing?.title ?? INBOX_TITLE }}>
        {choosing !== undefined ? null : (
          <Stack.SearchBar
            ref={field}
            placeholder={SEARCH_INBOX}
            placement={placement}
            allowToolbarIntegration={false}
            onChangeText={(event) => setSearch(event.nativeEvent.text)}
            onCancelButtonPress={() => setSearch("")}
          />
        )}
      </Stack.Screen>
      {choosing !== undefined ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            variant="plain"
            disabled={choosing.all.disabled === true}
            onPress={choosing.all.onPress}
          >
            {choosing.all.label}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : (
        <SettingsBarButton switcher={switcher} />
      )}
      <Stack.Toolbar placement="right">
        {choosing !== undefined ? (
          <Stack.Toolbar.Button variant="plain" onPress={choosing.done.onPress}>
            {choosing.done.label}
          </Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Menu icon={glyphSymbol(menu.symbol)} accessibilityLabel={menu.label}>
            {toolbarMenuActions(menu)}
          </Stack.Toolbar.Menu>
        )}
        {/* Note that a narrow iPad window's tab bar has no round +, so its list's bar offers New task, as its wider windows' bars do. */}
        {choosing !== undefined || PLUS_TAB ? null : (
          <Stack.Toolbar.Button
            icon={compose.symbol === undefined ? undefined : glyphSymbol(compose.symbol)}
            accessibilityLabel={compose.label}
            onPress={compose.onPress}
          />
        )}
      </Stack.Toolbar>
      {choosing === undefined ? null : (
        <Stack.Toolbar placement="bottom">
          {/* Note that the acts stand side by side between two flexible spaces, so iOS 26 draws them in one glass capsule centered over the foot, as Files and Mail group their edit bar's acts, never a glass circle each spread across it. */}
          <Stack.Toolbar.Spacer />
          {choosing.acts.map((act) =>
            // Note that a glyph is named as an asset rather than a symbol, because the bottom bar loads `icon` as an SF Symbol alone, which drew our Lucide glyphs as empty glass. A menu that would act on nothing, such as Remind me with no thread chosen, stands as a dimmed button, because the bar's menu draws its `disabled` live on iOS.
            isBarMenu(act) && act.disabled !== true ? (
              <Stack.Toolbar.Menu key={act.label} accessibilityLabel={act.label}>
                <Stack.Toolbar.Icon xcasset={act.symbol} renderingMode="template" />
                {toolbarMenuActions(act)}
              </Stack.Toolbar.Menu>
            ) : (
              <Stack.Toolbar.Button
                key={act.label}
                accessibilityLabel={act.label}
                disabled={act.disabled === true}
                onPress={isBarMenu(act) ? doNothing : act.onPress}
              >
                {act.symbol === undefined ? null : (
                  <Stack.Toolbar.Icon xcasset={act.symbol} renderingMode="template" />
                )}
              </Stack.Toolbar.Button>
            ),
          )}
          <Stack.Toolbar.Spacer />
        </Stack.Toolbar>
      )}
      <Screen>
        {/* Note that the list stands even with no thread, its empty state its one row, so a pull still reads the Inbox again. */}
        <InboxRows
          look={LIST_LOOK.PLAIN}
          listed={listing.listed}
          readerId={listing.readerId}
          onSelect={(id) => {
            handedOrders.set(
              id,
              listing.listed.map(({ item }) => item.id),
            );
            router.push(onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId: id })));
          }}
          onRefresh={acts.refresh}
          onMark={acts.mark}
          remindMenu={remind.itemMenu}
          onResolve={acts.resolve}
          choosing={choosing?.rows}
          onChooseStart={chooseStart}
          empty={
            listing.listed.length === 0 ? (
              <InboxEmpty
                show={show}
                search={search}
                feed={listing.feed}
                counts={listing.counts}
                onRetry={() => void acts.refresh()}
                onShow={choose}
              />
            ) : undefined
          }
        />
      </Screen>
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the list
// under its scopes' menu picker, since the column cuts segments short, with
// its search and ⋯ menu in its bar and the selected thread beside it, in the
// tab's own split view beside the system's tab sidebar, as Mail stands a
// mailbox's mail beside a message. The Stack's header steps aside, since the split view draws each column's
// navigation bar itself.
function InboxSplitScreen({
  selected,
  select,
  held,
}: {
  readonly selected: string | undefined;
  readonly select: (id: string) => void;
  readonly held: InboxHeld;
}) {
  const { show, choose, search, setSearch, listing, acts, menu, remind, choosing, chooseStart } =
    useInboxScreen(held, selected);

  useSurfaceOpen(selected === undefined ? undefined : PRODUCT_SURFACE.THREAD, selected);

  // Note that the iPad's K and J step through the rows the list column shows now, its scope and its search as they stand, from the thread beside it, as the panel's step through the list on screen; only while the Inbox's root is focused, never under a page pushed over it on the tab's stack.
  const focused = useIsFocused();
  const shownIds = listing.listed.map(({ item }) => item.id);
  const at = selected === undefined ? -1 : shownIds.indexOf(selected);
  useStandFrontSteps(
    at < 0 ? {} : { previous: shownIds[at - 1], next: shownIds[at + 1] },
    select,
    focused && at >= 0,
  );

  const rows = (
    <InboxRows
      look={LIST_LOOK.PLAIN}
      listed={listing.listed}
      readerId={listing.readerId}
      selected={selected}
      onSelect={select}
      onRefresh={acts.refresh}
      onMark={acts.mark}
      remindMenu={remind.itemMenu}
      onResolve={acts.resolve}
      choosing={choosing?.rows}
      onChooseStart={chooseStart}
      empty={
        listing.listed.length === 0 ? (
          <InboxEmpty
            show={show}
            search={search}
            feed={listing.feed}
            counts={listing.counts}
            onRetry={() => void acts.refresh()}
            onShow={choose}
          />
        ) : undefined
      }
    />
  );

  const list = {
    chosen: selected !== undefined,
    view: rows,
    // Note that Select mode names how many are chosen in the column's title, leads its bar with Select all, stands Done where ⋯ stood, and its acts in the column's own bar at its foot.
    bar:
      choosing === undefined
        ? {
            title: INBOX_TITLE,
            menu,
            search: { placeholder: SEARCH_INBOX, text: search, onChange: setSearch },
          }
        : {
            title: choosing.title,
            lead: [choosing.all],
            action: choosing.done,
            foot: choosing.acts,
          },
  };

  const detail =
    selected === undefined ? (
      <NoSelection title={CHOOSE_AN_ITEM_WORDS} />
    ) : (
      <ThreadColumn key={selected} id={selected} remindMenu={remind.itemMenu} onOpen={select} />
    );

  // Note that with no thread picked the detail's bar keeps the thread's acts, dimmed, as Mail's bar stands over No Message Selected; a picked thread's page stands its own.
  const detailBar = selected === undefined ? { acts: NO_THREAD_ACTS } : undefined;

  const first = useListColumn(list);
  const firstDetailBar = useDetailColumnBar(detailBar);
  const build = useSplitBuild();

  return (
    <>
      {/* Note that the root keeps its title while its bar is hidden, because a page pushed over the split view names its back button by it, which iPadOS 26 shows and VoiceOver says as the route's name otherwise. */}
      <Stack.Screen options={{ headerShown: false, title: INBOX_TITLE }} />
      <Screen key={build}>
        <SplitView {...first} detail={detail} detailBar={firstDetailBar} />
      </Screen>
    </>
  );
}

/**
 * The threads either side of an open one: in the order handed to it as it
 * opened, which it keeps while it stands, or, for one handed none or one that
 * order doesn't hold, in the kept scope's live rows, the open thread kept
 * among them, as the panel's list keeps the item its pane shows.
 */
function useThreadSteps(id: string): ThreadSteps {
  const { show } = useInboxScope();
  const listing = useInboxListing({ show, search: "", chosen: id });
  const [handed] = useState(() => handedOrders.get(id));

  // Note that the hand-off is taken once, so a later open of this thread with none handed, such as from a notification, never finds a stale one.
  useEffect(() => {
    handedOrders.delete(id);
  }, [id]);

  const order = handed?.includes(id) ? handed : listing.listed.map(({ item }) => item.id);

  const at = order.indexOf(id);

  return at < 0 ? { order } : { order, previous: order[at - 1], next: order[at + 1] };
}

/**
 * The Inbox tab's root screen: its list, laid out by the window's size
 * class. Note that a rotation or a fold swaps one layout for the other,
 * redrawing all under it, so what must outlive the swap is held here: the
 * search, and Remind me's picker sheet, drawn beside the layout rather than
 * in it, so a picker open on a thread stays open across the swap.
 */
export function InboxListScreen() {
  const sizeClass = useWindowSizeClass();
  const { selected, select } = useSplitSelection(SPLIT_TAB.INBOX);
  const [search, setSearch] = useState("");
  const remind = useRemind();
  useSurfaceOpen(PRODUCT_SURFACE.INBOX);

  const held = { search, setSearch, remind };

  return (
    <>
      {sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
        <InboxSplitScreen selected={selected} select={select} held={held} />
      ) : (
        <InboxStackList {...held} />
      )}
      {remind.sheet}
    </>
  );
}

/** The Inbox's pushed screen: one thread, named by the route's `id`, its path small in the bar over its heading. */
export function InboxThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listed, readerId, feed, retry } = useInboxThread(id);
  const steps = useThreadSteps(id);
  const handed = useHandToSplit(SPLIT_TAB.INBOX, id);
  useSurfaceOpen(handed ? undefined : PRODUCT_SURFACE.THREAD, id);

  return (
    <>
      <Stack.Screen
        options={{ headerBackTitle: INBOX_TITLE, ...(listed === undefined && { title: "" }) }}
      />
      {listed !== undefined ? (
        <ThreadDetail listed={listed} readerId={readerId} place={{ inStack: true, steps }} />
      ) : (
        <Screen>
          <ThreadNotDrawn feed={feed} onRetry={retry} />
        </Screen>
      )}
    </>
  );
}
