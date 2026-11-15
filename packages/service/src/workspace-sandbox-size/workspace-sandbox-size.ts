/**
 * workspace-sandbox-size.ts -- a workspace's cloud sandbox size, as every door reads and chooses it: read it as a member, and choose it as an owner or admin.
 *
 * The hosted procedures (`workspace-sandbox-size-procedures.ts`) go through
 * these, so one rule holds for each: a workspace the account is not a
 * member of is not found, and a choice by a member who is no owner or admin
 * is not permitted. Every answer is the size as it then stands. A choice
 * reaches an agent's sandbox at its next open
 * after it stops (`@repo/sandbox`'s `getOrCreate`), so a choice that changes
 * the size stops each of its agents' sandboxes nothing keeps up at once
 * (`sandboxesMovedTo`), and leaves the rest to stop when they idle.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { runningAgentSandboxesOf } from "@repo/database/models/agent-sandboxes";
import {
  readWorkspaceSandboxVcpus,
  setWorkspaceSandboxVcpus,
} from "@repo/database/models/workspace-sandbox-size-store";
import { type SandboxVcpus, sandboxMemoryGb } from "@repo/features/sandbox-size";
import type { WorkspaceSandboxSizeAnswer } from "@repo/features/workspace-sandbox-size-wire";
import { SANDBOX_IDLE } from "@repo/sandbox";
import { Clock, DateTime, Duration, Effect } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import { sandboxStoppedForSize } from "../agents/coder-host/runner-sessions.js";
import { afterResponse } from "../http/after-response.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../http/http-effect.js";

/** How many of a workspace's sandboxes are stopped for a new size at once. */
const MOVE_CONCURRENCY = 4;

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

/**
 * A change of the workspace's size from `from` to `to` vCPUs carried to its
 * agents' sandboxes once the answer has left: each that may still be running
 * (`runningAgentSandboxesOf`, used inside `SANDBOX_IDLE`) stopped where
 * nothing keeps it up (`sandboxStoppedForSize`), so its next message resumes
 * it at the new size and tells its agent so; nothing where the size stands.
 * A stop that fails is said in the log and keeps no other from stopping;
 * that sandbox moves when it next idles out.
 */
export const sandboxesMovedTo = (workspaceId: string, from: number, to: number) =>
  from === to
    ? Effect.void
    : afterResponse(
        "a workspace's sandboxes moved to its new size",
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const usedSince = new Date(now - Duration.toMillis(SANDBOX_IDLE));
          const running = yield* runningAgentSandboxesOf(workspaceId, usedSince);
          const size = { memoryGb: sandboxMemoryGb(to), fromGb: sandboxMemoryGb(from) };

          yield* Effect.forEach(
            running,
            (sandbox) =>
              sandboxStoppedForSize(sandbox, size).pipe(
                Effect.catch((failure) =>
                  Effect.logWarning(
                    `a sandbox was not stopped for its workspace's new size: ${failure._tag}`,
                  ),
                ),
              ),
            { concurrency: MOVE_CONCURRENCY, discard: true },
          );
        }),
      );
