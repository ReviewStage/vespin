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
 * travels as epoch milliseconds in a JSON number.
 */

import { Schema as EffectSchema } from "effect";
import { type ClientIdentity, clientHeaders } from "./client-identity.js";
import { recentRepositories, workspaceReaches } from "./tasks-model.js";
import type { TasksView } from "./tasks-view.js";
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

/** The snapshot the app writes for the share sheet. */
interface ShareSnapshot {
  /** The account it was read for, which a draft names back. */
  readonly accountId: string;
  /** The workspace the phone works in, which the sheet offers first. */
  readonly chosenWorkspaceId: string | undefined;
  readonly workspaces: readonly ShareWorkspace[];
  readonly service: ShareService;
}

/** What the share sheet kept for New task: the words, and the workspace and repository picked, for the account it was kept under. */
const shareDraftSchema = EffectSchema.Struct({
  accountId: EffectSchema.String,
  prompt: EffectSchema.String,
  workspaceId: EffectSchema.optionalKey(EffectSchema.String),
  repository: EffectSchema.optionalKey(EffectSchema.String),
  keptAt: EffectSchema.Number,
});

type ShareDraft = typeof shareDraftSchema.Type;

const decodeDraft = EffectSchema.decodeUnknownOption(EffectSchema.fromJsonString(shareDraftSchema));

/** The draft the share sheet kept, from its file's text, or none where it does not read or was kept under another account than `accountId`. */
export function shareDraftOf(json: string, accountId: string): ShareDraft | undefined {
  const read = decodeDraft(json);
  return read._tag === "Some" && read.value.accountId === accountId ? read.value : undefined;
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
 * named as `client`.
 */
export function shareSnapshotOf(
  accountId: string,
  chosenWorkspaceId: string | undefined,
  workspaces: readonly Workspace[],
  tasks: TasksView["tasks"],
  listedOf: (workspaceId: string) => readonly string[] | undefined,
  service: { readonly origin: string; readonly client: ClientIdentity },
): ShareSnapshot {
  const recent = recentRepositories(tasks);
  return {
    accountId,
    chosenWorkspaceId,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      repositories: workspaceRepositories(workspace, recent, listedOf(workspace.id)),
    })),
    service: { origin: service.origin, headers: clientHeaders(service.client) },
  };
}
