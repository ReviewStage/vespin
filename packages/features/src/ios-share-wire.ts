/**
 * ios-share-wire.ts -- what the iOS app and its share extension hand each other through their App Group: the workspaces and repositories the share sheet offers, and the draft it keeps for New task.
 *
 * The share extension runs apart from the app, with no host and no
 * account's reads, so the app writes it a snapshot of what New task would
 * offer: the workspace the phone works in, each of the account's
 * workspaces, and the repositories each reaches, the one a task starts in
 * first, and where its Start is sent with the headers the app names itself
 * in. The extension draws its sheet from it and starts the task there under
 * the access token the app keeps for it, or, where it can't, keeps what the
 * member wrote as a draft, which the app opens New task on the next time it
 * comes forward. The keys are the Swift's, exactly (`apps/mobile/share-extension/`),
 * which reads the snapshot loosely and writes the draft, so a key renamed
 * here is a sheet that offers nothing or a draft the app drops. An instant
 * travels as epoch milliseconds in a JSON number. A draft's pictures are
 * JPEGs the extension writes beside it, under the fixed names
 * `SHARE_DRAFT_PICTURE_FILES` lists, which the draft names back; a name
 * outside that list is refused, so a draft can never point the app at
 * another file. The snapshot also holds where a share may go in the
 * workspace the phone works in (`ShareDestinations`, built by
 * `ios-share-destinations.ts`): its Managers, open Inbox threads, recent
 * tasks and recent agents, each as a row names it, never what a row reads
 * live, such as whether an agent works, since the snapshot stands until the
 * app writes it again.
 */

import { Schema as EffectSchema, Option } from "effect";
import { type ClientIdentity, clientHeaders } from "./client-identity.js";
import { managerFaceSchema } from "./manager-face.js";
import { MODEL_PROVIDER } from "./models-wire.js";
import { TASK_STATUS, type TaskSummary } from "./task-wire.js";
import { newestRepositories, workspaceReaches } from "./tasks-model.js";
import type { Workspace } from "./workspace-wire.js";

/** One workspace the sheet offers, and the repositories a task in it may start in, the one it starts in first. */
interface ShareWorkspace {
  readonly id: string;
  readonly name: string;
  readonly repositories: readonly string[];
}

/** Where the share sheet sends its Start, and the headers the app names itself in there, which the extension sends beside the account's token. */
interface ShareService {
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** What a share may be sent to: a Manager's chat, an agent, an Inbox thread's agent, or a task, on which it starts a new agent. */
export const SHARE_DESTINATION_KIND = {
  MANAGER: "manager",
  AGENT: "agent",
  THREAD: "thread",
  TASK: "task",
} as const;

export type ShareDestinationKind =
  (typeof SHARE_DESTINATION_KIND)[keyof typeof SHARE_DESTINATION_KIND];

/** The most of each kind the snapshot holds for a workspace, newest moved first, so the extension reads a bounded file. */
export const SHARE_DESTINATION_BOUNDS = {
  MANAGERS: 10,
  THREADS: 15,
  TASKS: 15,
  AGENTS: 10,
  /** The most characters a row's name or title keeps. */
  MAX_NAME_CHARS: 120,
} as const;

const destinationName = EffectSchema.String.check(
  EffectSchema.isMaxLength(SHARE_DESTINATION_BOUNDS.MAX_NAME_CHARS),
);

const taskStatus = EffectSchema.Literals(Object.values(TASK_STATUS));

/**
 * One place a share may go, as its row names it, with when it last moved
 * (`at`, epoch milliseconds), which orders the sheet's Recent: a Manager by
 * its name and face; an agent by its name, the task it works on, and its
 * model's harness; an Inbox thread by its title, the agent a reply goes to,
 * and what holds it; a task by its name and status.
 */
const shareDestinationSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(SHARE_DESTINATION_KIND.MANAGER),
    id: EffectSchema.String,
    name: destinationName,
    face: EffectSchema.optionalKey(managerFaceSchema),
    at: EffectSchema.Number,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(SHARE_DESTINATION_KIND.AGENT),
    id: EffectSchema.String,
    name: destinationName,
    task: destinationName,
    harness: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(MODEL_PROVIDER))),
    at: EffectSchema.Number,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(SHARE_DESTINATION_KIND.THREAD),
    id: EffectSchema.String,
    title: destinationName,
    agentId: EffectSchema.String,
    /** What holds it: its task, by its name and status, or the agent on no task that posted it, by its name and a Manager's face. */
    holder: destinationName,
    holderStatus: EffectSchema.optionalKey(taskStatus),
    holderFace: EffectSchema.optionalKey(managerFaceSchema),
    at: EffectSchema.Number,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(SHARE_DESTINATION_KIND.TASK),
    id: EffectSchema.String,
    name: destinationName,
    status: taskStatus,
    at: EffectSchema.Number,
  }),
]);

export type ShareDestination = typeof shareDestinationSchema.Type;

/** Where a share may go in one workspace, the one the phone works in. */
export interface ShareDestinations {
  readonly workspaceId: string;
  readonly rows: readonly ShareDestination[];
}

/** The snapshot the app writes for the share sheet. */
interface ShareSnapshot {
  /** The account it was read for, which a draft names back. */
  readonly accountId: string;
  /** The workspace the phone works in, which the sheet offers first. */
  readonly chosenWorkspaceId: string | undefined;
  readonly workspaces: readonly ShareWorkspace[];
  readonly service: ShareService;
  /** Where a share may go in the workspace the phone works in; none until its lists are read. */
  readonly destinations?: ShareDestinations | undefined;
}

/** The files a draft's pictures are kept in, beside it at the group's root, one per picture the share sheet takes, in order. */
export const SHARE_DRAFT_PICTURE_FILES = [
  "share-draft-picture-1.jpg",
  "share-draft-picture-2.jpg",
  "share-draft-picture-3.jpg",
  "share-draft-picture-4.jpg",
] as const;

export type ShareDraftPictureFile = (typeof SHARE_DRAFT_PICTURE_FILES)[number];

/** The most places a draft names, past which it is refused rather than read. */
const SHARE_DRAFT_MAX_DESTINATIONS = 50;

/** What the share sheet kept for the app: the words, the pictures' files, the workspace and repository picked, and the places ticked, for the account it was kept under. */
const shareDraftSchema = EffectSchema.Struct({
  accountId: EffectSchema.String,
  prompt: EffectSchema.String,
  pictures: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.Literals(SHARE_DRAFT_PICTURE_FILES)),
  ),
  workspaceId: EffectSchema.optionalKey(EffectSchema.String),
  repository: EffectSchema.optionalKey(EffectSchema.String),
  /** The places ticked on the share page, by their ids (`SHARE_NEW_TASK_ID` for New task), which the app opens the page on again; none for a draft the Swift sheet kept for New task. */
  destinations: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.String).check(
      EffectSchema.isMaxLength(SHARE_DRAFT_MAX_DESTINATIONS),
    ),
  ),
  keptAt: EffectSchema.Number,
});

type ShareDraft = typeof shareDraftSchema.Type;

const decodeDraft = EffectSchema.decodeUnknownOption(EffectSchema.fromJsonString(shareDraftSchema));

/** The draft the share sheet kept, from its file's text, or none where it does not read or was kept under another account than `accountId`. */
export function shareDraftOf(json: string, accountId: string): ShareDraft | undefined {
  const read = decodeDraft(json);

  return Option.isSome(read) && read.value.accountId === accountId ? read.value : undefined;
}

/**
 * The repositories a task in `workspace` may start in, as New task offers
 * them (`useRepositoryPick`): the newest the account's tasks were about that
 * the workspace reaches, then the rest the workspace lists, each once. Where
 * the workspace's list was read, a recent repository it no longer lists is
 * left out; where it was not, the recent ones it reaches stand alone.
 */
function workspaceRepositories(
  workspace: Workspace,
  recent: readonly string[],
  listed: readonly string[] | undefined,
): readonly string[] {
  const reached = recent.filter(
    (repository) =>
      workspaceReaches(workspace, repository) &&
      (listed === undefined || listed.includes(repository)),
  );

  return [...new Set([...reached, ...(listed ?? [])])];
}

/**
 * The snapshot the share sheet is drawn from: each of the account's
 * workspaces with the repositories it reaches, read from the account's
 * tasks and from each workspace's list the app has read (`listedOf`), and
 * the workspace the phone works in, and where the sheet's Start is sent,
 * named as `client`, with where a share may go in the workspace the phone
 * works in, where its lists were read.
 */
export function shareSnapshotOf(
  accountId: string,
  chosenWorkspaceId: string | undefined,
  workspaces: readonly Workspace[],
  tasks: readonly Pick<TaskSummary, "id" | "repository" | "createdAt">[],
  listedOf: (workspaceId: string) => readonly string[] | undefined,
  service: { readonly origin: string; readonly client: ClientIdentity },
  destinations?: ShareDestinations,
): ShareSnapshot {
  const recent = newestRepositories(tasks);

  return {
    accountId,
    chosenWorkspaceId,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      repositories: workspaceRepositories(workspace, recent, listedOf(workspace.id)),
    })),
    service: { origin: service.origin, headers: clientHeaders(service.client) },
    ...(destinations === undefined ? undefined : { destinations }),
  };
}
