/**
 * failure-investigation.ts -- Investigate on a failure the panel shows: offered where the chosen workspace reaches the product's own repository, and pressed, a task there with an agent handed the failure to find its cause and fix it.
 *
 * Every failure the panel reports as unexpected offers its details to copy
 * (`failure-report.ts`); the same ones offer Investigate beside them, but
 * only to a reader whose chosen workspace's GitHub reaches
 * `INVESTIGATION_REPOSITORY`, which only the team that works on the app can
 * connect, so no one else ever sees it. Whether it is offered is asked each
 * time the failure is said shown, since the chosen workspace may change.
 *
 * A press starts a task in that repository with an agent on it at once
 * (`TASKS_START`), quietly, so the window stays where the failure was, under
 * one key for the failure however often it is pressed, so a second press
 * answers the agent the first started; a toast says it is under way, then
 * that it started, with Open, which opens the agent. What the agent is handed
 * is `@repo/features/failure-investigation`'s: the failure's copied details,
 * its stack, the run, and the route open as it was shown (`holdWindowRouter`),
 * and nothing a person wrote.
 */

import {
  failureInvestigation,
  INVESTIGATION_OWNER,
  INVESTIGATION_REPOSITORY,
  type InvestigatedRoute,
} from "@repo/features/failure-investigation";
import { FAILURE_SURFACE, type ShownFailureReport } from "@repo/features/shown-failure";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { STATUS_TONE } from "@repo/ui";
import type { FailureInvestigate } from "@repo/ui/reported-failure";
import { startFailureNote } from "@repo/ui/tasks-model";
import type { QueryClient } from "@tanstack/react-query";
import { askAct } from "./act.js";
import { keptChoiceNow } from "./desktop/chosen-workspace.js";
import type { PanelRouter } from "./panel-router.js";
import { showWorkingToast, TOAST_HOLD } from "./toast.js";
import { appStateIn, selectListedTasks } from "./use-app-state.js";

/** What the toasts of an investigation say. */
const WORDS = {
  STARTING: "Starting an investigation…",
  STARTED: "Investigation started",
  REFUSED: "The investigation could not be started.",
  OPEN: "Open",
} as const;

/** The window's router, held while its root draws it: the route a failure was shown on, and the way to the agent an investigation started. */
let windowRouter: PanelRouter | undefined;

/**
 * Holds `router` as the window's while its root draws it, and answers what
 * lets it go. Note that it is a door of its own, as the reporter is
 * (`installShownFailureReporter`), because a failure is shown from callers
 * that hold no router to hand in.
 */
export function holdWindowRouter(router: PanelRouter): () => void {
  windowRouter = router;
  return () => {
    if (windowRouter === router) windowRouter = undefined;
  };
}

/** The route open now, by its pattern; nothing where no router is held or none matched. */
function openRoute(): InvestigatedRoute | undefined {
  const matched = windowRouter?.state.matches.at(-1);
  return matched === undefined ? undefined : { pattern: matched.fullPath };
}

/** Whether `workspace`'s GitHub reaches the product's own repository: an active installation on its owner. */
function reachesOwnRepository(workspace: Workspace): boolean {
  const installations =
    workspace.githubInstallations ?? (workspace.github === null ? [] : [workspace.github]);
  const owner = INVESTIGATION_OWNER.toLowerCase();
  return installations.some((each) => each.active && each.login.toLowerCase() === owner);
}

/** The chosen workspace, where its GitHub reaches the product's own repository; nothing otherwise. */
function investigatingWorkspace(state: AppStateSnapshot): Workspace | undefined {
  const chosen = keptChoiceNow(selectListedTasks(state).workspaces);
  return chosen !== undefined && reachesOwnRepository(chosen) ? chosen : undefined;
}

/** The document `client` holds and the workspace it investigates in, where one reaches the product's own repository. */
function investigatingIn(
  client: QueryClient,
): { readonly state: AppStateSnapshot; readonly workspace: Workspace } | undefined {
  const state = appStateIn(client);
  const workspace = state === undefined ? undefined : investigatingWorkspace(state);
  return state === undefined || workspace === undefined ? undefined : { state, workspace };
}

/** Opens the agent an investigation started, in `workspace`. */
function openAgent(workspace: Workspace, agentId: string): void {
  void windowRouter?.navigate({
    to: "/$workspace/agent/$agentId",
    params: { workspace: workspace.slug ?? workspace.id, agentId },
  });
}

/**
 * Starts the task and agent investigating `report` in `workspace`, under
 * `key`, and says what came of it in a toast that turns as it answers.
 */
async function investigate(
  report: ShownFailureReport,
  details: string,
  state: AppStateSnapshot,
  workspace: Workspace,
  key: string,
): Promise<void> {
  const { run } = state;
  const { name, prompt } = failureInvestigation(report, {
    details,
    platform: run.platform,
    version: run.appVersion,
    build: run.commit,
    packaged: run.packaged,
    route: openRoute(),
  });
  const settle = showWorkingToast(WORDS.STARTING);
  const refused = (cause: unknown, words: string = WORDS.REFUSED) =>
    settle({
      words,
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: { surface: FAILURE_SURFACE.TASK_START, cause, about: { workspaceId: workspace.id } },
    });
  try {
    const answer = await askAct(ACT_KIND.TASKS_START, {
      name,
      workspaceId: workspace.id,
      repository: INVESTIGATION_REPOSITORY,
      planning: false,
      quiet: true,
      agent: { idempotencyKey: key, prompt },
    });
    if ("failure" in answer) return refused(answer, startFailureNote(answer.failure));
    const started = answer.agentStart;
    if (started === undefined || "failure" in started) return refused(started ?? answer);
    const agentId = started.agent.id;
    settle({
      words: WORDS.STARTED,
      tone: STATUS_TONE.COMPLETE,
      replayUnmasked: true,
      action: {
        label: WORDS.OPEN,
        onPress: () => openAgent(workspace, agentId),
        replayUnmasked: true,
      },
    });
  } catch (error) {
    refused(error);
  }
}

/**
 * Investigate's offer on a failure reported as `report`, whose copied
 * details are `details`, asked of the document `client` holds as it is said
 * shown: its press where the chosen workspace reaches the product's own
 * repository, and nothing otherwise. Every press of every offer on the same
 * failure carries one key, so the service answers the agent the first
 * started rather than a second.
 */
export function investigationOffer(
  report: ShownFailureReport,
  details: string,
  client: QueryClient,
): () => FailureInvestigate | undefined {
  const key = crypto.randomUUID();
  return () => {
    if (investigatingIn(client) === undefined) return undefined;
    // Note that the press reads the document again, since the chosen workspace may have changed while the failure stood.
    return () => {
      const pressed = investigatingIn(client);
      if (pressed === undefined) return;
      void investigate(report, details, pressed.state, pressed.workspace, key);
    };
  };
}
