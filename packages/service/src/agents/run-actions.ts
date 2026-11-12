/**
 * run-actions.ts -- the run action a call names, as one of an agent's repository's, found only for a cloud agent with a repository in a workspace with the Run actions experiment on, and that action run or stopped in the agent's sandbox.
 *
 * A repository's run actions are kept with its cloud setup
 * (`workspace-sandbox-setup-wire.ts`), and a member runs one in a cloud
 * agent's sandbox from the Run button over its tabs, ⌘K, or a phone's ⋯. With the
 * experiment off, an agent on a Mac, an agent with no repository, or an id
 * that is not one of the repository's actions, the action is not found, so
 * nothing is run that the workspace has not chosen and listed. The hosted
 * procedures (`agents.runAction`, `agents.stopRunAction`) and the member MCP
 * tools (`run_action`, `stop_run_action`) run and stop one through here, as
 * the member, by the Terminal tab's rule (`terminal/sandbox-reach.ts`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { readRunActions } from "@repo/database/models/workspace-sandbox-script-store";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import type { RunAction } from "@repo/features/workspace-sandbox-setup-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { workspaceEnvironmentOf } from "./coder-host/runner-sessions.js";
import { AgentSandbox } from "./terminal/agent-sandbox.js";
import {
  listedShells,
  reachedAgentSession,
  sandboxOrUpstream,
  shellRefusal,
} from "./terminal/sandbox-reach.js";
import { experimentOnIn } from "./workspace-experiment-on.js";

/** What of an agent names its run actions: where it runs, its workspace, and its repository. */
interface RunActionAgent {
  readonly machine?: string | undefined;
  readonly organizationId: string;
  readonly repository: string | null;
}

/** The agent's repository, where it has run actions at all: a cloud agent with one, in a workspace with the experiment on; not found otherwise. */
const runActionRepositoryOf = /* @__PURE__ */ Effect.fnUntraced(function* (agent: RunActionAgent) {
  const repository = agent.repository;
  if (agent.machine === AGENT_MACHINE.DEVICE || repository === null) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  if (!(yield* experimentOnIn(agent.organizationId, EXPERIMENT.RUN_ACTIONS))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return repository;
});

/** The run action `actionId` names among the agent's repository's, or not found. */
const runActionOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: RunActionAgent,
  actionId: string,
): Effect.fn.Return<RunAction, HostedRefusal, DatabaseServices> {
  const repository = yield* runActionRepositoryOf(agent);
  const actions = yield* hostedStoreOrUnavailable(readRunActions(agent.organizationId, repository));
  const action = actions.find((each) => each.id === actionId);
  if (action === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return {
    id: action.id,
    label: action.label,
    command: action.command,
    ...(action.icon === null ? undefined : { icon: action.icon }),
    ...(action.isDefault ? { isDefault: true } : undefined),
  };
});

/**
 * One of the agent's repository's run actions run in its running sandbox,
 * as the member, with the workspace's variables, answering its shell; a
 * stopped sandbox is refused rather than woken.
 */
export const ranRunAction = Effect.fn("web/ranRunAction")(function* (
  userId: string,
  agentId: string,
  actionId: string,
) {
  const { sessionId, agent } = yield* reachedAgentSession(userId, agentId);
  const action = yield* runActionOf(agent, actionId);
  if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  const environment = yield* hostedStoreOrUnavailable(
    workspaceEnvironmentOf(agent, AGENT_MACHINE.VERCEL),
  );
  const sandbox = yield* AgentSandbox;
  const ran = yield* sandboxOrUpstream(
    // Note that the action's shell is started under the action's own id, so two presses at once start one shell, never two.
    sandbox.run(sessionId, action.id, {
      actionId: action.id,
      label: action.label,
      command: action.command,
      environment,
    }),
  );
  if (Result.isFailure(ran)) return yield* Effect.fail(shellRefusal(ran.failure));
  return { terminal: ran.success };
});

/**
 * What one of the agent's run actions' shell runs stopped, as the member,
 * the shell left standing; answers the shells as they stand after. Note
 * that the action need not still be saved, because one removed from the
 * list while it runs must still be stoppable; the sandbox stops only a
 * shell started for that action's id, and finds none for any other.
 */
export const stoppedRunAction = Effect.fn("web/stoppedRunAction")(function* (
  userId: string,
  agentId: string,
  actionId: string,
) {
  const { sessionId, agent } = yield* reachedAgentSession(userId, agentId);
  yield* runActionRepositoryOf(agent);
  if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const sandbox = yield* AgentSandbox;
  const stopped = yield* sandboxOrUpstream(sandbox.stop(sessionId, actionId));
  if (Result.isFailure(stopped)) return yield* Effect.fail(shellRefusal(stopped.failure));
  return yield* listedShells(sessionId);
});
