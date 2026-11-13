/**
 * use-agent-run.ts -- an agent's run actions as its page's ⋯ offers them: its repository's commands, each run in the agent's sandbox or stopped while it runs, as the panel's Run › offers them on a narrow window.
 *
 * Which are offered, which run, and their words are the panel's
 * (`@repo/features/run-actions-model`): only where the agent runs in the
 * cloud, never on a
 * member's own Mac, whose actions run only through that Mac's host, and its
 * repository keeps any that may run in the cloud (`runActionsIn`, as the
 * panel filters by the agent's machine) (`WORKSPACE_SANDBOX_SETUP_READ`). Which run is read off the agent's
 * shells (`TERMINAL_LIST`) every few seconds while the page is in focus, and
 * none is offered until they are read, so a running one is never offered as
 * idle. A press under way holds its action until it settles. A
 * press resumes a stopped sandbox first (`TERMINAL_RESUME`), as the panel's
 * does, then runs the action (`AGENTS_RUN_ACTION`) or stops it
 * (`AGENTS_RUN_ACTION_STOP`); the phone draws no Terminal tab, so what runs
 * is seen through its ports. A press that did not go says so in the app's
 * failure notice, in the panel's words, a Stop with Try again; a run offers
 * none, since one not heard back may have started.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  RUN_ACTION_WORDS,
  repositoryRunActions,
  runActionsAsked,
  runningActions,
  SHELLS_LOOK_EVERY_MS,
  sandboxStopped,
} from "@repo/features/run-actions-model";
import {
  RUN_ACTION_PLACE,
  type RunAction,
  runActionsIn,
} from "@repo/features/workspace-sandbox-setup-wire";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ } from "@repo/ui-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useRef } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";
import { useFollowedAgent } from "./use-agent.js";

/** Where the reads this hook makes are kept among the app's queries. */
const QUERY_ROOT = {
  SETUP: "workspace-sandbox-setup",
  SHELLS: "agent-shells",
} as const;

/** One of the agent's run actions as the ⋯ offers it: the action, whether it runs now, and the press that runs or stops it. */
export interface OfferedRunAction {
  readonly action: RunAction;
  readonly runs: boolean;
  readonly onPress: () => void;
}

/** The run actions of the agent `agentId` names in their list's order, each with whether it runs and its press; none where its workspace, place, or repository offers none. */
export function useAgentRun(agentId: string): readonly OfferedRunAction[] {
  const acts = useHostActs();
  const write = useWrite();
  const queries = useQueryClient();
  const focused = useIsFocused();
  const agent = useFollowedAgent(agentId);
  const workspaceId = agent?.workspaceId;

  // Note that the reads are kept under the account signed in, so another account's never draws from them.
  const { data: accountId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  const asks =
    agent !== undefined &&
    workspaceId !== undefined &&
    runActionsAsked({ machine: agent.machine, repository: agent.repository });

  const { data: setup } = useQuery({
    queryKey: [QUERY_ROOT.SETUP, accountId, workspaceId],
    enabled: asks,
    queryFn: () => acts[ACT_KIND.WORKSPACE_SANDBOX_SETUP_READ]({ workspaceId: workspaceId ?? "" }),
  });

  // Note that an action kept to local agents never runs in a sandbox, so a cloud agent offers only those that may run there.
  const actions = asks
    ? runActionsIn(
        repositoryRunActions(setup?.runActions, agent?.repository),
        RUN_ACTION_PLACE.CLOUD,
      )
    : [];

  const offered = actions.length > 0;
  const shellsKey = [QUERY_ROOT.SHELLS, accountId, agentId];
  const pressing = useRef(new Set<string>());

  const { data: shellsRead } = useQuery({
    queryKey: shellsKey,
    enabled: offered,
    refetchInterval: offered && focused ? SHELLS_LOOK_EVERY_MS : false,
    retry: false,
    queryFn: () => acts[ACT_KIND.TERMINAL_LIST]({ agentId }),
  });

  const shells = shellsRead !== undefined && "terminals" in shellsRead ? shellsRead : undefined;
  const running = runningActions(shells);
  const stopped = sandboxStopped(shells);

  /** Runs one action, its sandbox resumed first where it is stopped, and reads the shells again either way. */
  const run = (action: RunAction) =>
    write(
      async () => {
        if (stopped) await acts[ACT_KIND.TERMINAL_RESUME]({ agentId }).catch(() => undefined);

        return acts[ACT_KIND.AGENTS_RUN_ACTION]({ agentId, actionId: action.id }).finally(() =>
          queries.invalidateQueries({ queryKey: shellsKey }),
        );
      },
      {
        refused: (answer) => ("terminal" in answer ? undefined : RUN_ACTION_WORDS.NOT_RUN),
        unanswered: RUN_ACTION_WORDS.NOT_RUN,
        // Note that a run offers no Try again, as the panel's does not: one that started but was not heard back would run twice, and the next read of the shells says whether it runs.
        went: BUZZ.SUCCESS,
      },
    );

  /** Stops one action's shell, its answer laid over the shells read. */
  const stop = (action: RunAction) =>
    write(
      () =>
        acts[ACT_KIND.AGENTS_RUN_ACTION_STOP]({ agentId, actionId: action.id }).then(
          async (answer) => {
            // Note that a read of the shells still out is let go first, so it never lands over the stop.
            if ("terminals" in answer) {
              await queries.cancelQueries({ queryKey: shellsKey });
              queries.setQueryData(shellsKey, answer);
            }

            return answer;
          },
        ),
      {
        refused: (answer) => ("terminals" in answer ? undefined : RUN_ACTION_WORDS.NOT_STOPPED),
        unanswered: RUN_ACTION_WORDS.NOT_STOPPED,
        retry: true,
        went: BUZZ.SUCCESS,
      },
    );

  // Note that a press under way holds its action, so a second press before it settles sends nothing.
  const offer = (action: RunAction): OfferedRunAction => {
    const runs = running.has(action.id);

    const onPress = () => {
      if (pressing.current.has(action.id)) return;
      pressing.current.add(action.id);
      void (runs ? stop(action) : run(action)).finally(() => pressing.current.delete(action.id));
    };

    return { action, runs, onPress };
  };

  // Note that nothing is offered until the shells are read, since an action read as idle before then would run again rather than stop; the read every few seconds is its Try again.
  return shells === undefined ? [] : actions.map(offer);
}
