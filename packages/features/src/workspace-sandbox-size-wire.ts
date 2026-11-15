/**
 * workspace-sandbox-size-wire.ts -- a workspace's cloud sandbox size on the wire: read it as a member, and choose it as an owner or admin, at most what Vespin's admins let the workspace have.
 *
 * The size is the vCPUs every agent's sandbox in the workspace opens with,
 * each with its memory (`sandbox-size.ts`). A choice is one of the sizes a
 * workspace may choose and no more than its most, which only Vespin's admins
 * raise (`admin-wire.ts`'s `WORKSPACE_SANDBOX`); one above it is not
 * permitted. An answer reads its sizes as numbers, so a size a newer service
 * offers never fails an older client's read.
 */

import { Schema as EffectSchema } from "effect";
import { SANDBOX_VCPU_SIZES } from "./sandbox-size.js";
import { countedNumber } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

export const WORKSPACE_SANDBOX_SIZE_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

/** A size a workspace may choose, as a request names it. */
export const sandboxVcpusSchema = EffectSchema.Literals(SANDBOX_VCPU_SIZES);

/** A workspace's sandbox size as its members read it. */
export const workspaceSandboxSizeAnswerSchema = EffectSchema.Struct({
  /** The vCPUs its agents' sandboxes open with: what its owners and admins chose, held under `maxVcpus`. */
  vcpus: countedNumber,
  /** The most vCPUs the workspace may choose. */
  maxVcpus: countedNumber,
});

export type WorkspaceSandboxSizeAnswer = typeof workspaceSandboxSizeAnswerSchema.Type;

/** Choosing the workspace's sandbox size (PUT), at most its `maxVcpus`. */
export const workspaceSandboxSizePutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  vcpus: sandboxVcpusSchema,
});
