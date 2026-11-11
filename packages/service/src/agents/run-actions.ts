/**
 * run-actions.ts -- the run action a route names, as one of an agent's repository's: found only for a cloud agent with a repository, in a workspace with the Run actions experiment on.
 *
 * A repository's run actions are kept with its cloud setup
 * (`workspace-sandbox-setup-wire.ts`), and a member runs one in a cloud
 * agent's sandbox from the Run button over its tabs, ⌘K, or a phone's ⋯. With the
 * experiment off, an agent on a Mac, an agent with no repository, or an id
 * that is not one of the repository's actions, the action is not found, so
 * nothing is run that the workspace has not chosen and listed.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { readRunActions } from "@repo/database/models/workspace-sandbox-script-store";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import type { RunAction } from "@repo/features/workspace-sandbox-setup-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { experimentOnIn } from "./workspace-experiment-on.js";

/** What of an agent names its run actions: where it runs, its workspace, and its repository. */
interface RunActionAgent {
  readonly machine?: string | undefined;
  readonly organizationId: string;
  readonly repository: string | null;
}

/** The run action `actionId` names among the agent's repository's, or not found. */
export const runActionOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: RunActionAgent,
  actionId: string,
): Effect.fn.Return<RunAction, HostedRefusal, DatabaseServices> {
  const repository = agent.repository;
  if (agent.machine === AGENT_MACHINE.DEVICE || repository === null) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  if (!(yield* experimentOnIn(agent.organizationId, EXPERIMENT.RUN_ACTIONS))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const actions = yield* hostedStoreOrUnavailable(readRunActions(agent.organizationId, repository));
  const action = actions.find((each) => each.id === actionId);
  if (action === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { id: action.id, label: action.label, command: action.command };
});
