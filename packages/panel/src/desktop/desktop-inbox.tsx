import { AGENT_CALL_FAILURE, type AgentInboxMessagedView } from "@repo/features/agent-view";
import { type InboxHolder, type InboxListed, NOTHING_HERE } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { LINK_DESTINATION, type LinkDestination } from "@repo/features/link-grammar";
import type { DescriptionMention } from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import { cardTitle } from "@repo/features/plain-words";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { CodeRef } from "@repo/features/task-wire";
import { placeOfTaskTarget, TOOL_TARGET, type ToolTarget } from "@repo/features/tool-call-model";
import { backToWords, readFailedWords } from "@repo/features/words";
import { HOST_CAPABILITY } from "@repo/settings";
import { APP_COMMAND, type KeyedCommand } from "@repo/settings/shortcuts";
import { ERROR_STATE_PLACEMENT, ErrorState, Toolbar } from "@repo/ui";
import {
  agentTab,
  changesTab,
  pageTab,
  STRIP_TAB_KIND,
  type StripTab,
  sameTab,
} from "@repo/ui/tab-strip-model";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { useAppCommand } from "../app-commands.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { besideItem } from "../inbox-item-links.js";
import { useInboxView } from "../inbox-route.js";
import { MemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { HERE, placeAddress, ROUTE, THING } from "../places/pressed-address.js";
import { useInboxDoor } from "../places/routed-doors.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { SHORTCUT_SUBJECT, shortcutSubject, useShortcutTarget } from "../shortcut-target.js";
import { agentName, messageFailureWords } from "../tasks/agent-model.js";
import {
  INBOX_COLUMNS,
  INBOX_VIEW,
  INBOX_VIEW_ITEMS,
  useInboxColumns,
} from "../tasks/inbox-columns.js";
import { InboxList, InboxListNote, InboxPaneEmpty } from "../tasks/inbox-list.js";
import { useInboxPager } from "../tasks/inbox-pager.js";
import { type InboxNewThread, InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane.js";
import type { OpenFileLines } from "../tasks/mention-chip.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import { COLUMN, pressTab, TAB_PRESS, type TabPressed } from "../tasks/tab-press.js";
import {
  heldTaskMentions,
  type TasklessPlace,
  TaskMentions,
  type TaskMentionsValue,
  useMentionAgentsReader,
  useSavedDescriptionText,
} from "../tasks/task-mentions.js";
import { PULL_REQUEST_VIEW } from "../tasks/task-tab-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useInboxListing } from "../tasks/use-inbox-listing.js";
import { useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import { useInboxItemOpenSpan, useInboxOpenSpan } from "../tasks/use-inbox-spans.js";
import {
  OpenAddressesHere,
  type OpenAddressHere,
  placeOfMention,
  useLinkRouter,
} from "../tasks/use-open-link.js";
import type { FileReads, SidePanelControl, SidePanelTab } from "../tasks/use-side-panel.js";
import { type HeldTaskInboxControl, useInboxCardDrafts } from "../tasks/use-task-inbox.js";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";
import { useCloudTerminalTab } from "../tasks/use-terminal-session.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { AgentPane } from "./main-tabs.js";
import {
  changesTabOf,
  SIDE_PANEL_HOLDER,
  SidePanel,
  type SidePanelDrawing,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { type TabViews, useTabViews } from "./strip-tabs.js";
import { taskCardOf } from "./task-card.js";

/**
 * desktop-inbox.tsx -- the window's Inbox: every item of every task of the listed workspace holding one in a list of its own, and the chosen item read beside it.
 *
 * It stands in the task's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The list (`inbox-list.tsx`) holds the items of each task of the
 * workspace the sidebar lists that main says holds one, needing the
 * developer or settled, each task read whole as main says it changed
 * (`use-holder-inbox-items.ts`), in one run, the latest changed first, in
 * the scope the developer last chose: Needs you, the questions alone that
 * wait on their answer; Open, what is not done; All, everything; or
 * Reminders, of everyone's, theirs, or one teammate's. The sidebar's Inbox
 * row counts the open threads that wait on the developer, a question or an
 * update not yet opened (`places-waiting.ts`). A task's status never hides its items: the Inbox is a feed
 * of what the agents got done, so an item of a task done or canceled is
 * listed and counted as any other until it is read or answered, its row
 * wearing its task's status (`inbox-list.tsx`). A press on a row chooses it, and the pane beside the
 * list (`inbox-pane.tsx`) shows it as a thread, answered in place, on its
 * task's own held read, which stands in for the list's read of that task
 * so an answer shows at once. Nothing is chosen until a row is pressed or a
 * link asks for an item, the pane saying meanwhile how to choose one
 * (`InboxPaneEmpty`), so nothing is read by the Inbox opening. The pane's crumbs open
 * the task or the agent's tab on it, leaving the Inbox; what the item opens that
 * a task's side panel draws opens in that panel beside it instead, standing
 * for the chosen item's task (`use-tasks-tab.ts`): a code block's Open its
 * file, and a link naming a file of the task's repository, one of its
 * pages, or one of its agents' pull requests (`inbox-item-links.ts`). The
 * panel's toggle, its width, and its keys are a task's own, and ⌘F finds in
 * the panel while it holds the keys, as on a task. With nothing listed, it says so under the Inbox's
 * glyph (`@repo/ui`'s `EmptyState`) over New task; with its scope leaving out every item, the list
 * says so and offers the scope that holds something, while the pane goes on showing the item
 * chosen, answered, though the list draws it no row. Escape never leaves it, a stray press
 * being no reason to lose the item being read; any row of the sidebar does, and so does Back. Too narrow for the list and the item
 * side by side, it shows one at a time (`inbox-columns.ts`): the list,
 * and the item once a row's press or a link opens it, whose way back, Back's
 * chord, or Escape gives the list again. K and J, and the pager where the
 * item stands alone, step through the list (`inbox-pager.tsx`). Everything in it that names a
 * person, an answer and an agent's starter, reads them against the listed
 * workspace's members (`member-directory.tsx`). The chosen item's box
 * mentions what its task's repository and workspace hold (`answerPlace`),
 * and what the task's page offers besides: its description and sections as
 * saved, its pages, its agents, and their pull requests
 * (`heldTaskMentions`); and its skills are read through its task and drawn
 * as chips that open their `SKILL.md` in the panel beside it, as a file the
 * item names opens.
 *
 * Its items are read and listed by `use-inbox-listing.ts`.
 *
 * It is a memo boundary over the window's steady tasks (`useSteadyDoors`),
 * as the sidebar and a task's page are, so the shell drawn again over the
 * same tasks leaves it as it was. Nothing over its list reads the clock or
 * the pointer: each row's time counts from the window's minute on its own,
 * and the list keeps the pointer where its next draw reads it; and the box's
 * drafts are read in the pane that draws it (`DraftedInboxPane`), so a word
 * typed there draws the pane alone. A row chosen is drawn here first, the
 * window holding the choice once that frame has painted
 * (`use-inbox-listing.ts`), so the side panel, which follows the window's
 * choice, stands as last drawn until then.
 */

/** What the pane says where the item asked for could not be read, its holder's own read having failed. */
const ITEM_NOT_READ = readFailedWords("this item");

/** What leads back to the list from a missing item's notice, where the Inbox shows one column. */
const BACK_TO_INBOX = backToWords("inbox");

const _nothing = (): void => undefined;

/** No tab of the Inbox's panel is drawn in semibold: what arrives on a task arrives on its page. */
const NO_UNREAD: readonly StripTab[] = [];

/** No agent's tab stands open beside the Inbox, so no worker's tab stands in its panel. */
const NO_OPEN_AGENTS: readonly string[] = [];

/**
 * `drawn` as last drawn while `holding`, else as it is now. Note that what
 * is handed back while holding is the element drawn before, which React
 * draws nothing anew for.
 */
function useHeldWhile<Drawn>(holding: boolean, drawn: Drawn): Drawn {
  const held = useRef(drawn);
  const shown = holding ? held.current : drawn;
  useLayoutEffect(() => {
    held.current = shown;
  });
  return shown;
}

/** The window's Inbox, in the task's place: every task's items, and the chosen one read beside them; a memo boundary, as the module's head says. */
export const DesktopInbox = memo(function DesktopInbox({
  tasks,
  room = SHELL_ROOM.WIDE,
  phoneStart = null,
}: {
  tasks: TasksControl;
  /** The room the stage gives; narrow, a phone's, the list is headed as a phone's page is (`phone-head.tsx`). */
  room?: ShellRoom;
  /** What a phone's head leads with, the reader's face (`phone-account.tsx`); none elsewhere. */
  phoneStart?: React.ReactNode;
}): React.JSX.Element {
  // New task is the way on from an Inbox with nothing in it, wherever an account can start one.
  const newTask = tasks.signedIn ? tasks.newTask.onOpen : undefined;
  const inbox = useInboxDoor(tasks);
  // A task chosen narrows the Inbox to its own items, which a chip over the list names and clears.
  const narrowedTask = useInboxView(tasks).narrowed;
  const narrowedTaskRow = tasks.tasks.find((task) => task.id === narrowedTask);
  const narrowedTaskName = narrowedTaskRow?.name;
  const {
    view,
    choices,
    openAutomation,
    failed,
    asked,
    settling,
    chosenTask,
    taskId,
    agents,
    live,
    liveScope,
    named,
    marks,
    standing,
    markable: unread,
    counts,
    list,
    listedRows,
    steps,
    onPointing,
    chosen,
    filteredOut,
    search,
    searched,
    missing,
    chosenFailed,
    onRetryChosen,
    reading,
    choose,
    clear,
    resolveItems,
    onRetry,
  } = useInboxListing(tasks, narrowedTask);
  // Mark all as read marks the listed workspace's items, or a task's alone, each on its own, since the service marks a workspace's whole.
  const { onMarkAll, onMarkEach } = marks;
  const markAll = () =>
    (narrowedTask === undefined ? onMarkAll : onMarkEach)(standing.flatMap(({ items }) => items));
  useAppCommand(APP_COMMAND.MARK_INBOX_READ, tasks.shown && unread ? markAll : undefined);
  // Note that a phone shows one thing at a time across the screen: the list, or the item in its place.
  const phone = room === SHELL_ROOM.NARROW;
  // A missing item's pane stands where its item would, and so does one whose read failed, so a narrow Inbox shows the notice rather than the list.
  // Note that the Inbox's own way back to its list chooses nothing through the listing, which drops a choice still on its way (`use-inbox-listing.ts`).
  const { onSingle } = view;
  const columns = useInboxColumns(
    chosen?.item.id ?? (missing || chosenFailed ? asked?.itemId : undefined),
    { onClear: clear, onSingle },
  );
  const timeOpen = useInboxItemOpenSpan(chosen?.item.id, live.read);
  useInboxOpenSpan(listedRows.length);
  // A row's press opens its item, the keyboard following it.
  const open = (listed: InboxListed) => {
    timeOpen(listed.item.id);
    choose(listed);
    columns.onOpen(listed.item.id);
  };
  const { onMark: markItem } = marks;
  // K and J choose the item above or below, the keyboard following it to its row.
  const step = (listed: InboxListed) => {
    timeOpen(listed.item.id);
    choose(listed);
    columns.onStep();
  };
  const pager = useInboxPager(steps, list, chosen?.item.id, step, { shown: tasks.shown });
  // Where the chosen item's words are read: its plan's workspace and repository.
  const place = chosen === undefined ? undefined : answerPlace(chosen.holder, tasks);
  // Where the chosen item's links are written: under its own workspace, by slug once the workspaces are read.
  const chosenWorkspaceId = chosen?.holder.task.workspaceId;
  const chosenLinkWorkspace =
    chosenWorkspaceId === undefined
      ? (tasks.workspace?.slug ?? tasks.workspace?.id)
      : (tasks.workspaces.find((each) => each.id === chosenWorkspaceId)?.slug ?? chosenWorkspaceId);
  // What the chosen item's box offers an `@`, read under that workspace and repository.
  const readMentionAgents = useMentionAgentsReader(place?.workspaceId, tasks.tasks, named.models);
  // An item's box starts a new thread with its agent, which opens in its place.
  const { startInboxThread } = agents;
  const newThread: InboxNewThread | undefined = tasks.signedIn
    ? startedThreads(startInboxThread, (item, itemId) => {
        // Note that the thread stands on the task of the item it was started from, which may no longer be the one
        // chosen nor listed, so its task is read from the chosen item, then the listed groups, then its agent.
        const taskId =
          (chosen?.item.id === item.id ? chosen.holder.task.id : undefined) ??
          standing.find(({ items }) => items.some((each) => each.id === item.id))?.holder.task.id ??
          tasks.liveAgents?.find((agent) => agent.id === item.agentId)?.planId ??
          undefined;
        inbox.choose(
          taskId === undefined
            ? { itemId, opened: true }
            : { taskId, itemAgentId: item.agentId, itemId, opened: true },
        );
      })
    : undefined;
  const listedWorkspace = tasks.workspace;
  const { sidePanel } = tasks;
  const { onArea, focus, setFocus } = useColumnFocus(tasks.tabKeys, tasks.onTabKeysTaken);
  // What the item names opens beside the Inbox through the window's one door for a press, the panel
  // taking the keys, so ⌘W closes the tab it opened (`tab-press.ts`).
  const onPressTab = (pressed: TabPressed) =>
    pressTab({ sidePanel, mainTabs: tasks.mainTabs, onKeys: setFocus }, pressed);
  const openPanelTab = (tab: SidePanelTab, at?: PagePlace) =>
    onPressTab({ kind: TAB_PRESS.PANEL, tab, place: at });
  // A file the item names opens the same way.
  const openFile = (ref: CodeRef, commit: string | undefined, reads?: FileReads) =>
    onPressTab({ kind: TAB_PRESS.FILE, ref, commit, reads });
  // A file the item's words or box name opens as its code does, in the panel beside the Inbox.
  const openMentionedFile = (path: string, lines: OpenFileLines | undefined) =>
    openFile(fileRef(path, lines), lines?.commit);
  // The task's agents this Inbox read, an archived one's among them, whose Pull request tabs the panel beside the item draws.
  const { heldIds } = agents;
  const router = useLinkRouter();
  // An address pressed on the item or in the panel beside it, or a place a part there names, opens what it names beside the item where the item's own choices say so (`inbox-item-links.ts`), a place in the app matched on the route tree.
  const openHere: OpenAddressHere = (address) => {
    const routed = besideItem(address, {
      kind: HERE.INBOX_ITEM,
      taskId,
      repository: chosenTask?.repository ?? null,
      pullRequests: named.pullRequests,
      agentIds: named.agentIds,
      heldIds,
    });
    // An agent of the item's task goes to the task on its own tab, where its transcript reads, never beside the item.
    if (routed.kind === ROUTE.GO) {
      const { place: at } = routed.link;
      if (at.kind !== LINK_DESTINATION.AGENT || at.planId === undefined) return false;
      tasks.onShowAgent(at.planId, at.agentId);
      return true;
    }
    if (routed.kind !== ROUTE.BESIDE) return false;
    // A link opens what it names beside the item, as a tab of the panel.
    const { thing } = routed;
    switch (thing.kind) {
      case THING.FILE: {
        const ref = fileRef(thing.path, thing.lines);
        if (thing.repository === undefined) {
          openFile(ref, thing.lines?.commit);
          return true;
        }
        // A file of another repository is read through the item's workspace, whose installation reaches it.
        if (place === undefined) return false;
        const { repository } = thing;
        const reads = { place: { workspaceId: place.workspaceId, repository }, repository };
        openFile(ref, thing.lines?.commit, reads);
        return true;
      }
      case THING.PAGE:
        // A page an agent showed since the pages were read stands as its change lands, since they are followed as they move;
        // another task's, a subtask's among them, opens here too, read on that task, so the reader stays on the item.
        openPanelTab(pageTab(thing.pageId), thing.place);
        return true;
      case THING.CHANGES:
        openPanelTab(changesTab(thing.agentId));
        return true;
      case THING.PULL_REQUEST:
        showPullRequest(
          { ...sidePanel, onOpen: openPanelTab },
          named,
          thing.agentId,
          PULL_REQUEST_VIEW.CONVERSATION,
          thing.number,
        );
        return true;
      // A review thread opens its agent's Pull request tab on the view the link names, which brings the thread into view as it draws.
      case THING.THREAD: {
        const tab = changesTabOf(named, thing.agentId, sidePanel.changes);
        sidePanel.onPullRequestView(tab, thing.view);
        openPanelTab(tab);
        tasks.onRevealThread(tab.changes, {
          kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
          agentId: thing.agentId,
          threadId: thing.threadId,
          view: thing.view,
        });
        return true;
      }
      // Another item is chosen in this Inbox, as a link opens one in it from elsewhere.
      case THING.INBOX_ITEM: {
        const { itemId, taskId: holder, agentId } = thing;
        // Note that the Inbox lists the listed workspace's tasks alone, so an item of a task listed
        // elsewhere is the window's, which lists that task's workspace before opening it.
        if (holder !== taskId && !tasks.tasks.some((each) => each.id === holder)) return false;
        const choice: InboxChoice = {
          taskId: holder,
          ...(agentId === undefined ? undefined : { itemAgentId: agentId }),
          itemId,
          opened: true,
        };
        // Note that the Inbox's door widens a list narrowed to another task, so the list it opens in holds it (`inbox-route.ts`).
        inbox.choose(choice);
        return true;
      }
      // Note that the panel beside an item draws no worker, so the table opens none there.
      case THING.WORKER:
        return false;
    }
  };
  // A place a part of the item or the panel beside it names opens as a link to it would (`openHere`), and through the door given where it opens nothing there.
  const openPlaceHere = (at: LinkDestination, elsewhere: () => void) => {
    if (!openHere(placeAddress({ workspace: "", place: at }, router))) elsewhere();
  };
  // A task or a section a mention names opens as a link to it would.
  const openMention = (mention: DescriptionMention) =>
    openPlaceHere(placeOfMention(mention), () => tasks.onShowMention(mention));
  // An item offers what its task's page does: its description and sections as saved, its pages, its agents, and their pull requests.
  const heldTask = chosen?.holder.task;
  const descriptionText = useSavedDescriptionText(heldTask);
  const mentions =
    place === undefined || heldTask === undefined
      ? undefined
      : heldTaskMentions(
          heldTask,
          place.workspace,
          descriptionText,
          { pages: view.pages, agents: named, readAgents: readMentionAgents },
          { onOpenTask: openMention, onOpenFile: openMentionedFile },
        );
  const drawing = useSidePanelDrawing(sidePanel);
  const views = useTabViews();
  // The panel holds the keys while the focus went into it last, or while it fills the window over the Inbox.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The item shown is read as it opens, and U marks it, only while the Inbox holds the keys and the panel does not cover it.
  const opened =
    tasks.shown && !sidePanel.fullScreen && columns.shown !== INBOX_COLUMNS.LIST
      ? chosen
      : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: chosen?.item,
    active: tasks.shown && !sideFocused,
    marks,
  });
  // ⌘O opens what holds the keys in its full place: the agent the panel shows while it holds them, in its task; else the item shown, in its task.
  const panelAgent =
    sideFocused &&
    sidePanel.tab !== undefined &&
    typeof sidePanel.tab !== "string" &&
    sidePanel.tab.kind === STRIP_TAB_KIND.TRANSCRIPT
      ? sidePanel.tab.transcript
      : undefined;
  const openInTask = (): (() => void) | undefined => {
    if (!tasks.shown) return undefined;
    if (panelAgent !== undefined && taskId !== undefined) {
      return () => tasks.onShowAgent(taskId, panelAgent);
    }
    if (opened === undefined) return undefined;
    const { task } = opened.holder;
    return () => tasks.onShowTask(task.id);
  };
  useAppCommand(APP_COMMAND.OPEN_IN_TASK, openInTask());
  // ⌘O acts on the item's task while the item shown takes it, so its menus print it.
  const opensInTask =
    !tasks.shown || (panelAgent !== undefined && taskId !== undefined) || opened === undefined
      ? undefined
      : shortcutSubject(SHORTCUT_SUBJECT.TASK, opened.holder.task.id);
  useShortcutTarget(opensInTask, OPEN_IN_TASK_KEYS);
  const { pages } = view;
  // The panel's state is held to the task's agents this Inbox read, whose Pull request tabs alone the panel draws, an archived one's among them.
  const { onTaskAgents } = view;
  const taskAgents = agents.agents;
  useEffect(() => {
    if (taskId === undefined || taskAgents === undefined) return;
    onTaskAgents(
      taskId,
      taskAgents.map((agent) => agent.id),
      heldIds,
    );
  }, [taskId, taskAgents, heldIds, onTaskAgents]);
  // The chosen item's thread, beside the list or in its place.
  const itemPane = (listed: InboxListed) => (
    <OpenAddressesHere value={openHere}>
      <SkillFiles
        source={agents.readSkills}
        onOpen={(skill) => {
          // Note that a skill's file opens in the panel beside the Inbox as a file the item names does, once the item's repository is known.
          if (place !== undefined) openMentionedFile(skill.path, undefined);
        }}
      >
        {/* The item's links are written under its own workspace, which a link may open outside the one listed. */}
        <LinkWorkspaceProvider value={chosenLinkWorkspace}>
          {/* Its thread's words read their mentions where its box does, so a file it names opens as its code does. */}
          <TaskMentions value={mentions}>
            <DraftedInboxPane
              holder={listed.holder}
              item={listed.item}
              control={live}
              scope={liveScope}
              opened={opened}
              readerId={tasks.me}
              agents={named}
              hidden={columns.shown === INBOX_COLUMNS.LIST}
              onBack={columns.onBack}
              pager={columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined}
              mentions={mentions}
              newThread={newThread}
              phone={
                phone
                  ? {
                      onShowPanel: sidePanel.open ? undefined : sidePanel.onToggle,
                      narrowedTask:
                        narrowedTask === undefined ? undefined : (narrowedTaskName ?? "Task"),
                    }
                  : undefined
              }
              doors={{
                ...paneDoors(tasks, listed.holder, { panelFor: taskId, openPlace: openPlaceHere }),
                onMark: markItem,
                onClose: resolveItems,
                onRemind: marks.onRemind,
                // The thread hands its crumbs the keys only while it is the item shown and the panel beside it does not hold them.
                keys: opened?.item.id === listed.item.id && !sideFocused,
              }}
            />
          </TaskMentions>
        </LinkWorkspaceProvider>
      </SkillFiles>
    </OpenAddressesHere>
  );
  // The panel stands for the chosen item's task, so its links are written under the item's own workspace, as its pane's are.
  // Note that it follows the window's choice, so it stands as last drawn while a choice made here settles (`useChoiceFirst`).
  // Note that the item's opener stands over the panel as over its pane, but not over the list, whose cards are other tasks'.
  const heldPanel = useHeldWhile(
    settling,
    // Note that the panel stands while its toggle asks for its "+" with nothing to show, drawing the menu alone.
    drawing.panel !== undefined || sidePanel.toggleAsked ? (
      // Note that the item's opener stands over the panel as over its pane, but not over the list, whose cards are other tasks'.
      <OpenAddressesHere value={openHere}>
        <LinkWorkspaceProvider value={chosenLinkWorkspace}>
          <InboxSidePanel
            tasks={tasks}
            openPlace={openPlaceHere}
            drawing={{ ...drawing, panel: drawing.panel ?? sidePanel }}
            focused={sideFocused}
            taskId={taskId}
            repository={chosenTask?.repository ?? null}
            pages={pages}
            agents={named}
            views={views}
            mentions={mentions}
            phone={
              room === SHELL_ROOM.NARROW && chosen !== undefined
                ? { back: cardTitle(chosen.item.title), onBack: sidePanel.onToggle }
                : undefined
            }
          />
        </LinkWorkspaceProvider>
      </OpenAddressesHere>
    ) : null,
  );
  return (
    <LinkWorkspaceProvider value={listedWorkspace?.slug ?? listedWorkspace?.id}>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <AutomationDirectory workspace={tasks.workspace} wanted onOpen={openAutomation}>
          <div
            ref={onArea}
            className="desktop-task relative flex min-h-0 flex-1"
            data-panel-open={String(sidePanel.open)}
            data-page="inbox"
          >
            {/* Hidden rather than left out while the panel fills the window, as a plan's column is. */}
            <PageFind
              page={FIND_PAGE.INBOX}
              active={tasks.shown && !sideFocused}
              hidden={sidePanel.fullScreen}
            >
              <div className={INBOX_VIEW} ref={columns.ref} data-columns={columns.shown}>
                <InboxList
                  view={list}
                  chosen={chosen?.item.id}
                  columns={columns.shown}
                  rows={columns.rows}
                  head={{
                    // Note that a panel filling the window covers the list, so H and E stand down under it.
                    shown: tasks.shown && !sidePanel.fullScreen,
                    // Note that a task's items are listed whole, so its Inbox offers no view's menu.
                    view: narrowedTask === undefined ? choices : undefined,
                    search,
                    phone:
                      room === SHELL_ROOM.NARROW
                        ? {
                            start: phoneStart,
                            readAll: { unread, onMarkAll: markAll },
                          }
                        : undefined,
                    readAll:
                      room === SHELL_ROOM.NARROW || narrowedTask !== undefined
                        ? undefined
                        : { unread, onMarkAll: markAll },
                    task:
                      narrowedTask === undefined
                        ? undefined
                        : {
                            name: narrowedTaskName,
                            status: narrowedTaskRow?.status,
                            onClear: inbox.widen,
                          },
                  }}
                  models={named.models}
                  readerId={tasks.me}
                  reading={reading}
                  note={
                    <InboxListNote
                      failed={failed}
                      reading={reading}
                      empty={listedRows.length === 0}
                      alone={columns.shown === INBOX_COLUMNS.LIST}
                      filteredOut={filteredOut ? choices : undefined}
                      counts={counts}
                      onList={columns.onList}
                      onRetry={onRetry}
                      searched={searched}
                      onNewTask={newTask}
                      none={narrowedTask === undefined ? undefined : NOTHING_HERE}
                    />
                  }
                  onChoose={open}
                  onMark={(listed, unread, saying) => markItem(listed.item, unread, saying)}
                  onClose={resolveItems}
                  onRemind={marks.onRemind}
                  onPointing={onPointing}
                />
                {chosen === undefined ? (
                  <section
                    className={INBOX_VIEW_ITEMS}
                    hidden={
                      missing || chosenFailed
                        ? columns.shown === INBOX_COLUMNS.LIST
                        : columns.shown !== INBOX_COLUMNS.BOTH
                    }
                  >
                    <Toolbar />
                    {missing ? (
                      <NotFound
                        thing={NOT_FOUND_THING.INBOX_ITEM}
                        action={
                          columns.onBack === undefined
                            ? undefined
                            : { label: BACK_TO_INBOX, onClick: columns.onBack }
                        }
                      />
                    ) : chosenFailed ? (
                      <ErrorState
                        failure={unreadShown(FAILURE_SURFACE.INBOX_ITEM_READ)}
                        placement={ERROR_STATE_PLACEMENT.CENTERED}
                        onRetry={onRetryChosen}
                      >
                        {ITEM_NOT_READ}
                      </ErrorState>
                    ) : failed || reading || filteredOut || searched !== undefined ? null : (
                      // Note that the list says the read failed, or what the filter or its search left out, so the pane beside it stands bare.
                      <InboxPaneEmpty
                        listed={listedRows.length}
                        newTask={newTask}
                        none={narrowedTask === undefined ? undefined : NOTHING_HERE}
                      />
                    )}
                  </section>
                ) : (
                  itemPane(chosen)
                )}
              </div>
            </PageFind>
            {heldPanel}
          </div>
        </AutomationDirectory>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
});

/** The key the Inbox offers on the item shown's task, which opens it in its full place. */
const OPEN_IN_TASK_KEYS: readonly KeyedCommand[] = [APP_COMMAND.OPEN_IN_TASK];

/**
 * The chosen item's thread (`InboxPane`), its box's drafts read here,
 * where the box is drawn, rather than by the page around it, so a word typed
 * draws the pane alone (`useInboxCardDrafts`); and its notice acknowledged
 * as it opens, once its holder's held read holds it, unless its box holds
 * words (`useNodOnOpen`).
 */
function DraftedInboxPane({
  control,
  scope,
  opened,
  readerId,
  ...pane
}: Omit<React.ComponentProps<typeof InboxPane>, "control"> & {
  /** The chosen item's holder's own held read, without its cards' drafts. */
  control: HeldTaskInboxControl;
  /** Whose read it is, under which its cards keep their drafts. */
  scope: Parameters<typeof useInboxCardDrafts>[1];
  /** The item shown while the Inbox holds the keys, which is acknowledged as it opens; none while it is not. */
  opened: InboxListed | undefined;
  readerId: string | undefined;
}): React.JSX.Element {
  const live = { ...control, ...useInboxCardDrafts(control, scope) };
  useNodOnOpen({ shown: opened, readerId, control: live });
  return <InboxPane {...pane} control={live} />;
}

/**
 * What an item's box starts a new thread with instead of a reply: a thread
 * with the item's agent, its words and files sent under the key the box
 * minted, opened through `onStarted` once the service took it, or the words
 * of why it did not, a send no answer came back for among them. An agent's
 * card offers the same (`agent-threads.tsx`).
 */
export function startedThreads(
  start: AgentsControl["startInboxThread"],
  onStarted: (item: InboxItem, itemId: string) => void,
): InboxNewThread {
  return {
    onStart: (item, begun) =>
      start({
        agentId: item.agentId,
        text: begun.text,
        ...(begun.attachments.length === 0 ? undefined : { attachments: begun.attachments }),
        clientKey: begun.clientKey,
      })
        .catch(
          (): AgentInboxMessagedView => ({
            failure: AGENT_CALL_FAILURE.UNANSWERED,
          }),
        )
        .then((answer) => {
          if ("failure" in answer) return messageFailureWords(answer.failure);
          onStarted(item, answer.item.id);
          return undefined;
        }),
  };
}

/** A file the item names as its code names it: its path, and its lines where it names them. */
function fileRef(path: string, lines: OpenFileLines | undefined): CodeRef {
  return lines === undefined
    ? { path }
    : { path, startLine: lines.startLine, endLine: lines.endLine };
}

/**
 * Where the chosen item's words are read in the window's Inbox, which
 * stands on no plan's page: its plan's workspace, by its slug, and
 * repository. Its box mentions what that repository and workspace hold, as
 * the plan's page does (`heldTaskMentions`), and its skills' files open
 * there. None until both are known.
 */
function answerPlace(holder: InboxHolder, tasks: TasksControl): TasklessPlace | undefined {
  const { workspaceId, repository } = holder.task;
  if (workspaceId === undefined || repository === undefined || repository === null) {
    return undefined;
  }
  const workspace = tasks.workspaces.find((each) => each.id === workspaceId)?.slug ?? workspaceId;
  return { workspace, workspaceId, repository };
}

/**
 * The side panel beside the Inbox, standing for the chosen item's task
 * (`use-tasks-tab.ts`): what the item opened
 * there, and what the task's "+" offers of it. A row of its tabs that
 * opens what it names opens it as the item's crumbs and links do: an
 * agent's tab leaves for it, a page stands in the panel, and the task's
 * own tabs leave for the task.
 */
function InboxSidePanel({
  tasks,
  openPlace,
  drawing,
  focused,
  taskId,
  repository,
  pages,
  agents,
  views,
  mentions,
  phone,
}: {
  tasks: TasksControl;
  /** Opens a place a row names as a link to it would beside the item, else through the door given. */
  openPlace: (place: LinkDestination, elsewhere: () => void) => void;
  drawing: SidePanelDrawing & { panel: SidePanelControl };
  focused: boolean;
  /** The chosen item's task, none before an item is chosen. */
  taskId: string | undefined;
  repository: string | null;
  pages: TasksControl["inboxView"]["pages"];
  agents: AgentsControl;
  views: TabViews;
  /** What the item's box offers an `@`, which every tab beside it offers too: an agent's composer, and a page's comments. */
  mentions: TaskMentionsValue | undefined;
  /** Where the panel heads itself on a phone, its way back shutting it to the item (`SidePanel`'s `phone`). */
  phone: { readonly back: string; readonly onBack: () => void } | undefined;
}): React.JSX.Element {
  const { panel } = drawing;
  const cloudTerminalTab = useCloudTerminalTab();
  const terminals =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.TERMINALS) }).data ===
    true;
  // A row opens what it names as a link to it would beside the item (`inbox-item-links.ts`): an agent of the
  // item's task reads beside it in the panel, and any other task or agent is gone to.
  const openTarget = (target: ToolTarget) => {
    switch (target.kind) {
      case TOOL_TARGET.PAGE:
        return panel.onOpen(pageTab(target.page));
      case TOOL_TARGET.TASK:
        return openPlace(placeOfTaskTarget(target), () =>
          target.agent === undefined
            ? tasks.onShowTask(target.task)
            : tasks.onShowAgent(target.task, target.agent),
        );
      case TOOL_TARGET.AGENT: {
        const { agent } = target;
        if (taskId === undefined) return;
        return openPlace({ kind: LINK_DESTINATION.AGENT, planId: taskId, agentId: agent }, () =>
          tasks.onShowAgent(taskId, agent),
        );
      }
      case TOOL_TARGET.DESCRIPTION:
        if (taskId === undefined) return;
        return openPlace({ kind: LINK_DESTINATION.TASK, planId: taskId }, () =>
          tasks.onShowTask(taskId),
        );
      case TOOL_TARGET.INBOX:
      case TOOL_TARGET.PULL_REQUEST:
        return;
    }
  };
  // An agent's transcript beside the item reads and writes as its tab in the task's column does,
  // through the agents the Inbox read of the item's task, its plan's card naming the task, whose
  // press opens the plan. Note that no press opens one here any more, since an agent opens in its own
  // tab on the task (`inbox-item-links.ts`); it is drawn only for a tab an earlier version kept.
  const listedTask =
    taskId === undefined ? undefined : tasks.tasks.find((each) => each.id === taskId);
  const cards = taskCards({
    agents,
    held: views.held,
    chosen: (opened) =>
      typeof opened !== "string" &&
      opened.kind === STRIP_TAB_KIND.AGENT &&
      panel.tab !== undefined &&
      typeof panel.tab !== "string" &&
      panel.tab.kind === STRIP_TAB_KIND.TRANSCRIPT
        ? panel.tab.transcript === opened.agent
        : panel.tab !== undefined && sameTab(opened, panel.tab),
    pages: taskId === undefined ? undefined : { taskId },
    task:
      listedTask === undefined
        ? undefined
        : {
            name: listedTask.name,
            status: listedTask.status,
            card: taskCardOf(tasks, listedTask, undefined),
          },
  });
  const transcript = (agentId: string) => {
    const agent = agents.agents?.find((each) => each.id === agentId);
    return (
      <AgentPane
        label={agent === undefined ? undefined : agentName(agent, agents.models)}
        tabbed={false}
        tab={agentTab(agentId)}
        agents={agents}
        shown={tasks.shown}
        views={views}
        // Note that a worker is drawn beside its agent's column alone, so its row goes to the task.
        onOpenDelegation={(agent, callId, _task, status) => {
          views.onWorkerStatus(callId, status);
          if (taskId !== undefined) tasks.onShowAgent(taskId, agent);
        }}
        onOpenPullRequest={(agent) =>
          showPullRequest(panel, agents, agent, PULL_REQUEST_VIEW.CONVERSATION)
        }
        onOpenTarget={openTarget}
        cards={cards}
      />
    );
  };
  // Note that every tab beside the item reads the mentions its box offers, so a page's comment is written in the box's editor, its quotes as blocks, as on the task.
  return (
    <TaskMentions value={mentions}>
      <SidePanel
        {...drawing}
        unread={NO_UNREAD}
        holder={SIDE_PANEL_HOLDER.INBOX}
        taskId={taskId ?? ""}
        repository={repository}
        pages={pages}
        agents={agents}
        openAgents={NO_OPEN_AGENTS}
        shownAgent={undefined}
        views={views}
        shown={tasks.shown}
        focused={focused}
        onOpenTarget={openTarget}
        transcript={taskId === undefined ? undefined : transcript}
        transcriptDoors={
          taskId === undefined
            ? undefined
            : {
                // Note that an agent's terminal never stands beside the Inbox, so it opens on the agent's task.
                onOpenInTask: (agentId) => tasks.onShowAgent(taskId, agentId),
                onOpenTerminal: terminals
                  ? (agentId) => tasks.onShowPanelTab(taskId, cloudTerminalTab(agentId))
                  : undefined,
              }
        }
        phone={phone}
        taskOfTab={tasks}
      />
    </TaskMentions>
  );
}

/**
 * The pane's doors for the task holding its item: they open the task, its
 * agents' tabs, and its files, a file in the panel beside the Inbox where
 * the panel stands for the task. An agent's card hands its threads the same
 * doors (`agent-threads.tsx`).
 */
export function paneDoors(
  tasks: TasksControl,
  holder: InboxHolder,
  seams: {
    /** The task the panel beside the Inbox stands for. */
    panelFor: string | undefined;
    /** Opens a place a part of the item names as a link to it would beside the item (`inbox-item-links.ts`), else through the door given. */
    openPlace: (place: LinkDestination, elsewhere: () => void) => void;
  },
): InboxPaneDoors {
  const { task } = holder;
  // An agent the item or its task's card names reads beside it, as a link to it does.
  // Note that an archived agent's tab is not drawn beside the item, so the window opens it on its task.
  const openAgent = (taskId: string, agentId: string) =>
    seams.openPlace({ kind: LINK_DESTINATION.AGENT, planId: taskId, agentId }, () =>
      tasks.onShowAgent(taskId, agentId),
    );
  // A task the card names, its parent or a sub-task, opens as a link to it does.
  const openTask = (taskId: string) =>
    seams.openPlace({ kind: LINK_DESTINATION.TASK, planId: taskId }, () => tasks.onSelect(taskId));
  return {
    tasks,
    onOpenHolder: () => tasks.onShowTask(task.id),
    // Note that the card's times count from the window's minute, so the page reads no clock.
    taskCard: taskCardOf({ ...tasks, onShowAgent: openAgent, onSelect: openTask }, task, undefined),
    onOpenAgent: (agentId) => openAgent(task.id, agentId),
    code: {
      repository: task.repository,
      place: { taskId: task.id },
      // Note that code is a link like any other: beside the item it opens in a File tab of the panel.
      onOpenFile: (ref, commit) =>
        seams.panelFor === task.id
          ? pressTab({ ...tasks, onKeys: tasks.onTabKeys }, { kind: TAB_PRESS.FILE, ref, commit })
          : tasks.onShowFile(task.id, ref, commit),
    },
  };
}
