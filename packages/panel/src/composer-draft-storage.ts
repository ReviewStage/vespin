// composer-draft-storage.ts -- the composer drafts as renderer storage keeps them, read alike by the panel and by the desktop's storage carry-over.

import { DIFF_SIDE } from "@repo/features/agent-wire";
import { DESCRIPTION_COMMENT_SCOPE } from "@repo/features/description-comment-wire";
import { INBOX_REPLY, inboxFormValueSchema } from "@repo/features/inbox-wire";
import { draftSuggestionSchema } from "@repo/features/suggestion-model";
import { Equal, Option, Schema, SchemaTransformation } from "effect";

/** Where the drafts are kept in the renderer's storage. */
export const COMPOSER_DRAFTS_KEY = "app.composerDrafts";

/** How many drafts are kept at most, the oldest written let go first. */
export const MAX_KEPT = 200;

/** What a draft is written to: a started agent, a plan's agent not yet started, an inbox item, a task not yet started, an automation's helper not yet started, a description's comment, a line comment on a pull request's changed file, a reply on its review thread, or an agent's line written again. */
export const DRAFT_PLACE = {
  AGENT: "agent",
  NEW_AGENT: "newAgent",
  INBOX: "inbox",
  NEW_TASK: "newTask",
  NEW_AUTOMATION: "newAutomation",
  DESCRIPTION_COMMENT: "descriptionComment",
  LINE_COMMENT: "lineComment",
  REVIEW_REPLY: "reviewReply",
  EDIT: "edit",
} as const;

/** A description's comment's kind as storage holds it: today's, or `planComment`, which every draft kept before the description was named so holds, read as today's. */
const descriptionCommentKind = Schema.Literals([
  DRAFT_PLACE.DESCRIPTION_COMMENT,
  "planComment",
]).pipe(
  Schema.decodeTo(
    Schema.Literal(DRAFT_PLACE.DESCRIPTION_COMMENT),
    SchemaTransformation.transform<
      typeof DRAFT_PLACE.DESCRIPTION_COMMENT,
      typeof DRAFT_PLACE.DESCRIPTION_COMMENT | "planComment"
    >({
      decode: () => DRAFT_PLACE.DESCRIPTION_COMMENT,
      encode: (kind) => kind,
    }),
  ),
);

const draftPlaceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.AGENT),
    /** The agent's plan, which the sidebar marks; null for an agent with none. */
    taskId: Schema.NullOr(Schema.String),
    agentId: Schema.String,
    /** The thread of a Manager's chat the box replies in, by the message it stands on, so each thread keeps its words apart from the chat's own box; none for that box. */
    thread: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_AGENT),
    taskId: Schema.String,
    /** The key the draft agent starts under, which a relaunch keeps, so a Start asked again is the same one. */
    draftId: Schema.String,
    /** The agent and message the draft forks, with the message's opening words, which a relaunch keeps beside its words; no message for a continue of the agent's whole transcript. */
    fork: Schema.optionalKey(
      Schema.Struct({
        agentId: Schema.String,
        messageId: Schema.optionalKey(Schema.String),
        opening: Schema.String,
      }),
    ),
    /** The suggestion the draft was opened from, which a relaunch keeps beside its words; none for any other draft. */
    suggestion: Schema.optionalKey(draftSuggestionSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.INBOX),
    /** The item's plan, which the sidebar marks; null for an inbox of an agent with no plan. */
    taskId: Schema.NullOr(Schema.String),
    /** The agent that posted the item, whose own inbox, where it has no plan, is all that reads it. */
    agentId: Schema.String,
    itemId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_TASK),
    /** The workspace the task starts in; null before the workspaces are read. */
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_AUTOMATION),
    /** The workspace the automation's helper starts in; null before the workspaces are read. */
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: descriptionCommentKind,
    /** The plan the comment is on, which the sidebar marks. */
    taskId: Schema.String,
    /**
     * What the words go to: the comment of a thread they edit, the thread
     * they answer, or, for a thread not yet started, the words it is started
     * on and whether on them or their block. Note that an edit is read first,
     * because a reply's place would read one with the comment it names left off.
     */
    on: Schema.Union([
      Schema.Struct({ threadId: Schema.String, entryId: Schema.String }),
      Schema.Struct({ threadId: Schema.String }),
      Schema.Struct({
        quote: Schema.String,
        scope: Schema.Literals(Object.values(DESCRIPTION_COMMENT_SCOPE)),
      }),
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.LINE_COMMENT),
    /** The repository, `owner/name`, of the pull request whose Files changed the comment is written in. */
    repository: Schema.String,
    /** The pull request's number, so two pull requests changing one file keep their words apart. */
    number: Schema.Number,
    /** The changed file the comment is on. */
    path: Schema.String,
    /** The side of the diff the comment's last line counts on, as GitHub anchors a thread. */
    side: Schema.Literals(Object.values(DIFF_SIDE)),
    /** The comment's last line, under which it stands. */
    line: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.REVIEW_REPLY),
    /** GitHub's own id for the thread, which names it across every pull request; a build from before also kept the agent whose pull request it is on, read past. */
    threadId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.EDIT),
    /** The agent whose transcript holds the line. */
    agentId: Schema.String,
    /** The developer's line the words are written again in place of. */
    messageId: Schema.String,
  }),
]);

/** Where one draft goes. */
export type DraftPlace = typeof draftPlaceSchema.Type;

/**
 * New task's words on one of the workspace's own issues, as a build from
 * before the app kept no issues stored them. No card opens on an issue now, so
 * such an entry is read past rather than taken for the workspace's own
 * draft, which it would displace, and goes once its account writes again.
 */
const issueDraftPlaceSchema = Schema.Struct({
  kind: Schema.Literal(DRAFT_PLACE.NEW_TASK),
  workspaceId: Schema.NullOr(Schema.String),
  issueId: Schema.String,
});

/**
 * An inbox card's place as a build from before its picks kept their
 * revision stored it: the revision in the place, and its thread apart from
 * its answer. Note that such an entry is read as today's place with the
 * revision moved onto its draft, so its picks still stand on the ask they
 * were made on, and goes once its account writes again.
 */
const revisedPlaceSchema = Schema.Struct({
  kind: Schema.Literal(DRAFT_PLACE.INBOX),
  taskId: Schema.NullOr(Schema.String),
  agentId: Schema.String,
  itemId: Schema.String,
  revision: Schema.Number,
  thread: Schema.optionalKey(Schema.Literal(true)),
});

/**
 * A line comment's place as a build from before Pull request tabs named
 * their pull request by its repository stored it: by the agent whose tab it
 * was written in. Its pull request cannot be told from the agent, so such an
 * entry is read past rather than refusing every draft beside it, and goes
 * once its account writes again.
 */
const agentLineCommentPlaceSchema = Schema.Struct({
  kind: Schema.Literal(DRAFT_PLACE.LINE_COMMENT),
  agentId: Schema.String,
});

/** The places of boxes since removed, as a build from before stored them: Chat's and its ask's answer, and the Inbox's New thread's. */
const RETIRED_DRAFT_PLACE = {
  CHAT: "chat",
  CHAT_ASK: "chatAsk",
  NEW_THREAD: "newThread",
} as const;

/**
 * A removed box's place, as a build from before it was removed stored it. No
 * box opens on one now, so such an entry is read past rather than refusing
 * every draft beside it, and goes once its account writes again.
 */
const retiredPlaceSchema = Schema.Struct({
  kind: Schema.Literals(Object.values(RETIRED_DRAFT_PLACE)),
});

/** A place as storage may hold it: one of today's, New task's on an issue (`issueDraftPlaceSchema`), one with its revision (`revisedPlaceSchema`), a line comment's by its agent (`agentLineCommentPlaceSchema`), or a removed box's (`retiredPlaceSchema`). */
const storedPlaceSchema = Schema.Union([
  issueDraftPlaceSchema,
  revisedPlaceSchema,
  draftPlaceSchema,
  agentLineCommentPlaceSchema,
  retiredPlaceSchema,
]);

type StoredPlace = typeof storedPlaceSchema.Type;

/** Whether a stored place is a removed box's, which no box opens now. */
function retired(stored: StoredPlace): stored is typeof retiredPlaceSchema.Type {
  return Object.values<string>(RETIRED_DRAFT_PLACE).includes(stored.kind);
}

/** The place a box opens today that a stored place names, with the revision a place from before held for its picks; none for a place no box opens now. */
export function placeOf(
  stored: StoredPlace,
): { readonly place: DraftPlace; readonly revision?: number } | undefined {
  if (retired(stored) || "issueId" in stored) return undefined;

  // A line comment kept by its agent, whose pull request cannot be told now, opens no box.
  if (stored.kind === DRAFT_PLACE.LINE_COMMENT && !("repository" in stored)) return undefined;

  if (!("revision" in stored)) return { place: stored };
  const { kind, taskId, agentId, itemId, revision } = stored;

  return { place: { kind, taskId, agentId, itemId }, revision };
}

/** The element of a page a thread being started there is on, as its draft keeps it. */
const pageElementSchema = Schema.Struct({
  path: Schema.String,
  quote: Schema.String,
  section: Schema.String,
  words: Schema.optionalKey(Schema.Literal(true)),
});

/** The element of a page a thread being started there is on: its path, its words, the heading it stands under, and whether the words are selected in it. */
export type DraftPageElement = typeof pageElementSchema.Type;

/** One place's draft as storage keeps it: its words, a card's picks where it holds some, and the account that wrote it. */
export const storedDraftSchema = Schema.Struct({
  accountId: Schema.NullOr(Schema.String),
  place: storedPlaceSchema,
  text: Schema.String,
  choices: Schema.optionalKey(Schema.Array(Schema.String)),
  values: Schema.optionalKey(Schema.Array(inboxFormValueSchema)),
  steps: Schema.optionalKey(Schema.Array(Schema.Number)),
  press: Schema.optionalKey(Schema.Literals(Object.values(INBOX_REPLY))),
  dropped: Schema.optionalKey(Schema.Array(Schema.String)),
  revision: Schema.optionalKey(Schema.Number),
  element: Schema.optionalKey(pageElementSchema),
  suggestion: Schema.optionalKey(draftSuggestionSchema),
});

/** The drafts as storage keeps them, the latest written last. */
export const storedDrafts = Schema.fromJsonString(Schema.Array(storedDraftSchema));

export type StoredDraft = typeof storedDraftSchema.Type;

/** Keeps drafts for distinct accounts and places, with the current origin's drafts written last. */
export function mergeStoredComposerDrafts(legacy: string, current: string): string {
  const decode = Schema.decodeUnknownOption(storedDrafts);
  const before = decode(legacy);
  const now = decode(current);

  if (Option.isNone(before)) return current;

  if (Option.isNone(now)) return legacy;

  const currentPlaces = now.value.map(({ accountId, place }) => ({
    accountId,
    place: placeOf(place)?.place,
  }));

  const missing = before.value.filter(({ accountId, place }) => {
    const destination = placeOf(place)?.place;

    return (
      destination !== undefined &&
      !currentPlaces.some(
        (entry) => entry.accountId === accountId && Equal.equals(entry.place, destination),
      )
    );
  });

  return missing.length === 0
    ? current
    : Schema.encodeSync(storedDrafts)([...missing, ...now.value].slice(-MAX_KEPT));
}
