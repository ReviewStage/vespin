// menu-commands.tsx -- the iPad menu bar's commands, routed: what stands in front told to the native menu, so each command is enabled and worded for it, and each press acted on as the screen's own press would.

import { isUnread } from "@repo/features/inbox-list-model";
import { REMIND_TIMES } from "@repo/features/inbox-remind-times";
import {
  MENU_COMMAND,
  MENU_SUBJECT,
  type MenuCommand,
  type MenuFocus,
  menuFocusOf,
} from "@repo/features/ios-menu-commands";
import { LINK_DESTINATION, type LinkDestination, linkOf } from "@repo/features/link-grammar";
import { LINK_PAGE } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { READ_MARK } from "@repo/features/read-mark";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { taskRowLook } from "@repo/features/task-tree-model";
import { TASK_STATUS, type TaskSummary } from "@repo/features/task-wire";
import { settleStopWords } from "@repo/features/tasks-model";
import { VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { selectTasks, selectWorkspaces } from "@repo/host/app-state-reads";
import { CONTACT_MAILTO } from "@repo/host/contract";
import { BUZZ, buzz, ConfirmAsk } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { openURL } from "expo-linking";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useInboxActs, useInboxThread } from "../inbox/use-inbox.js";
import { openInSafari } from "../open-link.js";
import { useOpenSettings } from "../settings-button.js";
import { useSidebarShown } from "../sidebar-shown.js";
import { signOutRefusalWords, useSignOut } from "../sign-out.js";
import { useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import { menuCommandsModule } from "./menu-commands-module.js";

/** What Sign Out asks first, since it leaves the phone with no account until the next sign-in. */
const SIGN_OUT_ASK = {
  TITLE: `Sign out of ${PRODUCT_NAME}?`,
  ACT: VERB.SIGN_OUT,
  REFUSED: "Couldn't sign out",
  AGAIN: "Try again",
} as const;

/** The commands that act on no one thing, enabled whenever an account is signed in. */
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
  readonly threadUnread: boolean;
}

/** Whether a link's word names the task: its id, or its number as a task link spells one. */
function namesTask(task: TaskSummary, named: string): boolean {
  return task.id === named || (task.number !== undefined && String(task.number) === named);
}

/** Reads what the route stands in front into what each command may do to it. */
function useSubject(signedIn: boolean): Subject {
  const pathname = usePathname();
  const { selected } = useGlobalSearchParams<{ selected?: string }>();
  const focus: MenuFocus = signedIn ? menuFocusOf(pathname, selected) : { kind: MENU_SUBJECT.NONE };
  const thread = useInboxThread(focus.kind === MENU_SUBJECT.THREAD ? focus.id : undefined).listed;
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const agent =
    focus.kind === MENU_SUBJECT.AGENT
      ? view?.taskAgents?.find(({ id }) => id === focus.id)
      : undefined;
  const taskNamed =
    focus.kind === MENU_SUBJECT.TASK
      ? (view?.tasks ?? []).find((each) => namesTask(each, focus.id))
      : undefined;
  const task =
    taskNamed ??
    (agent === undefined ? undefined : view?.tasks?.find(({ id }) => id === agent.planId));
  const workspaceId = thread?.holder.task.workspaceId ?? task?.workspaceId;
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const linked = (place: LinkDestination) =>
    linkOf(place, workspace?.slug ?? workspace?.id ?? workspaceId ?? "");
  const enabled: MenuCommand[] = signedIn ? [...SIGNED_IN_COMMANDS, ...ALWAYS] : [...ALWAYS];
  const toggled: MenuCommand[] = [];
  let address: string | undefined;
  if (thread !== undefined) {
    address = linked({
      kind: LINK_DESTINATION.INBOX_ITEM,
      planId: thread.holder.task.id,
      itemId: thread.item.id,
    });
    enabled.push(MENU_COMMAND.TOGGLE_READ, ...REMIND_PRESETS.keys());
    if (thread.item.remindAt !== undefined) enabled.push(MENU_COMMAND.REMIND_CLEAR);
    if (isUnread(thread.item)) toggled.push(MENU_COMMAND.TOGGLE_READ);
  } else if (agent !== undefined) {
    address = linked(
      task === undefined
        ? { kind: LINK_DESTINATION.AGENT, agentId: agent.id }
        : { kind: LINK_DESTINATION.AGENT, planId: task.id, agentId: agent.id },
    );
    if (task !== undefined) enabled.push(MENU_COMMAND.NEW_AGENT);
  } else if (task !== undefined) {
    address = linked({ kind: LINK_DESTINATION.TASK, planId: task.id });
    enabled.push(MENU_COMMAND.NEW_AGENT, MENU_COMMAND.TOGGLE_READ, MENU_COMMAND.PIN);
    if (task.status !== TASK_STATUS.DONE) enabled.push(MENU_COMMAND.MARK_DONE);
    if (taskRowLook(task, 0, undefined).unread) toggled.push(MENU_COMMAND.TOGGLE_READ);
    if (task.pinnedAt !== undefined) toggled.push(MENU_COMMAND.PIN);
  }
  if (address !== undefined) enabled.push(MENU_COMMAND.OPEN_IN_BROWSER);
  return {
    focus,
    task,
    address,
    enabled,
    toggled,
    threadId: thread?.item.id,
    threadUnread: thread !== undefined && isUnread(thread.item),
  };
}

/** Whether any agent of the task is starting or running, so marking it done stops them and asks first. */
function useAgentsWorking(taskId: string | undefined): boolean {
  const { data: working = false } = useQuery({
    ...appStateQuery,
    select: (state) =>
      taskId !== undefined &&
      (selectTasks(state).taskAgents ?? []).some(
        (agent) =>
          agent.planId === taskId &&
          agent.archivedAt === undefined &&
          agentStillWriting(agent.status),
      ),
  });
  return working;
}

/** The question a command asks before it acts. */
const ASK = {
  NONE: "none",
  SIGN_OUT: "signOut",
  SIGN_OUT_REFUSED: "signOutRefused",
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
  const acts = useHostActs();
  const inbox = useInboxActs();
  const signOut = useSignOut();
  const openSettings = useOpenSettings();
  const subject = useSubject(signedIn);
  const switcher = useWorkspaceSwitcher();
  const workspaces = signedIn ? (switcher?.workspaces ?? []) : [];
  const workspaceNames = workspaces.map(({ name }) => name);
  const chosenWorkspace = workspaces.findIndex(({ id }) => id === switcher?.chosen.id);
  const sidebar = useSidebarShown();
  // Note that Show or Hide Sidebar acts in any regular window, on the app sidebar where three columns stand and on the list beside its detail where two do.
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const sidebarStands = signedIn && regular;
  const enabled = [
    ...subject.enabled,
    ...(workspaces.length > 0 ? [MENU_COMMAND.SWITCH_WORKSPACE] : []),
    ...(sidebarStands ? [MENU_COMMAND.SIDEBAR] : []),
  ];
  const toggled =
    sidebarStands && !sidebar.shown ? [...subject.toggled, MENU_COMMAND.SIDEBAR] : subject.toggled;
  const working = useAgentsWorking(subject.task?.id);
  const [asking, setAsking] = useState<Ask>(ASK.NONE);
  const [refusal, setRefusal] = useState<string>();
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
    menuCommandsModule?.setState(
      subject.focus.kind,
      enabled,
      toggled,
      workspaceNames,
      chosenWorkspace,
    );
  });

  // Note that a refused sign-out says why and offers it again, since the phone is still signed in.
  const signOutNow = () => {
    signOut().catch((error: unknown) => {
      setRefusal(signOutRefusalWords(error));
      setAsking(ASK.SIGN_OUT_REFUSED);
    });
  };

  const markDone = (stopAgents?: true) => {
    const taskId = subject.task?.id;
    if (taskId === undefined) return;
    const stopping = stopAgents === undefined ? undefined : { stopAgents };
    acts[ACT_KIND.TASKS_SET_STANDING]({ taskId, status: TASK_STATUS.DONE, ...stopping }).then(
      (landed) => buzz(landed ? BUZZ.SUCCESS : BUZZ.ERROR),
      (error: unknown) => {
        console.error("Mark Done did not go.", error);
        buzz(BUZZ.ERROR);
      },
    );
  };

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
        return openSettings();
      case MENU_COMMAND.SWITCH_WORKSPACE: {
        const picked = index === undefined ? undefined : workspaces[index];
        if (picked !== undefined) switcher?.onChoose(picked.id);
        return;
      }
      case MENU_COMMAND.SIGN_OUT:
        return setAsking(ASK.SIGN_OUT);
      case MENU_COMMAND.NEW_TASK:
        return router.push("/start-task");
      case MENU_COMMAND.NEW_AGENT:
        if (task !== undefined)
          router.push({ pathname: "/start-agent", params: { task: task.id } });
        return;
      case MENU_COMMAND.INBOX:
        return router.navigate("/inbox");
      case MENU_COMMAND.TASKS:
        return router.navigate("/tasks");
      case MENU_COMMAND.SEARCH:
        return router.navigate("/search");
      case MENU_COMMAND.SIDEBAR:
        return sidebar.toggle();
      case MENU_COMMAND.MARK_DONE:
        if (working) setAsking(ASK.MARK_DONE);
        else markDone();
        return;
      case MENU_COMMAND.TOGGLE_READ:
        if (threadId !== undefined) inbox.mark(threadId, !subject.threadUnread);
        else if (task !== undefined) {
          const unread = subject.toggled.includes(MENU_COMMAND.TOGGLE_READ);
          acts[ACT_KIND.TASKS_MARK_READ]({
            taskId: task.id,
            readMark: unread ? READ_MARK.READ : READ_MARK.UNREAD,
          }).catch((error: unknown) => console.error("The mark did not go.", error));
        }
        return;
      case MENU_COMMAND.PIN:
        if (task === undefined) return;
        acts[ACT_KIND.TASKS_PIN]({ taskId: task.id, pinned: task.pinnedAt === undefined }).then(
          (landed) => buzz(landed ? BUZZ.SELECTION : BUZZ.ERROR),
          (error: unknown) => {
            console.error("The pin did not go.", error);
            buzz(BUZZ.ERROR);
          },
        );
        return;
      case MENU_COMMAND.REMIND_CLEAR:
        if (threadId !== undefined) inbox.remind(threadId, null);
        return;
      case MENU_COMMAND.OPEN_IN_BROWSER:
        if (subject.address !== undefined) openInSafari(subject.address);
        return;
      case MENU_COMMAND.HELP:
        return openInSafari(LINK_PAGE.DOCS);
      case MENU_COMMAND.FEEDBACK:
        openURL(CONTACT_MAILTO).catch((error: unknown) =>
          console.error("The feedback mail did not open.", error),
        );
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
    const listening = menuCommandsModule?.addListener("onCommand", ({ command, index }) =>
      latest.current(command, index),
    );
    return () => listening?.remove();
  }, []);

  const done = settleStopWords(TASK_STATUS.DONE);
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
        title={SIGN_OUT_ASK.REFUSED}
        message={refusal}
        act={SIGN_OUT_ASK.AGAIN}
        presented={asking === ASK.SIGN_OUT_REFUSED}
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
