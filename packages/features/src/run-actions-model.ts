/**
 * run-actions-model.ts -- a cloud agent's run actions as every client offers them: whether they are offered, its repository's list, which run now, the one pressed first, and their words.
 *
 * A run action is a command its repository keeps in Settings › Cloud
 * environment, run in a shell of the agent's sandbox when pressed
 * (`AGENTS_RUN_ACTION`) and stopped there (`AGENTS_RUN_ACTION_STOP`).
 * They are offered only where the agent's workspace has the Run actions
 * experiment on, the agent runs in the cloud, never on a member's own Mac,
 * and its repository has any; which run is read off the agent's shells,
 * each marked with the action it was started for (`TERMINAL_LIST`). The
 * panel's Run button, ⌘K, and narrow ⋯ (`@repo/panel`'s
 * `run-actions-button.tsx`) and the iOS agent page's ⋯ read them from here.
 * Nothing here draws.
 */

import { AGENT_MACHINE, type AgentMachineKind } from "./agent-wire.js";
import { SANDBOX_STATE, type TerminalsAnswer } from "./terminal-wire.js";
import type { RepositoryRunActions, RunAction } from "./workspace-sandbox-setup-wire.js";

/** What the run actions say, in the panel's words. */
export const RUN_ACTION_WORDS = {
  MENU: "Run actions",
  SUBMENU: "Run",
  RUNNING: "Running",
  RUN: (label: string) => `Run ${label}`,
  STOP: (label: string) => `Stop ${label}`,
  NOT_RUN: "That action did not run.",
  NOT_STOPPED: "That action did not stop.",
} as const;

/** How often a shown list of an agent's shells is read again, as the Terminal tab's own list goes. */
export const SHELLS_LOOK_EVERY_MS = 5_000;

/** Whether an agent's run actions are asked for: its workspace's experiment on, the agent in the cloud (no `machine`, as a sandbox's row says none), and its repository known. */
export function runActionsAsked(input: {
  readonly experiment: boolean;
  readonly machine: AgentMachineKind | undefined;
  readonly repository: string | null | undefined;
}): boolean {
  return (
    input.experiment &&
    input.machine !== AGENT_MACHINE.DEVICE &&
    input.repository !== null &&
    input.repository !== undefined
  );
}

/** The run actions a repository keeps, in their order, matched by its name in any case; none where it keeps none. */
export function repositoryRunActions(
  lists: readonly RepositoryRunActions[] | undefined,
  repository: string | null | undefined,
): readonly RunAction[] {
  const name = (repository ?? "").toLowerCase();

  return lists?.find((each) => each.repository.toLowerCase() === name)?.actions ?? [];
}

/** The actions whose shells run now, by id, read off the agent's shells; none before they are read. */
export function runningActions(shells: TerminalsAnswer | undefined): ReadonlySet<string> {
  return new Set(
    (shells?.terminals ?? []).flatMap((shell) =>
      shell.running && shell.runAction !== undefined ? [shell.runAction] : [],
    ),
  );
}

/** Whether the agent's sandbox is read as stopped, which a run resumes first; not before its shells are read. */
export function sandboxStopped(shells: TerminalsAnswer | undefined): boolean {
  return shells !== undefined && shells.sandbox !== SANDBOX_STATE.RUNNING;
}

/** The action pressed first: the list's default, or its first where none is. */
export function primaryRunAction<Offered extends { readonly action: RunAction }>(
  offered: readonly [Offered, ...Offered[]],
): Offered {
  return offered.find((each) => each.action.isDefault === true) ?? offered[0];
}

/** An action's row in a menu of them: its name, or Stop and its name while it runs. */
export function runActionMenuLabel(action: RunAction, runs: boolean): string {
  return runs ? RUN_ACTION_WORDS.STOP(action.label) : action.label;
}

/** What an action's press says: Run and its name, or Stop and its name while it runs. */
export function runActionPressWords(action: RunAction, runs: boolean): string {
  return runs ? RUN_ACTION_WORDS.STOP(action.label) : RUN_ACTION_WORDS.RUN(action.label);
}
