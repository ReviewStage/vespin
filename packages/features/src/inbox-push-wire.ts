/**
 * inbox-push-wire.ts -- what the service pushes to a phone beside Apple's `aps`, as the service writes it and the iOS app reads it: what a push tells of, the actions its category offers, and where a tap or an action on it takes the app.
 *
 * The service composes each push (`@repo/service/push/inbox-pushes`); the
 * app reads the same keys back from the notification's payload with
 * `inboxPushOf`, which ignores a key a newer service added, and
 * `inboxPushResponseOf` turns a tap or an action into the screen it opens
 * and what the app sends there. A decide's buttons are named by each
 * option's place in the payload's `options`, 0 first, which the app's
 * Notification Service Extension writes as each action's identifier; a
 * reply typed in place comes back under `INBOX_PUSH_ACTION.REPLY`. The
 * app's share extension posts one notification of its own, a local one
 * naming the task it started (`PUSH_KIND.SHARE_STARTED`), which a tap opens
 * the same way.
 */

import { Schema as EffectSchema, flow, Option } from "effect";
import { iosAgentRoute, iosAppRouteOf } from "./ios-app-links.js";
import { LINK_DESTINATION } from "./link-grammar.js";

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
  /** A task the share sheet started, posted on the phone itself rather than pushed. */
  SHARE_STARTED: "share-started",
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

/** The identifier of the reply typed in place that `PUSH_CATEGORY.REPLY` offers. */
export const INBOX_PUSH_ACTION = {
  REPLY: "reply",
} as const;

/** What a tap or an action on a push has the app send once it opens the thread. */
export const INBOX_PUSH_PRESS = {
  /** A decide's option, pressed as its button. */
  CHOOSE: "choose",
  /** Words typed in place. */
  REPLY: "reply",
} as const;

/** A decide's button identifier: an option's place, written in decimal. */
const OPTION_PLACE = /^(?:0|[1-9]\d{0,2})$/u;

const idSchema = EffectSchema.NonEmptyString;

/** A push about a post on a thread, an ask or any other: the ids the app opens and answers the thread by, and a decide's options. */
const threadPushSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals([PUSH_KIND.ASK, PUSH_KIND.POST]),
  itemId: idSchema,
  /** The agent's message the push is about: the ask an answer names, or the post a reply follows. */
  messageId: idSchema,
  agentId: idSchema,
  /** The task the thread stands on; optional for a released app, and always sent. */
  taskId: EffectSchema.optionalKey(idSchema),
  /** The thread's revision, which a nod or a close names. */
  revision: EffectSchema.Int,
  /** The ask's type, where the post asked; read as words, so a newer type still reads. */
  ask: EffectSchema.optionalKey(EffectSchema.String),
  /** A decide's option labels, in order, which its buttons say. */
  options: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  /** The labels the agent recommends among them. */
  recommended: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
});

/** A push about an agent's failed turn. */
const runFailedPushSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(PUSH_KIND.RUN_FAILED),
  agentId: idSchema,
  taskId: EffectSchema.optionalKey(idSchema),
  turnId: idSchema,
});

/** A background push naming a thread that settled, whose notification the app removes. */
const settledPushSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(PUSH_KIND.SETTLED),
  itemId: idSchema,
});

/** The share sheet's notification of a task it started, and its agent where one started. */
const shareStartedPushSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(PUSH_KIND.SHARE_STARTED),
  taskId: idSchema,
  agentId: EffectSchema.optionalKey(idSchema),
});

/** What a push carries beside `aps`, by its kind. */
const inboxPushSchema = EffectSchema.Union([
  threadPushSchema,
  runFailedPushSchema,
  settledPushSchema,
  shareStartedPushSchema,
]);

export type InboxPush = typeof inboxPushSchema.Type;

/** What the app sends on the thread it opens: an option pressed, or words typed in place. */
export type InboxPushPress =
  | {
      readonly kind: typeof INBOX_PUSH_PRESS.CHOOSE;
      readonly itemId: string;
      /** The ask the option answers, which must still be the thread's open one. */
      readonly messageId: string;
      readonly option: string;
    }
  | {
      readonly kind: typeof INBOX_PUSH_PRESS.REPLY;
      readonly itemId: string;
      readonly text: string;
    };

/** Where a tap or an action on a push takes the app, and what it sends there, if anything. */
export interface InboxPushResponse {
  /** The app's route (`@repo/features/ios-app-links`): the thread, or the failed agent's page. */
  readonly route: string;
  readonly press?: InboxPushPress;
}

/** How a person answered a notification: the action's identifier, and what they typed where it took words. */
export interface InboxPushAction {
  readonly actionId: string;
  readonly text?: string;
}

const decodePush = EffectSchema.decodeUnknownOption(inboxPushSchema);

/** The push a notification's payload carries, or none where it is not one of the service's. */
export const inboxPushOf = flow(decodePush, Option.getOrUndefined);

/** The route a push opens on. */
function routeOf(
  push: Exclude<InboxPush, { readonly kind: typeof PUSH_KIND.SETTLED }>,
): string | undefined {
  if (push.kind === PUSH_KIND.RUN_FAILED) return iosAgentRoute(push.agentId);

  if (push.kind !== PUSH_KIND.SHARE_STARTED)
    return iosAppRouteOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId: push.itemId });

  return push.agentId === undefined
    ? iosAppRouteOf({ kind: LINK_DESTINATION.TASK, planId: push.taskId })
    : iosAgentRoute(push.agentId);
}

/** What an action on a thread's push sends: a decide's option by its place, or words typed in place; nothing for a tap. */
function pressOf(
  push: Extract<InboxPush, { readonly itemId: string; readonly messageId: string }>,
  action: InboxPushAction,
): InboxPushPress | undefined {
  if (action.actionId === INBOX_PUSH_ACTION.REPLY) {
    const text = action.text?.trim() ?? "";

    return text === "" ? undefined : { kind: INBOX_PUSH_PRESS.REPLY, itemId: push.itemId, text };
  }

  if (!OPTION_PLACE.test(action.actionId)) return undefined;
  const option = push.options?.[Number.parseInt(action.actionId, 10)];

  return option === undefined
    ? undefined
    : { kind: INBOX_PUSH_PRESS.CHOOSE, itemId: push.itemId, messageId: push.messageId, option };
}

/**
 * Where a tap or an action on a notification takes the app, and what it
 * sends there: a thread's push opens the thread, with its option or its
 * words where an action pressed one; a failed run opens its agent; a task
 * the share sheet started opens its agent, or the task where none started.
 * None for no push, a payload that is not the service's, or a settled thread's
 * background push, which nobody taps.
 */
export function inboxPushResponseOf(
  push: InboxPush | undefined,
  action: InboxPushAction,
): InboxPushResponse | undefined {
  if (push === undefined || push.kind === PUSH_KIND.SETTLED) return undefined;
  const route = routeOf(push);

  if (route === undefined) return undefined;

  const press =
    push.kind === PUSH_KIND.RUN_FAILED || push.kind === PUSH_KIND.SHARE_STARTED
      ? undefined
      : pressOf(push, action);

  return press === undefined ? { route } : { route, press };
}
