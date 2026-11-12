import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import type { RunAction } from "@repo/features/workspace-sandbox-setup-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { EXPERIMENT, HOST_CAPABILITY } from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  GAP,
  INLINE_REF_LOOK,
  Inline,
  InlineRef,
  SplitButton,
  STATUS_TONE,
  useMenu,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { askAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { ActionMenu, type MenuAction, type MenuSubmenu } from "../desktop/action-menu.js";
import type { ShownShell } from "../desktop/agent-actions.js";
import { useOpenSettings } from "../open-settings.js";
import { QUERY_ROOT } from "../query-keys.js";
import {
  SHORTCUT_SUBJECT,
  type ShortcutSubject,
  shortcutSubject,
  useShortcutTarget,
} from "../shortcut-target.js";
import { showToast } from "../toast.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { runActionGlyph, shellsQuery } from "./run-action-shells.js";
import type { HeldAction } from "./terminal-held.js";
import { listedAgentIn } from "./use-workspace-agents.js";

/**
 * run-actions-button.tsx -- a cloud agent's run actions: its repository's commands, kept in Settings › Cloud environment, each run in a Terminal tab of the agent's sandbox when pressed.
 *
 * Offered only where the agent's workspace has the Run actions experiment
 * on, the agent runs in the cloud, and its repository has run actions
 * (`useRunActions`). Three places offer them, each from that one reading:
 * the Run button at the end of the agents' tab row, beside the panel's
 * own buttons and over the side panel its Terminal tab opens in
 * (`RunActionsButton`); ⌘K, whose open task lists each as Run or Stop
 * (`runPaletteRows`); and a phone's ⋯, which has no room for the button
 * (`runSubmenu`). The button's main part runs the repository's default
 * action, or the list's first where none is the default, or stops it while
 * it runs, as ⌥⌘R does in the desktop app; its chevron drops every action,
 * each with its icon, a run or, while it runs, a stop, under the agent it
 * runs in, and the way to edit them. A press is the only thing that runs one: a stopped sandbox is
 * resumed by the press, as opening its Terminal tab resumes it, and the
 * action's shell is then shown in the side panel's Terminal tab. Which
 * actions run is read off the agent's shells, each marked with the action
 * it was started for, while the agent is shown.
 */

/** What the button says, in the app's own words. */
const WORDS = {
  MENU: "Run actions",
  SUBMENU: "Run",
  SUBMENU_IN: "Run in",
  EDIT: "Edit run actions…",
  RUNNING: "Running",
  RUN: (label: string) => `Run ${label}`,
  STOP: (label: string) => `Stop ${label}`,
  IN: (words: string, agent: string) => `${words} in ${agent}`,
  STARTING: "Starting",
  NOT_RUN: "That action did not run.",
  NOT_STOPPED: "That action did not stop.",
} as const;

/** The keys the button offers on the agent shown, which its menu prints. */
const RUN_KEYS = [APP_COMMAND.RUN_ACTION] as const;

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
  action: HeldAction,
  stopped: boolean,
  onShowShell: ((terminal: ShownShell) => void) | undefined,
): Promise<void> {
  if (stopped) await askAct(ACT_KIND.TERMINAL_RESUME, { agentId }).catch(() => undefined);

  const answer = await askAct(ACT_KIND.AGENTS_RUN_ACTION, { agentId, actionId: action.id }).catch(
    (cause: unknown) => ({ failure: cause }),
  );

  await queries.invalidateQueries({ queryKey: [QUERY_ROOT.AGENT_SHELLS, agentId] });
  // The tab is held on the action, with the icon it wears as pressed, so it takes nothing typed and wears both.
  const held = { id: action.id, ...(action.icon === undefined ? {} : { icon: action.icon }) };

  if ("terminal" in answer) onShowShell?.({ ...answer.terminal, action: held });
  else pressFailed(ACT_KIND.AGENTS_RUN_ACTION, agentId, answer, WORDS.NOT_RUN);
}

/** Stops one action's shell, its answer laid over the shells read. */
async function stopAction(
  queries: QueryClient,
  agentId: string,
  action: HeldAction,
): Promise<void> {
  const answer = await askAct(ACT_KIND.AGENTS_RUN_ACTION_STOP, {
    agentId,
    actionId: action.id,
  }).catch((cause: unknown) => ({ failure: cause }));

  if ("terminals" in answer) queries.setQueryData([QUERY_ROOT.AGENT_SHELLS, agentId], answer);
  else pressFailed(ACT_KIND.AGENTS_RUN_ACTION_STOP, agentId, answer, WORDS.NOT_STOPPED);
}

/**
 * Runs or stops one of an agent's run actions from the tab that shows it,
 * through the presses the Run button makes, the tab already shown; and
 * whether a press is under way, which holds the tab's button.
 */
export function useRunActionPress(agentId: string): {
  readonly busy: boolean;
  readonly run: (action: HeldAction) => void;
  readonly stop: (action: HeldAction) => void;
} {
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);

  const pressed = (press: Promise<void>) => {
    setBusy(true);
    void press.finally(() => setBusy(false));
  };

  return {
    busy,
    run: (action) => pressed(runAction(queries, agentId, action, false, undefined)),
    stop: (action) => pressed(stopAction(queries, agentId, action)),
  };
}

/** One of the agent's run actions as a place offers it: the action, whether it runs now, and the press that runs or stops it. */
interface OfferedAction {
  readonly action: RunAction;
  readonly runs: boolean;
  readonly onPress: () => void;
}

/** An agent's run actions as every place that offers them reads them (`useRunActions`). */
export interface RunOffer {
  readonly agentId: string;
  /** The actions in the list's order. */
  readonly actions: readonly [OfferedAction, ...OfferedAction[]];
  /** The one the button's main part and ⌥⌘R press: the default, or the first where none is. */
  readonly primary: OfferedAction;
  /** Whether a press is still under way, which holds the button and ⌥⌘R. */
  readonly busy: boolean;
  /** Whether ⌥⌘R answers here: the desktop app, with the agent on screen. */
  readonly keyed: boolean;
  /** What the keys act on: the agent. */
  readonly subject: ShortcutSubject;
  /** Opens Settings › Cloud environment on the agent's workspace, where the actions are kept. */
  readonly onEdit: () => void;
}

/**
 * The agent's run actions, each with whether it runs and its press, where
 * the agent's workspace, place, and repository offer any; none otherwise,
 * and none while no agent is given. Its shells are read while it is shown.
 */
export function useRunActions(
  agent: Pick<AgentSummary, "id" | "machine"> | undefined,
  shown: boolean,
  onShowShell: ((terminal: ShownShell) => void) | undefined,
): RunOffer | undefined {
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const openSettings = useOpenSettings();
  const agentId = agent?.id ?? "";
  const place = useRunPlace(agentId);
  const on = useWorkspaceExperiment(place?.workspaceId, EXPERIMENT.RUN_ACTIONS);
  const cloud = agent !== undefined && agent.machine !== AGENT_MACHINE.DEVICE;
  const repository = place?.repository ?? null;
  const asks = on && cloud && repository !== null && place !== undefined;
  const setup = useQuery(sandboxSetupQuery(place?.workspaceId ?? "", asks)).data;

  const actions =
    setup?.runActions?.find(
      (each) => each.repository.toLowerCase() === (repository ?? "").toLowerCase(),
    )?.actions ?? [];

  const offered = asks && actions.length > 0;
  const shells = useQuery(shellsQuery(agentId, shown, offered)).data;

  // ⌥⌘R is the desktop's alone (`APP_SHORTCUTS`), so it is offered, and printed, only where the keymap answers it.
  const desktop =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;

  if (!offered || place === undefined) return undefined;
  const listed = shells !== undefined && "terminals" in shells ? shells : undefined;

  const running = new Set(
    (listed?.terminals ?? []).flatMap((shell) =>
      shell.running && shell.runAction !== undefined ? [shell.runAction] : [],
    ),
  );

  const stopped = listed !== undefined && listed.sandbox !== SANDBOX_STATE.RUNNING;

  const offer = (action: RunAction): OfferedAction => {
    const runs = running.has(action.id);

    const onPress = () => {
      setBusy(true);

      const pressed = runs
        ? stopAction(queries, agentId, action)
        : runAction(queries, agentId, action, stopped, onShowShell);

      void pressed.finally(() => setBusy(false));
    };

    return { action, runs, onPress };
  };

  const [first, ...rest] = actions;

  if (first === undefined) return undefined;

  const listedActions: readonly [OfferedAction, ...OfferedAction[]] = [
    offer(first),
    ...rest.map(offer),
  ];

  return {
    agentId,
    actions: listedActions,
    primary: listedActions.find((each) => each.action.isDefault === true) ?? listedActions[0],
    busy,
    keyed: desktop && shown,
    subject: shortcutSubject(SHORTCUT_SUBJECT.AGENT, agentId),
    onEdit: () => openSettings({ page: SETTINGS_VIEW.ENVIRONMENT, workspaceId: place.workspaceId }),
  };
}

/** An action's words: its name, or Stop and its name while it runs. */
function actionLabel({ action, runs }: OfferedAction): string {
  return runs ? WORDS.STOP(action.label) : action.label;
}

/** An action's glyph, its own icon whether or not it runs, so a reader keeps track of which action a Stop ends. */
function actionGlyph({ action }: OfferedAction): React.JSX.Element {
  return runActionGlyph(action.icon);
}

/** The actions as a menu lists them, the primary printing ⌥⌘R where it acts on the agent, then the way to edit them. */
function runItems(offer: RunOffer): MenuAction[][] {
  const items = offer.actions.map((offered): MenuAction => {
    const item: MenuAction = {
      key: offered.action.id,
      label: actionLabel(offered),
      // While it runs its row says so under "Stop" and its name, rather than its command.
      detail: offered.runs ? WORDS.RUNNING : offered.action.command,
      icon: actionGlyph(offered),
      replayMasked: true,
      onSelect: offered.onPress,
    };

    return offered === offer.primary
      ? { ...item, command: APP_COMMAND.RUN_ACTION, subject: offer.subject }
      : item;
  });

  return [items, [{ label: WORDS.EDIT, icon: <GLYPH.SETTINGS />, onSelect: offer.onEdit }]];
}

/** Run ›, the actions as a phone's ⋯ lists them, where no button stands. */
export function runSubmenu(offer: RunOffer | undefined): MenuSubmenu | undefined {
  if (offer === undefined) return undefined;

  return { label: WORDS.SUBMENU, icon: <GLYPH.RUN_ACTION />, items: runItems(offer).flat() };
}

/** One action as ⌘K lists it: Run or Stop and its name, its command or that it runs, and ⌥⌘R on the primary where the key acts. */
export interface RunPaletteRow {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly icon: React.JSX.Element;
  readonly keyed: boolean;
  readonly onPress: () => void;
}

/** The actions as ⌘K lists them, each worded as the act it is. */
export function runPaletteRows(offer: RunOffer | undefined): readonly RunPaletteRow[] {
  if (offer === undefined) return [];

  return offer.actions.map((offered) => ({
    id: offered.action.id,
    label: offered.runs ? WORDS.STOP(offered.action.label) : WORDS.RUN(offered.action.label),
    detail: offered.runs ? WORDS.RUNNING : offered.action.command,
    icon: actionGlyph(offered),
    keyed: offered === offer.primary && offer.keyed,
    onPress: offered.onPress,
  }));
}

/**
 * The Run button: its main part runs the primary action, or stops it while
 * it runs, and its chevron drops every action under the agent they run in,
 * named by its glyph and name as a mention is; it answers ⌥⌘R on the agent
 * shown in the desktop app. Its words name the agent it acts on.
 */
export function RunActionsButton({
  offer,
  agentGlyph,
  agentName,
}: {
  offer: RunOffer;
  /** The glyph the agent's tab wears, which its menu's heading names it with. */
  agentGlyph: React.JSX.Element;
  /** The agent the button acts on, as its tab names it, which its hint and menu say. */
  agentName: string;
}): React.JSX.Element {
  const menu = useMenu(true);
  const first = offer.primary;
  useShortcutTarget(offer.keyed ? offer.subject : undefined, RUN_KEYS);
  useAppCommand(APP_COMMAND.RUN_ACTION, offer.keyed && !offer.busy ? first.onPress : undefined);
  const said = first.runs ? WORDS.STOP(first.action.label) : WORDS.RUN(first.action.label);

  return (
    <>
      <SplitButton
        icon={first.runs ? <GLYPH.STOP /> : <GLYPH.RUN_ACTION />}
        label={WORDS.IN(said, agentName)}
        hintLabel={WORDS.IN(said, agentName)}
        busy={offer.busy}
        busyLabel={WORDS.STARTING}
        onClick={first.onPress}
        menu={{ label: WORDS.MENU, ...menu.trigger() }}
      >
        {actionLabel(first)}
      </SplitButton>
      {menu.drawn && (
        <ActionMenu
          label={WORDS.MENU}
          heading={
            <Inline gap={GAP.ICON} wrap={false}>
              {WORDS.SUBMENU_IN}
              <InlineRef
                look={INLINE_REF_LOOK.PILL}
                glyph={agentGlyph}
                label={agentName}
                hint={false}
              />
            </Inline>
          }
          menu={menu.drawn}
          groups={runItems(offer)}
          onClose={menu.close}
        />
      )}
    </>
  );
}
