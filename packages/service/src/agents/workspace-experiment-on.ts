/**
 * workspace-experiment-on.ts -- whether a workspace experiment is on in the workspace the work is in, which decides what of Task descriptions and Memory an agent or a member's call is offered, handed, and told, read beside the agent's starter's choice of Done and follow-ups and whether Computer use is on for the member whose Mac an agent reaches.
 *
 * Every gate of a workspace experiment asks here, for the workspace the work
 * stands in: an agent's own (`agent.organizationId`), a task's
 * (`task.workspaceId`), or the one a member's request names. It never asks
 * the account calling, so every member and agent of one workspace reads the
 * same answer. It is read once where an agent's tools, instructions, and
 * context are built, and again at each tool's door, since a harness may call
 * a tool it was not listed. It stands in a module of its own, beside nothing
 * else, so the start, the turn's context, and the doors all reach it without
 * reaching each other.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { accountExperimentOn, readAccountPreferences } from "@repo/database/models/account-store";
import { machineOwnerOf } from "@repo/database/models/machine-command-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import {
  workspaceExperimentOn,
  workspaceExperimentsOf,
} from "@repo/database/models/workspace-experiment-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { EXPERIMENT, experimentOn, type WorkspaceExperiment } from "@repo/settings";
import { Effect, Option } from "effect";
import { logStoreFailure } from "../http/store-failure.js";

/**
 * Whether the workspace has the experiment on (`workspaceExperimentOn`).
 * Where it cannot be read, it is off, logged for the operator.
 */
export function experimentOnIn(
  workspaceId: string,
  experiment: WorkspaceExperiment,
): Effect.Effect<boolean, never, DatabaseServices> {
  return workspaceExperimentOn(workspaceId, experiment).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => false),
  );
}

/**
 * When the workspace last turned the experiment on, in epoch milliseconds,
 * where it stands on; none where it is off. Where it cannot be read, it is
 * off, logged for the operator.
 */
export function experimentOnSinceIn(
  workspaceId: string,
  experiment: WorkspaceExperiment,
): Effect.Effect<Option.Option<number>, never, DatabaseServices> {
  return workspaceExperimentsOf(workspaceId).pipe(
    Effect.map((standings) =>
      Option.fromUndefinedOr(
        standings.find((standing) => standing.experiment === experiment && standing.on),
      ).pipe(Option.map((standing) => standing.changedAt.getTime())),
    ),
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => Option.none()),
  );
}

/**
 * The experiments an agent's tools, their words, and its instructions are
 * built by: its workspace's Task descriptions, Memory, and Reply buttons,
 * Done and follow-ups as the account that started the agent chose it, on or
 * off, and Computer use, which is no workspace's but the account's whose Mac
 * the agent reaches (`machineOwnerOf`), since that member alone is who it acts
 * for. An agent is told nothing of one that is off, so every word that names
 * one is chosen by this.
 */
export interface ExperimentsOn {
  readonly descriptionsOn: boolean;
  readonly memoryOn: boolean;
  readonly turnEndOn: boolean;
  readonly replyButtonsOn: boolean;
  readonly computerUseOn: boolean;
  /** Whether the member its threads would land with keeps an Inbox (`@repo/settings`'s `inbox`): its task's assignee, else its starter (`inboxKeeperOf`), which offers it the threads it posts there; no experiment, but read and gated as Done and follow-ups is. */
  readonly inboxOn: boolean;
}

/** Every experiment on: the words a tool is declared in where nothing narrows it, as the goldens hold them. */
export const EVERY_EXPERIMENT_ON: ExperimentsOn = {
  descriptionsOn: true,
  memoryOn: true,
  turnEndOn: true,
  replyButtonsOn: true,
  computerUseOn: true,
  inboxOn: true,
};

/** Every experiment off. */
export const NO_EXPERIMENT_ON: ExperimentsOn = {
  descriptionsOn: false,
  memoryOn: false,
  turnEndOn: false,
  replyButtonsOn: false,
  computerUseOn: false,
  inboxOn: false,
};

/** The agent an agent's experiments are read for: its workspace, the account that started it, its task, whose assignee's Inbox is read, and the conversation whose Mac owner's own Computer use is read. */
export interface ExperimentsOf {
  readonly organizationId: string;
  readonly userId: string;
  readonly taskId: string | null;
  readonly conversationId: string;
}

/**
 * Whose Inbox an agent's threads would land in, and so whose choice of
 * keeping one decides whether it posts any: its task's assignee while they
 * stand in the agent's workspace, else the agent's starter, the order a
 * thread picks who it waits on by (`inboxItemWaitsOn`). Note that it is read
 * again as each session opens and each tool is called, so a task
 * reassigned moves its agents to the new assignee's choice.
 */
function inboxKeeperOf(agent: ExperimentsOf) {
  return Effect.gen(function* () {
    // Note that an agent on no task has no assignee, so its starter keeps its threads.
    if (agent.taskId === null) return agent.userId;
    const header = yield* readTaskHeader(agent.userId, agent.taskId);
    const assignee = Option.getOrUndefined(header)?.assigneeId ?? null;

    if (assignee === null || assignee === agent.userId) return agent.userId;

    return (yield* isWorkspaceMember(assignee, agent.organizationId)) ? assignee : agent.userId;
  });
}

/**
 * The agent's experiments, its workspace's read in one statement beside its
 * starter's account and its Mac owner's; none where they cannot be read,
 * logged for the operator. For a caller that must tell a failed read from
 * every experiment off, as a restart does.
 */
export function experimentsReadIn(
  agent: ExperimentsOf,
): Effect.Effect<Option.Option<ExperimentsOn>, never, DatabaseServices> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };

  return Effect.all(
    [
      workspaceExperimentsOf(agent.organizationId),
      readAccountPreferences(agent.userId),
      Effect.flatMap(machineOwnerOf(target), (owner) =>
        accountExperimentOn(owner, EXPERIMENT.COMPUTER_USE),
      ),
      // Note that the assignee's row is read only where they, not the starter, keep the threads.
      Effect.flatMap(inboxKeeperOf(agent), (keeper) =>
        keeper === agent.userId
          ? Effect.succeed(Option.none())
          : Effect.map(readAccountPreferences(keeper), Option.some),
      ),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([standings, starter, computerUseOn, assignee]) => {
      const on = (experiment: WorkspaceExperiment) =>
        standings.some((standing) => standing.experiment === experiment && standing.on);

      return Option.some({
        descriptionsOn: on(EXPERIMENT.DESCRIPTIONS),
        memoryOn: on(EXPERIMENT.MEMORY),
        turnEndOn: starter !== undefined && experimentOn(starter.experiments, EXPERIMENT.TURN_END),
        replyButtonsOn: on(EXPERIMENT.REPLY_BUTTONS),
        computerUseOn,
        // Note that the keeper's own choice stands, an assignee who stored none reading as on, as the setting's default is, rather than as the starter's.
        inboxOn: Option.getOrElse(assignee, () => starter)?.preferences.inbox ?? true,
      });
    }),
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => Option.none<ExperimentsOn>()),
  );
}

/** The agent's experiments, as above; where they cannot be read, every one is off, logged for the operator. */
export function experimentsOnIn(
  agent: ExperimentsOf,
): Effect.Effect<ExperimentsOn, never, DatabaseServices> {
  return Effect.map(
    experimentsReadIn(agent),
    Option.getOrElse(() => NO_EXPERIMENT_ON),
  );
}

/**
 * The one refusal of a tool, or of a part of one, that an experiment off in
 * the workspace withholds. It names no experiment, since an agent is told
 * nothing of one that is off; a call meets it only from a session that
 * started before the switch flipped, or a harness that calls a tool it was
 * not listed.
 */
export const EXPERIMENT_OFF_REFUSAL = "This tool is not available here.";
