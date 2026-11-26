/**
 * manager-chat-live.ts -- a Manager's chat, one page of it, followed over the service's held poll: who may write a message, the rows its statement delivers, and the page as a reader draws it.
 *
 * A read follows one page of one Manager's chat (`manager_chat_message`),
 * newest first: the newest messages where its query names no `before`, or
 * the newest older than the `seq` it names, so a reader holding the newest
 * page asks the next older one by the oldest `seq` it holds. A page is
 * every message in its span, replies among them, each carrying its
 * thread's root, so the reader groups them. Its statement reads one row
 * more than a page holds, which says an older page stands, and the reader
 * draws a page without it (`managerChatPageOf`). Each row carries its
 * `seq`, since Realtime keeps no order. The service answers `not-found`
 * for an agent the account does not reach, or one that is no Manager.
 *
 * Each message carries its reactions, one per kind given, with how many
 * gave it and whether the reader did, the Manager among the givers. Note
 * that its row carries them as three lists of one length, a kind, its
 * count, and the reader's mark at each place, which the reader zips
 * (`managerChatPageOf`), because the statement builds no JSON: Postgres
 * marks its builders only stable, and a live statement calls immutable
 * functions alone. The lists are optional, so a build from before
 * reactions reads the row as it did, and one after reads none on a row
 * from a service before them.
 */

import { Schema as EffectSchema } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";

/** Who wrote a message of a Manager's chat: a person, or the Manager itself. */
export const MANAGER_CHAT_AUTHOR = {
  PERSON: "person",
  AGENT: "agent",
} as const;

export type ManagerChatAuthor = (typeof MANAGER_CHAT_AUTHOR)[keyof typeof MANAGER_CHAT_AUTHOR];

/** A reaction a member or the Manager gives a message of a Manager's chat, by Slack's name for its emoji: 👍 or 👎. */
export const MANAGER_CHAT_REACTION = {
  THUMBS_UP: "thumbsup",
  THUMBS_DOWN: "thumbsdown",
} as const;

export type ManagerChatReaction =
  (typeof MANAGER_CHAT_REACTION)[keyof typeof MANAGER_CHAT_REACTION];

/** One kind of reaction a message was given: how many gave it, the Manager among them, and whether the reader did. */
export const managerChatReactionCountSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(MANAGER_CHAT_REACTION)),
  count: countedNumber,
  reacted: EffectSchema.Boolean,
});

export type ManagerChatReactionCount = typeof managerChatReactionCountSchema.Type;

/** A member's reaction given a message of a Manager's chat, or taken off it (`POST /api/agents/{id}/chat-messages/{message}/reactions`): its kind, and whether it stands after, so one sent again lands as the first did. */
export const managerChatReactRequestSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(MANAGER_CHAT_REACTION)),
  reacted: EffectSchema.Boolean,
});

export type ManagerChatReactRequest = typeof managerChatReactRequestSchema.Type;

/** A member's reaction taken: whether it changed what stood, which one given twice, or taken off one never given, does not. */
export const managerChatReactAnswerSchema = EffectSchema.Struct({
  changed: EffectSchema.Boolean,
});

export type ManagerChatReactAnswer = typeof managerChatReactAnswerSchema.Type;

/** How many messages one page of a Manager's chat holds. */
export const MANAGER_CHAT_PAGE = 50;

/**
 * A file a message carries, by the reference its line keeps it under, and
 * named as it was sent: a picture by the id it was kept under, a person's
 * under its file's name or one of a set the Manager showed under its
 * caption, with its size where it was kept with one, as a set the Manager
 * showed is, so a reader draws it at its shape before its bytes land; and
 * any other file a person sent (a text file, a PDF, a picture not kept) by
 * its bytes as a `data:` URL, as their line carries it.
 */
export const managerChatAttachmentSchema = EffectSchema.Union([
  EffectSchema.Struct({
    id: EffectSchema.String,
    mediaType: EffectSchema.String,
    name: EffectSchema.optionalKey(EffectSchema.String),
    caption: EffectSchema.optionalKey(EffectSchema.String),
    width: EffectSchema.optionalKey(EffectSchema.Number),
    height: EffectSchema.optionalKey(EffectSchema.Number),
    byteCount: EffectSchema.optionalKey(EffectSchema.Number),
  }),
  EffectSchema.Struct({
    name: EffectSchema.String,
    mediaType: EffectSchema.String,
    url: EffectSchema.String,
  }),
]);

export type ManagerChatAttachment = typeof managerChatAttachmentSchema.Type;

/** One message as its row delivers it: its author, its words and files, the root of the thread it replies in, the turn and line it stands with, its instants in epoch milliseconds, and its reactions as three lists of one length, each kind given in `MANAGER_CHAT_REACTION`'s order. */
const MESSAGES = liveRows({
  row: EffectSchema.Struct({
    id: EffectSchema.String,
    seq: countedNumber,
    authorKind: EffectSchema.Literals(Object.values(MANAGER_CHAT_AUTHOR)),
    authorUserId: EffectSchema.NullOr(EffectSchema.String),
    authorName: EffectSchema.String,
    text: EffectSchema.String,
    attachments: EffectSchema.Array(managerChatAttachmentSchema),
    threadRoot: EffectSchema.NullOr(EffectSchema.String),
    broadcast: EffectSchema.Boolean,
    turnId: EffectSchema.NullOr(EffectSchema.String),
    lineId: EffectSchema.NullOr(EffectSchema.String),
    createdAt: countedNumber,
    editedAt: EffectSchema.NullOr(countedNumber),
    reactionKinds: EffectSchema.optionalKey(
      EffectSchema.Array(EffectSchema.Literals(Object.values(MANAGER_CHAT_REACTION))),
    ),
    reactionCounts: EffectSchema.optionalKey(EffectSchema.Array(countedNumber)),
    reactionsReacted: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.Boolean)),
  }),
  key: "id",
  order: [["seq", ORDER.DESC]],
});

/**
 * One page of a Manager's chat, by the agent its query names under `?id=`
 * and the `seq` the page stands before under `&before=`, the newest where it
 * names none: its messages, one statement. A `before` that spells no whole
 * number reads no messages.
 */
export const MANAGER_CHAT_READ = liveRead({
  name: "managerChat",
  path: HOSTED_SERVICE_PATH.LIVE_MANAGER_CHAT,
  params: {
    id: LIVE_PARAM.ID,
    before: LIVE_PARAM.OPTIONAL_TEXT,
    [LIVE_USER_QUERY]: LIVE_PARAM.USER,
  },
  mode: LIVE_MODE.SNAPSHOT,
  parts: { messages: MESSAGES },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

/** A message's row as the statement delivers it, its reactions in three lists. */
type ManagerChatLiveRow = LiveRowOf<typeof MESSAGES>;

/** One message of a Manager's chat, as a reader draws it: its row, its reactions zipped into one list; none from a service before reactions. */
export type ManagerChatLiveMessage = Omit<
  ManagerChatLiveRow,
  "reactionKinds" | "reactionCounts" | "reactionsReacted"
> & { readonly reactions?: readonly ManagerChatReactionCount[] };

/** One page of a Manager's chat as a reader draws it: its messages, newest first, and the `seq` to ask the next older page before, absent where the page reaches the chat's start. */
export interface ManagerChatPageView {
  readonly messages: readonly ManagerChatLiveMessage[];
  readonly before?: number;
}

/** A message from its row: its reactions zipped from the row's three lists, a kind with no count or mark beside it read as none given and not the reader's. */
function messageOf(row: ManagerChatLiveRow): ManagerChatLiveMessage {
  const { reactionKinds, reactionCounts, reactionsReacted, ...message } = row;

  if (reactionKinds === undefined) return message;

  const reactions = reactionKinds.map((kind, index) => ({
    kind,
    count: reactionCounts?.[index] ?? 0,
    reacted: reactionsReacted?.[index] === true,
  }));

  return { ...message, reactions };
}

/** A page of the chat from its rows: at most a page of them, newest first, and where the next older page stands before, where the statement read past the page. */
export function managerChatPageOf(rows: typeof MANAGER_CHAT_READ.rows.Type): ManagerChatPageView {
  const ordered = orderedLiveRows(MESSAGES, rows.messages);
  const messages = ordered.slice(0, MANAGER_CHAT_PAGE).map(messageOf);
  const oldest = messages.at(-1);

  return ordered.length > MANAGER_CHAT_PAGE && oldest !== undefined
    ? { messages, before: oldest.seq }
    : { messages };
}
