/**
 * workspace-sandbox-size.ts -- a workspace's cloud sandbox size, as every door reads and chooses it: read it as a member, and choose it as an owner or admin, at most the most our admins let the workspace have.
 *
 * The hosted procedures (`workspace-sandbox-size-procedures.ts`) go through
 * these, so one rule holds for each: a workspace the account is not a
 * member of is not found, and a choice by a member who is no owner or admin,
 * or above the workspace's most, is not permitted. Every answer is the size
 * as it then stands. A choice reaches an agent's sandbox at its next open
 * after it stops (`@repo/sandbox`'s `getOrCreate`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  readWorkspaceSandboxSize,
  setWorkspaceSandboxVcpus,
} from "@repo/database/models/workspace-sandbox-size-store";
import {
  type SandboxVcpus,
  sandboxVcpus,
  type WorkspaceSandboxSize,
} from "@repo/features/sandbox-size";
import type { WorkspaceSandboxSizeAnswer } from "@repo/features/workspace-sandbox-size-wire";
import { DateTime, Effect, Option } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";

/** The size as its members read it: the vCPUs its agents' sandboxes open with, and the most it may choose. */
export function sizeAnswer(size: WorkspaceSandboxSize): WorkspaceSandboxSizeAnswer {
  return { vcpus: sandboxVcpus(size), maxVcpus: size.maxVcpus };
}

/** The sandbox size of a workspace the account is a member of. */
export const readSandboxSize = Effect.fn("web/readSandboxSize")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<WorkspaceSandboxSizeAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* answeredWorkspace(userId, workspaceId);

  return sizeAnswer(yield* hostedStoreOrUnavailable(readWorkspaceSandboxSize(workspace.id)));
});

/** The sandbox size of a workspace the account manages chosen, refused above the most the workspace may have; the size as it then stands. */
export const chooseSandboxSize = Effect.fn("web/chooseSandboxSize")(function* (
  userId: string,
  workspaceId: string,
  vcpus: SandboxVcpus,
): Effect.fn.Return<WorkspaceSandboxSizeAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const standing = yield* hostedStoreOrUnavailable(readWorkspaceSandboxSize(workspace.id));

  if (vcpus > standing.maxVcpus) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const now = yield* DateTime.nowAsDate;

  const chosen = yield* hostedStoreOrUnavailable(
    setWorkspaceSandboxVcpus(workspace.id, vcpus, now),
  );

  // Note that a workspace gone since its membership was read is not found, as a read of it would be.
  if (Option.isNone(chosen)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return sizeAnswer(chosen.value);
});
