/**
 * manager-wire.ts -- a Manager as the New Manager dialog makes it: the request `POST /api/managers` takes.
 *
 * A Manager is an agent of kind `manager` on no task, standing in one
 * workspace and working in the repositories it names, the first of them its
 * checkout. Its name is its title from the start, which no generated title
 * replaces. It runs where `runsOn` says, on the model and effort named, and
 * the account that makes it is its owner. It wears the face the request
 * picks, or else one the service picks for it. The answer is a Start's
 * (`agents.start`), so a panel that reads an agent on no task reads it.
 */

import { Schema as EffectSchema } from "effect";
import { AGENT_BOUNDS, agentRunsOnRequestSchema } from "./agent-wire.js";
import { githubRepositoryFullNameSchema } from "./link-grammar.js";
import { managerFacePickSchema } from "./manager-face.js";
import { workspaceIdSchema } from "./task-wire.js";
import { trimmedText } from "./text-schema.js";

/** How much a Manager is made with: the repositories it works in, at most. */
export const MANAGER_BOUNDS = {
  MAX_REPOSITORIES: 10,
} as const;

/**
 * A Manager to make: the key a retry carries again, the workspace it stands
 * in, its name, its repositories (one or more, each once, the first its
 * checkout), where it runs, its model and effort, and the face it wears,
 * the service's pick where none is named.
 */
export const managerCreateRequestSchema = EffectSchema.Struct({
  idempotencyKey: trimmedText(AGENT_BOUNDS.MAX_KEY_CHARS),
  workspaceId: workspaceIdSchema,
  name: trimmedText(AGENT_BOUNDS.MAX_TITLE_CHARS),
  repositories: EffectSchema.NonEmptyArray(githubRepositoryFullNameSchema).check(
    EffectSchema.isMaxLength(MANAGER_BOUNDS.MAX_REPOSITORIES),
    EffectSchema.isUnique(),
  ),
  runsOn: agentRunsOnRequestSchema,
  model: trimmedText(AGENT_BOUNDS.MAX_CHOICE_CHARS),
  effort: trimmedText(AGENT_BOUNDS.MAX_CHOICE_CHARS),
  face: EffectSchema.optionalKey(managerFacePickSchema),
});

export type ManagerCreateRequest = typeof managerCreateRequestSchema.Type;

/** A request names a key, a workspace, a name, a few repositories, a place, and a choice: their bounds at JSON's widest escape, with room for the keys. */
export const MANAGER_CREATE_BODY_BYTES = 6 * 4_096;
