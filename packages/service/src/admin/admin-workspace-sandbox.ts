/**
 * admin-workspace-sandbox.ts -- the one thing an admin writes about a workspace: the most vCPUs its agents' sandboxes may be given, which its owners and admins choose under.
 *
 * Raising the most lets the workspace choose more, and changes nothing until
 * it does; lowering it holds a larger choice under it at each agent's next
 * open, without rewriting what the workspace chose, so raising it again
 * brings that choice back (`@repo/features/sandbox-size`'s `sandboxVcpus`).
 * The answer is the size as it then stands, as the workspace's members read
 * it.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { adminWorkspaceId } from "@repo/features/admin-wire";
import type { SandboxVcpus, WorkspaceSandboxSize } from "@repo/features/sandbox-size";
import type { WorkspaceSandboxSizeAnswer } from "@repo/features/workspace-sandbox-size-wire";
import { Effect } from "effect";
import { sizeAnswer } from "../workspace-sandbox-size/workspace-sandbox-size.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

export interface AdminWorkspaceSandboxOptions {
  query: { readonly id?: string };
  /** The most vCPUs the workspace may choose, one of the sizes the body's schema takes. */
  maxVcpus: SandboxVcpus;
  /** Sets the most the named workspace may choose; its size as it then stands, or nothing when no workspace carries that id. */
  writeSandboxCap: (
    workspaceId: string,
    maxVcpus: SandboxVcpus,
  ) => AdminSeamEffect<WorkspaceSandboxSize | undefined>;
}

/**
 * Answers the cap's write behind the gate every admin route stands behind,
 * as the workspace's read answers its id: a request naming no workspace is a
 * 400 before any seam is touched, and an id no workspace carries a 404.
 */
export function handleAdminWorkspaceSandbox(
  options: AdminWorkspaceSandboxOptions,
): Effect.Effect<WorkspaceSandboxSizeAnswer, AdminRefusal, DatabaseServices> {
  const id = adminWorkspaceId(options.query.id);

  if (id === undefined) return Effect.fail(ADMIN_REFUSAL.MISSING_WORKSPACE_ID);

  return options.writeSandboxCap(id, options.maxVcpus).pipe(
    Effect.catchCause((cause) => unavailableSeam("admin workspace sandbox write failed", cause)),
    Effect.flatMap((size) =>
      size === undefined
        ? Effect.fail(ADMIN_REFUSAL.WORKSPACE_NOT_FOUND)
        : Effect.succeed(sizeAnswer(size)),
    ),
  );
}
