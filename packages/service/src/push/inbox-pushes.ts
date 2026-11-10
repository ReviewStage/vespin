/**
 * inbox-pushes.ts -- what the service pushes to a member's phone: an Inbox post that waits on them, its notification cleared once it settles, and a run of theirs that failed.
 *
 * Three kinds of news reach a phone (`PUSH_KIND`), each its own so one can
 * be dropped alone: an agent's post that asks the member something, a
 * decide, do, or answer; any other post of an agent's on a thread that
 * waits on them; and a turn of an agent they started that failed. A thread
 * waits on one member (`inboxItemWaitsOn`: the member its agent addressed
 * it to, else its task's assignee, else the agent's starter), as its Slack
 * DM does (`../slack/thread-dms.ts`), and only that member's phones are
 * pushed. A turn the member stopped, or one that finished well, pushes
 * nothing. Whether a phone takes the push is the member's own grant of iOS
 * notification permission and iOS's settings: no switch of ours is read,
 * the desktop's `turnNotifications` among them (`@repo/host/agent-notices`).
 *
 * An alert says the thread's or the agent's title over the message's first
 * line, its Markdown chips said by their labels, and carries, beside Apple's
 * `aps`, the ids the app opens the thread and answers it by (`InboxPushIds`).
 * Its `thread-id` groups the phone's notifications by task, or by agent for
 * one with no task; its `category` is the actions the app offers on it
 * (`PUSH_CATEGORY`): a decide that takes one option offers each as a button,
 * whose labels the payload's `options` carries for the app's service
 * extension to set, since a category's actions are otherwise fixed; any other
 * post offers a reply typed in place; a failed run, none. Its collapse id is
 * the thread's, so a later post on a thread replaces the one before it on the
 * lock screen, and the app removes it by that id, which iOS names the
 * delivered notification by. Its badge is the member's Inbox count as the
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
 * unread, or an agent still standing on the turn that failed. What was
 * settled meanwhile is never sent. A settled thread's background push is
 * never held, since it only clears what a phone already shows.
 *
 * Every push is the caller's best effort, handed to `afterResponse`: a
 * runtime with no `ApnsSender`, such as most tests', or a member with no
 * phone registered, pushes nothing and reads nothing more.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { type Agent, readAgent, readAgentOfConversation } from "@repo/database/models/agent-store";
import {
  holdFailedTurnPush,
  holdThreadPush,
  type TakenHold,
  takeAbsentHolds,
} from "@repo/database/models/held-push-store";
import { latestTurnsOf } from "@repo/database/models/message-reads";
import { readLastActive } from "@repo/database/models/presence-store";
import { listPushDevices, type PushDevice } from "@repo/database/models/push-device-store";
import type { SettledAgentTurn } from "@repo/database/models/writer";
import { LIMIT_REACHED_WORDS } from "@repo/features/agent-failure-words";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  inboxAgentsTurn,
  knownAsk,
  openAskOf,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import { mentionLinksIn } from "@repo/features/mention-link";
import { agentName } from "@repo/features/model-label";
import { PRESENCE } from "@repo/features/presence-wire";
import { PUSH_NOTIFY } from "@repo/features/push-device-wire";
import { TURN_STATUS } from "@repo/wire";
import { Clock, Effect, Option } from "effect";
import { TURN_FAILURE } from "../core.js";
import {
  inboxItemWaitsOn,
  inboxWaitingCount,
  readInboxItem,
  readInboxItemHome,
} from "../inbox/inbox-store.js";
import { APNS_PUSH_TYPE, type ApnsPayload, ApnsSender } from "./apns.js";

/** What a push tells of, as the payload's `kind` names it. */
export const PUSH_KIND = {
  /** An agent's post asking the member something: a decide, do, or answer. */
  ASK: "ask",
  /** Any other post of an agent's on a thread that waits on the member. */
  POST: "post",
  /** A turn of an agent the member started that failed. */
  RUN_FAILED: "run-failed",
  /** A thread settled, so its delivered notification is removed; a background push. */
  SETTLED: "settled",
} as const;

/** The actions the app offers on an alert, as its `aps.category` names them; the app registers each. */
export const PUSH_CATEGORY = {
  /** A decide that takes one option: a button per option, labeled from the payload's `options`. */
  DECIDE: "inbox-decide",
  /** Any other post: a reply typed in place. */
  REPLY: "inbox-reply",
  /** A failed run: no action but opening the agent. */
  RUN_FAILED: "agent-run-failed",
} as const;

/** The most characters of a title and a body an alert says; Apple caps a payload at 4 KB. */
const ALERT_BOUND = { TITLE_CHARS: 120, BODY_CHARS: 240 } as const;

/** What a failed run's alert says under the agent's name, as the desktop's notification says it. */
const RUN_FAILED_BODY = "Your agent failed.";

/** The most holds one sweep takes, and how many it sends at once; the rest wait for the next minute's. */
const HELD_PUSH_SWEEP = { BATCH: 100, CONCURRENCY: 8 } as const;

/** One notification as a push composes it for the badge, before it is addressed to each phone. */
interface MemberNotification {
  readonly pushType: typeof APNS_PUSH_TYPE.ALERT | typeof APNS_PUSH_TYPE.BACKGROUND;
  readonly payload: ApnsPayload;
  readonly collapseId?: string;
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
  /** The task the thread stands on; absent for an agent with no task. */
  readonly taskId?: string;
  /** The thread's revision, which a nod or a close names. */
  readonly revision: number;
}

/** An agent's post as a push reads it: the item as the post wrote it, whether it asked, and the task its agent works on. */
export interface ThreadPushPost {
  readonly item: InboxItem;
  readonly asked: boolean;
  readonly taskId: string | null;
}

/** Words clipped to a bound, with an ellipsis where they were cut. */
function clipped(words: string, bound: number): string {
  return words.length <= bound ? words : `${words.slice(0, bound - 1).trimEnd()}…`;
}

/** The first line of the words that says anything, trimmed, each mention said by its label. */
function firstLine(text: string): string {
  let plain = text;
  for (const link of [...mentionLinksIn(text)].reverse()) {
    plain = `${plain.slice(0, link.start)}${link.label}${plain.slice(link.end)}`;
  }
  const line = plain.split("\n").find((each) => each.trim() !== "") ?? "";
  return clipped(line.trim(), ALERT_BOUND.BODY_CHARS);
}

/** The alert's title and body; a body that would say nothing is left out. */
function alertOf(title: string, body: string) {
  return {
    title: clipped(title.trim(), ALERT_BOUND.TITLE_CHARS),
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

/** Sends the notification `compose` writes for the member's badge to each phone named; nothing for none, and the badge is counted only once one stands. */
function sendToDevices(
  userId: string,
  devices: readonly PushDevice[],
  compose: (badge: number) => MemberNotification,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const sender = yield* Effect.serviceOption(ApnsSender);
    if (Option.isNone(sender) || devices.length === 0) return;
    const notification = compose(yield* inboxWaitingCount(userId, yield* Clock.currentTimeMillis));
    yield* Effect.forEach(
      devices,
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
    : holdFailedTurnPush(userId, subject.agentId, subject.turnId);
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

/** The alert about a post on a thread: its title over the post's first line, with the ask's actions where it asked; none where the post wrote no message of the agent's. */
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
  return (badge) => ({
    pushType: APNS_PUSH_TYPE.ALERT,
    collapseId: item.id,
    payload: {
      aps: {
        alert: alertOf(item.title, firstLine(message.text)),
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
  });
}

/** The alert about the agent's failed turn, the failure word it was settled with: its name over the words the desktop says. */
function failedTurnNotification(agent: Agent, turnId: string, failure: string | null) {
  return (badge: number): MemberNotification => ({
    pushType: APNS_PUSH_TYPE.ALERT,
    collapseId: agent.id,
    payload: {
      aps: {
        // A run its plan's usage limit stopped is told so, not that it failed.
        alert: alertOf(
          agentName(agent),
          failure === TURN_FAILURE.PLAN_LIMIT ? LIMIT_REACHED_WORDS : RUN_FAILED_BODY,
        ),
        "thread-id": agent.taskId ?? agent.id,
        category: PUSH_CATEGORY.RUN_FAILED,
        "mutable-content": 1,
        sound: "default",
        badge,
      },
      kind: PUSH_KIND.RUN_FAILED,
      agentId: agent.id,
      ...(agent.taskId === null ? undefined : { taskId: agent.taskId }),
      turnId,
    },
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
  return pushToMember(recipient, compose, { itemId: post.item.id });
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
  });
}

/**
 * Pushes the member who started the agent that its turn failed, saying the
 * agent's name; nothing for a turn that finished well or that a Stop ended,
 * which is the member's own, or for an agent that is gone. A later failure
 * of the same agent replaces the one before it on the lock screen.
 */
export function pushFailedTurn(
  turn: SettledAgentTurn,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  if (turn.status !== TURN_STATUS.FAILED) return Effect.void;
  return Effect.gen(function* () {
    const found = yield* readAgentOfConversation(turn.userId, turn.conversationId);
    if (Option.isNone(found)) return;
    const agent = found.value;
    yield* pushToMember(agent.userId, failedTurnNotification(agent, turn.turnId, turn.failure), {
      agentId: agent.id,
      turnId: turn.turnId,
    });
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
    const asks = openAskOf(item.thread ?? []) !== undefined && !inboxAgentsTurn(item);
    const waiting =
      item.status === INBOX_STATUS.OPEN &&
      item.waitsOn?.userId === userId &&
      (asks || item.unread === true);
    if (!waiting) return Option.none<ThreadPushPost>();
    const home = yield* readInboxItemHome(userId, itemId);
    const taskId = Option.match(home, { onNone: () => null, onSome: (each) => each.planId });
    return Option.some({ item, asked: asks, taskId });
  });
}

/** The agent a held failed turn's alert tells of, read again, with the failure word its turn was settled with: none where a later turn followed it or the agent is gone. */
function stillFailedAgent(userId: string, agentId: string, turnId: string) {
  return Effect.gen(function* () {
    const agent = yield* readAgent(userId, agentId);
    if (Option.isNone(agent)) return Option.none<{ agent: Agent; failure: string | null }>();
    const latest = (yield* latestTurnsOf(userId, [agent.value.conversationId])).get(
      agent.value.conversationId,
    );
    return latest?.id === turnId && latest.status === TURN_STATUS.FAILED
      ? Option.some({ agent: agent.value, failure: latest.failure })
      : Option.none<{ agent: Agent; failure: string | null }>();
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
    const failed = yield* stillFailedAgent(userId, agentId, turnId);
    return Option.map(failed, ({ agent, failure }) =>
      failedTurnNotification(agent, turnId, failure),
    );
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
