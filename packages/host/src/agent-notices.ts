import type {
  AccountInboxAgent,
  AccountInboxAnswer,
  AccountInboxAutomation,
  AccountInboxEntry,
  AccountInboxTask,
  AccountTasklessEntry,
} from "@repo/features/account-inbox-wire";
import { LIMIT_REACHED_WORDS } from "@repo/features/agent-failure-words";
import type { AgentAccountInboxAnswerView } from "@repo/features/agent-view";
import {
  AGENT_FAILURE,
  AGENT_STATUS,
  type AgentFailure,
  type AgentStatus,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import { SOUND_WHEN, type SoundWhen } from "@repo/settings";
import type { CompletionSound } from "@repo/wire/app-settings";
import { Clock, Context, Duration, Effect, FiberHandle, type Scope, Stream } from "effect";
import type { AppInboxSlice, AppInboxWaitingItem } from "./app-state.js";

/**
 * agent-notices.ts -- keeps where each coding agent stands and what waits across the account, for the window's marks and counts: the ledger of each agent's turn, fed by the plan list followed live, the follow of what waits, and the Dock's badge.
 *
 * Nothing here announces anything the developer did not ask for. An agent's
 * turn ending, an Inbox item posted, or an automation's run failing to start
 * is said by the window's own marks and counts, focused or behind, and by no
 * toast, since news the developer did not ask for interrupts more than it
 * tells: the agent's unseen dot, the Inbox's counts and the Dock's badge,
 * and the Automations failed mark. A command waiting on this Mac is always
 * posted as a notification (`client/client-notices.ts`), through the same
 * doors, since Ask every time is the developer's own ask to be asked. The
 * rest is told only where the developer turned it on, Settings › Account ›
 * Sounds: as a turn of an agent the account started ends, completed or
 * failed and never a Stop, and as an item asking the account something is
 * posted, a sound plays (`soundWhen`), as it does as a command waits on this
 * Mac, in the background only while the window is behind; and the OS posts
 * a notification (`turnNotifications`), only while the window is behind,
 * naming the agent or its task and saying it finished or failed, or naming
 * the task and the question asked, its click opening the agent's tab or the
 * Inbox item. Note that those names then reach the OS's notification
 * center, which is why the notification waits on the developer's switch.
 * A burst sounds once and posts one notification counting its news. Each
 * is heard in one place (`heard`), which chimes and posts through the
 * doors, in one window of the app. The phone is opted into apart from this:
 * the service pushes the iOS app an Inbox item waiting on the member and a
 * failed run of theirs (`@repo/service`'s `push/inbox-pushes.ts`) once the
 * member grants it iOS notification permission, and reads no
 * `turnNotifications`, since that grant is the developer's own ask.
 *
 * The panel reads an agent's status only while its tab is on screen, so
 * main keeps a ledger of its own, fed by every coding-agent answer that
 * passes through the acts (a list, a Start, a Stop, a transcript page) and
 * by the plan list, followed live over Neon Realtime, which carries every
 * agent on a plan as each moves, so an agent on a plan the developer has
 * left is still heard and nothing is read on a clock. The ledger keys an agent's run by the turn its status is
 * read from (`turnId`): a status that moves from still writing to ended under
 * one turn is that turn's end, marked once as the agent's unseen dot, until
 * its tab is shown or the window comes forward on it, and not at all while
 * the window is focused on that agent's tab, where the developer sees the
 * end for themselves. A message to an agent that had ended reads it running
 * under the ended turn's id until its harness opens the next turn, which is the old
 * run read again and not a new one: the ledger keeps the end it marked until
 * the new turn's id arrives, whose own end is the next dot. A list that
 * landed late, describing a turn the agent has left behind, says nothing
 * newer. A Stop is the developer's own and leaves no dot. The ledger is this
 * launch's and this account's, so an agent that ended before the app watched
 * it, or while the app was not running, is not dotted, a reload of the window
 * dots nothing twice, and an account that signs out takes its agents with
 * it. Only another account is a change of hands: the account's own session
 * renewing, which it does mid-run, says the same account again and keeps the
 * ledger, or an agent running across the renewal would be first seen again
 * already ended and never dotted.
 *
 * The notices hold one more read of their own: what waits on the developer
 * across the account's tasks, every open inbox item, followed over Neon
 * Realtime for as long as an account is signed in, so an item an agent posts
 * is heard whichever task is open, or none, and whichever Mac started the
 * agent. Of those, only the items of agents the account started wait on
 * it, since an agent runs on its starter's keys and asks its starter: each
 * answer is written whole as each task's open items of those, which the
 * sidebar counts, and the Dock's badge counts them as the Inbox's Open
 * lists them: every one, a question and a notice not yet acknowledged
 * alike, but those whose reminder is set for later than now, each counted
 * again the moment its reminder comes due; every task holding any
 * member's item is listed for the Inbox. The same read carries the newest
 * run of each of the account's own automations that failed to start lately,
 * which is written for the window's Automations to mark until that
 * automation is opened, and counts on no badge, since nothing answers it.
 * Another account, or nobody, ends the follow of the last, and lets go of
 * its items, its counts, and its badge before anything of the next is read.
 */

/** The statuses under which an agent may still write, which is when its task is watched. */
const WRITING_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** How many pushes of the followed list in a row may leave out an agent only a Start answered before the ledger lets it go. */
const UNNAMED_PUSHES_KEPT = 2;

/** How long after a chime the news heard is told by that one chime rather than one of its own, so a burst of ends sounds once; and how long a notification gathers the news heard after its first, so a burst of ends posts once. */
const BURST = Duration.millis(1500);

/** What names an agent in a notification where neither it nor its task has a name yet. */
const UNNAMED_AGENT = "Your agent";

/** What kind of event a notice tells of. */
export const NOTICE_KIND = {
  /** A command an agent asked to run on this Mac waits on the developer (`client/client-notices.ts`). */
  MAC_COMMAND_ASK: "mac-command-ask",
  /** A turn of an agent the account started ended, completed or failed. */
  AGENT_FINISHED: "agent-finished",
  /** An inbox item asking the account something was posted. */
  ITEM_ASKED: "item-asked",
} as const;

/** The event a notice tells of, by the identifiers that name it. */
export type NoticeSubject =
  | { readonly kind: typeof NOTICE_KIND.MAC_COMMAND_ASK; readonly askId: string }
  | { readonly kind: typeof NOTICE_KIND.AGENT_FINISHED; readonly agentId: string }
  | { readonly kind: typeof NOTICE_KIND.ITEM_ASKED; readonly itemId: string };

/** When a sound plays as news is heard, and which one, as the account's preferences hold them now. */
interface SoundChoice {
  readonly when: SoundWhen;
  readonly sound: CompletionSound;
}

/** What one piece of news says in a notification, and the place its click opens. */
interface Told {
  readonly kind: typeof NOTICE_KIND.AGENT_FINISHED | typeof NOTICE_KIND.ITEM_ASKED;
  readonly title: string;
  readonly body: string;
  readonly place: LinkPlace;
}

/** The notification as the OS posts it: the event it tells of, what it says, and what its click does. */
export interface AgentNotice {
  subject: NoticeSubject;
  title: string;
  body: string;
  onClick: () => void;
}

/**
 * The doors a notice leaves this process through: the OS's notification,
 * which a command waiting on this Mac posts (`client/client-notices.ts`), as
 * does news where the account turned notifications on (`heard`), the Dock's
 * badge, and the chime. A service rather than a dependency handed
 * in, because it is this process's door to Electron, so a test stands a Layer
 * of its own on it.
 */
export interface AgentNoticeDoorsSurface {
  post(notice: AgentNotice): void;
  /** How many inbox items wait across the account as the Inbox's Open lists them, which the Dock's badge counts; none clears it. */
  badge(count: number): void;
  /** Plays the sound once, in one window of the app: the desktop's focused panel or its main one, or the web's tab. */
  chime(sound: CompletionSound): void;
}

export class AgentNoticeDoors extends Context.Service<AgentNoticeDoors, AgentNoticeDoorsSurface>()(
  "@repo/desktop/AgentNoticeDoors",
) {}

/**
 * The doors as the notices call them: one that throws is reported and its
 * count dropped. Note that the throw never reaches the caller, because the
 * badge is set from the inbox's answers, and a throw there would end the
 * follow for the rest of the run.
 */
function guardedDoors(
  doors: AgentNoticeDoorsSurface,
  report: (message: string) => void,
): AgentNoticeDoorsSurface {
  const guarded =
    <Said>(door: string, say: (said: Said) => void) =>
    (said: Said): void => {
      try {
        say(said);
      } catch (defect) {
        report(
          `the notice's ${door} door failed: ${defect instanceof Error ? defect.message : String(defect)}`,
        );
      }
    };
  return {
    post: guarded("post", (notice: AgentNotice) => doors.post(notice)),
    badge: guarded("badge", (count: number) => doors.badge(count)),
    chime: guarded("chime", (sound: CompletionSound) => doors.chime(sound)),
  };
}

export interface AgentNoticesDependencies {
  /** Where the unseen agents are written, for the tabs to draw. */
  onUnseenChanged: (unseen: readonly string[]) => void;
  /** The panel window coming forward or going behind, for as long as the subscription stands. */
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  /** Who is signed in now, by the account's own key, or nobody. */
  signedInAs: () => string | undefined;
  /** The signed-in account's id, which an inbox item's starter is named by; none for an identity stored without one, which counts every item. */
  accountId: () => string | undefined;
  /** The account as each change of it says, for as long as the subscription stands: the ledger is no one else's. */
  onAccountChanged: (listener: (signedInAs: string | undefined) => void) => () => void;
  /** What waits across the account, followed for as long as the stream is run: each answer the host tells as it moves. */
  followAccountInbox: () => Stream.Stream<AgentAccountInboxAnswerView>;
  /** Who is signed in, by the account's own key, from where the launch stands and at each change: whose items the inbox read reads. */
  accounts: Stream.Stream<string | undefined>;
  /** Where each task's waiting items, and every task holding an item, are written, for the window's Inbox. */
  onInboxChanged: (inbox: AppInboxSlice) => void;
  /** When a sound plays as news is heard, and which, read as each piece of news lands. */
  sound: () => SoundChoice;
  /** Whether the account turned notifications on (`turnNotifications`), read as each piece of news lands and again as its notification is posted. */
  notify: () => boolean;
  /** A task's name as the account's list holds it; none for a task it does not. */
  taskName: (taskId: string) => string | undefined;
  /** Opens a place in the window, brought forward: a notification's click. */
  open: (place: LinkPlace) => void;
  report: (line: string) => void;
}

export interface AgentNotices {
  /** Agents as an answer carried them: a task's list, or the one a Start or a Stop answered. */
  observeAgents(agents: readonly AgentSummary[]): void;
  /** One agent's status as a transcript page carried it; an agent no answer has named yet is left for the list. */
  observeStatus(agentId: string, status: AgentStatus): void;
  /** The agent as the answer to a message carried it: running, with a line awaiting the turn it opens. */
  observeMessaged(agent: AgentSummary): void;
  /** A task the host no longer holds: its agents are forgotten. */
  observeTaskGone(taskId: string): void;
  /** Every agent on a plan as the list followed live carries them, and the plans it holds: an agent of any other plan, or one of a held plan the list no longer names, as one archived, is forgotten. */
  observeFollowed(agents: readonly AgentSummary[], taskIds: readonly string[]): void;
  /** The panel said which agent's tab it shows, or none. */
  shown(agentId: string | null): void;
  /** The developer marked the agent as read by hand: its unseen dot goes, whichever page shows. */
  seen(agentId: string): void;
  /** News heard outside the notices' own reads, a command waiting on this Mac: told as the notices tell their own. */
  heard(subject: NoticeSubject): void;
}

/** What the ledger keeps of one agent: enough to tell one turn's end from the next's. */
interface HeldAgent {
  /** The plan it works on; null for one an automation started with no plan. */
  taskId: string | null;
  status: AgentStatus;
  /** Why the turn the status is read from failed, where it did. */
  failure: AgentFailure | undefined;
  /** The turn the status is read from; none before the first. */
  turnId: string | null;
  /** The turns the agent has left behind, which a list that landed late may still describe. */
  pastTurns: ReadonlySet<string>;
  /** The id of the member who started it; none where no answer named them. */
  startedBy: string | undefined;
  /** Its title as its tab shows it; null until it has one. */
  title: string | null;
}

function stillWriting(status: AgentStatus): boolean {
  return WRITING_STATUSES.has(status);
}

/**
 * The answer as it waits on the account: a task's items that wait on it
 * (`waitsOn`), its assignee's, or its agent's starter's where nobody is
 * assigned, and the items of the agents with no task it started, since such
 * an agent runs on its starter's keys and asks its starter, and the tasks
 * holding any item whole, since every member's Inbox lists them. An item a
 * service before `waitsOn` names goes by its starter; one naming neither, or
 * an account whose id is not known, is the account's own, as every item was
 * before. Note that what counts is this, while the window
 * lists every member's items of agents with no task (`sliceOf`), as it does
 * a task's.
 */
function waitingOnAccount(
  answer: AccountInboxAnswer,
  accountId: string | undefined,
): AccountInboxAnswer {
  if (accountId === undefined) return answer;
  const ownOf = (item: { readonly startedBy?: string; readonly waitsOn?: string }) => {
    const waitsOn = item.waitsOn ?? item.startedBy;
    return waitsOn === undefined || waitsOn === accountId;
  };
  return {
    ...answer,
    items: answer.items.filter(ownOf),
    ...(answer.planless === undefined ? undefined : { planless: answer.planless.filter(ownOf) }),
  };
}

/** An item's reminder as the window counts it: when it comes due, read or unread alike, since the service answers none once a change ended it; nothing where it has none. */
function reminderOf(item: { readonly remindAt?: number | null }): {
  readonly remindAt?: number;
} {
  return item.remindAt === undefined || item.remindAt === null ? {} : { remindAt: item.remindAt };
}

/** The items each task holds waiting, the task whose item changed latest first, as the read answered them latest first. */
function waitingTasks(items: readonly AccountInboxEntry[]): AppInboxSlice["waiting"] {
  const tasks = new Map<string, AppInboxWaitingItem[]>();
  for (const item of items) {
    const waiting = {
      id: item.id,
      agentId: item.agentId,
      title: item.title,
      postedAt: item.postedAt,
      ...(item.asking === undefined ? undefined : { asking: item.asking }),
      ...reminderOf(item),
    };
    const held = tasks.get(item.planId);
    if (held === undefined) tasks.set(item.planId, [waiting]);
    else held.push(waiting);
  }
  return [...tasks].map(([taskId, held]) => ({ taskId, items: held }));
}

/** The open items of agents with no task as the window holds them: each with when it last changed, its agent and its kind, who started it, and the automation and repository standing in a task's place. */
function waitingTaskless(items: readonly AccountTasklessEntry[]): AppInboxSlice["taskless"] {
  return items.map((item) => ({
    id: item.id,
    agentId: item.agentId,
    title: item.title,
    postedAt: item.postedAt,
    updatedAt: item.updatedAt,
    agentTitle: item.agentTitle,
    agentModel: item.agentModel,
    automationId: item.automationId,
    automationName: item.automationName,
    repository: item.repository,
    ...(item.asking === undefined ? undefined : { asking: item.asking }),
    ...(item.startedBy === undefined ? undefined : { startedBy: item.startedBy }),
    ...(item.waitsOn === undefined ? undefined : { waitsOn: item.waitsOn }),
    ...(item.workspaceId === undefined ? undefined : { workspaceId: item.workspaceId }),
    ...reminderOf(item),
  }));
}

/**
 * Each agent the open items of agents with no task name, once, as a service
 * before `agents` leaves the window to list them: how many it holds open,
 * how many of those wait on the account, asks and notices alike (`waiting`,
 * as `waitingOnAccount` keeps them), and when the latest changed, named as its
 * latest names it. Note that its settled items are not among them, since
 * such a service names none.
 */
function agentsOfOpenItems(
  items: readonly AccountTasklessEntry[],
  waiting: readonly AccountTasklessEntry[],
): AppInboxSlice["agents"] {
  const toDo = new Set(waiting.map((item) => item.id));
  const held = new Map<string, AppInboxSlice["agents"][number]>();
  // The read answers its items the latest changed first, so an agent's first is the one it is named by.
  for (const item of items) {
    const was = held.get(item.agentId);
    held.set(item.agentId, {
      ...(was ?? {
        agentId: item.agentId,
        agentTitle: item.agentTitle,
        agentModel: item.agentModel,
        automationId: item.automationId,
        automationName: item.automationName,
        repository: item.repository,
        ...(item.workspaceId === undefined ? undefined : { workspaceId: item.workspaceId }),
        updatedAt: item.updatedAt,
      }),
      items: (was?.items ?? 0) + 1,
      toDo: (was?.toDo ?? 0) + (toDo.has(item.id) ? 1 : 0),
    });
  }
  return [...held.values()];
}

/** Whether an item waits now rather than under a reminder set for later than `now`, as the Inbox's Open lists it. */
function dueBy(now: number): (item: { readonly remindAt?: number | null }) => boolean {
  return (item) => item.remindAt === undefined || item.remindAt === null || item.remindAt <= now;
}

/** What an answer of the inbox read carries that the window and the Dock are told of. */
type InboxAnswered = Pick<
  AccountInboxAnswer,
  "items" | "plans" | "planless" | "automations" | "agents" | "failedRuns"
>;

/** Whether two answers say alike everything the window draws of each item of an agent with no task: when it last changed, its agent's title and model, the automation and repository standing in a task's place, and the workspace whose list it stands in, which change without the item's stamp moving, a service first naming the workspace among them. */
function sameTaskless(
  one: readonly AccountTasklessEntry[],
  other: readonly AccountTasklessEntry[],
): boolean {
  return (
    one.length === other.length &&
    one.every((item, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.id === item.id &&
        was.updatedAt === item.updatedAt &&
        was.agentTitle === item.agentTitle &&
        was.agentModel === item.agentModel &&
        was.automationId === item.automationId &&
        was.automationName === item.automationName &&
        was.repository === item.repository &&
        was.workspaceId === item.workspaceId
      );
    })
  );
}

/** Whether two answers list the same automations holding items, alike in order, count, and instant. */
function sameAutomations(
  one: readonly AccountInboxAutomation[],
  other: readonly AccountInboxAutomation[],
): boolean {
  return (
    one.length === other.length &&
    one.every((held, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.automationId === held.automationId &&
        was.items === held.items &&
        was.updatedAt === held.updatedAt
      );
    })
  );
}

/** Whether two answers list the same agents with no task holding items, alike in order, count, To do count, instant, and everything the window names each by. */
function sameAgents(
  one: readonly AccountInboxAgent[],
  other: readonly AccountInboxAgent[],
): boolean {
  return (
    one.length === other.length &&
    one.every((held, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.agentId === held.agentId &&
        was.items === held.items &&
        was.toDo === held.toDo &&
        was.updatedAt === held.updatedAt &&
        was.agentTitle === held.agentTitle &&
        was.agentModel === held.agentModel &&
        was.automationId === held.automationId &&
        was.automationName === held.automationName &&
        was.repository === held.repository &&
        was.workspaceId === held.workspaceId
      );
    })
  );
}

/** Whether two answers list the same tasks holding items, alike in order, count, To do count, and instant: a read mark moves the To do count alone. */
function sameTasks(one: readonly AccountInboxTask[], other: readonly AccountInboxTask[]): boolean {
  return (
    one.length === other.length &&
    one.every((task, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.planId === task.planId &&
        was.items === task.items &&
        was.toDo === task.toDo &&
        was.updatedAt === task.updatedAt
      );
    })
  );
}

/** How many of a kind, as a notification's title counts them: "1 agent", "3 agents". */
function agentsCounted(count: number): string {
  return count === 1 ? "1 agent" : `${count} agents`;
}

/**
 * The one notification a burst of news posts: one piece says its own
 * title and body and opens its own place; several are counted ("3 agents
 * finished"), name each in the body, and open the newest agent's tab, or
 * the Inbox where any of them asks.
 */
function noticeOf(burst: readonly Told[]): Omit<AgentNotice, "subject" | "onClick"> & {
  readonly place: LinkPlace;
} {
  const [only, ...rest] = burst;
  if (only !== undefined && rest.length === 0) return only;
  const finished = burst.filter((told) => told.kind === NOTICE_KIND.AGENT_FINISHED);
  const asked = burst.length - finished.length;
  const said = [
    ...(finished.length > 0 ? [`${agentsCounted(finished.length)} finished`] : []),
    ...(asked > 0 ? [`${finished.length > 0 ? asked : agentsCounted(asked)} need you`] : []),
  ];
  const newest = burst.at(-1);
  return {
    title: said.join(", "),
    body: [...new Set(burst.map((told) => told.title))].join(", "),
    place: asked > 0 || newest === undefined ? { kind: LINK_PLACE.INBOX } : newest.place,
  };
}

/**
 * The notices, built on the ambient scope: the inbox follow forks into it
 * and the focus subscription is given back when it closes, so both end with
 * the launch rather than with a handle a caller had to remember.
 */
export const createAgentNotices = /* @__PURE__ */ Effect.fn("desktop/createAgentNotices")(
  function* (
    dependencies: AgentNoticesDependencies,
  ): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
    const { onUnseenChanged, report } = dependencies;
    const doors = guardedDoors(yield* AgentNoticeDoors, report);
    const clock = yield* Clock.Clock;
    const ledger = new Map<string, HeldAgent>();
    const unseen = new Set<string>();
    /** The agents on plans the followed list last named, so one it stops naming is known to have left it rather than not reached it yet. */
    let followedAgents = new Set<string>();
    /** How many pushes in a row have left out each agent the list has not named yet, as one only a Start answered. */
    const unnamedPushes = new Map<string, number>();
    let shownAgent: string | null = null;
    let focused = false;
    /** Whose agents the ledger holds: read as it takes its first, and moved only by another account. */
    let holder: string | undefined;
    /** The inbox read's last answer for the account signed in, as it waits on the account (`waitingOnAccount`), and every member's items of agents with no task the window lists; none before its first. */
    let waiting:
      | {
          readonly answer: AccountInboxAnswer;
          readonly listed: readonly AccountTasklessEntry[];
        }
      | undefined;
    /** The asking items waiting on the account as the inbox read last answered them; none before the first answer for the account signed in, which only seeds them. */
    let asking: ReadonlySet<string> | undefined;
    /** When the last chime played, by the Clock; none before the first. */
    let chimedAt: number | undefined;
    /** The news the notification gathering now will tell of, the oldest first; none while none gathers. */
    let gathering: Told[] = [];
    /** Forks the wait for the gathering notification, on the services and the scope the notices were built with. */
    const forkGathering = yield* FiberHandle.makeRuntime<never, never, void>();

    function publishUnseen(): void {
      onUnseenChanged([...unseen]);
    }

    /**
     * A notification of news, where the account turned them on and the
     * window is behind: the first piece opens a burst, which gathers what
     * else is heard within `BURST` and is then posted as one notification,
     * never a stack, unless the window came forward, the account turned
     * notifications off, or another account signed in meanwhile. A command waiting on this Mac is posted
     * by its own follow (`client/client-notices.ts`), so it tells nothing here.
     */
    function notify(subject: NoticeSubject, told: Told): void {
      if (focused || !dependencies.notify()) return;
      gathering.push(told);
      if (gathering.length > 1) return;
      const teller = dependencies.signedInAs();
      forkGathering(
        Effect.andThen(
          Effect.sleep(BURST),
          Effect.sync(() => {
            const burst = gathering;
            gathering = [];
            if (focused || !dependencies.notify() || dependencies.signedInAs() !== teller) return;
            const { title, body, place } = noticeOf(burst);
            doors.post({ subject, title, body, onClick: () => dependencies.open(place) });
          }),
        ),
      );
    }

    /**
     * News the developer may want told of, heard once each: the one place an
     * agent's finish, a new ask, and a command waiting on this Mac land. It
     * chimes where the account turned a sound on, in the background only
     * while the window is behind, and once for a burst: news within `BURST`
     * of the last chime is told by that chime. What the notices heard
     * themselves, an agent's finish or an ask, is said too (`told`), which
     * a notification posts (`notify`).
     */
    function heard(subject: NoticeSubject, told?: Told): void {
      if (told !== undefined) notify(subject, told);
      const { when, sound } = dependencies.sound();
      if (when === SOUND_WHEN.OFF || (when === SOUND_WHEN.BACKGROUND && focused)) return;
      const now = clock.currentTimeMillisUnsafe();
      if (chimedAt !== undefined && now - chimedAt < Duration.toMillis(BURST)) return;
      chimedAt = now;
      doors.chime(sound);
    }

    /** A turn ended: dot its tab, unless the developer is looking at it, and tell of it where the account started the agent. */
    function ended(agentId: string, agent: HeldAgent): void {
      if (agent.status !== AGENT_STATUS.COMPLETED && agent.status !== AGENT_STATUS.FAILED) {
        return;
      }
      const accountId = dependencies.accountId();
      if (accountId !== undefined && agent.startedBy === accountId) {
        const taskName = agent.taskId === null ? undefined : dependencies.taskName(agent.taskId);
        heard(
          { kind: NOTICE_KIND.AGENT_FINISHED, agentId },
          {
            kind: NOTICE_KIND.AGENT_FINISHED,
            title: agent.title ?? taskName ?? UNNAMED_AGENT,
            body:
              agent.status !== AGENT_STATUS.FAILED
                ? "Your agent finished."
                : // An agent its plan's usage limit stopped is told so, not that it failed.
                  agent.failure === AGENT_FAILURE.PLAN_LIMIT
                  ? LIMIT_REACHED_WORDS
                  : "Your agent failed.",
            place: {
              kind: LINK_PLACE.AGENT,
              ...(agent.taskId === null ? undefined : { planId: agent.taskId }),
              agentId,
            },
          },
        );
      }
      if (focused && shownAgent === agentId) return;
      unseen.add(agentId);
      publishUnseen();
    }

    /**
     * What the window holds of an answer: each task's items waiting on the
     * account and every task holding one, and beside them the items of
     * agents with no task, every member's listed as a task's are, and the
     * automations and the agents holding them.
     */
    function sliceOf(
      answer: InboxAnswered,
      listed: readonly AccountTasklessEntry[],
    ): AppInboxSlice {
      return {
        waiting: waitingTasks(answer.items),
        tasks: answer.plans.map(({ planId: taskId, ...holding }) => ({
          ...holding,
          taskId,
        })),
        taskless: waitingTaskless(listed),
        automations: answer.automations ?? [],
        // A service before `agents` names only the agents something waits on.
        agents: answer.agents ?? agentsOfOpenItems(listed, answer.planless ?? []),
        failedRuns: answer.failedRuns ?? [],
      };
    }

    /** The wait for the next reminder of the answer last written to come due, which the next answer replaces. */
    const reminders = yield* FiberHandle.make<void>();

    /**
     * What waits in the inbox that the Dock counts, as the Inbox's Open lists
     * it: every open item, a question or a notice not yet acknowledged, but
     * one whose reminder is set for later than `now`. Note that it is the
     * whole app's, so every workspace's items count.
     */
    function countedOf(answer: InboxAnswered, now: number): number {
      return [...answer.items, ...(answer.planless ?? [])].filter(dueBy(now)).length;
    }

    /** When the answer's next reminder later than `now` comes due; none where it holds none. */
    function nextDueOf(answer: InboxAnswered, now: number): number | undefined {
      let next: number | undefined;
      for (const { remindAt } of [...answer.items, ...(answer.planless ?? [])]) {
        if (remindAt === undefined || remindAt === null || remindAt <= now) continue;
        if (next === undefined || remindAt < next) next = remindAt;
      }
      return next;
    }

    /** The Dock's badge for an answer, counted now and again as each reminder it holds comes due, on the Clock rather than a timer of its own. */
    const badgeAsDue = (answer: InboxAnswered): Effect.Effect<void> =>
      Effect.gen(function* () {
        for (;;) {
          const now = yield* Clock.currentTimeMillis;
          doors.badge(countedOf(answer, now));
          const due = nextDueOf(answer, now);
          if (due === undefined) return;
          yield* Effect.sleep(Duration.millis(due - now));
        }
      });

    /** Writes what waits for the window, and its number, a task's items and an agent's with no task alike, the account's own alone, for the Dock, whose wait for the last answer's reminders it replaces. */
    function publishWaiting(
      answer: InboxAnswered,
      listed: readonly AccountTasklessEntry[],
    ): Effect.Effect<void> {
      dependencies.onInboxChanged(sliceOf(answer, listed));
      return Effect.asVoid(FiberHandle.run(reminders, badgeAsDue(answer)));
    }

    /**
     * An answer of the inbox read, written whole. Nothing of it is announced:
     * the window's counts and the Dock's badge say what waits. Only what
     * waits on the account (`waitingOnAccount`) is counted, while every
     * member's items of agents with no task are written for the window.
     */
    function observeWaiting(read: AccountInboxAnswer): Effect.Effect<void> {
      const answer = waitingOnAccount(read, dependencies.accountId());
      const listed = read.planless ?? [];
      observeAsking(answer);
      const was = waiting;
      // Note that an answer at the same cursor holding fewer of the account's own items is written, because the account's id, which picks them, may have arrived since.
      if (
        was?.answer.cursor === answer.cursor &&
        was.answer.items.length === answer.items.length &&
        (was.answer.planless?.length ?? 0) === (answer.planless?.length ?? 0) &&
        was.listed.length === listed.length
      ) {
        // Note that the tasks, automations, and agents holding items, and what an item with no task is named
        // by, may move with nothing waiting moving, an archive, a rename, or a hold let go, so they are written alone.
        if (
          sameTasks(was.answer.plans, answer.plans) &&
          sameAutomations(was.answer.automations ?? [], answer.automations ?? []) &&
          sameAgents(was.answer.agents ?? [], answer.agents ?? []) &&
          sameTaskless(was.listed, listed)
        ) {
          return Effect.void;
        }
        const moved = {
          ...was.answer,
          plans: answer.plans,
          automations: answer.automations ?? [],
          agents: answer.agents ?? [],
          planless: answer.planless ?? [],
        };
        waiting = { ...was, answer: moved, listed };
        dependencies.onInboxChanged(sliceOf(moved, listed));
        return Effect.void;
      }
      waiting = { answer, listed };
      return publishWaiting(answer, listed);
    }

    /**
     * The asking items an answer holds waiting on the account, each new one
     * told of once. The first answer for the account signed in only seeds
     * them, since what already waited is no news, and a notice that asks
     * nothing is told by the counts alone.
     */
    function observeAsking(answer: InboxAnswered): void {
      const was = asking;
      const now = new Map<string, Told>();
      for (const item of answer.items) {
        if (item.asking !== true) continue;
        now.set(item.id, {
          kind: NOTICE_KIND.ITEM_ASKED,
          title: dependencies.taskName(item.planId) ?? item.agentTitle ?? UNNAMED_AGENT,
          body: item.title,
          place: { kind: LINK_PLACE.INBOX_ITEM, planId: item.planId, itemId: item.id },
        });
      }
      for (const item of answer.planless ?? []) {
        if (item.asking !== true) continue;
        now.set(item.id, {
          kind: NOTICE_KIND.ITEM_ASKED,
          title: item.agentTitle ?? item.automationName ?? UNNAMED_AGENT,
          body: item.title,
          // Note that it is named by its id alone, because the panel then asks the service which workspace holds it, where a link under its agent opens in the workspace the window stands in.
          place: { kind: LINK_PLACE.INBOX_ITEM, itemId: item.id },
        });
      }
      asking = new Set(now.keys());
      if (was === undefined) return;
      for (const [itemId, told] of now) {
        if (!was.has(itemId)) heard({ kind: NOTICE_KIND.ITEM_ASKED, itemId }, told);
      }
    }

    /**
     * What waits for one account, followed for as long as it stays signed in:
     * whatever the last account left is let go first, and nobody's is
     * nothing to follow. Note that an answer is let go where the account it
     * was told for is no longer signed in, because it may land in the tick
     * before the change ends the follow, and one telling why there is none
     * says nothing: the host seals the follow again itself.
     */
    const waitingOf = (reader: string | undefined): Effect.Effect<void> =>
      Effect.suspend(() => {
        waiting = undefined;
        asking = undefined;
        const letGo = publishWaiting({ items: [], plans: [] }, []);
        if (reader === undefined) return letGo;
        // An answer that throws is reported rather than left to end the follow, which would never resume.
        const look = (answer: AgentAccountInboxAnswerView) =>
          Effect.catchDefect(
            Effect.suspend(() => {
              if (dependencies.signedInAs() !== reader || "failure" in answer) return Effect.void;
              return observeWaiting(answer);
            }),
            (defect) =>
              Effect.sync(() =>
                report(
                  `the inbox answer could not be noted: ${defect instanceof Error ? defect.message : String(defect)}`,
                ),
              ),
          );
        return Effect.andThen(letGo, Stream.runForEach(dependencies.followAccountInbox(), look));
      });

    /** One agent as an answer carried it, against where the ledger last had it. */
    function observe(agentId: string, next: HeldAgent): void {
      const was = ledger.get(agentId);
      // An agent first seen ended ended before the app watched it; one first seen at work may have just started.
      if (was === undefined) {
        if (ledger.size === 0) holder = dependencies.signedInAs();
        ledger.set(agentId, next);
        return;
      }
      // The reads overlap, so a list can land after a newer read moved the
      // ledger on: one describing a turn the agent has left behind, or no
      // turn yet, says nothing newer and is let go whole.
      if (next.turnId === null ? was.turnId !== null : was.pastTurns.has(next.turnId)) return;
      // Note that a read naming no starter keeps the one an earlier read named, because not every read carries it.
      const startedBy = next.startedBy ?? was.startedBy;
      // So does one naming no title, since a status page carries none.
      const title = next.title ?? was.title;
      if (was.turnId === next.turnId) {
        // A turn that ended stays ended, so an end is never a second turn's,
        // and running again under the ended turn's id is a late read or a
        // message awaiting the next turn, which its own answer says.
        if (!stillWriting(was.status)) return;
        const held = { ...next, pastTurns: was.pastTurns, startedBy, title };
        ledger.set(agentId, held);
        if (stillWriting(next.status)) return;
        ended(agentId, held);
        return;
      }
      // A new turn: the one before it is left behind, and its own end is the next dot.
      const pastTurns = new Set(was.pastTurns);
      if (was.turnId !== null) pastTurns.add(was.turnId);
      const held = { ...next, pastTurns, startedBy, title };
      ledger.set(agentId, held);
      if (!stillWriting(next.status)) ended(agentId, held);
    }

    /** Lets go of every agent `keep` refuses, their dots with them, as a plan or an agent deleted or an account left has no tab to clear one. */
    function forget(keep: (agent: HeldAgent, agentId: string) => boolean): void {
      let dotted = false;
      for (const [agentId, agent] of ledger) {
        if (keep(agent, agentId)) continue;
        ledger.delete(agentId);
        if (unseen.delete(agentId)) dotted = true;
      }
      if (dotted) publishUnseen();
    }

    function seen(agentId: string | null): void {
      if (agentId === null || !unseen.delete(agentId)) return;
      publishUnseen();
    }

    /** The agent as the ledger holds it, on a plan or with none. */
    function heldOf(
      agent: Pick<AgentSummary, "planId" | "status" | "turn" | "turnId" | "startedBy" | "title">,
    ): HeldAgent {
      return {
        taskId: agent.planId,
        status: agent.status,
        failure: agent.turn?.failure,
        turnId: agent.turnId,
        pastTurns: new Set(),
        startedBy: agent.startedBy?.userId,
        title: agent.title,
      };
    }

    // Note that the ledger holds every agent a read names, any member's, on a
    // plan or with none, because a teammate's turn ending is news to whoever
    // reads its page, whether or not it has a plan.
    const notices: AgentNotices = {
      observeAgents: (agents) => {
        for (const agent of agents) observe(agent.id, heldOf(agent));
      },
      observeMessaged: (agent) => observe(agent.id, heldOf(agent)),
      observeStatus: (agentId, status) => {
        const held = ledger.get(agentId);
        if (held !== undefined) observe(agentId, { ...held, status });
      },
      observeTaskGone: (taskId) => forget((agent) => agent.taskId !== taskId),
      observeFollowed: (agents, taskIds) => {
        const held = new Set(taskIds);
        // The list names every agent on its plans but the archived, so one it named and no longer
        // does takes its dot with it. One only a Start answered is kept through a push or two that
        // leave it out, since a push of the plans may carry agents from before that Start, and let go
        // after that, as one archived before the list ever named it.
        const named = new Set(agents.map((agent) => agent.id));
        forget((agent, agentId) => {
          if (agent.taskId === null) return true;
          if (!held.has(agent.taskId)) return false;
          if (named.has(agentId)) return true;
          if (followedAgents.has(agentId)) return false;
          const pushes = (unnamedPushes.get(agentId) ?? 0) + 1;
          unnamedPushes.set(agentId, pushes);
          return pushes <= UNNAMED_PUSHES_KEPT;
        });
        for (const agentId of unnamedPushes.keys()) {
          if (named.has(agentId) || !ledger.has(agentId)) unnamedPushes.delete(agentId);
        }
        followedAgents = named;
        notices.observeAgents(agents);
      },
      shown: (agentId) => {
        shownAgent = agentId;
        seen(agentId);
      },
      seen,
      heard: (subject) => heard(subject),
    };

    // Each account's inbox followed in turn, the follow for the last one
    // ended as the next is signed in, so nothing of one is told for another.
    yield* Effect.forkScoped(
      Stream.runDrain(
        Stream.switchMap(Stream.changes(dependencies.accounts), (reader) =>
          Stream.fromEffect(waitingOf(reader)),
        ),
      ),
    );
    // Coming forward on the shown agent's tab is seeing it.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        dependencies.onPanelFocusChanged((next) => {
          focused = next;
          if (focused) seen(shownAgent);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    // Another account leaves the ledger no one's: nothing of the account
    // that left is dotted for whoever signs in next, and an answer still on
    // its way lands as a first sighting, which dots nothing.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        dependencies.onAccountChanged((signedInAs) => {
          if (ledger.size === 0 || signedInAs === holder) return;
          forget(() => false);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    return notices;
  },
);
