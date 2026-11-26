/**
 * fixture-host.ts -- a fixture run's host: the profile's synthetic data laid over the host's own document, so the screens read it as they read a live run's.
 *
 * The desktop's and the web's fixture runs lay the synthetic data over the
 * document on the window's side, as each delivery lands
 * (`@repo/panel`'s `tasks-fixture-loader.ts`). The app runs the host in its
 * own process and holds its document, so it lays the data into the document
 * itself, after the launch's bootstrap has been read into it and again after
 * each change the host writes (`compose-mobile.ts`): the Inbox profile's
 * account signed in, its tasks' items (`@repo/host/fixture-inbox`), which
 * the Inbox lists, the tasks holding them, which name its rows, and, where
 * the launch asks, the service's refusal of an old build. A live run, and a profile that stages nothing, is left as
 * the host wrote it, and a document already staged is handed nothing new.
 */

import { ACCOUNT_STATUS, signedInAccountId } from "@repo/credentials/snapshot";
import { AGENT_CALL_FAILURE, type SendingMessage } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { PULL_REQUEST_WRITE_OUTCOME } from "@repo/features/pull-request-write-wire";
import { markedAs, type ReadMark, type ReadMarked } from "@repo/features/read-mark";
import { DESCRIPTION_ACTOR } from "@repo/features/task-wire";
import {
  FOLLOWER_CALL_FAILURE,
  type ListedApart,
  type ListedTasksView,
  listedApart,
  TASK_CALL_FAILURE,
  type TaskListParts,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppStateSnapshot,
  OWN_TRANSCRIPT,
  RUN_PROFILE,
  type RunProfile,
} from "@repo/host/app-state";
import type { AppStateStore } from "@repo/host/client";
import type {
  ActPortClient,
  PortActKind,
  PortActPayload,
  PortActResult,
} from "@repo/host/contract";
import {
  type AgentChoices,
  type AutomationSwitches,
  agentChangeOf,
  automationSwitchOf,
  chosenTasksView,
  type InboxReadMarks,
  type InboxReminders,
  type InboxSentReplies,
  inboxActAnswer,
  inboxAppState,
  inboxAutomationsAppState,
  inboxReadMarksAppState,
  inboxRemindersAppState,
  inboxSentFile,
  inboxSentRepliesAppState,
  inboxSentReply,
  inboxTasksView,
  type KeptQueues,
  MEMORY_SAVE_REFUSED,
  machineAskAppState,
  NEW_MEMORY_ID,
  olderPageAnswer,
  olderPageAppState,
  type PullRequestMoves,
  pullRequestMovedBy,
  pullRequestPartsAppState,
  queueAfter,
  queuedAppState,
  type SavedMemoryWords,
  savedMemoriesAppState,
  type ThreadResolves,
  threadResolveOf,
} from "@repo/host/fixture-inbox";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";
import { SETUP_AUDIENCE, setupPlaceStored } from "@repo/settings";
import { sentLineId } from "@repo/wire/host-ids";
import { Predicate } from "effect";

/** The one workspace a fixture run's account is in. */
const FIXTURE_WORKSPACE_IDS: readonly string[] = [FIXTURE_IDS.WORKSPACE];

/** Each task list as staged, so a list staged already is never staged twice, which would list its tasks twice. */
const stagedLists = new WeakSet<TaskListParts>();

/** A read mark a run's screen set on one of the fixture's tasks, and the instant it was set. */
type KeptReadMark = { readonly mark: ReadMark; readonly at: number };

/** The read marks each run's screens set on the fixture's tasks, by task, each map replaced whole as one is set. */
type KeptReadMarks = ReadonlyMap<string, KeptReadMark>;

/** A task with a kept read mark laid on it: the very task where it stands so already. */
function markedTask<Task extends ReadMarked>(task: Task, kept: KeptReadMark): Task {
  const marked = markedAs(kept.mark, task, kept.at);
  // SAFETY: the keys of a mark are the fields of `ReadMarked` it sets.
  const keys = Object.keys(marked) as (keyof ReadMarked)[];

  return keys.every((key) => task[key] === marked[key]) ? task : { ...task, ...marked };
}

/**
 * The tasks of a list with the read marks a run set laid on them, as the
 * host draws a mark: the list itself where no task's mark moved. Note that a
 * task already standing as its mark says is kept, and a list none of whose
 * tasks moved is kept whole, because the store tells the lists apart by
 * identity, and each change it announces stages the fixture again: a fresh
 * list on every stage never settled, and starved the JS thread.
 */
function markedTasksView(list: ListedTasksView, marks: KeptReadMarks): ListedTasksView {
  if (marks.size === 0) return list;

  const tasks = list.tasks.map((task) => {
    const kept = marks.get(task.id);

    return kept === undefined ? task : markedTask(task, kept);
  });

  return tasks.every((task, place) => task === list.tasks[place]) ? list : { ...list, tasks };
}

/** The fixture's tasks laid over the list held beside the document, or the list held where it is staged already, its agents on the choices the run made and its rows on the read marks it set: the tasks slice, and the lists beside it. */
function stagedTasks(
  held: AppStateSnapshot,
  lists: TaskListParts,
  choices: AgentChoices,
  marks: KeptReadMarks,
): ListedApart {
  const view = { ...held.tasks, ...lists };
  const listed = stagedLists.has(lists) ? view : inboxTasksView(held.run.profile, view);
  const apart = listedApart(markedTasksView(chosenTasksView(listed, choices), marks));
  stagedLists.add(apart.lists);

  return apart;
}

/** The moves each run's changes made to the fixture's pull requests, by the store the run stages, each map replaced whole as a change lands so a staging reads it anew. */
const MOVES = new WeakMap<object, PullRequestMoves>();

/** How many reads of the invitations agent's older page each run's screens asked, by the store the run stages. */
const OLDER_ASKS = new WeakMap<object, number>();

/** No pull request moved yet. */
const NO_MOVES: PullRequestMoves = new Map();

/** The review threads each run resolved or opened again, by the store the run stages, each map replaced whole as a change lands. */
const RESOLVES = new WeakMap<object, ThreadResolves>();

/** No thread resolved or opened again yet. */
const NO_RESOLVES: ThreadResolves = new Map();

/** The reminders each run set on the fixture's items, by the store the run stages, each map replaced whole as one is set. */
const REMINDERS = new WeakMap<object, InboxReminders>();

/** No reminder set yet. */
const NO_REMINDERS: InboxReminders = new Map();

/** The Inbox read marks each fixture run made, by its store. */
const INBOX_READ_MARKS = new WeakMap<object, InboxReadMarks>();

/** The replies with pictures each fixture run sent, by its store, each map replaced whole as one is sent. */
const SENT_REPLIES = new WeakMap<object, InboxSentReplies>();

/** No reply with pictures sent yet. */
const NO_SENT_REPLIES: InboxSentReplies = new Map();

/** The tasks whose first start the fixture refused, by their id, kept for the run whose document it is. */
const STARTS_REFUSED = new WeakMap<object, ReadonlySet<string>>();

/** No Inbox read mark made. */
const NO_INBOX_READ_MARKS: InboxReadMarks = new Map();

/** The runs that hold a machine's ask, as `-machineAsk true` asks, by the store each stages, since a stage after a press is asked with none of the launch's own. */
const MACHINE_ASKED = new WeakSet<object>();

/** The runs whose account stands owed setup, as `-setupOwed true` asks, by the store each stages, since a stage after a press is asked with none of the launch's own. */
const SETUP_OWED = new WeakSet<object>();

/** The runs whose account stands with its Inbox turned off, as `-inboxOff true` asks, by the store each stages, since a stage after a press is asked with none of the launch's own. */
const INBOX_OFF = new WeakSet<object>();

/** Where an account owed setup stands until it moves: its first step, set up for itself. */
const SETUP_START = setupPlaceStored({ audience: SETUP_AUDIENCE.ME, at: 0 });

/** The machines' asks each run answered, by the store the run stages, each set replaced whole as one is answered. */
const ANSWERED_ASKS = new WeakMap<object, ReadonlySet<string>>();

/** No ask answered yet. */
const NO_ANSWERED_ASKS: ReadonlySet<string> = new Set();

/** The words each run saved over the fixture's memories, by the store the run stages, each map replaced whole as one is saved. */
const MEMORY_WORDS = new WeakMap<object, SavedMemoryWords>();

/** No memory's words saved yet. */
const NO_MEMORY_WORDS: SavedMemoryWords = new Map();

/** The switches each run turned on the fixture's automations, by the store the run stages, each map replaced whole as one is turned. */
const SWITCHES = new WeakMap<object, AutomationSwitches>();

/** No automation's switch turned yet. */
const NO_SWITCHES: AutomationSwitches = new Map();

/** What each run changed of the fixture's agents, by the store the run stages, each map replaced whole as one is changed. */
const CHOICES = new WeakMap<object, AgentChoices>();

/** Nothing changed yet. */
const NO_CHOICES: AgentChoices = new Map();

/** The queues each run changed, by the store the run stages, each map replaced whole as one is changed. */
const QUEUES = new WeakMap<object, KeptQueues>();

/** No queue changed yet. */
const NO_QUEUES: KeptQueues = new Map();

/** The read marks each run's screens set on the fixture's tasks, by the store the run stages. */
const READ_MARKS = new WeakMap<object, KeptReadMarks>();

/** No read mark set yet. */
const NO_READ_MARKS: KeptReadMarks = new Map();

/** What the store is handed: whole slices of the document. */
type StorePatch = Parameters<AppStateStore["update"]>[0];

/** The slices of the document as staged that differ from the document as held, which is what the store is handed. */
function stagedPatch(held: AppStateSnapshot, staged: AppStateSnapshot): StorePatch {
  // SAFETY: the keys of a snapshot are its slices beside the window's facts and the version, which are the store's own to keep and are left out here.
  const names = Object.keys(staged) as (keyof AppStateSnapshot)[];

  // SAFETY: each entry carries a slice's own name with the staged value of that slice.
  return Object.fromEntries(
    names
      .filter((name) => name !== "window" && name !== "version" && staged[name] !== held[name])
      .map((name) => [name, staged[name]]),
  ) as StorePatch;
}

/** The network as held, or with the service refusing this build as older than it serves where the launch asks for that; the slice held where it says so already. */
/**
 * The document as held, or, where the launch stands the account owed setup,
 * its settings read and holding setup's first place, as an account that
 * started setup on another device and never finished it holds; as held once
 * the run moved or finished setup itself, so its own moves stand.
 */
function withSetupOwed(held: AppStateSnapshot, setupOwed: boolean): AppStateSnapshot {
  const { settings } = held;

  if (!setupOwed || settings === undefined) return held;
  const { stored } = settings;

  if (stored.setupPlace !== undefined || stored.setupFinished === true) return held;

  return {
    ...held,
    settings: { ...settings, accountRead: true, stored: { ...stored, setupPlace: SETUP_START } },
  };
}

/**
 * The document as held, or, where the launch stands the account with its
 * Inbox turned off, its settings read with the Inbox off, as an account that
 * turned it off on another device holds them; as held once the run chose
 * for itself, so a turn of Settings' switch stands.
 */
function withInboxOff(held: AppStateSnapshot, inboxOff: boolean): AppStateSnapshot {
  const { settings } = held;

  if (!inboxOff || settings === undefined || settings.stored.inbox !== undefined) return held;

  return { ...held, settings: { ...settings, stored: { ...settings.stored, inbox: false } } };
}

function stagedNetwork(held: AppStateSnapshot, updateNeeded: boolean): AppStateSnapshot["network"] {
  // STAGING ONLY: stills of the phone offline.
  if (require("react-native").Settings.get("stageOffline") === "true") return { ...held.network, online: false };
  if (!updateNeeded || held.network.updateNeeded === true) return held.network;

  return { ...held.network, updateNeeded: true };
}

/**
 * The account's saved keys as the fixture holds them: read, with none saved,
 * so Talk in a new agent's sheet answers a press as an account with no
 * OpenAI key does; the slice held where no account is signed in.
 */
function stagedKeys(held: AppStateSnapshot): AppStateSnapshot[typeof LIVE_READ.PROVIDER_KEYS] {
  const accountId = signedInAccountId(held.account);
  const keys = held[LIVE_READ.PROVIDER_KEYS];

  if (accountId === undefined || keys[accountId]?.rows !== undefined) return keys;

  return { ...keys, [accountId]: { rows: { keys: [], subscriptions: [] } } };
}

/** The messages to an agent the run sent, by the agent, in the order sent: on their way where the run took them, and left unanswered where `-refuseWrites` refused them, kept as the host keeps a refused line. */
const KEPT_SENDS = new WeakMap<object, ReadonlyMap<string, readonly SendingMessage[]>>();

/** No messages sent. */
const NO_KEPT_SENDS: ReadonlyMap<string, readonly SendingMessage[]> = new Map();

/** The messages and thread replies the run sent a Manager's chat, by the Manager, oldest first, each as the row the chat lands it as. */
const KEPT_CHAT = new WeakMap<object, ReadonlyMap<string, readonly ManagerChatLiveMessage[]>>();

/** Where the sequence of the messages the run sends a Manager's chat starts, past every row the fixture stages, so each lands newest, as the chat orders its rows. */
const SENT_CHAT_SEQ = 1_000_000;

/** No message sent a Manager's chat. */
const NO_KEPT_CHAT: ReadonlyMap<string, readonly ManagerChatLiveMessage[]> = new Map();

/**
 * Keeps a message the run took for a Manager's chat, or a reply in one of
 * its threads, as the row the chat lands it as, under the key it went
 * under, written by the signed-in account, and lays it over the document at
 * once; nothing for any other act.
 */
function keepChatSend(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  if (kind !== ACT_KIND.AGENTS_CHAT_SEND) return;
  // SAFETY: the payload is the kind's, which the guard above names.
  const sent = payload as PortActPayload<typeof ACT_KIND.AGENTS_CHAT_SEND>;
  const { account } = state.snapshot();
  const held = KEPT_CHAT.get(state) ?? NO_KEPT_CHAT;
  const rows = (held.get(sent.agentId) ?? []).filter((row) => row.clientKey !== sent.clientKey);

  const row: ManagerChatLiveMessage = {
    id: sent.clientKey,
    clientKey: sent.clientKey,
    seq: SENT_CHAT_SEQ + rows.length,
    authorKind: MANAGER_CHAT_AUTHOR.PERSON,
    authorUserId: signedInAccountId(account) ?? null,
    authorName: account.status === ACCOUNT_STATUS.SIGNED_IN ? (account.name ?? "") : "",
    text: sent.text,
    attachments: [],
    threadRoot: sent.threadRoot ?? null,
    broadcast: false,
    turnId: null,
    lineId: null,
    createdAt: Date.now(),
    editedAt: null,
  };

  KEPT_CHAT.set(state, new Map(held).set(sent.agentId, [...rows, row]));
  stageFixture(state);
}

/** The document with each message the run sent a Manager's chat standing as the newest of its rows, as the chat's next read carries it. */
function chatSentAppState(
  state: AppStateSnapshot,
  sent: ReadonlyMap<string, readonly ManagerChatLiveMessage[]>,
): AppStateSnapshot {
  if (sent.size === 0) return state;
  const held = state[LIVE_READ.MANAGER_CHAT];
  const laid = { ...held };

  for (const [agentId, rows] of sent) {
    const chat = held[agentId]?.rows;

    if (chat !== undefined)
      laid[agentId] = { rows: { ...chat, messages: [...rows.toReversed(), ...chat.messages] } };
  }

  return { ...state, [LIVE_READ.MANAGER_CHAT]: laid };
}

/**
 * The document with each message the run sent standing in its agent's
 * transcript as the host draws one (`AppTranscript.sending`): one taken on
 * its way, since nothing the run stages moves and the host lays its own
 * lines over no transcript it did not read, and one refused marked Not
 * delivered with Retry, Edit, and Delete, which the fixture answers at the
 * act port before the host's own record could keep it.
 */
function sendsAppState(
  state: AppStateSnapshot,
  sends: ReadonlyMap<string, readonly SendingMessage[]>,
): AppStateSnapshot {
  if (sends.size === 0) return state;
  const held = state[LIVE_READ.TRANSCRIPT];
  const laid = { ...held };

  for (const [agentId, lines] of sends) {
    const rows = held[agentId]?.[OWN_TRANSCRIPT]?.rows;

    if (rows !== undefined)
      laid[agentId] = { ...held[agentId], [OWN_TRANSCRIPT]: { rows: { ...rows, sending: lines } } };
  }

  return { ...state, [LIVE_READ.TRANSCRIPT]: laid };
}

/**
 * Keeps a message to an agent as a line under its key, refused where
 * `-refuseWrites` left it unanswered and on its way where the run took it,
 * in place of one sent before under the same key, as a Retry is, or lets one
 * go on its Unsend, and lays them over the document at once; answers whether
 * the act was one of those.
 */
function keepSend(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
  refused: boolean,
): boolean {
  const held = KEPT_SENDS.get(state) ?? NO_KEPT_SENDS;

  if (kind === ACT_KIND.AGENTS_UNSEND) {
    // SAFETY: the payload is the kind's, which the guard above names.
    const { agentId, lineId } = payload as PortActPayload<typeof ACT_KIND.AGENTS_UNSEND>;
    const lines = (held.get(agentId) ?? []).filter((line) => line.id !== lineId);
    KEPT_SENDS.set(state, new Map(held).set(agentId, lines));
    stageFixture(state);

    return true;
  }

  if (kind !== ACT_KIND.AGENTS_MESSAGE) return false;
  // SAFETY: the payload is the kind's, which the guard above names.
  const sent = payload as PortActPayload<typeof ACT_KIND.AGENTS_MESSAGE>;
  const id = sentLineId(sent.clientKey);

  const line: SendingMessage = {
    id,
    clientKey: sent.clientKey,
    text: sent.text,
    sentAt: Date.now(),
    steers: sent.steers === true,
    ...(refused ? { refused: { failure: AGENT_CALL_FAILURE.UNANSWERED } } : undefined),
  };

  const lines = [...(held.get(sent.agentId) ?? []).filter((each) => each.id !== id), line];
  KEPT_SENDS.set(state, new Map(held).set(sent.agentId, lines));
  stageFixture(state);

  return true;
}

/**
 * Lays the fixture profile's data over the host's document; nothing in a
 * live run. Where `updateNeeded`, as `-updateNeeded true` asks, the network
 * stands as the service's refusal of an old build leaves it, so a flow
 * shoots the screen that asks for the update (`maestro/update-needed.yaml`).
 * Where `machineAsk`, as `-machineAsk true` asks, the run holds an ask of
 * Ada's MacBook for an agent's command from then on (`maestro/machine-ask.yaml`).
 * Where `inboxOff`, as `-inboxOff true` asks, the account reads its Inbox
 * turned off until the run turns it on (`maestro/inbox-off.yaml`).
 */
export function stageFixture(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  updateNeeded = false,
  machineAsk = false,
  setupOwed = false,
  inboxOff = false,
): void {
  if (machineAsk) MACHINE_ASKED.add(state);

  if (setupOwed) SETUP_OWED.add(state);

  if (inboxOff) INBOX_OFF.add(state);

  const snapshot = state.snapshot();

  if (!snapshot.run.fixtureMode || snapshot.run.profile === RUN_PROFILE.IDLE) return;
  const held: AppStateSnapshot = { ...snapshot, window: { fullScreen: false } };
  const inbox = inboxAppState(held, FIXTURE_WORKSPACE_IDS);

  if (inbox === held) return;

  const parts = queuedAppState(
    olderPageAppState(
      pullRequestPartsAppState(
        inbox,
        MOVES.get(state) ?? NO_MOVES,
        RESOLVES.get(state) ?? NO_RESOLVES,
      ),
      OLDER_ASKS.get(state) ?? 0,
    ),
    QUEUES.get(state) ?? NO_QUEUES,
  );

  const saved = savedMemoriesAppState(
    inboxReadMarksAppState(
      inboxRemindersAppState(
        inboxSentRepliesAppState(parts, SENT_REPLIES.get(state) ?? NO_SENT_REPLIES),
        REMINDERS.get(state) ?? NO_REMINDERS,
      ),
      INBOX_READ_MARKS.get(state) ?? NO_INBOX_READ_MARKS,
    ),
    MEMORY_WORDS.get(state) ?? NO_MEMORY_WORDS,
  );

  const sendsKept = chatSentAppState(
    sendsAppState(saved, KEPT_SENDS.get(state) ?? NO_KEPT_SENDS),
    KEPT_CHAT.get(state) ?? NO_KEPT_CHAT,
  );

  const switched = inboxAutomationsAppState(sendsKept, SWITCHES.get(state) ?? NO_SWITCHES);

  const reminded = MACHINE_ASKED.has(state)
    ? machineAskAppState(switched, ANSWERED_ASKS.get(state) ?? NO_ANSWERED_ASKS)
    : switched;

  const listed = stagedTasks(
    held,
    state.taskList(),
    CHOICES.get(state) ?? NO_CHOICES,
    READ_MARKS.get(state) ?? NO_READ_MARKS,
  );

  const staged = {
    ...withInboxOff(withSetupOwed(reminded, SETUP_OWED.has(state)), INBOX_OFF.has(state)),
    tasks: listed.tasks,
    network: stagedNetwork(held, updateNeeded),
    [LIVE_READ.PROVIDER_KEYS]: stagedKeys(inbox),
  };

  state.update(stagedPatch(held, staged), listed.lists);
}

/**
 * Keeps a reply with pictures the fixture took and lays it over the
 * document at once, as the service's next read carries one, so the thread
 * draws the reply's pictures as a live run does; nothing for any other act,
 * one the fixture refused, or a reply with no pictures.
 */
function keepSentReply(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
  answer: PortActResult<PortActKind>,
): void {
  if (kind !== ACT_KIND.AGENTS_INBOX_MESSAGE) return;

  if (Predicate.isObject(answer) && "failure" in answer) return;

  // SAFETY: the payload is the kind's, which the guard above names.
  const reply = inboxSentReply(
    payload as PortActPayload<typeof ACT_KIND.AGENTS_INBOX_MESSAGE>,
    Date.now(),
  );

  if (reply === undefined) return;
  const sent = SENT_REPLIES.get(state) ?? NO_SENT_REPLIES;
  const replies = [...(sent.get(reply.itemId) ?? []), reply];
  SENT_REPLIES.set(state, new Map(sent).set(reply.itemId, replies));
  stageFixture(state);
}

/**
 * Lays a comment thread the fixture started, replied to, resolved, or
 * reopened over the document at once, as the host draws a declared write,
 * since the fixture answers it before it reaches the host; nothing for any
 * other act, or one the fixture refused. Note that the fixture keeps the
 * thread itself as it answers (`inboxAppState`'s comments), so this only
 * stages the run again.
 */
function keepCommentThread(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  answer: PortActResult<PortActKind>,
): void {
  if (kind !== ACT_KIND.TASKS_COMMENT_START && kind !== ACT_KIND.TASKS_COMMENT_ACT) return;

  if (Predicate.isObject(answer) && "thread" in answer) stageFixture(state);
}

/** A picture a reply of this run carried, read back as the service answers one; none for any other act or attachment. */
function sentFileRead(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): PortActResult<typeof ACT_KIND.AGENTS_INBOX_ATTACHMENT> | undefined {
  if (kind !== ACT_KIND.AGENTS_INBOX_ATTACHMENT) return undefined;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { attachmentId } = payload as PortActPayload<typeof ACT_KIND.AGENTS_INBOX_ATTACHMENT>;

  return inboxSentFile(SENT_REPLIES.get(state) ?? NO_SENT_REPLIES, attachmentId);
}

/** Keeps a reminder the fixture took, set or cleared, and lays it over the document at once, as the host draws one; nothing for any other act. */
function keepReminder(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  if (kind !== ACT_KIND.AGENTS_INBOX_REMIND) return;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { itemId, until } = payload as PortActPayload<typeof ACT_KIND.AGENTS_INBOX_REMIND>;
  REMINDERS.set(state, new Map(REMINDERS.get(state) ?? NO_REMINDERS).set(itemId, until));
  stageFixture(state);
}

/**
 * Keeps a read mark the fixture took, Mark as read or unread or the read an
 * open sends, and lays it over the document at once, as the host draws one;
 * nothing for any other act. Note that the fixture answers the mark itself,
 * since the host's own drawing of it stands only until the fixture lays its
 * tasks over the list again, which a run with no service does as the write
 * goes unanswered.
 */
function keepReadMark(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): boolean {
  if (kind !== ACT_KIND.TASKS_MARK_READ) return false;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { taskId, readMark } = payload as PortActPayload<typeof ACT_KIND.TASKS_MARK_READ>;
  const kept: KeptReadMark = { mark: readMark, at: Date.now() };
  READ_MARKS.set(state, new Map(READ_MARKS.get(state) ?? NO_READ_MARKS).set(taskId, kept));
  stageFixture(state);

  return true;
}

/** Keeps an Inbox read mark the fixture took and lays it over the document at once, as the host draws one; nothing for any other act. */
function keepInboxReadMark(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  if (kind !== ACT_KIND.AGENTS_INBOX_READ_STATE) return;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { itemId, unread } = payload as PortActPayload<typeof ACT_KIND.AGENTS_INBOX_READ_STATE>;
  INBOX_READ_MARKS.set(
    state,
    new Map(INBOX_READ_MARKS.get(state) ?? NO_INBOX_READ_MARKS).set(itemId, unread),
  );
  stageFixture(state);
}

/** Keeps a machine's ask the fixture answered and takes it off the document at once, as the service's read drops it (`machineAskAppState`); nothing for any other act. */
function keepMachineAnswer(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  if (kind !== ACT_KIND.MACHINE_ASK_ANSWER) return;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { id } = payload as PortActPayload<typeof ACT_KIND.MACHINE_ASK_ANSWER>;
  ANSWERED_ASKS.set(state, new Set(ANSWERED_ASKS.get(state) ?? NO_ANSWERED_ASKS).add(id));
  stageFixture(state);
}

/** Keeps the words of a memory the fixture saved, over one of its own or as a new one, and lays them over the document at once (`savedMemoriesAppState`); nothing for any other act. */
function keepMemory(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  if (kind !== ACT_KIND.MEMORIES_SAVE) return;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { text, replaces } = payload as PortActPayload<typeof ACT_KIND.MEMORIES_SAVE>;

  const id = replaces ?? NEW_MEMORY_ID;
  MEMORY_WORDS.set(state, new Map(MEMORY_WORDS.get(state) ?? NO_MEMORY_WORDS).set(id, text));
  stageFixture(state);
}

/** Keeps an automation's switch the fixture turned, and lays it over the list at once, as the host draws a switch turned (`inboxAutomationsAppState`); nothing for any other act. */
function keepAutomationSwitch(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  const turned = automationSwitchOf(kind, payload);

  if (turned === undefined) return;
  const switches = new Map(SWITCHES.get(state) ?? NO_SWITCHES);
  SWITCHES.set(state, switches.set(turned.automationId, turned.enabled));
  stageFixture(state);
}

/** Keeps a change of one of its agents the fixture took, its model, mode, servers, name, pin, or archive, and lays it over the document at once, as the host draws one; nothing for any other act. */
function keepChoice(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  const changed = agentChangeOf(kind, payload);

  if (changed === undefined) return;
  const held = CHOICES.get(state) ?? NO_CHOICES;
  const change = { ...held.get(changed.agentId), ...changed.change };
  CHOICES.set(state, new Map(held).set(changed.agentId, change));
  stageFixture(state);
}

/** Keeps the queue a change to it or a Stop the fixture took leaves its agent, and lays it over the document at once, as the host draws one; nothing for any other act. */
function keepQueue(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  const held = QUEUES.get(state) ?? NO_QUEUES;
  const after = queueAfter(held, kind, payload);

  if (after === undefined) return;
  QUEUES.set(state, new Map(held).set(after.agentId, after.queue));
  stageFixture(state);
}

/** Keeps how a change the fixture took moved its pull request, or a review thread it resolved or opened again, and lays it over the document at once; nothing for any other act. */
function keepMove(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  if (kind !== ACT_KIND.PULL_REQUESTS_ACTION) return;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { number, request } = payload as PortActPayload<typeof ACT_KIND.PULL_REQUESTS_ACTION>;
  const moves = MOVES.get(state) ?? NO_MOVES;
  const moved = pullRequestMovedBy(moves.get(number), request);
  const resolve = threadResolveOf(request);

  if (moved !== undefined) MOVES.set(state, new Map(moves).set(number, moved));

  if (resolve !== undefined) {
    RESOLVES.set(
      state,
      new Map(RESOLVES.get(state) ?? NO_RESOLVES).set(resolve.threadId, resolve.resolved),
    );
  }

  if (moved !== undefined || resolve !== undefined) stageFixture(state);
}

/** What a read of the invitations agent's older page answers, counted, its page laid over the document at once where it lands; none for any other act or transcript. */
function olderRead(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  profile: RunProfile,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): PortActResult<typeof ACT_KIND.AGENTS_TRANSCRIPT_OLDER> | undefined {
  if (kind !== ACT_KIND.AGENTS_TRANSCRIPT_OLDER) return undefined;
  const asks = (OLDER_ASKS.get(state) ?? 0) + 1;
  // SAFETY: the payload is the kind's, which the guard above names.
  const params = payload as PortActPayload<typeof ACT_KIND.AGENTS_TRANSCRIPT_OLDER>;
  const answer = olderPageAnswer(profile, params, asks);

  if (answer === undefined) return undefined;
  OLDER_ASKS.set(state, asks);
  stageFixture(state);

  return answer;
}

/** What GitHub says of a pull request change the fixture refuses, as it words a merge it will not make. */
const PULL_REQUEST_REFUSED_WORDS = "Pull Request is not mergeable";

/** The agent a refused description's edit names as having written over it, the invitations agent as its row names it. */
const EDIT_CONFLICT_AGENT = "Build the invite flow";

/**
 * A task's start answered as unanswered the first time its task's id is
 * sent, as a dropped connection leaves it, so a flow sees New task's notice
 * with Try again, and a Try again under the same id goes through; nothing for
 * any other act, or a start sent again.
 */
function startRefusedOnce(
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): PortActResult<typeof ACT_KIND.TASKS_START> | undefined {
  if (kind !== ACT_KIND.TASKS_START) return undefined;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { id } = payload as PortActPayload<typeof ACT_KIND.TASKS_START>;
  const refused = STARTS_REFUSED.get(state) ?? new Set<string>();

  if (id === undefined || refused.has(id)) return undefined;
  STARTS_REFUSED.set(state, new Set(refused).add(id));

  return { failure: TASK_CALL_FAILURE.UNANSWERED };
}

/** A description's edit answered as a conflict with the invitations agent's change to its first line, written meanwhile, as the service answers one whose lines both changed. */
function editConflict({
  edit,
}: PortActPayload<typeof ACT_KIND.TASKS_EDIT>): PortActResult<typeof ACT_KIND.TASKS_EDIT> {
  const [first = "", ...rest] = edit.description.base.split("\n");
  const current = [`${first} (noted by the agent)`, ...rest].join("\n");

  return {
    conflict: {
      current,
      by: {
        actor: DESCRIPTION_ACTOR.AGENT,
        label: EDIT_CONFLICT_AGENT,
        at: Date.now(),
        duringCall: false,
      },
    },
  };
}

/**
 * The writes `-refuseWrites true` refuses, each answered as the host
 * answers once the service has refused it: a task's status and its pin
 * not kept, so the screens put the row back and say why, as they would
 * of a live refusal (a task's start is refused on its first send alone,
 * `startRefusedOnce`), an agent's start unanswered, so a flow sees New
 * agent's notice with Try again once its sheet has closed, and a follower
 * added, a memory deleted or a thread's reminder or reply unanswered, so a
 * flow sees the notice over Add a follower's sheet, Settings', and a
 * thread's composer, the keyboard up or down, and a reply standing on its
 * thread marked Not delivered, a message to an agent standing in its
 * transcript marked Not delivered (`keepSend`), and a description's edit met by the
 * invitations agent's note written meanwhile over the same lines, so a flow
 * sees Edit description's conflict ask.
 */
const REFUSED_WRITES: ReadonlyMap<
  PortActKind,
  (payload: PortActPayload<PortActKind>) => PortActResult<PortActKind>
> = new Map<PortActKind, (payload: PortActPayload<PortActKind>) => PortActResult<PortActKind>>([
  // Note that a memory's save and a version's restore are refused too, so their notices and Try again show.
  [ACT_KIND.MEMORIES_SAVE, () => MEMORY_SAVE_REFUSED],
  [ACT_KIND.TASKS_RESTORE, () => false],
  // SAFETY: the payload is the kind's, which the map's key names.
  [
    ACT_KIND.TASKS_EDIT,
    (payload) => editConflict(payload as PortActPayload<typeof ACT_KIND.TASKS_EDIT>),
  ],
  [ACT_KIND.TASKS_SET_STANDING, () => false],
  [ACT_KIND.TASKS_PIN, () => false],
  [ACT_KIND.AGENTS_START, () => ({ failure: AGENT_CALL_FAILURE.UNANSWERED })],
  [ACT_KIND.TASKS_ADD_FOLLOWER, () => ({ failure: FOLLOWER_CALL_FAILURE.UNANSWERED })],
  [ACT_KIND.MEMORIES_FORGET, () => ({ failure: AGENT_CALL_FAILURE.UNANSWERED })],
  [ACT_KIND.AGENTS_INBOX_REMIND, () => ({ failure: AGENT_CALL_FAILURE.UNANSWERED })],
  // Note that a thread's reply is unanswered too, so a flow sees it stand on its thread marked Not delivered.
  [ACT_KIND.AGENTS_INBOX_MESSAGE, () => ({ failure: AGENT_CALL_FAILURE.UNANSWERED })],
  // Note that a note to the people who make the app is refused too, so its footer's failure tone shows.
  [ACT_KIND.FEEDBACK_SEND, () => ({ delivered: false })],
  // Note that a change to a pull request is refused as GitHub refuses one, its words beside, so the pull request page shows its write note.
  [
    ACT_KIND.PULL_REQUESTS_ACTION,
    () => ({ outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: PULL_REQUEST_REFUSED_WORDS }),
  ],
]);

/** A member of `members` by a key known only at run time, as the fixture reads each one of the port before it answers or forwards it. */
function memberAt<Member>(
  members: { readonly [key: PropertyKey]: Member },
  key: PropertyKey,
): Member | undefined {
  return members[key];
}

/**
 * The act port a fixture run's screens act through: each act the profile
 * answers, such as a mark, a thread's file read, or a reply or a resolve on
 * a thread, one of them refused (`inboxActAnswer`),
 * answered by the fixture, as the panel's fixture run answers it on the
 * window's side, and every other act sent to the host. The invitations
 * agent's older page is read as the service would read it, though its first
 * read is not heard back, so a flow sees Try again, and the next lays the
 * page before the transcript's first message. Note that a thread's read
 * mark and a task's each move their row's dot (`keepInboxReadMark`,
 * `keepReadMark`), and a change to one of the
 * fixture's pull requests moves it on the document of `state`, as GitHub
 * would, so a screen draws it merged, out of the queue, closed, or a
 * draft, and a reminder set or cleared moves its item there, as the host draws one, so the Inbox
 * puts it away under Reminders, an automation's switch turned moves it on
 * the list there, and a change of an agent's model, permission
 * mode, servers, name, or pin moves the agent there, as the host draws one,
 * and a change to its queue moves the queue there, a Stop pausing it, so a
 * flow may move a queued message and Resume, and a description comment
 * thread started, replied to, resolved, or reopened stands so on its task's
 * comments there (`keepCommentThread`).
 * Where `refusesWrites`, the writes `REFUSED_WRITES` names are refused
 * before anything else answers them, so a flow sees the failure notice.
 */
export function fixtureActs(
  acts: ActPortClient,
  profile: RunProfile,
  state: Pick<AppStateStore, "snapshot" | "taskList" | "update">,
  refusesWrites = false,
): ActPortClient {
  return new Proxy(acts, {
    get(target, kind) {
      const sent = memberAt<unknown>(target, kind);

      if (!Predicate.isString(kind) || !Predicate.isFunction(sent)) return sent;

      // Note that each function under a kind takes that kind's payload.
      return (payload: PortActPayload<PortActKind>, ...rest: unknown[]) => {
        // SAFETY: the port is keyed by act kind.
        const refused = refusesWrites ? REFUSED_WRITES.get(kind as PortActKind) : undefined;

        if (refused !== undefined) return Promise.resolve(refused(payload));

        // Note that a message to an agent is left unanswered too, and kept as the host keeps a refused line, so a flow sees it stand Not delivered.
        // SAFETY: the port is keyed by act kind.
        if (refusesWrites && keepSend(state, kind as PortActKind, payload, true)) {
          return Promise.resolve(
            kind === ACT_KIND.AGENTS_UNSEND
              ? undefined
              : { failure: AGENT_CALL_FAILURE.UNANSWERED },
          );
        }

        // SAFETY: the port is keyed by act kind.
        const startRefused = refusesWrites
          ? startRefusedOnce(state, kind as PortActKind, payload)
          : undefined;

        if (startRefused !== undefined) return Promise.resolve(startRefused);
        // SAFETY: the port is keyed by act kind.
        const older = olderRead(state, profile, kind as PortActKind, payload);

        if (older !== undefined) return Promise.resolve(older);

        // SAFETY: the port is keyed by act kind, and each function under a kind takes that kind's payload.
        if (keepReadMark(state, kind as PortActKind, payload)) return Promise.resolve(true);

        // SAFETY: as above.
        const sentFile = sentFileRead(state, kind as PortActKind, payload);

        if (sentFile !== undefined) return Promise.resolve(sentFile);

        // SAFETY: the port is keyed by act kind, and each function under a kind takes that kind's payload.
        const staged = inboxActAnswer(profile, kind as PortActKind, payload);

        if (staged === undefined) return sent.call(target, payload, ...rest);
        // SAFETY: as above.
        keepMove(state, kind as PortActKind, payload);
        // SAFETY: as above.
        keepReminder(state, kind as PortActKind, payload);
        // SAFETY: as above.
        keepInboxReadMark(state, kind as PortActKind, payload);
        // SAFETY: as above.
        keepChoice(state, kind as PortActKind, payload);
        // SAFETY: as above.
        keepQueue(state, kind as PortActKind, payload);
        // SAFETY: as above.
        keepMemory(state, kind as PortActKind, payload);
        // SAFETY: as above.
        keepAutomationSwitch(state, kind as PortActKind, payload);
        // SAFETY: as above.
        keepMachineAnswer(state, kind as PortActKind, payload);
        // SAFETY: as above.
        keepSentReply(state, kind as PortActKind, payload, staged.answer);
        // SAFETY: as above.
        keepCommentThread(state, kind as PortActKind, staged.answer);
        // Note that a message the run took stands in its agent's transcript on its way, as a sent line does until its row lands, since nothing the run stages moves.
        // SAFETY: as above.
        keepSend(state, kind as PortActKind, payload, false);
        // Note that a message the run took for a Manager's chat lands as its row at once, a reply in its thread's, as the chat's next read carries it.
        // SAFETY: as above.
        keepChatSend(state, kind as PortActKind, payload);

        return Promise.resolve(staged.answer);
      };
    },
  });
}
