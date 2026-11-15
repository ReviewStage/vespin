/**
 * workspace-sandbox-size-wire.ts -- a workspace's cloud sandbox size on the wire: read it as a member, and choose it as an owner or admin.
 *
 * The size is the vCPUs every agent's sandbox in the workspace opens with,
 * each with its memory (`sandbox-size.ts`); a choice is one of the sizes a
 * workspace may choose. An answer reads its size as a number, so a size a
 * newer service offers never fails an older client's read.
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
  /** The vCPUs its agents' sandboxes open with. */
  vcpus: countedNumber,
});

export type WorkspaceSandboxSizeAnswer = typeof workspaceSandboxSizeAnswerSchema.Type;

/** Choosing the workspace's sandbox size (PUT). */
export const workspaceSandboxSizePutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  vcpus: sandboxVcpusSchema,
});
