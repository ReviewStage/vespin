import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import type { TerminalSummary } from "@repo/features/terminal-wire";
import type { RunAction } from "@repo/features/workspace-sandbox-setup-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { PlayIcon, riseAbove, SplitButton, STATUS_TONE, useMenu } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { askAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { QUERY_ROOT } from "../query-keys.js";
import { SHORTCUT_SUBJECT, shortcutSubject, useShortcutTarget } from "../shortcut-target.js";
import { showToast, TOAST_HOLD } from "../toast.js";
import { appStateQuery } from "../use-app-state.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { listedAgentIn } from "./use-workspace-agents.js";

/**
 * run-actions-button.tsx -- the Run button in a cloud agent's message box: its repository's run actions, kept in Settings › Cloud environment, each run in a Terminal tab of the agent's sandbox when pressed.
 *
 * Drawn only where the agent's workspace has the Run actions experiment on,
 * the agent runs in the cloud, and its repository has run actions. The
 * main part runs the list's first action, or stops it while it runs, as
 * ⌥⌘R does on the agent shown; the chevron drops every action, each a run
 * or, while it runs, a stop. A press is the only thing that runs one: a
 * stopped sandbox is resumed by the press, as opening its Terminal tab
 * resumes it, and the action's shell is then shown in the side panel's
 * Terminal tab. Which actions run is read off the agent's shells, each
 * marked with the action it was started for, while the button is shown.
 */

/** How often the shown button reads which of its actions run, as the Terminal tab's own list goes. */
const SHELLS_EVERY_MS = 5_000;

/** What the button says, in the app's own words. */
const WORDS = {
  MENU: "Run actions",
  RUN: (label: string) => `Run ${label}`,
  STOP: (label: string) => `Stop ${label}`,
  STARTING: "Starting",
  NOT_RUN: "That action did not run.",
  NOT_STOPPED: "That action did not stop.",
} as const;

/** The keys the button offers on the agent shown, which its menu prints. */
const RUN_KEYS = [APP_COMMAND.RUN_ACTION] as const;

/** An agent's shells and where its sandbox stands, read as its Run button shows which actions run. */
function shellsQuery(agentId: string, shown: boolean, enabled: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_SHELLS, agentId],
    queryFn: () => askAct(ACT_KIND.TERMINAL_LIST, { agentId }),
    enabled,
    refetchInterval: shown ? SHELLS_EVERY_MS : false,
    retry: false,
  });
}

/** The workspace's sandbox setup, as Settings › Cloud environment reads it, its run actions among it. */
function sandboxSetupQuery(workspaceId: string, enabled: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_SANDBOX_SETUP, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_SANDBOX_SETUP_READ, { workspaceId }),
    enabled,
  });
}

/** The agent's workspace and repository as the task list carries them; none where it carries no such agent. */
function useRunPlace(agentId: string) {
  const select = useCallback(
    (state: AppStateSnapshot) => {
      const listed = listedAgentIn(state.tasks, agentId);
      return listed === undefined
        ? undefined
        : { workspaceId: listed.workspaceId, repository: listed.repository };
    },
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

/** Says a press that did not go through, reporting it beside the act and the agent. */
function pressFailed(
  kind: typeof ACT_KIND.AGENTS_RUN_ACTION | typeof ACT_KIND.AGENTS_RUN_ACTION_STOP,
  agentId: string,
  cause: unknown,
  words: string,
): void {
  showToast({
    words,
    tone: STATUS_TONE.DANGER,
    hold: TOAST_HOLD.FAILED,
    failure: { surface: FAILURE_SURFACE.ACT, act: kind, cause, about: failureAboutOf({ agentId }) },
  });
}

/**
 * Runs one action: its sandbox resumed first where it is stopped, the
 * action run, and its shell shown; the shells read again either way.
 */
async function runAction(
  queries: QueryClient,
  agentId: string,
  action: RunAction,
  stopped: boolean,
  onShowShell: ((terminal: TerminalSummary) => void) | undefined,
): Promise<void> {
  if (stopped) await askAct(ACT_KIND.TERMINAL_RESUME, { agentId }).catch(() => undefined);
  const answer = await askAct(ACT_KIND.AGENTS_RUN_ACTION, { agentId, actionId: action.id }).catch(
    (cause: unknown) => ({ failure: cause }),
  );
  await queries.invalidateQueries({ queryKey: [QUERY_ROOT.AGENT_SHELLS, agentId] });
  if ("terminal" in answer) onShowShell?.(answer.terminal);
  else pressFailed(ACT_KIND.AGENTS_RUN_ACTION, agentId, answer, WORDS.NOT_RUN);
}

/** Stops one action's shell, its answer laid over the shells read. */
async function stopAction(queries: QueryClient, agentId: string, action: RunAction): Promise<void> {
  const answer = await askAct(ACT_KIND.AGENTS_RUN_ACTION_STOP, {
    agentId,
    actionId: action.id,
  }).catch((cause: unknown) => ({ failure: cause }));
  if ("terminals" in answer) queries.setQueryData([QUERY_ROOT.AGENT_SHELLS, agentId], answer);
  else pressFailed(ACT_KIND.AGENTS_RUN_ACTION_STOP, agentId, answer, WORDS.NOT_STOPPED);
}

/** The Run button, where the agent's workspace, place, and repository offer any action; nothing otherwise. */
export function RunActionsButton({
  agent,
  shown,
  narrow,
  onShowShell,
}: {
  agent: AgentSummary;
  /** Whether the agent's tab is on screen, which offers ⌥⌘R and reads its shells. */
  shown: boolean;
  /** Whether the composer is too narrow for the button's words, which folds them. */
  narrow: boolean;
  /** Shows an action's shell in the side panel's Terminal tab; none where no side panel runs terminals. */
  onShowShell: ((terminal: TerminalSummary) => void) | undefined;
}): React.JSX.Element | null {
  const queries = useQueryClient();
  const menu = useMenu(true);
  const [busy, setBusy] = useState(false);
  const place = useRunPlace(agent.id);
  const on = useWorkspaceExperiment(place?.workspaceId, EXPERIMENT.RUN_ACTIONS);
  const cloud = agent.machine !== AGENT_MACHINE.DEVICE;
  const repository = place?.repository ?? null;
  const asks = on && cloud && repository !== null && place !== undefined;
  const setup = useQuery(sandboxSetupQuery(place?.workspaceId ?? "", asks)).data;
  const actions =
    setup?.runActions?.find(
      (each) => each.repository.toLowerCase() === (repository ?? "").toLowerCase(),
    )?.actions ?? [];
  const offered = asks && actions.length > 0;
  const shells = useQuery(shellsQuery(agent.id, shown, offered)).data;
  const listed = shells !== undefined && "terminals" in shells ? shells : undefined;
  const running = new Set(
    (listed?.terminals ?? []).flatMap((shell) =>
      shell.running && shell.runAction !== undefined ? [shell.runAction] : [],
    ),
  );
  const stopped = listed !== undefined && listed.sandbox !== "running";
  const subject = shortcutSubject(SHORTCUT_SUBJECT.AGENT, agent.id);
  const press = (action: RunAction) => {
    setBusy(true);
    const pressed = running.has(action.id)
      ? stopAction(queries, agent.id, action)
      : runAction(queries, agent.id, action, stopped, onShowShell);
    void pressed.finally(() => setBusy(false));
  };
  const first = actions[0];
  useShortcutTarget(shown && offered ? subject : undefined, RUN_KEYS);
  useAppCommand(
    APP_COMMAND.RUN_ACTION,
    shown && first !== undefined && offered && !busy ? () => press(first) : undefined,
  );
  if (!offered || first === undefined) return null;
  const firstRuns = running.has(first.id);
  const items: MenuAction[] = actions.map((action, index) => {
    const runs = running.has(action.id);
    const item: MenuAction = {
      label: runs ? WORDS.STOP(action.label) : action.label,
      detail: action.command,
      icon: runs ? <GLYPH.STOP /> : <PlayIcon />,
      replayMasked: true,
      onSelect: () => press(action),
    };
    return index === 0 ? { ...item, command: APP_COMMAND.RUN_ACTION, subject } : item;
  });
  return (
    <>
      <SplitButton
        icon={firstRuns ? <GLYPH.STOP /> : <PlayIcon />}
        label={firstRuns ? WORDS.STOP(first.label) : WORDS.RUN(first.label)}
        hintLabel={firstRuns ? WORDS.STOP(first.label) : WORDS.RUN(first.label)}
        busy={busy}
        busyLabel={WORDS.STARTING}
        onClick={() => press(first)}
        menu={{ label: WORDS.MENU, ...menu.trigger(riseAbove) }}
      >
        {narrow ? null : first.label}
      </SplitButton>
      {menu.drawn && (
        <ActionMenu label={WORDS.MENU} menu={menu.drawn} groups={[items]} onClose={menu.close} />
      )}
    </>
  );
}
