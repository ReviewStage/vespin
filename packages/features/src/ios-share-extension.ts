/**
 * ios-share-extension.ts -- the iOS share extension's own half of a share: what was shared laid into the page's field, each place's write sent to the service under the access token the extension reads at send time, and the notification of a task the share started.
 *
 * The extension runs with no host, so it cannot send through the app's
 * acts. It sends the same writes the app's share page sends
 * (`ios-share-send.ts`), each through the hosted client that act calls
 * (`HostedAgentClient`, `HostedTaskClient`), named as the app is on every
 * call to the service's origin (`clientNamedOnService`). The token is handed
 * in once per send and goes nowhere but each call's header: a send with no
 * token, one past its expiry as the extension reads it, sends nothing, and
 * every place stays not gone, so the page keeps the share as a draft for
 * the app. What a send answers carries no token, so nothing it hands back
 * can carry one into a draft, a log, or a notification.
 *
 * What was shared lands in the field as the app's share page lays it in:
 * the words shared, then the web link as its pill (a mention-shaped link,
 * which the field draws as a chip), then each picture's marker, "Picture 1"
 * and on, as the app names a picture.
 *
 * A share that made a task posts a notification naming the task, and its
 * agent where one started (`PUSH_KIND.SHARE_STARTED`), which the app's tap
 * handler opens; it carries ids alone, never the task's words, so a locked
 * phone shows nothing of the share.
 */

import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { fixedBearer } from "./account-call.js";
import { HostedAgentClient } from "./agent-client.js";
import { type ClientIdentity, clientNamedOnService } from "./client-identity.js";
import { fileMarker, pictureName } from "./file-marker.js";
import { PUSH_KIND } from "./inbox-push-wire.js";
import { SHARE_SEND_KIND, type ShareSend, type ShareSendTo } from "./ios-share-send.js";
import { mentionMarkdownLink } from "./link-grammar.js";
import { PRODUCT_NAME } from "./product-name.js";
import { HostedTaskClient, type TaskStarted } from "./task-client.js";

/** What another app shared, as the extension read it: its words, its web links, the page's title, and its pictures' files. */
export interface SharedRead {
  readonly texts: readonly string[];
  readonly links: readonly string[];
  /** The shared page's title, where the sharing app named one, which the link's pill wears. */
  readonly title: string | undefined;
  /** Each picture's JPEG, written by the extension within the service's bounds, by its file's path. */
  readonly pictures: readonly string[];
}

/** A picture the field holds: the name its marker and its attachment go by, and its file. */
export interface SharedPicture {
  readonly name: string;
  readonly file: string;
}

/** What the field opens on: its words, with the link's pill and the pictures' markers, and the pictures they name. */
export interface SharedField {
  readonly words: string;
  readonly pictures: readonly SharedPicture[];
}

/** `values` trimmed, each kept once, none empty. */
function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()))].filter((value) => value !== "");
}

/** The words a link's pill wears: the page's title, else its host. */
function linkLabel(link: string, title: string | undefined): string {
  const named = title?.trim() ?? "";

  if (named !== "") return named;

  return URL.canParse(link) ? new URL(link).host : link;
}

/**
 * The field's words and pictures for what was shared: the words, then the
 * link as its pill where the words don't already hold it, then each
 * picture's marker in order.
 */
export function sharedField(shared: SharedRead): SharedField {
  const texts = distinct(shared.texts);
  const link = distinct(shared.links).find((each) => !texts.some((text) => text.includes(each)));

  const pictures = shared.pictures.map((file, index) => ({ name: pictureName(index + 1), file }));

  const words = [
    ...texts,
    ...(link === undefined ? [] : [mentionMarkdownLink(linkLabel(link, shared.title), link)]),
    ...(pictures.length === 0 ? [] : [pictures.map(({ name }) => fileMarker(name)).join(" ")]),
  ].join("\n\n");

  return { words: words === "" ? "" : `${words} `, pictures };
}

/** Where the extension's calls go and who they say they come from. */
export interface ShareService {
  readonly origin: string;
  readonly client: ClientIdentity;
}

/** What a share sent from the extension came to: the places whose write did not go, by their ids, and the task New task made, where it made one. */
export interface ShareSent {
  readonly failed: readonly string[];
  readonly started: TaskStarted | undefined;
}

/** What one place's write came to. */
interface PlaceSent {
  readonly to: string;
  readonly went: boolean;
  readonly started?: TaskStarted;
}

/** One place's write, through the client its act calls; whether the service took it, and the task New task made. */
function placeSent(
  { to, send }: ShareSendTo,
  agents: HostedAgentClient,
  tasks: HostedTaskClient,
): Effect.Effect<PlaceSent, never, HttpClient.HttpClient> {
  switch (send.kind) {
    case SHARE_SEND_KIND.MANAGER_CHAT: {
      const { agentId, ...request } = send.params;

      return Effect.map(agents.chatSend(agentId, request), (answer) => ({
        to,
        went: !("failure" in answer),
      }));
    }

    case SHARE_SEND_KIND.AGENT_MESSAGE: {
      const { agentId, pictures: _pictures, steers: _steers, ...request } = send.params;

      return Effect.map(agents.message(agentId, request), (answer) => ({
        to,
        went: !("failure" in answer),
      }));
    }

    case SHARE_SEND_KIND.THREAD_REPLY: {
      const { itemId, ...request } = send.params;

      return Effect.map(agents.messageInbox(itemId, request), (answer) => ({
        to,
        went: !("failure" in answer),
      }));
    }

    case SHARE_SEND_KIND.TASK_AGENT: {
      const { taskId, ...request } = send.params;

      if (taskId === undefined) return Effect.succeed({ to, went: false });

      return Effect.map(agents.start(taskId, request), (answer) => ({
        to,
        went: !("failure" in answer),
      }));
    }

    case SHARE_SEND_KIND.NEW_TASK:
      return Effect.map(newTaskSent(send, tasks), (started) => ({
        to,
        // Note that New task's words go only to its agent, so a task made whose agent was refused did not take the share.
        went:
          started !== undefined && (started.agent === undefined || !("failure" in started.agent)),
        ...(started === undefined ? undefined : { started }),
      }));
  }
}

/** New task's start as New task sends it; the task it made, or none where it made none. */
function newTaskSent(
  send: Extract<ShareSend, { readonly kind: typeof SHARE_SEND_KIND.NEW_TASK }>,
  tasks: HostedTaskClient,
): Effect.Effect<TaskStarted | undefined, never, HttpClient.HttpClient> {
  const { quiet: _quiet, ...request } = send.params;

  return Effect.map(tasks.create(request), (result) => (result.ok ? result.answer : undefined));
}

/**
 * Sends each place's write at once under `token`, named as `service.client`
 * on the service's origin, and answers the places whose write did not go,
 * a refusal or no answer alike, with the task New task made. With no token,
 * nothing travels and every place is not gone.
 */
export function sendShare(
  sends: readonly ShareSendTo[],
  token: string | undefined,
  service: ShareService,
): Effect.Effect<ShareSent, never, HttpClient.HttpClient> {
  if (token === undefined) {
    return Effect.succeed({ failed: sends.map(({ to }) => to), started: undefined });
  }

  const target = { serviceBaseUrl: service.origin, credential: fixedBearer(token) };
  const agents = new HostedAgentClient(target);
  const tasks = new HostedTaskClient(target);

  return Effect.gen(function* () {
    const http = clientNamedOnService(yield* HttpClient.HttpClient, service.client, service.origin);

    const sent = yield* Effect.forEach(sends, (each) => placeSent(each, agents, tasks), {
      concurrency: "unbounded",
    }).pipe(Effect.provideService(HttpClient.HttpClient, http));

    return {
      failed: sent.filter(({ went }) => !went).map(({ to }) => to),
      started: sent.find((each) => each.started !== undefined)?.started,
    };
  });
}

/** What the share sheet's page says over its field where a share could not go from the sheet itself. */
export const SHARE_EXTENSION_WORDS = {
  SIGNED_OUT: `Open ${PRODUCT_NAME} and sign in to share from here.`,
  LEFT_OUT: "Some pictures couldn't be attached.",
  NOT_KEPT: `It didn't go, and it couldn't be saved for ${PRODUCT_NAME}. Try again.`,
  /** A share kept for the app, which opens the page on it again with the places it didn't reach ticked. */
  kept: (count: number) =>
    count === 1
      ? `It didn't go to one place. Open ${PRODUCT_NAME} to send it from there.`
      : `It didn't go to ${count} places. Open ${PRODUCT_NAME} to send it from there.`,
} as const;

/** The notification's words, which name nothing of the task. */
export const SHARE_NOTICE_WORDS = {
  TITLE: "Task started",
  AGENT: `Tap to open its agent in ${PRODUCT_NAME}.`,
  TASK: `Its agent didn't start. Tap to open the task in ${PRODUCT_NAME}.`,
} as const;

/** The local notification of a task a share made: its id, which a second one for the task replaces, its words, and the payload the app's tap handler routes. */
export interface ShareStartedNotice {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly payload: {
    readonly kind: typeof PUSH_KIND.SHARE_STARTED;
    readonly taskId: string;
    readonly agentId?: string;
  };
}

/** The notification of the task `started` names, opening its agent where one started, else the task. */
export function shareStartedNotice(started: TaskStarted): ShareStartedNotice {
  const taskId = started.task.id;

  const agent =
    started.agent !== undefined && "agent" in started.agent ? started.agent.agent : undefined;

  return {
    id: taskId,
    title: SHARE_NOTICE_WORDS.TITLE,
    body: agent === undefined ? SHARE_NOTICE_WORDS.TASK : SHARE_NOTICE_WORDS.AGENT,
    payload: {
      kind: PUSH_KIND.SHARE_STARTED,
      taskId,
      ...(agent === undefined ? undefined : { agentId: agent.id }),
    },
  };
}
