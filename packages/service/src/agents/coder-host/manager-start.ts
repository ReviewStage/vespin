/**
 * manager-start.ts -- a Manager made from what the New Manager dialog asks, on the one start path.
 *
 * A Manager is an agent of kind `manager` on no task (`WorkspaceWhere`),
 * started by the account that asks, which owns it: it stands in the
 * workspace the request names, which that account must be a member of, and
 * works in the repositories it names, the first its checkout. Its name is
 * its title from the start, so no model is asked to name it. Its first turn
 * is opened with `MANAGER_OPENING` in the prompt's place, which the
 * conversation shows as its creator's first line, and its instructions
 * (`managerInstructions`) say what an introduction covers. A workspace the
 * account is not in reads as none before its experiments are read, so no
 * outsider learns whether one has Managers on; one with the experiment off
 * is refused as not permitted. Everything else, the retry under its key
 * among it, refuses and answers as any Start does (`startAgent`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { AGENT_KIND } from "@repo/features/agent-wire";
import type { ManagerCreateRequest } from "@repo/features/manager-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import type { AgentSessions, TypedTurn } from "../sessions/agent-sessions.js";
import { experimentOnIn } from "../workspace-experiment-on.js";
import { type RequestedStart, type StartServices, startAgent } from "./start.js";
import { summaryOf } from "./stop.js";

/** The words a Manager's first turn opens on, said as its creator's first line. */
export const MANAGER_OPENING = "Introduce yourself.";

/** Makes the account's Manager as the request asks, or answers the one a retry under its key already made. */
export const startManager = /* @__PURE__ */ Effect.fnUntraced(function* (
  agentSessions: Effect.Effect<
    AgentSessions<TypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  userId: string,
  request: ManagerCreateRequest,
): Effect.fn.Return<RequestedStart, HostedRefusal, StartServices> {
  const { workspaceId } = request;

  if (!(yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId)))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }

  if (!(yield* experimentOnIn(workspaceId, EXPERIMENT.MANAGERS))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }

  const [repository, ...extraRepositories] = request.repositories;

  const { agent, created, txid } = yield* startAgent(agentSessions, userId, {
    taskId: null,
    workspaceId,
    repository,
    extraRepositories,
    prompt: MANAGER_OPENING,
    idempotencyKey: request.idempotencyKey,
    choice: { model: request.model, effort: request.effort },
    runsOn: request.runsOn,
    title: request.name,
    kind: AGENT_KIND.MANAGER,
  }).pipe(Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)));

  const summary = yield* summaryOf(userId, agent);

  return { agent: summary, created, ...(txid === undefined ? undefined : { txid }) };
});
