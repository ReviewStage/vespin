import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { type Mention, mentionMarkdown } from "@repo/features/mention-link";
import { Effect, Option } from "effect";

/**
 * written-mentions.ts -- the mentions the service writes into what an agent is handed, a message's sender, a starter's report, a task's assignee, each `[@name](target)` under its workspace.
 *
 * A tool answers a thing of ours by its id and name, and the agent writes
 * its mention from them by one rule (`./link-rule.ts`). What the service
 * itself writes into an agent's words, such as the sender a message opens
 * with, is written here, as the desktop writes its own links: the workspace
 * by the slug its member reads it under, or by its id where the member reads
 * it no longer, since a slug is never trusted and the id alone finds the
 * thing.
 */

/** The step a workspace's links are written under: its slug as the member reads it, or its id. */
export const workspaceStepOf = (
  userId: string,
  workspaceId: string,
): Effect.Effect<string, StoreFailure, DatabaseServices> =>
  Effect.map(
    workspaceOf(userId, workspaceId),
    (found) => Option.getOrUndefined(found)?.slug ?? workspaceId,
  );

/**
 * The step a workspace's links are written under, as `workspaceStepOf` reads
 * it, and its name, which its tasks' keys are drawn from (`workspace-key.ts`);
 * no name where the member reads the workspace no longer.
 */
export const workspaceNamingOf = (
  userId: string,
  workspaceId: string,
): Effect.Effect<
  { readonly step: string; readonly name: string },
  StoreFailure,
  DatabaseServices
> =>
  Effect.map(workspaceOf(userId, workspaceId), (found) => {
    const workspace = Option.getOrUndefined(found);

    return { step: workspace?.slug ?? workspaceId, name: workspace?.name ?? "" };
  });

/** The mention as an agent writes it, named and under the workspace's step; a thing of ours names no repository. */
export function writtenMention(mention: Mention, name: string, workspace: string): string {
  return mentionMarkdown(mention, name, { workspace, repository: null });
}
