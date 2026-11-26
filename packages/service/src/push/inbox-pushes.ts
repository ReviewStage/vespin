/**
 * inbox-pushes.ts -- what the service pushes to a member's phone: an Inbox post that waits on them, its notification cleared once it settles, a run of theirs that failed, and, where they keep no Inbox, one that finished.
 *
 * Three kinds of news reach a phone (`PUSH_KIND`, `@repo/features/inbox-push-wire`), each its own so one can
 * be dropped alone: an agent's post that asks the member something, a
 * decide, do, or answer; any other post of an agent's on a thread that
 * waits on them; and a turn of an agent they started that ended. A thread
 * waits on one member (`inboxItemWaitsOn`: the member its agent addressed
 * it to, else its task's assignee, else the agent's starter), as its Slack
 * DM does (`../slack/thread-dms.ts`), and only that member's phones are
 * pushed. A turn that failed pushes its starter, or for a Manager, which
 * many members talk to, the member who asked for the turn (`turnAsker`,
 * read as it settles), its starter standing in for a turn no member asked
 * for. One that finished well pushes that member only where they keep no
 * Inbox (`@repo/settings`'s `inbox` off, their own setting): their agents then ask in their reply rather than on a thread, so
 * the turn's end is the news a post would have been, and its alert says the
 * reply's opening words. Where the Inbox is on, a finished turn pushes
 * nothing, since what needs the member comes as a post. A turn the member
 * stopped pushes nothing. Whether a phone takes the push is the member's own grant of iOS
 * notification permission and iOS's settings: no switch of ours is read,
 * the desktop's `turnNotifications` among them (`@repo/host/agent-notices`).
 *
 * An alert says the thread's or the agent's title over the message's
 * Markdown said as plain words, its chips by their labels, since a banner and
 * the Lock Screen draw no formatting. Beside Apple's `aps` it carries the ids
 * the app opens the thread and answers it by (`InboxPushIds`), and a post's
 * Markdown itself (`markdown`), as much as Apple's 4 KB bound leaves room
 * for, which the app's expanded notification draws formatted.
 * Its `thread-id` groups the phone's notifications by task, or by agent for
 * a thread on no task, a Manager's, which goes only to a phone whose build
 * opens one (`TASKLESS_THREAD_PUSH_API_VERSION`); its `category` is the actions the app offers on it
 * (`PUSH_CATEGORY`): a decide that takes one option offers each as a button,
 * whose labels the payload's `options` carries for the app to set on that
 * notification alone, since a category's actions are otherwise fixed; any other
 * post offers a reply typed in place; a turn that ended, none. Its collapse id is
 * the thread's, or the agent's for a turn, so a later post on a thread, or a
 * later turn of an agent, replaces the one before it on the
 * lock screen, and the app removes it by that id, which iOS names the
 * delivered notification by. A finished turn's alert goes as a failed one's
 * does (`PUSH_KIND.RUN_FAILED`), saying its own words, since that is the
 * kind a released app opens the agent from, and a kind of its own would
 * open nothing there. Its badge is the member's Inbox count as the
 * desktop's Dock counts it (`inboxWaitingCount`).
 *
 * Once a thread settles anywhere, an ask answered or withdrawn, a notice
 * acknowledged or closed, the member it waits on is sent a background push
 * naming the thread (`PUSH_KIND.SETTLED`), so the app removes its delivered
 * notification, with the badge their Inbox now counts.
 *
 * Each phone's "Notify me" (`PUSH_NOTIFY`) says when it takes an alert. One
 * set to never takes nothing, the background push among it. One set to
 * always takes each alert as it is due. One set to away, the default, takes
 * it at once only while the member is not at their desk: while a desktop or
 * web client of theirs saw them active inside `PRESENCE.WINDOW_MS`
 * (`@repo/database/models/presence-store`), the alert is held instead
 * (`@repo/database/models/held-push-store`), one hold per thread and per
 * agent. Once they walk away, the scheduled sweep takes the hold
 * (`releaseHeldPushes`) and sends it to the phones set to away, composed
 * afresh from the thread or the agent as it then stands, if it still waits
 * on them: a thread still open on them with its ask unanswered, or its post
 * unread, or an agent still standing on the turn that failed, or on the turn
 * that finished while its member still keeps no Inbox. What was
 * settled meanwhile is never sent. A settled thread's background push is
 * never held, since it only clears what a phone already shows.
 *
 * A post on a thread, an ask among them, and the thread settling also
 * refresh the Live Activity of the member it waits on, whose count of
 * threads waiting moved (`live-activities.ts`): an ask starting to wait at
 * high priority, the rest as routine.
 *
 * Every push is the caller's best effort, handed to `afterResponse`: a
 * runtime with no `ApnsSender`, such as most tests', or a member with no
 * phone registered, pushes nothing and reads nothing more.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readAccountPreferences } from "@repo/database/models/account-store";
import { type Agent, readAgent, readAgentOfConversation } from "@repo/database/models/agent-store";
import {
  holdThreadPush,
  holdTurnPush,
  type TakenHold,
  takeAbsentHolds,
} from "@repo/database/models/held-push-store";
import { latestTurnsOf, readMessageByClientId } from "@repo/database/models/message-reads";
import { readLastActive } from "@repo/database/models/presence-store";
import { listPushDevices, type PushDevice } from "@repo/database/models/push-device-store";
import { turnAsker } from "@repo/database/models/turn-asker";
import type { SettledAgentTurn } from "@repo/database/models/writer";
import { LIMIT_REACHED_WORDS } from "@repo/features/agent-failure-words";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { inboxAgentsTurn, inboxRowOf } from "@repo/features/inbox-digest";
import { PUSH_CATEGORY, PUSH_KIND } from "@repo/features/inbox-push-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  knownAsk,
  openAskOf,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import { clippedWords, markdownPlainText } from "@repo/features/markdown-plain-text";
import { agentName } from "@repo/features/model-label";
import { PRESENCE } from "@repo/features/presence-wire";
import { PUSH_NOTIFY } from "@repo/features/push-device-wire";
import { TURN_STATUS } from "@repo/wire";
import { Clock, Effect, Option } from "effect";
import { lastSaid } from "../agents/coder-host/starter-report.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { TURN_FAILURE } from "../core.js";
import {
  inboxItemWaitsOn,
  inboxWaitingCount,
  readInboxItem,
  readInboxItemHome,
} from "../inbox/inbox-store.js";
import { APNS_PUSH_TYPE, type ApnsPayload, ApnsSender } from "./apns.js";
import { LIVE_ACTIVITY_CAUSE, refreshLiveActivity } from "./live-activities.js";
import { markdownLeads } from "./markdown-leads.js";

/** The most characters of a title and a body an alert says; Apple caps a payload at 4 KB. */
const ALERT_BOUND = { TITLE_CHARS: 120, BODY_CHARS: 240 } as const;

/**
 * Apple's bound on an alert push's payload, in bytes of its JSON, and the
 * room kept under it for what Apple's own encoding may add.
 */
const PAYLOAD_BOUND = { BYTES: 4096, SPARE: 64 } as const;

/** What a failed run's alert says under the agent's name, as the desktop's notification says it. */
const RUN_FAILED_BODY = "Your agent failed.";

/** What a finished turn's alert says under the agent's name where its reply said nothing. */
const TURN_FINISHED_BODY = "Your agent finished.";

/** The most holds one sweep takes, and how many it sends at once; the rest wait for the next minute's. */
const HELD_PUSH_SWEEP = { BATCH: 100, CONCURRENCY: 8 } as const;

/**
 * The first hosted API version (`HOSTED_API_VERSION`) whose iOS builds open
 * a thread's alert that names no task, a Manager's, on the thread in their
 * Inbox. Note that a build before it, or a phone that has not registered
 * since the service kept its version, is never sent one.
 */
const TASKLESS_THREAD_PUSH_API_VERSION = 9;

/** One notification as a push composes it for the badge, before it is addressed to each phone, and the API version a phone must have named to be sent it, where an older build cannot open it. */
interface MemberNotification {
  readonly pushType: typeof APNS_PUSH_TYPE.ALERT | typeof APNS_PUSH_TYPE.BACKGROUND;
  readonly payload: ApnsPayload;
  readonly collapseId?: string;
  readonly minApiVersion?: number;
}

/** What an alert tells of, which a hold names so the sweep can read it again. */
type HoldSubject =
  | { readonly itemId: string }
  | { readonly agentId: string; readonly turnId: string };

/** The ids an alert about a thread carries for the app to open it and answer it. */
interface InboxPushIds {
  readonly itemId: string;
  /** The agent's message the alert is about: the ask an answer names, or the post a reply follows. */
  readonly messageId: string;
  readonly agentId: string;
  /** The task the thread stands on; none for a thread on no task, a Manager's. */
  readonly taskId?: string;
  /** The thread's revision, which a nod or a close names. */
  readonly revision: number;
}

/** An agent's post as a push reads it: the item as the post wrote it, whether it asked, and the task its agent works on, none for a Manager. */
export interface ThreadPushPost {
  readonly item: InboxItem;
  readonly asked: boolean;
  readonly taskId: string | null;
}

/**
 * The words as an alert's body says them: the Markdown said as plain text,
 * each mention by its label, a line to each line it draws, clipped to the
 * body's bound. Note that Apple draws no formatting in a banner or on the
 * Lock Screen, so marks left in would stand as stray characters, and that the
 * lines past the first fill a banner's four lines and the expanded alert.
 */
function bodyWords(text: string): string {
  return clippedWords(markdownPlainText(text), ALERT_BOUND.BODY_CHARS);
}

/** A title as an alert says it: its Markdown said as plain text on one line, or its words as written where that says nothing. */
function titleWords(title: string): string {
  const plain = markdownPlainText(title).replaceAll("\n", " ");

  return plain === "" ? title.trim() : plain;
}

/** The alert's title and body; a body that would say nothing is left out. */
function alertOf(title: string, body: string) {
  return {
    title: clippedWords(titleWords(title), ALERT_BOUND.TITLE_CHARS),
    ...(body === "" ? undefined : { body }),
  };
}

/** The agent's message a post wrote: the ask it holds open where it asked, else the agent's latest, as its Slack DM reads it. */
function postedMessage(item: InboxItem, asked: boolean): InboxMessage | undefined {
  const thread = item.thread ?? [];
  const latest = thread.findLast((message) => message.author === INBOX_MESSAGE_AUTHOR.AGENT);

  if (!asked) return latest;

  return thread.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN) ?? latest;
}

/** What a post's alert offers: a decide that takes one option, its options as buttons; anything else, a reply. */
function actionsOf(message: InboxMessage) {
  const ask = message.ask === undefined ? undefined : knownAsk(message.ask);

  if (ask?.type !== INBOX_ASK.DECIDE || ask.multiple === true) {
    return {
      category: PUSH_CATEGORY.REPLY,
      ...(ask === undefined ? undefined : { ask: ask.type }),
    };
  }

  const recommended = recommendedLabels(ask);

  return {
    category: PUSH_CATEGORY.DECIDE,
    ask: ask.type,
    options: ask.options.map((option) => option.label),
    ...(recommended.length === 0 ? undefined : { recommended }),
  };
}

/** Whether the phone's build reads the notification: any does where it names no version, else one whose register named that version or later. */
function readsNotification(device: PushDevice, notification: MemberNotification): boolean {
  const { minApiVersion } = notification;

  return (
    minApiVersion === undefined ||
    (device.apiVersion !== null && device.apiVersion >= minApiVersion)
  );
}

/** Sends the notification `compose` writes for the member's badge to each phone named whose build reads it; nothing for none, and the badge is counted only once one stands. */
function sendToDevices(
  userId: string,
  devices: readonly PushDevice[],
  compose: (badge: number) => MemberNotification,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const sender = yield* Effect.serviceOption(ApnsSender);

    if (Option.isNone(sender) || devices.length === 0) return;
    const composed = compose(yield* inboxWaitingCount(userId, yield* Clock.currentTimeMillis));
    const { minApiVersion: _gate, ...notification } = composed;

    yield* Effect.forEach(
      devices.filter((device) => readsNotification(device, composed)),
      ({ token, environment, bundleId }) =>
        sender.value.send({ ...notification, device: { token, environment, bundleId } }),
      { discard: true },
    );
  });
}

/** Whether a desktop or web client of the member's saw them active inside the window, as of `now`. */
function memberPresent(userId: string, now: number) {
  return Effect.map(readLastActive(userId), (last) =>
    Option.match(last, {
      onNone: () => false,
      onSome: (at) => now - at.getTime() < PRESENCE.WINDOW_MS,
    }),
  );
}

/** The alert held for the member's phones set to away, or stamped held again. */
function holdFor(userId: string, subject: HoldSubject) {
  return "itemId" in subject
    ? holdThreadPush(userId, subject.itemId)
    : holdTurnPush(userId, subject.agentId, subject.turnId);
}

/**
 * Sends the notification to every phone the member registered but those set
 * to never; nothing where the runtime holds no sender or the member
 * registered none. An alert that names what it tells of (`hold`) goes, while
 * the member is present, to the phones set to always alone, and is held for
 * those set to away (`releaseHeldPushes`); a background push names none and
 * is never held.
 */
function pushToMember(
  userId: string,
  compose: (badge: number) => MemberNotification,
  hold?: HoldSubject,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const sender = yield* Effect.serviceOption(ApnsSender);

    if (Option.isNone(sender)) return;

    const devices = (yield* listPushDevices(userId)).filter(
      (device) => device.notify !== PUSH_NOTIFY.NEVER,
    );

    if (devices.length === 0) return;

    if (hold === undefined || !(yield* memberPresent(userId, yield* Clock.currentTimeMillis))) {
      return yield* sendToDevices(userId, devices, compose);
    }

    if (devices.some((device) => device.notify === PUSH_NOTIFY.AWAY)) {
      yield* holdFor(userId, hold);
    }

    yield* sendToDevices(
      userId,
      devices.filter((device) => device.notify === PUSH_NOTIFY.ALWAYS),
      compose,
    );
  });
}

/** A payload's size as Apple counts it: the bytes of its JSON. */
function payloadBytes(payload: ApnsPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * The payload with the post's Markdown beside the alert, as the app's
 * expanded notification draws it (`notification-content/`): as many of its
 * blocks, from the first, as keep the payload within Apple's bound, so a cut
 * never leaves a mark open. Note that it is left out where it would say just
 * what the body says, or where not even its first block fits, and the
 * expanded notification then draws the body.
 */
function withMarkdown(payload: ApnsPayload, text: string, body: string | undefined): ApnsPayload {
  const room = PAYLOAD_BOUND.BYTES - PAYLOAD_BOUND.SPARE;
  let markdown: string | undefined;

  // Note that each lead holds the one before it, so the walk stops at the first past the bound and never measures a long post whole.
  for (const lead of markdownLeads(text)) {
    if (payloadBytes({ ...payload, markdown: lead }) > room) break;
    markdown = lead;
  }

  return markdown === undefined || markdown === body ? payload : { ...payload, markdown };
}

/** The alert about a post on a thread: its title over the post's plain words, with the post's Markdown beside them and the ask's actions where it asked; none where the post wrote no message of the agent's. */
function threadPostNotification(
  post: ThreadPushPost,
): ((badge: number) => MemberNotification) | undefined {
  const { item, asked, taskId } = post;
  const message = postedMessage(item, asked);

  if (message === undefined) return undefined;

  const ids: InboxPushIds = {
    itemId: item.id,
    messageId: message.id,
    agentId: item.agentId,
    ...(taskId === null ? undefined : { taskId }),
    revision: item.revision,
  };

  const { category, ...actions } = actionsOf(message);
  const kind = message.ask?.status === INBOX_ASK_STATUS.OPEN ? PUSH_KIND.ASK : PUSH_KIND.POST;

  const alert = alertOf(item.title, bodyWords(message.text));

  return (badge) => ({
    pushType: APNS_PUSH_TYPE.ALERT,
    collapseId: item.id,
    ...(taskId === null ? { minApiVersion: TASKLESS_THREAD_PUSH_API_VERSION } : undefined),
    payload: withMarkdown(
      {
        aps: {
          alert,
          // Note that a thread on no task threads its alerts by its agent, as its task would.
          "thread-id": taskId ?? item.agentId,
          category,
          "mutable-content": 1,
          sound: "default",
          badge,
        },
        kind,
        ...ids,
        ...actions,
      },
      message.text,
      alert.body,
    ),
  });
}

/** The alert about the agent's turn that ended, saying the words given under its name; a tap opens the agent. */
function agentTurnNotification(agent: Agent, turnId: string, body: string) {
  return (badge: number): MemberNotification => ({
    pushType: APNS_PUSH_TYPE.ALERT,
    collapseId: agent.id,
    payload: {
      aps: {
        alert: alertOf(agentName(agent), body),
        // Note that an agent on no task threads its alerts by itself, as its task would.
        "thread-id": agent.taskId ?? agent.id,
        category: PUSH_CATEGORY.RUN_FAILED,
        "mutable-content": 1,
        sound: "default",
        badge,
      },
      // Note that a finished turn goes as this kind too, since it is the one a released app opens the agent from.
      kind: PUSH_KIND.RUN_FAILED,
      agentId: agent.id,
      ...(agent.taskId === null ? undefined : { taskId: agent.taskId }),
      turnId,
    },
  });
}

/** Whether the member keeps no Inbox: the setting turned off, where nothing stored reads as on. */
function inboxOff(userId: string) {
  return Effect.map(readAccountPreferences(userId), (row) => row?.preferences.inbox === false);
}

/** The opening words of the reply the agent's turn ended with, as an alert's body says them; the finished turn's own words where it said nothing. */
function replyWords(agent: Agent, turnId: string) {
  return Effect.map(
    readMessageByClientId(agent.userId, agent.conversationId, CODER_TOOL_SET, turnId),
    (journal) => {
      const [newest] = journal.ok ? journal.value : [];
      const said = newest === undefined ? undefined : lastSaid(newest.message);
      const words = said === undefined ? "" : bodyWords(said);

      return words === "" ? TURN_FINISHED_BODY : words;
    },
  );
}

/** The member a turn of the agent that ended is pushed to: for a Manager, whoever asked for it, as the module says; else its starter. */
function turnRecipient(agent: Agent) {
  return agent.kind === AGENT_KIND.MANAGER
    ? turnAsker({ userId: agent.userId, conversationId: agent.conversationId })
    : Effect.succeed(agent.userId);
}

/**
 * The alert to the member given about the agent's turn as it ended: a
 * failed one says why, as the desktop's notification does, and one that
 * finished well says its reply's opening words where that member keeps no
 * Inbox; none for any other end.
 */
function turnNotification(
  agent: Agent,
  recipient: string,
  turn: { readonly id: string; readonly status: string; readonly failure: string | null },
) {
  return Effect.gen(function* () {
    if (turn.status === TURN_STATUS.FAILED) {
      // A run its plan's usage limit stopped is told so, not that it failed.
      const body = turn.failure === TURN_FAILURE.PLAN_LIMIT ? LIMIT_REACHED_WORDS : RUN_FAILED_BODY;

      return Option.some(agentTurnNotification(agent, turn.id, body));
    }

    if (turn.status !== TURN_STATUS.SETTLED || !(yield* inboxOff(recipient))) {
      return Option.none<(badge: number) => MemberNotification>();
    }

    return Option.some(agentTurnNotification(agent, turn.id, yield* replyWords(agent, turn.id)));
  });
}

/**
 * Pushes the member the post's thread waits on: an alert saying the
 * thread's title over the post's first line, as the header says, with the
 * ask's actions where it asked; nothing where the thread waits on nobody or
 * the post wrote no message of the agent's.
 */
export function pushThreadPost(
  post: ThreadPushPost,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  const compose = threadPostNotification(post);
  const recipient = post.item.waitsOn?.userId;

  if (compose === undefined || recipient === undefined) return Effect.void;

  return Effect.andThen(
    pushToMember(recipient, compose, { itemId: post.item.id }),
    refreshLiveActivity(
      recipient,
      post.asked ? LIVE_ACTIVITY_CAUSE.ASKED : LIVE_ACTIVITY_CAUSE.ROUTINE,
    ),
  );
}

/**
 * Tells the phones of the member the thread waits on that it settled, as a
 * background push naming it, with their Inbox's count as its badge;
 * nothing for a thread that is gone.
 */
export function pushThreadSettled(
  itemId: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const recipient = yield* inboxItemWaitsOn(itemId);

    if (Option.isNone(recipient)) return;
    yield* pushToMember(recipient.value, (badge) => ({
      pushType: APNS_PUSH_TYPE.BACKGROUND,
      payload: { aps: { "content-available": 1, badge }, kind: PUSH_KIND.SETTLED, itemId },
    }));
    yield* refreshLiveActivity(recipient.value, LIVE_ACTIVITY_CAUSE.ROUTINE);
  });
}

/**
 * Pushes the member who started the agent, or who asked a Manager for the
 * turn, that its turn ended, saying the agent's name: one that failed, and
 * one that finished well where that member keeps no Inbox, over its reply's opening words; nothing for a turn
 * a Stop ended, which is the member's own, a finished one where they keep
 * an Inbox, or an agent that is gone. A later turn of the same agent
 * replaces the one before it on the lock screen.
 */
export function pushSettledTurn(
  turn: SettledAgentTurn,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  if (turn.status !== TURN_STATUS.FAILED && turn.status !== TURN_STATUS.SETTLED) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    const found = yield* readAgentOfConversation(turn.userId, turn.conversationId);

    if (Option.isNone(found)) return;
    const agent = found.value;

    const recipient = yield* turnRecipient(agent);

    const compose = yield* turnNotification(agent, recipient, {
      id: turn.turnId,
      status: turn.status,
      failure: turn.failure,
    });

    if (Option.isNone(compose)) return;
    yield* pushToMember(recipient, compose.value, { agentId: agent.id, turnId: turn.turnId });
  });
}

/**
 * The post a held thread's alert tells of, read again for the member it
 * waits on: the thread still open on them, its ask unanswered and not its
 * agent's turn, or its post unread; none where it settled, moved to another
 * member, was read, or is gone.
 */
function stillWaitingPost(userId: string, itemId: string) {
  return Effect.gen(function* () {
    const stored = yield* readInboxItem(userId, itemId);

    if (Option.isNone(stored)) return Option.none<ThreadPushPost>();
    const { item } = stored.value;
    const asks = openAskOf(item.thread ?? []) !== undefined && !inboxAgentsTurn(inboxRowOf(item));

    const waiting =
      item.status === INBOX_STATUS.OPEN &&
      item.waitsOn?.userId === userId &&
      (asks || item.unread === true);

    if (!waiting) return Option.none<ThreadPushPost>();
    const home = yield* readInboxItemHome(userId, itemId);

    return Option.map(home, ({ taskId }) => ({ item, asked: asks, taskId }));
  });
}

/** The alert a held turn tells of, composed afresh for the member it was held for where its agent still stands on that turn and it still pushes; none where a later turn followed it or the agent is gone. */
function stillStandingTurn(userId: string, agentId: string, turnId: string) {
  return Effect.gen(function* () {
    const agent = yield* readAgent(userId, agentId);

    if (Option.isNone(agent)) return Option.none<(badge: number) => MemberNotification>();

    // Note that the turns are read as the agent's starter's, since a Manager's alert may be held for another member who asked.
    const latest = (yield* latestTurnsOf(agent.value.userId, [agent.value.conversationId])).get(
      agent.value.conversationId,
    );

    return latest?.id === turnId
      ? yield* turnNotification(agent.value, userId, latest)
      : Option.none<(badge: number) => MemberNotification>();
  });
}

/** The alert a hold the sweep took tells of, composed afresh where what it tells of still waits; none otherwise. */
function heldNotification(hold: TakenHold) {
  return Effect.gen(function* () {
    const { userId, inboxItemId, agentId, turnId } = hold;

    if (inboxItemId !== null) {
      const post = yield* stillWaitingPost(userId, inboxItemId);

      return Option.flatMap(post, (each) => Option.fromUndefinedOr(threadPostNotification(each)));
    }

    if (agentId === null || turnId === null) return Option.none();

    return yield* stillStandingTurn(userId, agentId, turnId);
  });
}

/** One hold the sweep took, sent to the member's phones set to away where what it tells of still waits; nothing otherwise. */
function releaseHold(hold: TakenHold): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const compose = yield* heldNotification(hold);

    if (Option.isNone(compose)) return;

    // Note that a phone set to always had the alert when it was due, so only those set to away wait for it.
    const away = (yield* listPushDevices(hold.userId)).filter(
      (device) => device.notify === PUSH_NOTIFY.AWAY,
    );

    yield* sendToDevices(hold.userId, away, compose.value);
  });
}

/**
 * The scheduled sweep's release of held alerts: a batch of the holds of
 * members no client has seen active inside `PRESENCE.WINDOW_MS` of `now`,
 * each taken once and sent where what it tells of still waits; how many it
 * took. A hold that fails to send is logged and dropped, as an alert due at
 * once would have been.
 */
export function releaseHeldPushes(
  now: number,
): Effect.Effect<number, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const taken = yield* takeAbsentHolds(new Date(now - PRESENCE.WINDOW_MS), HELD_PUSH_SWEEP.BATCH);
    yield* Effect.forEach(
      taken,
      (hold) =>
        releaseHold(hold).pipe(
          Effect.catch((failure) => Effect.logWarning("a held push was not sent", failure)),
        ),
      { concurrency: HELD_PUSH_SWEEP.CONCURRENCY, discard: true },
    );

    return taken.length;
  });
}
