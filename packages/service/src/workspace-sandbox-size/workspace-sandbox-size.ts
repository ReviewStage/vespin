/**
 * workspace-sandbox-size.ts -- a workspace's cloud sandbox size, as every door reads and chooses it: read it as a member, and choose it as an owner or admin.
 *
 * The hosted procedures (`workspace-sandbox-size-procedures.ts`) go through
 * these, so one rule holds for each: a workspace the account is not a
 * member of is not found, and a choice by a member who is no owner or admin
 * is not permitted. Every answer is the size as it then stands. A choice
 * reaches an agent's sandbox at its next open after it stops
 * (`@repo/sandbox`'s `getOrCreate`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  readWorkspaceSandboxVcpus,
  setWorkspaceSandboxVcpus,
} from "@repo/database/models/workspace-sandbox-size-store";
import type { SandboxVcpus } from "@repo/features/sandbox-size";
import type { WorkspaceSandboxSizeAnswer } from "@repo/features/workspace-sandbox-size-wire";
import { DateTime, Effect } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../http/http-effect.js";

/** The sandbox size of a workspace the account is a member of. */
export const readSandboxSize = Effect.fn("web/readSandboxSize")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<WorkspaceSandboxSizeAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* answeredWorkspace(userId, workspaceId);

  return { vcpus: yield* hostedStoreOrUnavailable(readWorkspaceSandboxVcpus(workspace.id)) };
});

/** The sandbox size of a workspace the account manages chosen; the size as it then stands. */
export const chooseSandboxSize = Effect.fn("web/chooseSandboxSize")(function* (
  userId: string,
  workspaceId: string,
  vcpus: SandboxVcpus,
): Effect.fn.Return<WorkspaceSandboxSizeAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(setWorkspaceSandboxVcpus(workspace.id, vcpus, now));

  return { vcpus };
});
