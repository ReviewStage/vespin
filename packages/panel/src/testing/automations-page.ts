/**
 * automations-page.ts -- the window every `automations-page*.test.ts` stands the Automations page in: its fakes, `mount`, and the helpers both of those files read.
 *
 * Importing it registers the `beforeEach` that answers the page's acts and
 * lays its lists from `world`, and the `afterEach` that unmounts what a test
 * drew, as `desktop-inbox.ts` registers its own, so each file of the page's
 * tests meets the same window. What one file alone reads stays in that file,
 * beside the assertions it serves. The service is a script at the act
 * boundary; synthetic automations and words throughout.
 */

import type { AgentSummary, ListedAgent } from "@repo/features/agent-wire";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationCreateParams,
} from "@repo/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
  type AutomationWorkspaceRun,
} from "@repo/features/automation-wire";
import { CHAPTERS_MODEL_DEFAULT } from "@repo/features/chapters-model-choice";
import { readerZone } from "@repo/features/date-mention";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { type AppWorkspaceIntegrations, NO_KEYS_HELD } from "@repo/host/app-state";
import { EXPERIMENT, type Experiment } from "@repo/settings";
import { createMemoryHistory, useRouter } from "@tanstack/react-router";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { Effect } from "effect";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, beforeAll, beforeEach, vi } from "vitest";
import { useAutomationsRoute } from "../automations-route.js";
import { AutomationsPage } from "../desktop/automations-page.js";
import { OpenFeedbackProvider } from "../open-feedback.js";
import { type ShellLeaveAsk, usePlaceLeave } from "../places/place-leave.js";
import { useBoardDoor } from "../places/routed-doors.js";
import { SHELL_ROOM } from "../shell-room.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/automations-place.js";
import { ToastHost } from "../toast.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "./app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "./app-platform.js";
import {
  type HostReadsHanded,
  handHostReads,
  holdAutomations,
  holdIntegrations,
  stateWith,
} from "./app-state.js";
import { composerEditor, editorBundleLanded, installEditorLayout } from "./composer.js";
import { settleQueries, withQueryClient } from "./copy-feedback.js";
import { installScrollIntoView } from "./scroll-into-view.js";
import { tasksControl } from "./tasks-control.js";
import { type TestWindowRouter, windowRouter } from "./window-router.js";

export const WORKSPACE: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

export function automation(n: number, patch: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    id: `3f0e6f5c-7d1a-4f6e-9a55-${String(n).padStart(12, "0")}`,
    planId: null,
    planName: null,
    workspaceId: WORKSPACE.id,
    name: `Automation ${n}`,
    enabled: true,
    pausedReason: null,
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: readerZone() },
    action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage today's issues." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 1,
    repositories: ["acme/ledger"],
    ...patch,
  };
}

export const SWEEP = automation(1, {
  name: "Nightly flaky-test sweep",
  scope: AUTOMATION_SCOPE.WORKSPACE,
});

export const DIGEST = automation(2, {
  name: "Morning digest",
  scope: AUTOMATION_SCOPE.PERSONAL,
  mine: true,
});

export const FAILING = automation(3, {
  name: "Dependency bumps",
  scope: AUTOMATION_SCOPE.WORKSPACE,
  lastRun: {
    id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
    status: AUTOMATION_RUN_STATUS.FAILED,
    reason: "unavailable",
    agent: null,
    firedAt: 2,
    settledAt: 3,
  },
});

/** The models a new agent may run on. */
const CATALOG = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: "anthropic",
    efforts: ["low", "high"],
  },
] as const;

/** The account's default model, which a new agent runs on until another is chosen. */
const DEFAULT_CHOICE = { model: "anthropic/claude-opus-5.5", effort: "high" };

/** The task the workspace's same-agent automation agents stand on, which the window does not list. */
const DIGEST_TASK = "2b4d6f8a-0c1e-4a3b-9d5f-7a9c1e3b5d7f";

/** One agent of the workspace's on the repository, which a same-agent automation's runs may go to. */
export const CI_DIGEST = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: DIGEST_TASK,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "CI digest",
  createdAt: 1,
  status: "completed",
  turnId: null,
} as const;

/** A task of the workspace's the window does not list, which the workspace's agents work on. */
const LEDGER_TASK = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";

/** An agent on a task in the workspace, working in the automations' repository, as the task list carries it. */
export function onLedger(agent: AgentSummary): ListedAgent {
  return { ...agent, planId: LEDGER_TASK, workspaceId: WORKSPACE.id, repository: "acme/ledger" };
}

/** The task list as the host lays it: failed before it carried any agent where the test says so, else carrying the test's agents. */
export function tasksView(): TasksView {
  const read: TasksView = world.remembering
    ? {
        ...IDLE_TASKS_VIEW,
        workspaces: [
          {
            ...WORKSPACE,
            experiments: [
              { experiment: EXPERIMENT.MEMORY, on: true, changedBy: null, changedAt: 1 },
            ],
          },
        ],
      }
    : IDLE_TASKS_VIEW;

  const listed: TasksView = world.agentListRefused
    ? { ...read, listStatus: TASKS_READ.FAILED }
    : {
        ...read,
        listStatus: TASKS_READ.READY,
        taskAgents: world.workspaceAgents,
      };

  return world.workspacesRefused ? { ...listed, workspacesStatus: TASKS_READ.FAILED } : listed;
}

/** Every workspace whose list was read, by a hold or a Try again, in order. */
export function listed(): string[] {
  return host.asked
    .filter((each) => each.kind === AUTOMATION_FOLLOW.WORKSPACE)
    .map((each) => each.id);
}

/**
 * What stands laid again for every list and history a page held, as the
 * host lays a change, a write drawn on a list before it answers among them
 * (`@repo/host`'s `automation-collections.ts`).
 */
export function layStanding(): void {
  host.lay();
}

/** The models as the host holds them: failed while refused, and the catalog otherwise, every model unpaid where the test says so. */
const modelsHeld = () =>
  world.catalogRefused
    ? { failed: true as const }
    : {
        rows: {
          models: CATALOG.map((model) =>
            world.catalogUnconnected ? { ...model, credentialMissing: true } : model,
          ),
        },
      };

/** Lays the models and the account's row as the host holds them for the page about to draw: the row failed while the default is refused. */
function holdChoices(): void {
  world.deliverModels = handHostReads({
    models: modelsHeld(),
    preferences: world.defaultRefused
      ? { failed: true }
      : {
          rows: {
            agent: DEFAULT_CHOICE,
            chaptersModel: CHAPTERS_MODEL_DEFAULT,
            slackNotifications: true,
            sounds: { list: [], choices: { finish: undefined, ask: undefined } },
          },
        },
  }).deliverModels;
}

/** Lays a workspace's integrations as the host's read of them now stands, as it does once the hold is taken and again as an install lands: failed while refused, its Sentry as `sentryRead` says and no Slack bot otherwise. */
export function layIntegrations(workspaceId: string): void {
  const read =
    world.sentryRefusals > 0
      ? { failed: true as const }
      : {
          rows: { sentry: world.sentryRead, slack: { configured: true, channelRepositories: {} } },
        };

  if (world.sentryRefusals > 0) world.sentryRefusals -= 1;
  world.workspaceIntegrations = { ...world.workspaceIntegrations, [workspaceId]: read };
  world.deliverIntegrations(world.workspaceIntegrations);
}

/** The secrets a write answers once: a webhook made, and a new secret asked for. Synthetic. */
export const MADE_SECRET = "whsec-fixture-made-once";
export const ROTATED_SECRET = "whsec-fixture-rotated-once";

/**
 * What the page's fakes answer and record, and the hands a test moves the
 * window by, set again before each test. They are one object's fields rather
 * than bindings of their own, because a test file cannot assign a binding it
 * imports.
 */
class AutomationsWorld {
  /** Whether the workspace stands listed with Memory on, as its admin turned it on. */
  remembering = false;
  root: Root | undefined;
  /** The service's automations, as a read of the list answers them and a change changes them. */
  standing: AutomationSummary[] = [];
  /** How many reads of the list are refused before one answers. */
  listRefusals = 0;
  /** Whether a read of the list is held unanswered, so only the writes' answers draw. */
  listHeld = false;
  /** Whether the page stands over no workspace, so nothing it reads is laid. */
  unlisted = false;
  /** The changes held unanswered, each answered by its resolver, where changes are held at all. */
  heldChanges: (() => void)[] | undefined;
  /** Every change asked, as the act carried it. */
  changes: unknown[] = [];
  /** Every automation made, as the act carried it. */
  creates: AutomationCreateParams[] = [];
  /** Every automation deleted, by its id. */
  deletes: string[] = [];
  /** Every search of a workspace's agents, as the act carried it. */
  agentsAsked: unknown[] = [];
  /** Every agent of the workspace the task list carries, as the host lays it. */
  workspaceAgents: readonly ListedAgent[] = [];
  /** The agents a search for `words` finds, as the service answers it. */
  agentsFound: (words: string) => readonly AgentSummary[] = () => [];
  /** The service's runs of every automation, newest first, as a read of one's runs answers them. */
  runs: AutomationRunSummary[] = [];
  /** Every run of the workspace's automations, as its Runs tab's read holds them. */
  workspaceRuns: AutomationWorkspaceRun[] = [];
  /** Every Run now asked, by the automation it runs. */
  runsAsked: string[] = [];
  /** Whether a read of an automation's runs is held unanswered, as one still out on the wire. */
  runsHeld = false;
  /** Whether a Run now is held unanswered, as one still out on the wire. */
  runHeld = false;
  /** What a Run now answers where it does not start a run. */
  runRefusal: (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE] | undefined;
  /** Every agent whose page a run opened. */
  agentsOpened: string[] = [];
  /** Every agent a run opened on its task, as its task and itself. */
  agentsShown: string[] = [];
  /** Every agent the task list carries, on a task or with none; none while it is not followed. */
  liveAgents: ListedAgent[] | undefined;
  /** Whether the account's default model reads, or answers that it could not. */
  defaultRefused = false;
  /** How many times the model catalog was asked again. */
  catalogReads = 0;
  /** Whether the model catalog answers that it could not be read. */
  catalogRefused = false;
  /** Whether the catalog marks every model as one no credential of the reader's pays for. */
  catalogUnconnected = false;
  /** Whether the task list failed before it carried the workspace's agents. */
  agentListRefused = false;
  /** Whether the read of the workspaces failed, which every read of the task list answers until a test says otherwise. */
  workspacesRefused = false;
  /** How many times the task list, and the workspaces with it, were asked to be read again. */
  tasksRefreshes = 0;
  /** Lays the task list on the window again, as the host does once it reads it. */
  deliverTasks: (next: TasksView) => void = () => undefined;
  /** Lays the models on the window again, as the host does once it asks them again. */
  deliverModels: HostReadsHanded["deliverModels"] = () => undefined;
  /** Whether a search among the workspace's agents answers that it could not be made. */
  agentSearchRefused = false;
  /** Whether the account's tasks were about no repository lately, so a new automation starts with none. */
  noRecent = false;
  /** Whether the read of the account's integrations is held unanswered, as one still out on the wire. */
  integrationsHeld = false;
  /** How many reads of the account's integrations are refused before one answers. */
  integrationsRefusals = 0;
  /** The workspace's Sentry as its read answers it: the deployment holds the integration, installed once, unless a test says otherwise. */
  sentryRead: WorkspaceSentry = {
    configured: true,
    installations: [{ installationId: "a1b2c3d4-0000-4000-8000-000000000001" }],
  };
  /** How many of the host's reads of a workspace's integrations fail before one answers. */
  sentryRefusals = 0;
  /** The workspaces whose integrations the host follows, laid once as the first hold of each is taken. */
  integrationsFollowed = new Set<string>();
  /** Each workspace's integrations the host holds for the window, as last laid. */
  workspaceIntegrations: AppWorkspaceIntegrations = NO_KEYS_HELD;
  /** Lays each workspace's integrations on the window's document, as the host does once the editor holds them. */
  deliverIntegrations: HostReadsHanded["deliverIntegrations"] = () => undefined;
  /** Every workspace a Sentry install was asked for. */
  sentryInstalls: string[] = [];
  /** What a change answers: the automation as changed, or why not. */
  changeRefusal: (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE] | undefined;
  /** What a deletion answers: deleted, or why not. */
  deleteRefusal: (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE] | undefined;
  /** The automations a fresh webhook secret was asked for. */
  secretsAsked: string[] = [];
  /** What the window handed main's clipboard itself. */
  copied: string[] = [];
  /** The experiments a Send feedback was about, in order. */
  feedbackAbout: Experiment[] = [];
  /** The window's router the mounted page stands under, which it is drawn again under. */
  pageRouter: TestWindowRouter | undefined;
  /** The path the window's router stands at. */
  windowPath: () => string = () => "";
  /** Opens the Board as the sidebar's Tasks row would, through the window's guarded door. */
  openBoard: () => void = () => undefined;
  /** Every page the Automations pages stood on, in order, as the window's router moved them. */
  places: AutomationsPlace[] = [];
  /** Whether the window has seen the automation deleted, as its history asks it. */
  deletedNow: (automationId: string) => boolean = () => false;
  /** The ask the window's guard last told the shell of, as a browser tab's ways out hear it; nothing while no page holds unsaved work. */
  shellAsk: ShellLeaveAsk | undefined;
  /** Sends the window to a place among the automations, as a link opened there does. */
  sendTo: (place: AutomationsPlace) => void = () => undefined;
  /** Lists another workspace under the mounted pages, as the switcher would. */
  moveTo: (workspace: Workspace) => void = () => undefined;
}

export const world = new AutomationsWorld();

/** The host's holds on the page's lists and histories, as the test's host answers them. */
let host: ReturnType<typeof holdAutomations>;

// Landed before any page renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  world.secretsAsked = [];
  world.copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(world.copied) });
  world.feedbackAbout = [];
  world.remembering = false;
  world.standing = [DIGEST, SWEEP, FAILING];
  world.listRefusals = 0;
  world.listHeld = false;
  world.unlisted = false;
  world.heldChanges = undefined;
  world.changes = [];
  world.creates = [];
  world.deletes = [];
  world.agentsAsked = [];
  world.workspaceAgents = [onLedger(CI_DIGEST)];
  world.agentsFound = () => [];
  world.runs = [];
  world.workspaceRuns = [];
  world.runsAsked = [];
  world.runsHeld = false;
  world.runHeld = false;
  world.runRefusal = undefined;
  world.agentsOpened = [];
  world.agentsShown = [];
  world.liveAgents = undefined;
  world.defaultRefused = false;
  world.catalogReads = 0;
  world.catalogRefused = false;
  world.catalogUnconnected = false;
  world.workspacesRefused = false;
  world.tasksRefreshes = 0;
  world.agentListRefused = false;
  world.agentSearchRefused = false;
  world.changeRefusal = undefined;
  world.deleteRefusal = undefined;
  world.noRecent = false;
  world.integrationsHeld = false;
  world.integrationsRefusals = 0;
  world.sentryRead = {
    configured: true,
    installations: [{ installationId: "a1b2c3d4-0000-4000-8000-000000000001" }],
  };
  world.sentryInstalls = [];
  world.sentryRefusals = 0;
  world.integrationsFollowed = new Set();
  world.workspaceIntegrations = NO_KEYS_HELD;
  fakeActs({
    // Note that the task list is laid as the page is first drawn, so a test's agents stand once it mounts.
    requestAppState: () => Promise.resolve(stateWith({}, { tasks: tasksView() })),
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.AUTOMATIONS_CHANGE) {
        world.changes.push(request.payload);
        const { automationId, change } = request.payload;
        const was = world.standing.find((each) => each.id === automationId);

        if (world.changeRefusal !== undefined || was === undefined) {
          const failure = world.changeRefusal ?? AUTOMATION_CALL_FAILURE.NOT_FOUND;

          return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { failure } });
        }

        const automation = { ...was, ...change };
        world.standing = world.standing.map((each) =>
          each.id === automationId ? automation : each,
        );
        layStanding();
        const done = { status: FAKE_ANSWER.DONE, value: { automation } } as const;

        if (world.heldChanges === undefined) return Promise.resolve(done);
        const held = world.heldChanges;

        return new Promise((resolve) => held.push(() => resolve(done)));
      }

      if (request.kind === ACT_KIND.AUTOMATIONS_CREATE) {
        world.creates.push(request.payload);

        const { workspaceId, name, trigger, action, scope, repositories, archiveSuccessful } =
          request.payload;

        const hooked = trigger.kind === AUTOMATION_TRIGGER.WEBHOOK;

        const made = automation(42, {
          workspaceId: workspaceId ?? WORKSPACE.id,
          name,
          trigger,
          action,
          scope: scope ?? AUTOMATION_SCOPE.PERSONAL,
          repositories: repositories ?? [],
          archiveSuccessful: archiveSuccessful ?? true,
          ...(hooked
            ? { webhookUrl: "https://vespin.dev/api/automations/made/webhook" }
            : undefined),
        });

        // A webhook's secret is answered once, by the write that minted it.
        const value = hooked
          ? { automation: made, webhookSecret: MADE_SECRET }
          : { automation: made };

        world.standing = [made, ...world.standing];
        layStanding();

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }

      if (request.kind === ACT_KIND.AUTOMATIONS_RUN) {
        world.runsAsked.push(request.payload.automationId);

        if (world.runHeld) return new Promise(() => undefined);

        if (world.runRefusal !== undefined) {
          return Promise.resolve({
            status: FAKE_ANSWER.DONE,
            value: { failure: world.runRefusal },
          });
        }

        const made = {
          id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4b5",
          firing: { kind: "manual" },
          status: AUTOMATION_RUN_STATUS.STARTED,
          reason: null,
          agent: { id: CI_DIGEST.id, title: null, status: "starting" },
          firedAt: 5,
          settledAt: 5,
        } as const;

        world.runs = [made, ...world.runs];

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { run: made } });
      }

      if (request.kind === ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET) {
        world.secretsAsked.push(request.payload.automationId);
        const automation = world.standing.find((each) => each.id === request.payload.automationId);

        const value =
          automation === undefined
            ? { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND }
            : { automation, webhookSecret: ROTATED_SECRET };

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }

      // Note that the host follows a workspace's integrations once however many surfaces hold them, and lays what it read once the hold is taken.
      if (request.kind === ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW) {
        const { workspaceId } = request.payload;

        if (!world.integrationsFollowed.has(workspaceId)) {
          world.integrationsFollowed.add(workspaceId);
          void Promise.resolve().then(() => layIntegrations(workspaceId));
        }

        return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
      }

      if (request.kind === ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY) {
        layIntegrations(request.payload.workspaceId);

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }

      if (request.kind === ACT_KIND.WORKSPACE_SENTRY_INSTALL) {
        world.sentryInstalls.push(request.payload.workspaceId);

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }

      if (request.kind === ACT_KIND.AUTOMATIONS_DELETE) {
        if (world.deleteRefusal !== undefined) {
          return Promise.resolve({
            status: FAKE_ANSWER.DONE,
            value: { failure: world.deleteRefusal },
          });
        }

        world.deletes.push(request.payload.automationId);
        world.standing = world.standing.filter((each) => each.id !== request.payload.automationId);
        layStanding();

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { deleted: true } });
      }

      if (request.kind === ACT_KIND.AGENTS_MODELS_RETRY) {
        world.catalogReads += 1;
        world.deliverModels(modelsHeld());

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }

      if (request.kind === ACT_KIND.AGENTS_WORKSPACE_LIST) {
        world.agentsAsked.push(request.payload);

        if (world.agentSearchRefused) {
          return Promise.resolve({
            status: FAKE_ANSWER.DONE,
            value: { failure: AUTOMATION_CALL_FAILURE.UNANSWERED },
          });
        }

        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { agents: world.agentsFound(request.payload.words ?? "") },
        });
      }

      if (request.kind === ACT_KIND.TASKS_REFRESH) {
        world.tasksRefreshes += 1;
        world.agentListRefused = false;
        world.deliverTasks(tasksView());

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }

      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
  // Note that each list and history a page holds is laid on its document as the host lays it.
  const reads = handHostReads({});
  world.deliverIntegrations = reads.deliverIntegrations;
  world.deliverTasks = reads.deliverTasks;
  host = holdAutomations(reads.deliverAutomations, {
    [AUTOMATION_FOLLOW.WORKSPACE]: (workspaceId) => {
      if (world.listHeld) return undefined;

      if (world.listRefusals > 0) {
        world.listRefusals -= 1;

        return { failed: true };
      }

      return { rows: world.standing.filter((each) => each.workspaceId === workspaceId) };
    },
    [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: () => ({ rows: world.workspaceRuns }),
    [AUTOMATION_FOLLOW.RUNS]: () => (world.runsHeld ? undefined : { rows: world.runs }),
  });
  // Note that the account's integrations are laid as the host holds them: none while held, failed while refused, and Linear and Sentry connected otherwise.
  holdIntegrations(() => {
    if (world.integrationsHeld) return undefined;

    if (world.integrationsRefusals > 0) {
      world.integrationsRefusals -= 1;

      return { failed: true };
    }

    const integrations = Object.fromEntries(
      INTEGRATION_PROVIDER_LIST.map((provider) => [
        provider,
        provider === INTEGRATION_PROVIDER.LINEAR || provider === INTEGRATION_PROVIDER.SENTRY
          ? INTEGRATION_STATUS.CONNECTED
          : INTEGRATION_STATUS.DISCONNECTED,
      ]),
    );

    // SAFETY: every provider on the list is given a status above, which is the whole of the record.
    return {
      rows: { integrations: integrations as Record<IntegrationProvider, IntegrationStatus> },
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => world.root?.unmount());
  world.root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** The page as drawn over the tasks control given, under the mounted page's router, rendered again in place where one stands. */
export function render(tasks: ReturnType<typeof tasksControl>): void {
  const router = world.pageRouter ?? assert.fail("a page is mounted");
  act(() =>
    world.root?.render(
      withQueryClient(
        router.provide(
          createElement(
            Fragment,
            null,
            createElement(AutomationsPage, { tasks, room: SHELL_ROOM.WIDE }),
            createElement(ToastHost),
          ),
        ),
      ),
    ),
  );
}

/** The window's router standing at `place`'s address. */
export function routerAt(place: AutomationsPlace): TestWindowRouter {
  return windowRouter(createMemoryHistory({ initialEntries: [automationsAddress(place)] }));
}

/** The Automations page standing on `at`, the list unless said, in the task's place over the workspace listed. */
export function mount(
  tasks = tasksControl({ workspace: WORKSPACE }),
  at: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST },
): HTMLElement {
  holdChoices();
  world.unlisted = tasks.workspace === undefined;
  const container = document.createElement("div");
  document.body.append(container);
  world.root = createRoot(container);
  world.pageRouter = routerAt(at);
  render(tasks);

  return container;
}

/** Lets every promise settled so far run its continuations, and every notification TanStack Query queued reach what it draws. */
export async function settle(): Promise<void> {
  const ticks = () =>
    act(async () => {
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });

  await ticks();
  await settleQueries(ticks);

  // Note that the list and the runs the host lays reach their queries a tick after they land, so the page is read once neither still stands out, bar one the test holds or a page over no workspace reads; a list held out holds the runs out too, since the page's skeleton reads them until the list lands.
  if (world.listHeld || world.unlisted) return;
  await vi.waitFor(() => {
    const text = document.body.textContent ?? "";
    assert.strictEqual(
      text.includes("Reading your automations") ||
        text.includes("Reading the automation") ||
        (!world.runsHeld &&
          (text.includes("Reading the runs") || text.includes("Reading its runs"))),
      false,
    );
  });
}

/** The automations' rows, top to bottom. */
export function automationRows(page: HTMLElement): Element[] {
  return [...page.querySelectorAll(".automation-group li")];
}

/** The row of the automation named. */
export function rowOf(page: HTMLElement, name: string): Element {
  const row = automationRows(page).find(
    (each) => each.querySelector(".automation-row-name")?.textContent === name,
  );

  assert.ok(row, `no row for ${name}`);

  return row;
}

/** The workspace the account made first, its personal one, where everything is its own. */
export const PERSONAL: Workspace = { ...WORKSPACE, id: "workspace-personal", name: "Ada" };

/** The address `place` stands at under the workspace, named by its id as it has no slug, as the Automations route writes it. */
function automationsAddress(place: AutomationsPlace): string {
  const under = `/${WORKSPACE.id}`;

  switch (place.kind) {
    case AUTOMATIONS_PAGE.LIST:
      return `${under}/automations`;
    case AUTOMATIONS_PAGE.RUNS:
      return `${under}/automations/runs`;
    case AUTOMATIONS_PAGE.NEW:
      return `${under}/automations/new`;
    case AUTOMATIONS_PAGE.EDIT:
      return place.runId === undefined
        ? `${under}/automation/${place.automationId}`
        : `${under}/automation/${place.automationId}/run/${place.runId}`;
  }
}

/** The page an address under the workspace stands, as `automationsAddress` writes it; none for one standing no Automations page. */
function placeOfAddress(path: string): AutomationsPlace | undefined {
  const [, , head, id, tail, runId] = path.split("/");

  if (head === "automations") {
    if (id === undefined) return { kind: AUTOMATIONS_PAGE.LIST };

    if (id === "runs") return { kind: AUTOMATIONS_PAGE.RUNS };

    return id === "new" ? { kind: AUTOMATIONS_PAGE.NEW } : undefined;
  }

  if (head !== "automation" || id === undefined) return undefined;

  return tail === "run" && runId !== undefined
    ? { kind: AUTOMATIONS_PAGE.EDIT, automationId: id, runId }
    : { kind: AUTOMATIONS_PAGE.EDIT, automationId: id };
}

/**
 * The Automations pages as the window holds them, standing on `start` and
 * moved by their own presses, over the workspace listed, the personal one
 * first among the account's.
 */
export function mountPages(start: AutomationsPlace, workspace: Workspace = WORKSPACE): HTMLElement {
  holdChoices();
  world.unlisted = false;
  world.places = [start];
  world.shellAsk = undefined;
  const pagesRouter = routerAt(start);
  // Each page the router moves to is recorded as it lands, as the window stands it.
  pagesRouter.history.subscribe(({ location }) => {
    const landed = placeOfAddress(location.pathname);

    if (landed !== undefined) world.places.push(landed);
  });
  world.sendTo = (place) => pagesRouter.history.push(automationsAddress(place));

  function Pages() {
    world.deletedNow = useAutomationsRoute({ narrow: false }).deletedNow;
    const [listed, setListed] = useState(workspace);
    world.moveTo = setListed;

    // The window's own guard, over doors that move the window first as the Plans tab's own do: each is the router's
    // move, which asks as it goes while the page holds unsaved work, and what it opens is recorded once it lands.
    const placeLeave = usePlaceLeave((ask) => {
      world.shellAsk = ask;
    });

    const router = useRouter();

    const arriveAt = (href: string, landed: () => void) =>
      placeLeave.arrive(() => void router.navigate({ href }), landed);

    const tasks = tasksControl({
      placeLeave,
      agentView: {
        agentId: undefined,
        onOpen: (agentId: string) =>
          arriveAt(`/${WORKSPACE.slug}/agent/${agentId}`, () => world.agentsOpened.push(agentId)),
        onClose: () => undefined,
      },
      liveAgents: world.liveAgents,
      onShowAgent: (taskId: string, agentId: string) =>
        world.agentsShown.push(`${taskId} ${agentId}`),
      workspace: listed,
      workspaces: [PERSONAL, WORKSPACE],
    });

    const base = tasks.newTask;
    const board = useBoardDoor(tasks);
    world.windowPath = () => router.history.location.pathname;
    world.openBoard = board.open;

    return createElement(AutomationsPage, {
      tasks: {
        ...tasks,
        newTask: {
          ...base,
          repositoriesIn: () => ({
            ...base.repositoriesIn(listed.id),
            scope: listed.id,
            recent: world.noRecent
              ? []
              : listed.id === WORKSPACE.id
                ? ["acme/ledger", "acme/web"]
                : ["beta/app"],
          }),
        },
      },
      room: SHELL_ROOM.WIDE,
    });
  }

  const container = document.createElement("div");
  document.body.append(container);
  world.root = createRoot(container);
  act(() =>
    world.root?.render(
      pagesRouter.provide(
        withQueryClient(
          createElement(
            OpenFeedbackProvider,
            { value: (about: Experiment) => world.feedbackAbout.push(about) },
            createElement(Fragment, null, createElement(Pages), createElement(ToastHost)),
          ),
        ),
      ),
    ),
  );

  return container;
}

export function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );

  assert.ok(found, `no button ${name}`);

  return found;
}

/** The item of the menu standing open whose words are `name`. */
export function menuItem(name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"]:not([data-leaving]) [role="menuitem"]',
    ),
  ].find((each) => each.textContent === name);

  assert.ok(found, `no menu item ${name}`);

  return found;
}

/** The prompt's editor, the composer's field the prompt is written in. */
export function promptEditor(page: HTMLElement): TiptapEditorHTMLElement {
  return composerEditor(page.querySelector(".automation-prompt") ?? assert.fail("no prompt"));
}

/** Writes the prompt's words whole over what it held, as typing over all of it selected does. */
export function writePrompt(page: HTMLElement, words: string): void {
  const { editor } = promptEditor(page);
  assert.ok(editor, "the prompt's editor is running");
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(words, 1, editor.state.doc.content.size - 1));
  });
}

/** Types into a field as a developer would, so React hears the change. */
export function type(field: HTMLInputElement | null, value: string): void {
  assert.ok(field, "the field is drawn");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The picker named, by its chip's own name: "Event: Issue opened". */
export function picker(page: HTMLElement, label: string): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>(`button[aria-label^="${label}: "]`);
  assert.ok(found, `no picker ${label}`);

  return found;
}

/** What the picker named says it holds now. */
export function picked(page: HTMLElement, label: string): string | undefined {
  return picker(page, label)
    .getAttribute("aria-label")
    ?.slice(label.length + 2);
}

/** What the row of the picker named says under its name: the trigger's sentence under Type. */
export function pickerDetail(page: HTMLElement, label: string): string | undefined {
  const id = picker(page, label).getAttribute("aria-describedby");

  return id === null ? undefined : (document.getElementById(id)?.textContent ?? undefined);
}

/** Whether `words` stand in an error line, which the window's announcer says as they arrive. */
export function announced(words: string): boolean {
  return [...document.querySelectorAll("[data-slot=field-error]")].some(
    (region) => region.textContent === words,
  );
}

/** What describes the picker named, each part on its own: its row's why, then its row's error. */
export function pickerDescription(page: HTMLElement, label: string): (string | undefined)[] {
  const ids = picker(page, label).getAttribute("aria-describedby")?.split(" ") ?? [];

  return ids.map((id) => document.getElementById(id)?.textContent ?? undefined);
}

/** Picks an option as a developer would: the picker's chip, then the menu's row of that name. */
export function pick(page: HTMLElement, label: string, option: string): void {
  act(() => picker(page, label).click());

  const row = [...document.querySelectorAll<HTMLButtonElement>("[role=option]")].find(
    (each) => each.querySelector(".ui-combobox-option-label")?.textContent === option,
  );

  assert.ok(row, `no ${option} in ${label}`);
  act(() => row.click());
}
