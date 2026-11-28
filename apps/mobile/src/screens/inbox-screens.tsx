// inbox-screens.tsx -- the Inbox's list and its thread: the Stack's two screens in a compact window, one split view in a regular one.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { isAudioType, isVideoType } from "@repo/features/conversation-picture-wire";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { RESOLVE } from "@repo/features/inbox-ask-words";
import { inboxAttachmentOf, inboxPictureDestination } from "@repo/features/inbox-attachment-link";
import {
  type InboxFields,
  inboxRowOf,
  type InboxRow as ListedRow,
} from "@repo/features/inbox-digest";
import {
  ANSWER_TONE,
  EVERYONES,
  holderName,
  holderRepository,
  holderTask,
  holderWorkspaceId,
  INBOX_MEDIA,
  INBOX_NOT_READ,
  INBOX_READ_MARK,
  INBOX_RUN_LABEL,
  INBOX_SCOPES,
  INBOX_SHOW,
  INBOX_SHOW_EMPTY,
  INBOX_SHOW_LABEL,
  INBOX_VIEW_WORDS,
  INBOX_WHOSE,
  type InboxAnyHolder,
  type InboxCounts,
  type InboxListed,
  type InboxPinnedRun,
  type InboxShow,
  type InboxWhose,
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
  MINE,
  narrowedByWhose,
  READING_INBOX,
  SEARCH_INBOX,
} from "@repo/features/inbox-list-model";
import {
  filesLost,
  UNDELIVERED_FILES_LOST,
  type UndeliveredReply,
} from "@repo/features/inbox-undelivered";
import { INBOX_STATUS, inboxWaitsOn } from "@repo/features/inbox-wire";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { threadActivity } from "@repo/features/ios-system-activity";
import { LINK_DESTINATION, linkOf, linkWorkspaceStep } from "@repo/features/link-grammar";
import type { ManagerFace } from "@repo/features/manager-face";
import { agentName as agentNameOf, providerOf } from "@repo/features/model-label";
import type { ModelProvider } from "@repo/features/models-wire";
import { cardTitle } from "@repo/features/plain-words";
import { SEARCH_FOUND_KIND } from "@repo/features/search-found-model";
import type { TaskSummary } from "@repo/features/task-wire";
import {
  NO_RESULTS_HINT,
  noResultsForWords,
  noSelectionWords,
  PATH_OPENS,
  SELECTION_WORDS,
  selectedWords,
  TERM,
} from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { INBOX_FEED, type InboxFeed, selectWorkspaces } from "@repo/host/app-state-reads";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  agentLead,
  BAR_TITLE,
  type BarAction,
  type BarFootItem,
  type BarMenu,
  BUTTON_LOOK,
  CHIP_MARK,
  EmptyState,
  GLYPH,
  GlassDock,
  glyphIcon,
  glyphSymbol,
  isBarMenu,
  LIST_LOOK,
  ListColumn,
  type ListLook,
  ListRow,
  type ListScopes,
  ListSection,
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
  StackBarMenu,
  THREAD_MEDIA,
  type ThreadMedia,
  type ThreadMessage,
  ThreadPage,
  taskLead,
  threadPreview,
  type UndeliveredLine,
  useChipMarkOf,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppReadyCount } from "../app-ready.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useTaskListCollections, useTaskListRow } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useInboxChoosing } from "../inbox/inbox-choosing.js";
import {
  type InboxPinnedFirst,
  type InboxScope,
  type InboxWhoseChoice,
  useInboxPinnedFirst,
  useInboxRunFolds,
  useInboxScope,
  useInboxWhose,
} from "../inbox/inbox-view-choices.js";
import { useRowLinkNames, useTitleLinkNames } from "../inbox/preview-link-names.js";
import {
  type InboxThreadHeld,
  useInboxActs,
  useInboxListing,
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
import { useOpenDrawnCount } from "../open-drawn.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useReplyDrawnCount } from "../reply-drawn.js";
import { useNoteOpened } from "../search/recent-opened.js";
import { useHeldSearchPlacement, useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { APP_SIDEBAR } from "../sidebar-shown.js";
import { TabColumns } from "../split-columns.js";
import {
  SPLIT_TAB,
  useHandToSplit,
  usePickInPlace,
  useSplitPicked,
  useSplitSelection,
} from "../split-route.js";
import { StackColumnBar } from "../stack-column-bar.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab } from "../tab-route.js";
import { useLinkStandings } from "../tasks/use-link-standings.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import {
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

/** How an open ask's option file is read beside the thread's own: a recording, a sound clip, or a picture. */
function askFileKind(mediaType: string) {
  if (isVideoType(mediaType)) return INBOX_MEDIA.VIDEO;

  return isAudioType(mediaType) ? INBOX_MEDIA.AUDIO : INBOX_MEDIA.PICTURE;
}

type InboxRowsProps = {
  readonly look: ListLook;
  /** The rows drawn, in one run where `runs` is none. */
  readonly listed: readonly InboxListed<InboxAnyHolder>[];
  /** Pinned and Everything else, each under its heading, where the pinned tasks' threads stand first (`inboxPinnedRuns`). */
  readonly runs: readonly InboxPinnedRun<InboxAnyHolder>[] | undefined;
  readonly readerId: string | undefined;
  readonly selected?: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onMark: (item: ListedRow, unread: boolean) => void;
  readonly remindMenu: (item: InboxFields) => RowSubmenu;
  readonly onResolve: (item: InboxFields) => void;
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
 * press lifts its preview over the same acts. Where a pinned task's thread is
 * listed, the rows stand in the panel's runs, Pinned then Everything else,
 * each folding under its header and count (`InboxRunSections`).
 */
function InboxRows({
  look,
  listed,
  runs,
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
      {runs === undefined ? (
        <InboxItemRows
          listed={listed}
          readerId={readerId}
          pictureOf={pictureOf}
          onMark={onMark}
          remindMenu={remindMenu}
          onResolve={onResolve}
        />
      ) : (
        <InboxRunSections
          runs={runs}
          readerId={readerId}
          pictureOf={pictureOf}
          onMark={onMark}
          remindMenu={remindMenu}
          onResolve={onResolve}
        />
      )}
    </RowList>
  );
}

/**
 * The Inbox's runs where the pinned tasks' threads stand first, as the
 * panel's Inbox stands them: Pinned, then Everything else, each a section
 * under its header and how many threads it holds, folding in place on a
 * press of its header, the folds kept across launches (`useInboxRunFolds`).
 */
function InboxRunSections({
  runs,
  ...acts
}: InboxRowActs & { readonly runs: readonly InboxPinnedRun<InboxAnyHolder>[] }) {
  const { onFold } = useInboxRunFolds();

  return runs.map(({ run, items, count, folded }) => (
    <ListSection
      key={run}
      title={INBOX_RUN_LABEL[run]}
      count={count}
      foldable
      folded={folded}
      onFold={(shut) => onFold(run, shut)}
    >
      <InboxItemRows listed={items} {...acts} />
    </ListSection>
  ));
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
  readonly item: ListedRow;
  /** Its task, which its link names; none for a thread on no task, a Manager's, whose link names the thread alone. */
  readonly taskId: string | undefined;
  readonly workspaceId: TaskSummary["workspaceId"];
  /** What holds it: its task's name, or its agent's. */
  readonly taskName: string;
  /** Its task's status, whose ring leads the name; none for an agent. */
  readonly taskStatus: TaskSummary["status"] | undefined;
  /** The face of the Manager it stands under, on no task, which leads the name; none for a task's, or another agent's. */
  readonly managerFace: ManagerFace | undefined;
};

type InboxRowActs = {
  readonly readerId: string | undefined;
  /** Each member's picture by their id, read once by the list the row stands in. */
  readonly pictureOf: PictureOf;
  readonly onMark: (item: ListedRow, unread: boolean) => void;
  /** Remind me's times on the thread, a menu a swipe from the trailing edge opens. */
  readonly remindMenu: (item: InboxFields) => RowSubmenu;
  /** Resolves the open thread, which a full swipe from the trailing edge runs. */
  readonly onResolve: (item: InboxFields) => void;
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
}: InboxRowActs & { readonly listed: readonly InboxListed<InboxAnyHolder>[] }) {
  return (
    <RowForEach data={listed} keyOf={(each) => each.item.id}>
      {(each) => <InboxItemRow listed={each} {...acts} />}
    </RowForEach>
  );
}

/** One Inbox item's row, under its task, or the agent on no task that posted it, a Manager, as every list of Inbox items draws it, Search's Recent among them, where it stands among other kinds' rows. */
export function InboxItemRow({
  listed: { holder, item },
  ...acts
}: InboxRowActs & { readonly listed: InboxListed<InboxAnyHolder> }) {
  const task = holderTask(holder);

  return (
    <InboxRow
      item={item}
      taskId={task?.id}
      workspaceId={holderWorkspaceId(holder)}
      taskName={holderName(holder)}
      taskStatus={task?.status}
      managerFace={"agent" in holder ? holder.agent.face : undefined}
      {...acts}
    />
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
  managerFace,
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
  const links = useRowLinkNames(item);
  const title = cardTitle(item.title, links);
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
        inboxThreadMessages({ ...item, thread: item.digest.tail }, agentName, readerId),
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
      // Note that a Manager's face leads its row at rest, as the panel's Inbox wears it, since the Inbox says what waits on the reader rather than who works.
      task={
        managerFace === undefined
          ? { name: taskName, status: taskStatus }
          : { name: taskName, manager: { face: managerFace, working: false } }
      }
      line={inboxLineKind(item)}
      summary={inboxPreview(item, (member) => inboxMemberName(member, readerId), undefined, links)}
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
      preview={threadPreview({
        title,
        task: { name: taskName, status: taskStatus },
        messages,
      })}
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
  read,
  counts,
  onRetry,
  onShow,
  whose,
}: {
  readonly show: InboxShow;
  /** Whom the items listed are addressed to, in whose words the list says it holds none. */
  readonly whose: InboxWhose;
  readonly search: string;
  readonly feed: InboxFeed;
  readonly read: boolean;
  readonly counts: InboxCounts;
  readonly onRetry: () => void;
  readonly onShow: (show: InboxShow) => void;
}) {
  // Note that a feed that failed stays failed, but one that answered still reads until the screen's own rows answered, since the kept rows load after the document says the feed stands.
  if (feed !== INBOX_FEED.FAILED && (feed === INBOX_FEED.READING || !read))
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
      title={INBOX_SHOW_EMPTY[whose.kind][show]}
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

/** The Inbox's ⋯ menu: its scopes, the one shown checked, then Select, which turns the list to Select mode as Mail's menu does, and Mark all as read; then Addressed to and Pinned tasks first, as the panel's View options offers them (`viewEntries`). */
function moreMenu(
  scopes: readonly Scope[],
  view: Pick<BarMenu, "submenus" | "groups">,
  listed: readonly InboxListed<InboxAnyHolder>[],
  markAll: (items: readonly ListedRow[]) => void,
  select: { readonly listed: boolean; readonly onSelect: () => void },
): BarMenu {
  return {
    ...MORE,
    ...view,
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

/**
 * The ⋯ menu's view choices after its scopes, the account's as the panel's
 * View options offers them: Addressed to, where it narrows the scope shown
 * (`narrowedByWhose`), Anyone or Me, and the teammate the account names
 * where one is, its choice checked; then Pinned tasks first, a switch. Note
 * that the phone offers no other teammate, having no people menu to list
 * them by; one chosen on the Mac stands here, and Me or Anyone lets it go.
 */
function viewEntries(
  show: InboxShow,
  { whose, onWhose }: InboxWhoseChoice,
  { pinnedFirst, onPinnedFirst }: InboxPinnedFirst,
): Pick<BarMenu, "submenus" | "groups"> {
  const named = whose.kind === INBOX_WHOSE.PERSON ? [whose] : [];

  const addressed: BarMenu = {
    label: INBOX_VIEW_WORDS.WHOSE,
    symbol: GLYPH.PEOPLE,
    choices: [
      {
        label: INBOX_VIEW_WORDS.ANYONE,
        on: whose.kind === INBOX_WHOSE.EVERYONE,
        onPress: () => onWhose(EVERYONES),
      },
      {
        label: INBOX_VIEW_WORDS.ME,
        on: whose.kind === INBOX_WHOSE.MINE,
        onPress: () => onWhose(MINE),
      },
      ...named.map((person) => ({
        id: person.userId,
        label: person.name,
        on: true,
        onPress: () => onWhose(person),
      })),
    ],
    actions: [],
  };

  return {
    submenus: narrowedByWhose(show) ? [addressed] : [],
    groups: [
      {
        choices: [
          {
            label: INBOX_VIEW_WORDS.PINNED_FIRST,
            symbol: GLYPH.PIN,
            on: pinnedFirst,
            onPress: () => onPinnedFirst(!pinnedFirst),
          },
        ],
        items: [],
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
  chosen: readonly ListedRow[],
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
 * as the act asks, for Select mode's bar at the foot. Note that it's a
 * function of elements rather than a component, because the bar's menu
 * takes only its own items as children.
 */
function toolbarMenuActions(menu: BarMenu) {
  return menu.actions.map((action) => (
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
}

/** The name an agent is called by, as the panel names it, the harness its model runs in, whose mark its tile wears, and a Manager's face, as the task list's collections hold them; the unlisted name and no harness or face before the agent is listed. */
function useAgentLabel(agentId: string): {
  readonly name: string;
  readonly harness: ModelProvider | undefined;
  /** A Manager's face, which a menu naming it leads with; none for a coder. */
  readonly face: ManagerFace | undefined;
} {
  const agent = useTaskListRow(useTaskListCollections().agents, agentId);

  return agent === undefined
    ? { name: UNLISTED_AGENT, harness: undefined, face: undefined }
    : { name: agentNameOf(agent), harness: providerOf(agent.model), face: agent.face };
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
      readonly remindMenu: (item: InboxFields) => BarMenu;
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
  readonly listed: InboxThreadHeld;
  readonly readerId: string | undefined;
  readonly place: ThreadPlace;
}) {
  const colors = useColors();
  const { holder, item } = listed;
  const title = cardTitle(item.title, useTitleLinkNames(item.title));
  // Note that a thread on no task, a Manager's, stands in its agent's workspace and names no task, as the panel's Inbox draws it under its agent alone.
  const task = holderTask(holder);
  const workspaceId = holderWorkspaceId(holder);
  // Note that a pull request a thread names opens in the app by its task's workspace.
  const openLink = useOpenLink(workspaceId);
  const { name: agentName, harness, face: agentFace } = useAgentLabel(item.agentId);
  const pictureOf = useMemberPictures();
  // Note that a Manager's face stands in its tile on each message it wrote, read as a chip naming it reads it (`useChipMarkOf`), so the writer line and the app's menus wear one face.
  const agentMark = useChipMarkOf()({ kind: ENTITY_KIND.AGENT, agentId: item.agentId });

  const writerManager =
    agentMark?.kind === CHIP_MARK.MANAGER
      ? { face: agentMark.face, working: agentMark.working }
      : undefined;

  // Note that the reader's replies that did not go stand at the thread's foot as their own messages, marked Not delivered, as the panel keeps them.
  const undelivered = useUndeliveredShown(item);

  const messages = useMemo(
    () => inboxThreadMessages(undelivered.item, agentName, readerId),
    [undelivered.item, agentName, readerId],
  );

  const hostActs = useHostActs();

  // Note that the closers are named from the thread's own workspace's members, followed here, since a link may open a thread outside the workspace the phone works in.
  useLiveFollow(workspaceId, (id) =>
    hostActs[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId: id }),
  );

  const memberFace = useMemberFaces(workspaceId);

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
  const workspaceStep = linkWorkspaceStep(workspaceId, workspaces);

  // A video the system's player cannot read opens with its thread on vespin.dev in Safari, which plays it.
  const openOnWeb = () => {
    const place = { kind: LINK_DESTINATION.INBOX_ITEM, taskId: task?.id, itemId: item.id } as const;

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
  useNoteOpened({
    kind: SEARCH_FOUND_KIND.INBOX,
    id: item.id,
    workspaceId,
  });
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
    onMark: (unread: boolean) => inboxActs.mark(inboxRowOf(item), unread),
    remind: remindMenu(item),
    onCopyLink: () =>
      keeping.copyWords(
        linkOf(
          { kind: LINK_DESTINATION.INBOX_ITEM, taskId: task?.id, itemId: item.id },
          workspaceStep,
        ),
      ),
  };

  const menu = threadMenu(item, answer, doors);
  // Note that a split view's detail bar stands the thread's main acts as glyphs, as Mail's stands Reply and Trash, and ⋯ keeps the rest; a compact window's stack keeps them all in ⋯.
  const acts = threadActs(item, answer, doors);

  // Note that the path opens its task and its agent as pages pushed over the thread on the stack it stands on, in any window, as the panel's crumbs open them, where the window stands a split view, the path heading the page over its title; a compact window's stack names the thread as its title, which can hold no menu, so there they lead the ⋯ menu instead, headed by the path. A thread on no task opens its agent alone. Each leads with its own mark: the task's status ring and the agent's harness.
  const openAgent = {
    label: PATH_OPENS.AGENT,
    ...agentLead(harness, agentFace),
    onPress: () => router.push(onOwnTab(iosAgentRoute(item.agentId))),
  };

  const pathActions: BarMenu["actions"] =
    task === undefined
      ? [openAgent]
      : [
          {
            label: PATH_OPENS.TASK,
            ...taskLead(task.status),
            onPress: () =>
              router.push(
                onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId: task.id })),
              ),
          },
          openAgent,
        ];

  const path = task === undefined ? [holderName(holder)] : [task.name, agentName];

  // Note that a compact window's ⋯ is SwiftUI's own menu, as a split view's bar stands it, headed by the thread's path over its task and agent, then the thread's acts and menus.
  const compactMenu: BarMenu = {
    label: menu.label,
    symbol: menu.symbol,
    choices: [],
    actions: [],
    groups: [
      { title: path.join(PATH_PART), items: pathActions },
      { choices: menu.choices, items: [...menu.actions, ...(menu.submenus ?? [])] },
    ],
  };

  // Note that a press on a message's writer opens their page, the agent's or a member's, as the panel's writer opens theirs; a member no account names opens nothing.
  const writerOpen = (writer: (typeof messages)[number]["writer"]) => {
    const { userId } = writer;

    if (writer.agent) return openAgent.onPress;

    if (userId === undefined) return undefined;

    return () => router.push(onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.PERSON, userId })));
  };

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
      manager: message.writer.agent ? writerManager : undefined,
      onOpen: writerOpen(message.writer),
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

  // A chip's pull request in the thread is read through its task's own workspace, as the panel's Inbox reads it.
  const linkStanding = useLinkStandings(
    messageWords,
    holderRepository(holder),
    workspaces.find((each) => each.id === workspaceId),
  );

  const page = (
    <ThreadPage
      path={path}
      status={task?.status}
      manager={"agent" in holder ? holder.agent.face : undefined}
      pathActions={pathActions}
      title={title}
      messages={drawn}
      opening={events.get(-1)}
      repository={holderRepository(holder)}
      onOpenLink={openLink}
      pictureSource={pictureSource}
      onRetryPicture={retryPicture}
      videoAt={videoAt}
      linkStanding={linkStanding}
      standing={
        item.status === INBOX_STATUS.OPEN ? undefined : inboxSettledStanding(inboxRowOf(item))
      }
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
            // Note that an iPad's page column stands the thread's acts and ⋯ in its screen's own header (`StackColumnBar`), and the page none of its own.
            acts: APP_SIDEBAR ? [] : acts,
            menu: APP_SIDEBAR ? undefined : menuWithout(menu, acts),
            foot: (
              <ThreadComposer
                item={item}
                answer={answer}
                agentName={agentName}
                place={{ workspaceId, taskId: task?.id }}
                inColumn
              />
            ),
          })}
    />
  );

  if (!inStack) {
    return APP_SIDEBAR ? (
      <>
        <StackColumnBar bar={{ acts, menu: menuWithout(menu, acts) }} />
        {page}
      </>
    ) : (
      page
    );
  }

  return (
    <>
      {/* Note that the stack's bar names the thread in the ink, as Messages names a conversation and the agent page names its agent, since the thread opens at its newest message with its heading out of sight; its path leads the ⋯ menu. */}
      <Stack.Screen
        options={{
          title,
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
        >
          {STEP_WORDS.PREVIOUS}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Button
          accessibilityLabel={STEP_WORDS.NEXT}
          disabled={place.steps.next === undefined}
          icon={glyphSymbol(GLYPH.NEXT_ITEM)}
          onPress={() => stepTo(place.steps.next)}
        >
          {STEP_WORDS.NEXT}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.View>
          <StackBarMenu menu={compactMenu} />
        </Stack.Toolbar.View>
      </Stack.Toolbar>
      <GlassDock
        bar={
          <ThreadComposer
            item={item}
            answer={answer}
            agentName={agentName}
            place={{ workspaceId, taskId: task?.id }}
          />
        }
      >
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
): UndeliveredLine | undefined {
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
  readonly remindMenu: (item: InboxFields) => BarMenu;
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
  readonly scope: InboxScope;
};

/** What the list screens share: the scope and its pills, the search, the listing under both, and the acts on it. */
function useInboxScreen(
  { search, setSearch, remind, scope }: InboxHeld,
  chosen?: string | undefined,
) {
  const { show, choose } = scope;
  const addressed = useInboxWhose();
  const pinned = useInboxPinnedFirst();
  const { whose } = addressed;
  const listing = useInboxListing({ show, search, chosen, pinnedFirst: pinned.pinnedFirst, whose });
  // Note that the Inbox shows the feed's answer once it lists rows, the kept ones drawn at launch among them, or once the feed answered with none in this scope.
  useAppReadyCount(listing.listed.length > 0 || listing.feed === INBOX_FEED.ANSWERED);
  const acts = useInboxActs();
  const scopes = scopePills(show, choose, listing.counts);
  const selecting = useInboxChoosing();

  const menu = moreMenu(
    scopes,
    viewEntries(show, addressed, pinned),
    listing.listed,
    acts.markAll,
    {
      listed: listing.listed.length > 0,
      onSelect: selecting.start,
    },
  );

  // Note that only the threads still listed stand chosen, so a thread a scope, a search, or the service took away is never acted on unseen.
  const picked = selecting.choosing.on ? selecting.choosing.chosen : [];
  // Note that Select mode reaches only the rows drawn, so the thread the split view shows, kept among the steps though its run is folded (`inboxShownItems`), is never chosen without a row.
  const rows = listing.runs?.flatMap(({ items }) => items) ?? listing.shown;

  const pickedItems = rows.filter(({ item }) => picked.includes(item.id)).map(({ item }) => item);

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
        all: (pickedItems.length === rows.length && pickedItems.length > 0
          ? { label: SELECTION_WORDS.DESELECT_ALL, onPress: () => selecting.choose([]) }
          : {
              label: SELECTION_WORDS.SELECT_ALL,
              // Note that with nothing listed, such as under a search that finds nothing, Select all stands dimmed, so its press never lets go of the threads chosen before.
              disabled: rows.length === 0,
              onPress: () => selecting.choose(rows.map(({ item }) => item.id)),
            }) satisfies BarAction,
        done: { label: SELECT_DONE, onPress: selecting.stop } satisfies BarAction,
      }
    : undefined;

  return {
    show,
    choose,
    whose,
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

  const {
    show,
    choose,
    whose,
    search,
    setSearch,
    listing,
    acts,
    menu,
    remind,
    choosing,
    chooseStart,
  } = useInboxScreen(held);

  const field = useRefilledSearchField(search);
  const placement = useHeldSearchPlacement(search);

  // Note that Select mode names how many are chosen in the title's place, stands Select all where the switcher stood and Done where ⋯ stood, and its acts in a bar at the foot, the tab bar stepping aside for it (`useInboxChoosingOn`), as Photos does. Done is the bar's plain word, as Mail's is, since ending a selection commits nothing.
  // Note that the count stands inline in the bar, as Photos' Select Items does, rather than in the large title, because iOS left the large title blank once its words changed under it.
  return (
    <>
      <Stack.Screen
        options={{
          title: choosing?.title ?? INBOX_TITLE,
          headerLargeTitleEnabled: choosing === undefined,
        }}
      >
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
          // Note that ⋯ is SwiftUI's own menu, as every other bar's ⋯ and View options stand (`StackBarMenu`), so its glyph and its menu draw as the task and agent pages' do.
          <Stack.Toolbar.View>
            <StackBarMenu menu={menu} />
          </Stack.Toolbar.View>
        )}
        {/* Note that New task's compose ends the bar, as Messages' and Mail's stand. */}
        {choosing !== undefined ? null : (
          <Stack.Toolbar.Button
            icon={compose.symbol === undefined ? undefined : glyphSymbol(compose.symbol)}
            accessibilityLabel={compose.label}
            onPress={compose.onPress}
          >
            {compose.label}
          </Stack.Toolbar.Button>
        )}
      </Stack.Toolbar>
      {choosing === undefined ? null : (
        <Stack.Toolbar placement="bottom">
          {/* Note that the acts stand side by side between two flexible spaces, so iOS 26 draws them in one glass capsule centered over the foot, as Files and Mail group their edit bar's acts, never a glass circle each spread across it. */}
          <Stack.Toolbar.Spacer />
          {choosing.acts.map((act) =>
            // Note that a glyph is named by `glyphIcon`, an SF Symbol as one and a Lucide glyph as an asset, because the bottom bar loads `icon` as an SF Symbol alone, which drew our Lucide glyphs as empty glass. A menu that would act on nothing, such as Remind me with no thread chosen, stands as a dimmed button, because the bar's menu draws its `disabled` live on iOS.
            isBarMenu(act) && act.disabled !== true ? (
              <Stack.Toolbar.Menu key={act.label} accessibilityLabel={act.label}>
                <Stack.Toolbar.Label>{act.label}</Stack.Toolbar.Label>
                <Stack.Toolbar.Icon {...glyphIcon(act.symbol)} />
                {toolbarMenuActions(act)}
              </Stack.Toolbar.Menu>
            ) : (
              <Stack.Toolbar.Button
                key={act.label}
                accessibilityLabel={act.label}
                disabled={act.disabled === true}
                onPress={isBarMenu(act) ? doNothing : act.onPress}
              >
                <Stack.Toolbar.Label>{act.label}</Stack.Toolbar.Label>
                {act.symbol === undefined ? null : (
                  <Stack.Toolbar.Icon {...glyphIcon(act.symbol)} />
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
          listed={listing.shown}
          runs={listing.runs}
          readerId={listing.readerId}
          onSelect={(id) => {
            handedOrders.set(
              id,
              listing.shown.map(({ item }) => item.id),
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
                whose={whose}
                search={search}
                feed={listing.feed}
                read={listing.read}
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

/**
 * The Inbox's list as a regular window's list column draws it: the threads
 * under the column's title, its ⋯ and its search, or Select mode's count,
 * Select all, Done and acts, the thread picked standing selected.
 */
function inboxListColumn(
  screen: ReturnType<typeof useInboxScreen>,
  selected: string | undefined,
  select: (id: string) => void,
) {
  const {
    show,
    choose,
    whose,
    search,
    setSearch,
    listing,
    acts,
    menu,
    remind,
    choosing,
    chooseStart,
  } = screen;

  const rows = (
    <InboxRows
      look={LIST_LOOK.PLAIN}
      listed={listing.shown}
      runs={listing.runs}
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
            whose={whose}
            search={search}
            feed={listing.feed}
            read={listing.read}
            counts={listing.counts}
            onRetry={() => void acts.refresh()}
            onShow={choose}
          />
        ) : undefined
      }
    />
  );

  return {
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
  const screen = useInboxScreen(held, selected);
  const { listing, remind } = screen;

  useSurfaceOpen(selected === undefined ? undefined : PRODUCT_SURFACE.THREAD, selected);

  // Note that the iPad's K and J step through the rows the list column shows now, its scope and its search as they stand, from the thread beside it, as the panel's step through the list on screen; only while the Inbox's root is focused, never under a page pushed over it on the tab's stack.
  const focused = useIsFocused();
  const shownIds = listing.shown.map(({ item }) => item.id);
  const at = selected === undefined ? -1 : shownIds.indexOf(selected);
  useStandFrontSteps(
    at < 0 ? {} : { previous: shownIds[at - 1], next: shownIds[at + 1] },
    select,
    focused && at >= 0,
  );

  const list = inboxListColumn(screen, selected, select);

  const detail =
    selected === undefined ? (
      <NoSelection title={noSelectionWords(TERM.INBOX_ITEM)} />
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
      {/* Note that an iPad's page column stands its screen's own header instead, which its columns draw (`TabColumns`). */}
      {APP_SIDEBAR ? null : <Stack.Screen options={{ headerShown: false, title: INBOX_TITLE }} />}
      <TabColumns build={build} {...first} detail={detail} detailBar={firstDetailBar} />
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
  const { whose } = useInboxWhose();
  const { pinnedFirst } = useInboxPinnedFirst();
  // Note that the steps read the app's one read of the Inbox, never one of their own for the thread opened, so opening a thread reads nothing more; a thread the list's scope never shows has no steps but those it was handed.
  const listing = useInboxListing({ show, search: "", pinnedFirst, whose });
  const [handed] = useState(() => handedOrders.get(id));

  // Note that the hand-off is taken once, so a later open of this thread with none handed, such as from a notification, never finds a stale one.
  useEffect(() => {
    handedOrders.delete(id);
  }, [id]);

  const order = handed?.includes(id) ? handed : listing.shown.map(({ item }) => item.id);

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
  const shared = useContext(InboxHeldContext);

  return shared === undefined ? <InboxOwnRoot /> : <InboxLayouts held={shared} />;
}

/** The Inbox's root holding its own search, scope and Remind me sheet, where nothing above it holds them, as on an iPhone. */
function InboxOwnRoot() {
  const held = useInboxHeld();

  return (
    <>
      <InboxLayouts held={held} />
      {held.remind.sheet}
    </>
  );
}

/** The Inbox's root laid out by the window's size class. */
function InboxLayouts({ held }: { readonly held: InboxHeld }) {
  const sizeClass = useWindowSizeClass();
  const { selected, select } = useSplitSelection(SPLIT_TAB.INBOX);

  return sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
    <InboxSplitScreen selected={selected} select={select} held={held} />
  ) : (
    <InboxStackList {...held} />
  );
}

/** What the Inbox's root keeps across its layouts: its search, its scope, and Remind me's sheet. */
function useInboxHeld(): InboxHeld {
  const [search, setSearch] = useState("");
  const remind = useRemind();
  const scope = useInboxScope();

  return { search, setSearch, remind, scope };
}

/** The Inbox's search, scope and Remind me sheet, held above an iPad's split view for its list column and its page alike; none elsewhere, where the Inbox's root holds its own. */
const InboxHeldContext = createContext<InboxHeld | undefined>(undefined);

/**
 * What an iPad's Inbox holds above the system's split view, so its list in
 * the middle column (`InboxListColumn`) and its root in the last one, which
 * draws the picked thread, read one search, one scope, and one Remind me
 * sheet, as columns under one root share it.
 */
export function InboxHeldProvider({ children }: { readonly children: ReactNode }) {
  const held = useInboxHeld();

  return (
    <InboxHeldContext value={held}>
      {children}
      {held.remind.sheet}
    </InboxHeldContext>
  );
}

/**
 * The Inbox's list in an iPad's middle column, beside the sidebar and the
 * picked thread: what the Inbox holds above the split view, the thread its
 * root picked standing selected, and a pick handed to that root.
 */
export function InboxListColumn() {
  const held = useContext(InboxHeldContext);
  const selected = useSplitPicked(SPLIT_TAB.INBOX);
  const pick = usePickInPlace(SPLIT_TAB.INBOX);

  if (held === undefined) throw new Error("An iPad's Inbox list stands under InboxHeldProvider.");

  const list = inboxListColumn(useInboxScreen(held, selected), selected, pick);

  return <ListColumn view={list.view} bar={list.bar} />;
}

/** The Inbox's pushed screen: one thread, named by the route's `id`, its path small in the bar over its heading. */
export function InboxThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listed, readerId, feed, retry } = useInboxThread(id);
  const steps = useThreadSteps(id);
  const handed = useHandToSplit(SPLIT_TAB.INBOX, id);
  useSurfaceOpen(handed ? undefined : PRODUCT_SURFACE.THREAD, id);
  useOpenDrawnCount(handed ? undefined : PRODUCT_SURFACE.THREAD, listed !== undefined);

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
