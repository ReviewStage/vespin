// menu-commands.tsx -- the iPad menu bar's commands, routed: what stands in front told to the native menu, so each command is enabled and worded for it, and each press acted on as the screen's own press would.

import type { ListedAgent } from "@repo/features/agent-wire";
import { inboxRowOf } from "@repo/features/inbox-digest";
import { holderTask, holderWorkspaceId, isUnread } from "@repo/features/inbox-list-model";
import { REMIND_TIMES } from "@repo/features/inbox-remind-times";
import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import {
  MENU_COMMAND,
  MENU_OWN_PAGE,
  MENU_SUBJECT,
  type MenuCommand,
  type MenuFocus,
  type MenuOwnPage,
  type MenuRouteParams,
  menuFocusOf,
  menuOwnPageOf,
} from "@repo/features/ios-menu-commands";
import {
  GITHUB_PAGE,
  gitHubPageLink,
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  linkWorkspaceStep,
} from "@repo/features/link-grammar";
import { LINK_PAGE } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { READ_MARK } from "@repo/features/read-mark";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { taskRowLook } from "@repo/features/task-tree-model";
import { TASK_STATUS, type TaskSummary } from "@repo/features/task-wire";
import {
  MARK_FAILED_NOTES,
  settleFailedNote,
  settleStopWords,
  TASK_MARK,
} from "@repo/features/tasks-model";
import { VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { selectAgentPinned, selectWorkspaces } from "@repo/host/app-state-reads";
import { CONTACT_MAILTO } from "@repo/host/contract";
import { windowRows } from "@repo/host/read-window";
import { BUZZ, ConfirmAsk, useWindowSizeClass, WINDOW_SIZE_CLASS } from "@repo/ui-native";
import { and, type Collection, eq, isUndefined } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { openURL } from "expo-linking";
import {
  useGlobalSearchParams,
  useNavigationContainerRef,
  usePathname,
  useRootNavigationState,
  useRouter,
} from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentRowActs } from "../agents/use-agent.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useTaskListCollections, useTaskListRow } from "../host/host-provider.js";
import { useWindow } from "../host/use-window.js";
import { useInboxShown } from "../inbox/inbox-shown.js";
import { useFrontSteps, useInboxActs, useInboxThread } from "../inbox/use-inbox.js";
import { openInSafari } from "../open-link.js";
import { SEARCH_FOCUS_PARAM } from "../search-field.js";
import { SETTINGS_ROUTE, useOpenSettings } from "../settings-button.js";
import { APP_SIDEBAR, useSidebarShown } from "../sidebar-shown.js";
import { useSignOut } from "../sign-out.js";
import { useHeldTasksNamed } from "../tasks/use-found-task.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import { menuCommandsModule } from "./menu-commands-module.js";
import { type NavigatorState, tabStackBacks, tabsInFront } from "./window-back.js";

/** What Sign Out asks first, since it leaves the phone with no account until the next sign-in. */
const SIGN_OUT_ASK = {
  TITLE: `Sign out of ${PRODUCT_NAME}?`,
  ACT: VERB.SIGN_OUT,
} as const;

/** The sheets a command opens, by their routes. */
const SHEET_ROUTE = {
  SETTINGS: "/settings",
  NEW_TASK: "/start-task",
  NEW_AGENT: "/start-agent",
} as const;

/** The commands that act on no one thing, enabled whenever an account is signed in, but Inbox while the member turned it off, since no Inbox stands to go to. */
const SIGNED_IN_COMMANDS: readonly MenuCommand[] = [
  MENU_COMMAND.SETTINGS,
  MENU_COMMAND.SIGN_OUT,
  MENU_COMMAND.NEW_TASK,
  MENU_COMMAND.INBOX,
  MENU_COMMAND.TASKS,
  MENU_COMMAND.SEARCH,
];

/** The commands that need no account at all. */
const ALWAYS: readonly MenuCommand[] = [MENU_COMMAND.HELP, MENU_COMMAND.FEEDBACK];

/** The commands that set Remind Me's presets, in REMIND_TIMES' order. */
const REMIND_COMMANDS = [
  MENU_COMMAND.REMIND_HOUR,
  MENU_COMMAND.REMIND_TOMORROW,
  MENU_COMMAND.REMIND_NEXT_WEEK,
] as const;

/** Each preset Remind Me offers, by the command that sets it. */
const REMIND_PRESETS: ReadonlyMap<MenuCommand, (typeof REMIND_TIMES)[number]> = new Map(
  REMIND_TIMES.flatMap((time, at) => {
    const command = REMIND_COMMANDS[at];

    return command === undefined ? [] : [[command, time] as const];
  }),
);

/** What the menu stands in front of, once read: the task or the agent with the task it works on, or the thread with its task. */
interface Subject {
  readonly focus: MenuFocus;
  readonly task: TaskSummary | undefined;
  /** The page's address on vespin.dev, which Open in Browser opens. */
  readonly address: string | undefined;
  readonly enabled: readonly MenuCommand[];
  readonly toggled: readonly MenuCommand[];
  /** The thread in front, by its id, which Mark as Read and Remind Me act on. */
  readonly threadId: string | undefined;
  /** The thread in front, which Resolve settles against the revision it drew. */
  readonly thread: InboxItem | undefined;
  /** The agent in front, which Stop stops and Pin pins. */
  readonly agentId: string | undefined;
  /** Whether the agent in front is pinned, which Pin then unpins. */
  readonly agentPinned: boolean;
  readonly threadUnread: boolean;
}

/**
 * The address a pushed pull request or page opens in the browser: the pull
 * request on GitHub, or the page on vespin.dev in its task's workspace,
 * which a task's page names itself and an agent's page takes from its task.
 */
function ownPageAddress(
  page: MenuOwnPage,
  task: TaskSummary | undefined,
  agentTaskId: string | undefined,
  stepOf: (workspaceId: string | undefined) => string | undefined,
): string | undefined {
  switch (page.kind) {
    case MENU_OWN_PAGE.PULL_REQUEST:
      return gitHubPageLink({
        kind: GITHUB_PAGE.PULL_REQUEST,
        repository: page.repository,
        number: page.number,
      });
    case MENU_OWN_PAGE.TASK_PAGE: {
      const step = stepOf(page.workspaceId ?? task?.workspaceId);

      const place = {
        kind: LINK_DESTINATION.PAGE,
        taskId: page.taskId,
        pageId: page.pageId,
      } as const;

      return step === undefined ? undefined : linkOf(place, step);
    }

    case MENU_OWN_PAGE.AGENT_PAGE: {
      const step = stepOf(task?.workspaceId);

      return step === undefined || agentTaskId === undefined
        ? undefined
        : linkOf({ kind: LINK_DESTINATION.PAGE, taskId: agentTaskId, pageId: page.pageId }, step);
    }
  }
}

/** Reads what the route stands in front into what each command may do to it. */
function useSubject(signedIn: boolean): Subject {
  const pathname = usePathname();
  const params = useGlobalSearchParams<MenuRouteParams>();
  const focus: MenuFocus = signedIn ? menuFocusOf(pathname, params) : { kind: MENU_SUBJECT.NONE };
  const ownPage = signedIn ? menuOwnPageOf(pathname, params) : undefined;

  const thread = useInboxThread(focus.kind === MENU_SUBJECT.THREAD ? focus.id : undefined).listed;
  const collections = useTaskListCollections();
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];

  const agent = useTaskListRow(
    collections.agents,
    focus.kind === MENU_SUBJECT.AGENT ? focus.id : undefined,
  );

  const pinnedOf = useMemo(() => selectAgentPinned(agent?.id ?? ""), [agent?.id]);
  const agentPinned = useQuery({ ...appStateQuery, select: pinnedOf }).data ?? false;

  // Note that the task in front is read by its key alone, so the menu bar is drawn again only as that task moves, never as any other of the account's tasks does.
  const taskNamed = useHeldTasksNamed(focus.kind === MENU_SUBJECT.TASK ? focus.id : undefined)[0];

  const task = useTaskListRow(collections.tasks, taskNamed?.id ?? agent?.taskId ?? undefined);

  const workspaceId =
    (thread === undefined ? undefined : holderWorkspaceId(thread.holder)) ?? task?.workspaceId;

  const workspaceStep = linkWorkspaceStep(workspaceId, workspaces);

  const linked = (place: LinkDestination) =>
    workspaceStep === undefined ? undefined : linkOf(place, workspaceStep);

  const inboxShown = useInboxShown();

  const enabled: MenuCommand[] = signedIn
    ? [
        ...SIGNED_IN_COMMANDS.filter((command) => inboxShown || command !== MENU_COMMAND.INBOX),
        ...ALWAYS,
      ]
    : [...ALWAYS];

  const toggled: MenuCommand[] = [];
  let address: string | undefined;

  if (thread !== undefined) {
    address = linked({
      kind: LINK_DESTINATION.INBOX_ITEM,
      taskId: holderTask(thread.holder)?.id,
      itemId: thread.item.id,
    });
    enabled.push(MENU_COMMAND.TOGGLE_READ, ...REMIND_PRESETS.keys());

    if (thread.item.remindAt !== undefined) enabled.push(MENU_COMMAND.REMIND_CLEAR);

    if (isUnread(thread.item)) toggled.push(MENU_COMMAND.TOGGLE_READ);

    if (thread.item.status === INBOX_STATUS.OPEN) enabled.push(MENU_COMMAND.RESOLVE);
  } else if (agent !== undefined) {
    address = linked(
      task === undefined
        ? { kind: LINK_DESTINATION.AGENT, agentId: agent.id }
        : { kind: LINK_DESTINATION.AGENT, taskId: task.id, agentId: agent.id },
    );

    if (task !== undefined) enabled.push(MENU_COMMAND.NEW_AGENT);

    if (agentStillWriting(agent.status)) enabled.push(MENU_COMMAND.STOP_AGENT);

    // Note that Pin acts on the agent in front, not its task, as the agent page's bar pins it.
    enabled.push(MENU_COMMAND.PIN);

    if (agentPinned) toggled.push(MENU_COMMAND.PIN);
  } else if (task !== undefined) {
    address = linked({ kind: LINK_DESTINATION.TASK, taskId: task.id });
    enabled.push(MENU_COMMAND.NEW_AGENT, MENU_COMMAND.TOGGLE_READ, MENU_COMMAND.PIN);

    if (task.status !== TASK_STATUS.DONE) enabled.push(MENU_COMMAND.MARK_DONE);

    if (taskRowLook(task, 0, undefined).unread) toggled.push(MENU_COMMAND.TOGGLE_READ);

    if (task.pinnedAt !== undefined) toggled.push(MENU_COMMAND.PIN);
  }

  // Note that a pushed pull request or page opens itself in the browser, not the agent or task it stands over.
  if (ownPage !== undefined)
    address = ownPageAddress(ownPage, task, agent?.taskId ?? undefined, (id) =>
      linkWorkspaceStep(id, workspaces),
    );

  if (address !== undefined) enabled.push(MENU_COMMAND.OPEN_IN_BROWSER);

  return {
    focus,
    task,
    address,
    enabled,
    toggled,
    threadId: thread?.item.id,
    thread: thread?.item,
    agentId: agent?.id,
    agentPinned: agent !== undefined && agentPinned,
    threadUnread: thread !== undefined && isUnread(thread.item),
  };
}

/**
 * How many agents of `taskId` are starting or running as Mark Done is
 * pressed, read off the agents the list holds at that moment, so marking it
 * done stops them and asks first. Note that it is read on the press rather
 * than followed, because following it built a query over every agent each
 * time a task came in front, inside the commit its page's push waited on.
 */
function workingAgentsNow(agents: Collection<ListedAgent, string>, taskId: string): number {
  let working = 0;

  for (const agent of agents.values()) {
    if (
      agent.taskId === taskId &&
      agent.archivedAt === undefined &&
      agentStillWriting(agent.status)
    ) {
      working += 1;
    }
  }

  return working;
}

/** How many agents of the task are starting or running, followed while Mark Done's question stands, so its words count them as they stop. */
function useWorkingAgents(taskId: string | undefined): number {
  const { agents } = useTaskListCollections();

  // Note that the query's identity is the values it captures, as TanStack DB 1.0 derives it, so it is made again only for another task.
  const onTask = windowRows(
    useWindow((q) =>
      taskId === undefined
        ? undefined
        : q
            .from({ agent: agents })
            .where(({ agent }) => and(eq(agent.taskId, taskId), isUndefined(agent.archivedAt))),
    ),
  );

  // Note that the rows are matched to the task again, since a read rebuilt for another task holds the last task's rows until it answers.
  return onTask.filter((agent) => agent.taskId === taskId && agentStillWriting(agent.status))
    .length;
}

/** The question a command asks before it acts. */
const ASK = {
  NONE: "none",
  SIGN_OUT: "signOut",
  MARK_DONE: "markDone",
} as const;

type Ask = (typeof ASK)[keyof typeof ASK];

/**
 * The menu bar's commands, mounted once at the root over every screen: what
 * stands in front is told to the native menu as it changes, each press is
 * acted on as the screen's own control would act, the panel's acts sent on
 * the host's port, and Sign Out and Mark Done on a task whose agents work ask
 * first, as their screens' controls do. Every command here is also reachable
 * without the menu bar: from a tab, a row's or a page's menu, or Settings.
 * Draws only those questions; on an iPhone, where no menu bar stands, the
 * module draws nothing and no press ever comes.
 */
export function MenuCommands({ signedIn }: { readonly signedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const acts = useHostActs();
  const write = useWrite();
  const inbox = useInboxActs();
  const agentActs = useAgentRowActs();
  const signOut = useSignOut();
  const openSettings = useOpenSettings();
  const subject = useSubject(signedIn);
  const switcher = useWorkspaceSwitcher();
  const workspaces = signedIn ? (switcher?.workspaces ?? []) : [];
  const workspaceNames = workspaces.map(({ name }) => name);
  const chosenWorkspace = workspaces.findIndex(({ id }) => id === switcher?.chosen.id);
  const sidebar = useSidebarShown();
  // Note that Show or Hide Sidebar acts in any regular window, on the list beside its detail, as a two-column split view's own button does, but an iPad's, whose sidebar is the system's split view's own column, shown and hidden by its own button, swipe and command.
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const sidebarStands = signedIn && regular && !APP_SIDEBAR;

  // Note that Back pops a page the tab pushed over the window, as a stack's own Back does; never a sheet, which closes with its own Done or Cancel.
  const root: NavigatorState = useRootNavigationState();
  const navigation = useNavigationContainerRef();
  const tabs = tabsInFront(root);

  const backs = signedIn && tabs !== undefined && tabStackBacks(tabs);

  // Note that K and J step from the thread in front through what its screen draws, which stands its own steps (`useStandFrontSteps`), so the menu keeps no list or scope of its own.
  const steps = useFrontSteps();

  const enabled = [
    ...subject.enabled,
    ...(workspaces.length > 0 ? [MENU_COMMAND.SWITCH_WORKSPACE] : []),
    ...(sidebarStands ? [MENU_COMMAND.SIDEBAR] : []),
    ...(backs ? [MENU_COMMAND.BACK] : []),
    ...(signedIn && steps.previous !== undefined ? [MENU_COMMAND.PREVIOUS_ITEM] : []),
    ...(signedIn && steps.next !== undefined ? [MENU_COMMAND.NEXT_ITEM] : []),
  ];

  const toggled = [
    ...subject.toggled,
    ...(sidebarStands && !sidebar.shown ? [MENU_COMMAND.SIDEBAR] : []),
  ];

  const [asking, setAsking] = useState<Ask>(ASK.NONE);
  const { agents } = useTaskListCollections();
  const working = useWorkingAgents(asking === ASK.MARK_DONE ? subject.task?.id : undefined);
  // Note that the menu is told only as what it shows changes, since each telling rebuilds it.
  const told = useRef<string>(undefined);
  useEffect(() => {
    const now = JSON.stringify([
      subject.focus.kind,
      enabled,
      toggled,
      workspaceNames,
      chosenWorkspace,
    ]);

    if (told.current === now) return;
    told.current = now;
    menuCommandsModule.setState(
      subject.focus.kind,
      enabled,
      toggled,
      workspaceNames,
      chosenWorkspace,
    );
  });

  // Note that a refused sign-out says why in the failure notice, with Try again, since the phone is still signed in and nothing here needs deciding.
  const signOutNow = () => {
    void signOut();
  };

  const markDone = (stopAgents?: true) => {
    const taskId = subject.task?.id;

    if (taskId === undefined) return;
    const stopping = stopAgents === undefined ? undefined : { stopAgents };
    write(
      () => acts[ACT_KIND.TASKS_SET_STANDING]({ taskId, status: TASK_STATUS.DONE, ...stopping }),
      {
        refused: (landed) => (landed ? undefined : settleFailedNote(TASK_STATUS.DONE, 1)),
        retry: true,
        subject: { kind: WRITE_SUBJECT.TASK_STATUS, id: taskId },
        went: BUZZ.SUCCESS,
      },
    );
  };

  // Note that a sheet already standing is not opened again, so a key pressed twice never stacks two of it.
  const standing = (route: string) => pathname === route || pathname.startsWith(`${route}/`);

  const act = (command: MenuCommand, index: number | undefined) => {
    if (!enabled.includes(command)) return;
    const { task, threadId } = subject;
    const preset = REMIND_PRESETS.get(command);

    if (preset !== undefined) {
      if (threadId !== undefined) inbox.remind(threadId, preset.at(Date.now()));

      return;
    }

    switch (command) {
      case MENU_COMMAND.SETTINGS:
        if (!standing(SHEET_ROUTE.SETTINGS)) openSettings();

        return;
      case MENU_COMMAND.SWITCH_WORKSPACE: {
        const picked = index === undefined ? undefined : workspaces[index];

        if (picked !== undefined) switcher?.onChoose(picked.id);

        return;
      }

      case MENU_COMMAND.SIGN_OUT:
        return setAsking(ASK.SIGN_OUT);
      case MENU_COMMAND.NEW_TASK:
        if (!standing(SHEET_ROUTE.NEW_TASK)) router.push(SHEET_ROUTE.NEW_TASK);

        return;
      case MENU_COMMAND.NEW_AGENT:
        if (task !== undefined && !standing(SHEET_ROUTE.NEW_AGENT))
          router.push({ pathname: SHEET_ROUTE.NEW_AGENT, params: { task: task.id } });

        return;
      case MENU_COMMAND.INBOX:
        return router.navigate("/inbox");
      case MENU_COMMAND.TASKS:
        return router.navigate("/tasks");
      case MENU_COMMAND.SEARCH:
        // Note that Search is opened asking for its field's focus, since the system activates it only as its tab is tapped.
        return router.navigate({ pathname: "/search", params: { [SEARCH_FOCUS_PARAM]: "1" } });
      case MENU_COMMAND.SIDEBAR:
        return sidebar.toggle();
      case MENU_COMMAND.BACK: {
        // Note that the tab's stack is read again at the press, because a held ⌘[ repeats before this render's enablement catches up, and a Back at the tab's root would go to the first tab.
        const liveRoot: NavigatorState | undefined = navigation.getRootState();
        const live = tabsInFront(liveRoot);

        if (live !== undefined && tabStackBacks(live)) router.back();

        return;
      }

      case MENU_COMMAND.PREVIOUS_ITEM:
        if (steps.previous !== undefined) steps.go(steps.previous);

        return;
      case MENU_COMMAND.NEXT_ITEM:
        if (steps.next !== undefined) steps.go(steps.next);

        return;
      case MENU_COMMAND.MARK_DONE:
        if (task !== undefined && workingAgentsNow(agents, task.id) > 0) {
          setAsking(ASK.MARK_DONE);
        } else markDone();

        return;
      case MENU_COMMAND.TOGGLE_READ:
        if (subject.thread !== undefined)
          inbox.mark(inboxRowOf(subject.thread), !subject.threadUnread);
        else if (task !== undefined) {
          const unread = subject.toggled.includes(MENU_COMMAND.TOGGLE_READ);
          const readMark = unread ? READ_MARK.READ : READ_MARK.UNREAD;
          write(() => acts[ACT_KIND.TASKS_MARK_READ]({ taskId: task.id, readMark }), {
            retry: true,
            subject: { kind: WRITE_SUBJECT.TASK_READ, id: task.id },
          });
        }

        return;
      case MENU_COMMAND.PIN:
        if (subject.agentId !== undefined) {
          agentActs.pin(subject.agentId, !subject.agentPinned);

          return;
        }

        if (task === undefined) return;
        {
          const pinned = task.pinnedAt === undefined;
          write(() => acts[ACT_KIND.TASKS_PIN]({ taskId: task.id, pinned }), {
            refused: (landed) =>
              landed ? undefined : MARK_FAILED_NOTES[pinned ? TASK_MARK.PIN : TASK_MARK.UNPIN],
            retry: true,
            subject: { kind: WRITE_SUBJECT.TASK_PIN, id: task.id },
            went: BUZZ.SELECTION,
          });
        }

        return;
      case MENU_COMMAND.RESOLVE:
        if (subject.thread !== undefined) inbox.resolve(subject.thread);

        return;
      case MENU_COMMAND.STOP_AGENT:
        if (subject.agentId !== undefined) agentActs.stop(subject.agentId);

        return;
      case MENU_COMMAND.REMIND_CLEAR:
        if (threadId !== undefined) inbox.remind(threadId, null);

        return;
      case MENU_COMMAND.OPEN_IN_BROWSER:
        if (subject.address !== undefined) openInSafari(subject.address);

        return;
      case MENU_COMMAND.HELP:
        return openInSafari(LINK_PAGE.DOCS);
      // Note that the form needs an account, so a signed-out app, or one the service refuses as too old, writes the contact mail as it always did.
      case MENU_COMMAND.FEEDBACK:
        if (!signedIn) {
          openURL(CONTACT_MAILTO).catch((cause: unknown) =>
            console.error("The feedback mail did not open.", cause),
          );

          return;
        }

        if (!standing(SETTINGS_ROUTE.FEEDBACK)) openSettings(SETTINGS_ROUTE.FEEDBACK);

        return;
      // Note that Remind Me's presets were set above, by the time each sets.
      case MENU_COMMAND.REMIND_HOUR:
      case MENU_COMMAND.REMIND_TOMORROW:
      case MENU_COMMAND.REMIND_NEXT_WEEK:
        return;
      default: {
        // Note that a command with no case fails to compile, and one the native side sends that this build does not know is said rather than thrown, since a throw in a native event's listener ends a Release build.
        const unhandled: never = command;
        console.error(`The menu command ${String(unhandled)} has no handler.`);
      }
    }
  };

  // Note that the listener reads the newest committed `act` through a ref, so it is added once rather than at every render.
  const latest = useRef(act);
  useEffect(() => {
    latest.current = act;
  });
  useEffect(() => {
    const listening = menuCommandsModule.addListener("onCommand", ({ command, index }) =>
      latest.current(command, index),
    );

    return () => listening.remove();
  }, []);

  const done = settleStopWords(TASK_STATUS.DONE, working);
  const dismiss = () => setAsking(ASK.NONE);

  return (
    <>
      <ConfirmAsk
        title={SIGN_OUT_ASK.TITLE}
        act={SIGN_OUT_ASK.ACT}
        destructive
        presented={asking === ASK.SIGN_OUT}
        onAct={() => {
          dismiss();
          signOutNow();
        }}
        onDismiss={dismiss}
      />
      <ConfirmAsk
        title={done.title}
        message={done.body}
        act={done.verb}
        destructive
        presented={asking === ASK.MARK_DONE}
        onAct={() => {
          dismiss();
          markDone(true);
        }}
        onDismiss={dismiss}
      />
    </>
  );
}
