/**
 * use-new-task.ts -- New task's flow: its dialog, Home's own composer's asks, a start and the page it draws while under way, and a group's quick add.
 *
 * The flow owns its state and its starts, and reads the workspaces, the
 * account, the run, and Settings' Open a task once it starts from app state;
 * where the window stands, and the agents and tabs a start opens on, it takes
 * from `useTasksTab` as one bundle of doors (`NewTaskDoors`). A group's quick
 * add needs none of that, so a surface calls `useQuickAddStart` itself.
 */

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { localAgentRefusalWords } from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@repo/features/agent-view";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import type { DescriptionMention } from "@repo/features/mention-link";
import type { CatalogModel, MacOffer, ModelChoice } from "@repo/features/models-wire";
import { SENTRY_SEND_SPAN } from "@repo/features/sentry-tracing";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type {
  TaskCreateRelation,
  TaskCreateRelationKind,
  TaskRunsOnRequest,
  TaskStanding,
  TaskSummary,
} from "@repo/features/task-wire";
import { startFailureNote } from "@repo/features/tasks-model";
import { TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { APP_SETTING_DEFAULTS } from "@repo/settings";
import { STATUS_TONE } from "@repo/ui";
import { agentTab, draftTab } from "@repo/ui/tab-strip-model";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { sendMutation } from "../act-mutations.js";
import { useSteadyDoor } from "../steady-door.js";
import { useToast } from "../toast.js";
import {
  appStateQuery,
  selectAppSettingsView,
  selectFixtureStaged,
  selectListedTasks,
} from "../use-app-state.js";
import {
  startFailureNote as agentStartFailureNote,
  choiceRequest,
  openingLineOf,
  type SentLine,
} from "./agent-model.js";
import type { NewTaskPress } from "./new-task-composer.js";
import { NEW_TASK_PURPOSE, type NewTaskPurpose } from "./new-task-purpose.js";
import type { NewTaskRelation } from "./new-task-relation.js";
import type { RepositoryChooser } from "./repository-chip.js";
import { useRepositoriesIn } from "./task-repository-menus.js";
import type { ComposerNote } from "./use-agent-composer.js";
import type { AgentsControl, ModelsRead } from "./use-agents.js";
import type { MainTab } from "./use-main-tabs.js";

/** What the toast says once New task started a task it did not open. */
const TASK_STARTED_NOTE = "Task started";

/** What it says instead where the task started but its agent was refused. */
const TASK_STARTED_AGENT_REFUSED_NOTE = "Task started, but its agent did not";

/** That toast's action, which opens the task. */
const OPEN_STARTED_TASK = "Open";

/** What New task stands as a page of its own: an agent's start under way, or a start Home's own composer refused. */
const NEW_TASK_PAGE = {
  STARTING: "starting",
  HOME_REFUSED: "home-refused",
} as const;

/** Whether a task New task starts opens, as Settings › Profile › Tasks says; until the first document arrives it does. */
const selectOpensNewTask = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.openNewTask ?? APP_SETTING_DEFAULTS.openNewTask;

/** Whether a task may be started: an account signed in, or a fixture's tasks standing in for one. */
const selectMayStart = (state: AppStateSnapshot): boolean =>
  selectFixtureStaged(state) || state.account.status === ACCOUNT_STATUS.SIGNED_IN;

/** The workspaces the window lists, a fixture's standing in for the account's. */
const selectListedWorkspaces = (state: AppStateSnapshot): readonly Workspace[] =>
  selectListedTasks(state).workspaces;

/** No workspaces, the same array every render, before the first document arrives. */
const NO_WORKSPACES: readonly Workspace[] = [];

/**
 * The coding agent New task's Agent mode starts on the task it started:
 * the key its start carries, which the card keeps for a press asking the
 * same again (`new-task-composer.tsx`), its prompt, the files attached,
 * the model picked on its chip, none where the chip was left on the
 * account's default, so the service runs the default it holds at the start,
 * and the MCP servers its + menu switched off, none by default.
 */
export interface NewTaskAgent {
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  /** The repositories the agent works in beside the task's, `owner/name`, which the card's repository chip picks after the task's own; none where left out. */
  readonly alsoRepositories?: readonly string[] | undefined;
}

/** The agent a task's start starts on it, as the act carries it: the card's key, the prompt, the files where any, the chip's model where one was picked, the servers switched off where any, and the repositories beside the task's where any. */
function agentRequest(handed: NewTaskAgent) {
  const also = handed.alsoRepositories ?? [];
  return {
    idempotencyKey: handed.idempotencyKey,
    prompt: handed.prompt,
    ...(handed.attachments.length === 0 ? undefined : { attachments: handed.attachments }),
    ...(handed.choice === undefined ? undefined : choiceRequest(handed.choice)),
    ...(handed.disabledServers.length === 0
      ? undefined
      : { disabledServers: handed.disabledServers }),
    ...(also.length === 0
      ? undefined
      : { alsoRepositories: also.map((repository) => ({ repository })) }),
  };
}

/** Where a group's quick add puts the task it adds: the group's status, priority, or assignee, its repository, or the task it adds a sub-task of. */
export interface QuickAddInto {
  readonly standing?: TaskStanding;
  readonly repository?: string;
  readonly parentTaskId?: string;
}

/** What a quick add asks of where its task stands: a status, a priority, or an assignee, as given; no one assigned is where a task starts, so it is asked nothing. */
function startingStanding(standing: TaskStanding | undefined) {
  if (standing === undefined) return undefined;
  const { assigneeId, ...rest } = standing;
  return assigneeId === undefined || assigneeId === null ? rest : { ...rest, assigneeId };
}

/** What the press that opened New task chose: a repository (a repository group's +), the card's purpose (the Automations page's Create with an agent), the relation it starts its task in (a relation's New task, or New sub-task), or the card a start refused after it closed opens again on. */
export interface NewTaskPreset {
  readonly repository?: string;
  /** The relation the card starts its task in, from the new task's side; none for a task related to none. */
  readonly relation?: NewTaskRelation;
  /** What the card starts; a task's agent where none is named. */
  readonly purpose?: NewTaskPurpose;
  /** The card as it pressed Start, and why the start was refused, where the card is opened again on a refusal. */
  readonly refused?: NewTaskRefusal;
}

/** The card as it pressed Start, and why the start was refused, which the card opens again on. */
export interface NewTaskRefusal {
  readonly card: NewTaskCardKept;
  readonly note: Failure;
}

/** A start pressed on Home's own composer and refused, which that composer opens again on: each refusal a new opening, so the composer draws it afresh. */
interface HomeRefusal {
  readonly opening: number;
  readonly refused: NewTaskRefusal;
}

/**
 * What New task's card held as it pressed Start, which it hands its start
 * so a card opened again on a refusal starts where it was left: the
 * repository, the model picked on its chip, none where it was left on the
 * account's default, and the press it made, whose key a Retry asking the
 * same carries again.
 */
interface NewTaskCardKept {
  /** What the card started, which it opens again for; a task's agent where none is named. */
  readonly purpose?: NewTaskPurpose;
  /** The relations the card started its task in, which it opens again on. */
  readonly relations: readonly NewTaskRelation[];
  readonly repository: string | null;
  readonly choice: ModelChoice | undefined;
  readonly press: NewTaskPress;
  /** The words as the box held them, which the card opens again on. */
  readonly words: string;
}

/**
 * New task's agent start under way: the line its agent opens on, and the
 * model it was started with, which the page draws while it waits. It names
 * no task, since the task stands Untitled until its agent names it.
 */
export interface StartingTask {
  readonly line: SentLine;
  /** The model the card's chip picked; none where the start takes the default. */
  readonly choice: ModelChoice | undefined;
}

/** A start Home's own composer refused, with the arrivals counted as it was refused, past which it gives way. */
interface HomeRefusedPage {
  readonly kind: typeof NEW_TASK_PAGE.HOME_REFUSED;
  readonly refused: NewTaskRefusal;
  readonly arrivals: number;
}

/**
 * New task's own page, standing until the developer arrives anywhere past
 * the arrivals it counts: an agent's start under way, with the arrivals
 * counted once the window stood where it was pressed into, or Home's
 * refused start. A start keeps the refusal it stood over (`over`), as the
 * window stands Home again on it where the start is let go with the
 * developer gone nowhere since. The dialog is no page: it stands over
 * either.
 */
type NewTaskPage =
  | (StartingTask & {
      readonly kind: typeof NEW_TASK_PAGE.STARTING;
      readonly arrivals: number;
      readonly over: HomeRefusedPage | undefined;
    })
  | HomeRefusedPage;

/** The refusal Home's composer stands on under `page`, if any. */
function homeRefusedUnder(page: NewTaskPage | undefined): HomeRefusedPage | undefined {
  return page?.kind === NEW_TASK_PAGE.STARTING ? page.over : page;
}

/**
 * What a start comes from beyond its name, repository, and workspace: where
 * its agent runs, and the agent New task's composer starts on its words in
 * the task's own start (`handed`).
 */
export interface NewTaskStart {
  /**
   * Where the card's Runs on chose: the cloud, or one of the member's
   * devices. A task holds no place, so it is where the handed agent runs,
   * and, with none handed, the member's last pick.
   */
  readonly runsOn?: TaskRunsOnRequest;
  /** The device Runs on chose, which a refusal names; none for the cloud. */
  readonly device?: MacOffer;
  /** The relations the start makes its task in, from the new task's side, written with it in one transaction; none for a task related to none. */
  readonly relations?: readonly TaskCreateRelation[];
  readonly handed?: NewTaskAgent;
  /** What the card held as it pressed Start, which it opens again on where an agent's start is refused after the card closed. */
  readonly card?: NewTaskCardKept;
}

/** Adds a task named `name` to a Tasks page group with no agent, opening nothing; answers why it was not added, or nothing once the list carries it. */
export type QuickAddStart = (name: string, into: QuickAddInto) => Promise<Failure | undefined>;

/** New task as the window draws and presses it: the presses that open it, the dialog, Home's own composer's asks, and a start under way. */
export interface NewTask {
  /**
   * New task's agent start under way, which the window draws on a task's
   * page in its shape until the start answers (`StartingAgentTab`); none
   * otherwise, or once the developer went to another task or page meanwhile.
   */
  starting: StartingTask | undefined;
  /** Opens the New task dialog over whatever stands open, which it leaves standing; on Home, hands Home's own composer the caret instead (`homeAsks`). */
  onOpen: () => void;
  /** New task with a repository already chosen in the dialog: what a repository group's + asks. */
  onOpenIn: (repository: string) => void;
  /** New task related to the task given as `kind`, read from the new task's side, in that task's workspace: what the add menu's New task, and the task's menu and ⌘K's New sub-task, ask. */
  onOpenRelated: (taskId: string, kind: TaskCreateRelationKind) => void;
  /** New task's card for the agent that makes an automation: what the Automations page's Create with an agent asks. */
  onOpenForAutomation: () => void;
  /** Whether the dialog stands. */
  open: boolean;
  /** What the press that opened the dialog chose: a repository, where it chose one. */
  preset: NewTaskPreset | undefined;
  /** How many times New task was pressed on Home, whose composer takes the caret at each press rather than a dialog opening over it. */
  homeAsks: number;
  /** A start pressed on Home's own composer and refused while Home stood, which that composer opens again on rather than a dialog over it; none once the developer went elsewhere. */
  homeRefused: HomeRefusal | undefined;
  /** The workspaces a task may start in, the account's every one. */
  workspaces: readonly Workspace[];
  /** The workspace the dialog starts the task in until another is chosen: the one listed; none before the workspaces are read. */
  workspaceId: string | undefined;
  /** The repository chip's list for a workspace, as the dialog chooses which the task starts in. */
  repositoriesIn: (workspaceId: string | undefined) => RepositoryChooser;
  /**
   * Starts the task on the repository given, or none, in the workspace
   * given, with an empty description and no call,
   * which closes the dialog and opens the task; with an agent handed over it opens the
   * task on a draft agent's tab holding the agent's prompt, files, and
   * model, which starts the agent at once; answers why the task did not
   * start, with the press that mends it where there is one, or nothing
   * once it has.
   */
  start: (
    name: string,
    repository: string | null,
    workspaceId: string | undefined,
    from?: NewTaskStart,
  ) => Promise<Failure | undefined>;
  /** The models the composer's chip offers, as last read; nothing before the first read lands. */
  models: readonly CatalogModel[] | undefined;
  /** The member's devices Runs on offers, as the same read last listed them: none listed where it offered none, and nothing before a read lands. */
  devices: readonly MacOffer[] | undefined;
  /** Whether the last read of the models did not land. */
  modelsFailed: boolean;
  /** Where the newest read of the models stands, at the generation it took, so the card can wait on a read made since it opened. */
  modelsRead: ModelsRead;
  /** Asks the host for the models again, as the card opening and the chip's Retry ask. */
  readModels: () => void;
  /** Puts the dialog away with nothing started. */
  onClose: () => void;
  /** The tasks the window lists, archived ones among them, which name the agents an `@` in the composer offers and New task's Task relation offers its workspace's of. */
  tasks: readonly TaskSummary[];
  /** Opens a task or a section a mention in the composer names, as the window's own opener does. */
  onShowMention: (mention: DescriptionMention) => void;
}

/**
 * Where the window stands, and the moves a start makes there, each read as
 * the window stands at the call.
 */
interface NewTaskPlaceDoors {
  /** Whether Home's own route stands with no task bound, the one place that draws Home's composer. */
  readonly atHome: () => boolean;
  /** How many times the developer arrived on another page of the window. */
  readonly arrivals: () => number;
  /** Keeps what stood where New task was pressed, `moved` saying whether the press moved the window itself, and answers the door that stands it again where the developer went nowhere since. */
  readonly keepPressedOver: (moved: boolean) => () => void;
  /** Stands the start's page: the bound task's own place, or Home, as a step the task it starts takes in place; answers whether the window moved. */
  readonly standStartPage: () => boolean;
  /** Stands the bound task's own place, or Home where none is bound. */
  readonly standBound: () => void;
  /** Opens a started task as the toast's Open opens it, asking first while a page stands unsaved work. */
  readonly openStarted: (taskId: string) => void;
  /** Opens a task or a section a mention in the composer names. */
  readonly showMention: (mention: DescriptionMention) => void;
}

/** What New task takes from the Tasks tab: whether it is shown, what it lists, where the window stands, the agents a start opens on, and the tab it shows. */
export interface NewTaskDoors {
  /** Whether the tab is on screen, the dialog put away once it is not. */
  readonly shown: boolean;
  /** The workspace the window lists, which New task starts in until another is chosen. */
  readonly workspaceId: string | undefined;
  /** The tasks the window lists, in the sidebar's order. */
  readonly tasks: readonly TaskSummary[];
  /** The task New task relates a new one to, as the window holds it; none where it holds none. */
  readonly taskOf: (taskId: string) => TaskSummary | undefined;
  readonly place: NewTaskPlaceDoors;
  readonly agents: Pick<
    AgentsControl,
    | "onTaskStarted"
    | "onHandDraft"
    | "models"
    | "macs"
    | "modelsFailed"
    | "modelsRead"
    | "readModels"
  >;
  /** Shows a tab in a task's own column. */
  readonly showTab: (taskId: string, tab: MainTab) => void;
}

/** The start act, traced as a send where it carries an agent; one with none is not. */
function useTaskStartMutation() {
  return useMutation(
    sendMutation(ACT_KIND.TASKS_START, (start) =>
      start.agent === undefined ? undefined : SENTRY_SEND_SPAN.TASK_START,
    ),
  ).mutateAsync;
}

/**
 * A group's quick add, in the workspace given: it starts a task with no
 * agent and no call, quietly, so the window stays on the Tasks page and the
 * task lands in its group.
 */
export function useQuickAddStart(workspaceId: string | undefined): QuickAddStart {
  const sendTaskStart = useTaskStartMutation();
  return useCallback(
    (name, into) =>
      sendTaskStart({
        name,
        ...(into.repository === undefined ? undefined : { repository: into.repository }),
        ...(into.parentTaskId === undefined ? undefined : { parentTaskId: into.parentTaskId }),
        ...(workspaceId === undefined ? undefined : { workspaceId }),
        ...startingStanding(into.standing),
        planning: false,
        quiet: true,
      }).then(
        (answer): Failure | undefined =>
          "failure" in answer
            ? { reason: FAILURE_REASON.OTHER, text: startFailureNote(answer.failure) }
            : undefined,
        (refused: Error): Failure => ({ reason: FAILURE_REASON.OTHER, text: refused.message }),
      ),
    [sendTaskStart, workspaceId],
  );
}

/** New task's flow, over the doors the Tasks tab hands it. */
export function useNewTask(doors: NewTaskDoors): NewTask {
  const { shown, place, agents, showTab } = doors;
  const sendTaskStart = useTaskStartMutation();
  const toast = useToast();
  const opensNewTask =
    useQuery({ ...appStateQuery, select: selectOpensNewTask }).data ??
    APP_SETTING_DEFAULTS.openNewTask;
  const signedIn = useQuery({ ...appStateQuery, select: selectMayStart }).data === true;
  const workspaces =
    useQuery({ ...appStateQuery, select: selectListedWorkspaces }).data ?? NO_WORKSPACES;
  const repositoriesIn = useRepositoriesIn();
  // The New task dialog's ask, standing while the dialog does: the preset it was opened with, if any.
  const [newTaskAsk, setNewTaskAsk] = useState<
    { readonly preset: NewTaskPreset | undefined } | undefined
  >(undefined);
  // How many times New task was pressed while Home stood, whose own composer takes the caret on each.
  const [homeNewTasks, setHomeNewTasks] = useState(0);
  // New task's own page: an agent's start under way, or a start Home's own composer refused while Home stood.
  const [page, setPage] = useState<NewTaskPage | undefined>(undefined);
  // How many starts Home's own composer had refused, each a new opening it draws afresh.
  const [homeRefusals, setHomeRefusals] = useState(0);
  // The opener of the render a started task's toast is pressed in.
  const openStarted = useRef(place.openStarted);
  openStarted.current = place.openStarted;

  // A started task becomes the host's open one, which turns the page to it,
  // so the dialog closes and the Inbox or a version history standing behind
  // it gives way. It starts in the chosen workspace; with none listed the
  // service starts it in the account's first one. A name left blank is not
  // sent, and the plan stands as Untitled. A start opens no call, and
  // names no planning, so the task opens on its empty description. New task starts the task
  // and its agent in that one start, under the key its card holds
  // (`agentRequest`), and opens the task on the agent's tab, or on a draft
  // holding the words with why where the agent was refused (`openAgent`).
  // An agent's start answered after the developer opened another task, or
  // left the task, opens nothing (the host's `TASKS_START`), so the window
  // stays where they went, and the agent's tab is the one the task opens on
  // when they come to it.
  // Note that a start whose task was refused, or never answered, is never
  // sent again by itself, because the service keeps no key for a task, so a
  // second start could make a second task; the card says why with Retry.
  // With Settings' Open a task once it starts off, the start is a quiet one:
  // the window stays on the page it was on, the agent's tab is made ready
  // for when the task opens, and a toast says the task started with Open.
  const startTask = (
    name: string,
    repository: string | null,
    workspaceId: string | undefined,
    from: NewTaskStart = {},
  ): Promise<Failure | undefined> => {
    // An agent's start opens on its task's page at once, its words drawn as
    // the agent's first line, rather than holding the card until the
    // service answers; a refusal opens the card again where it was left.
    const { handed, card } = from;
    const stays = !opensNewTask;
    // Note that the starting page's line is stamped at the press.
    const sentAt = Date.now();
    const line =
      handed === undefined || stays
        ? undefined
        : openingLineOf({
            key: handed.idempotencyKey,
            prompt: handed.prompt,
            attachments: handed.attachments,
            sentAt,
          });
    // Note that a start's page is let go only while it is still this start's, because another start may have replaced it.
    const letGoOfPage = () =>
      setPage((now) =>
        now?.kind === NEW_TASK_PAGE.STARTING && now.line === line ? now.over : now,
      );
    // Staying, an agent's start puts the card away at once and opens nothing; an opening one stands the task bound's own
    // place, or Home, where its page draws, in place of whatever stood in it, as a step the task it starts takes in place,
    // so Back from that task returns to where New task was pressed.
    // Note that what stood at the press is where its address stood, which a refusal opens again.
    let standBack = place.keepPressedOver(false);
    if (handed !== undefined && stays) setNewTaskAsk(undefined);
    else if (line !== undefined) {
      const moved = place.standStartPage();
      standBack = place.keepPressedOver(moved);
      const arrivals = place.arrivals() + (moved ? 1 : 0);
      setPage((now) => ({
        kind: NEW_TASK_PAGE.STARTING,
        line,
        choice: handed?.choice,
        arrivals,
        over: homeRefusedUnder(now),
      }));
      setNewTaskAsk(undefined);
    }
    // Note that the host opens a start's task at once, so a bare one pressed on Home's own
    // composer, whose page the task's took the place of, says its refusal in a toast, as no
    // card stands to say it.
    const saidInToast = handed === undefined && !stays && newTaskAsk === undefined;
    // Note that only Home's own route draws its composer, once no task is bound there, so a press
    // with no dialog standing over Home was the composer's own.
    const pressedOnHome = newTaskAsk === undefined && place.atHome();
    // Note that a refusal keeps what refused it, so the box that shows it reports that in its place.
    const refusedWith = (note: ComposerNote): ComposerNote => {
      if (saidInToast) {
        toast({
          words: note.text,
          tone: STATUS_TONE.DANGER,
          failure: { surface: FAILURE_SURFACE.TASK_START, cause: note.cause },
        });
      }
      if (handed !== undefined) {
        letGoOfPage();
        // Note that what stood before the press comes back only where the developer went nowhere since.
        standBack();
        // A start pressed on Home's own composer opens it again where Home still stands, rather than a
        // second composer in a dialog over it holding the same words; elsewhere the dialog says it.
        if (card !== undefined && pressedOnHome && place.atHome()) {
          const refusal: HomeRefusedPage = {
            kind: NEW_TASK_PAGE.HOME_REFUSED,
            refused: { card, note },
            arrivals: place.arrivals(),
          };
          setHomeRefusals((was) => was + 1);
          // Note that another start's page standing still stands, over the refusal.
          setPage((now) =>
            now?.kind === NEW_TASK_PAGE.STARTING ? { ...now, over: refusal } : refusal,
          );
        } else {
          setNewTaskAsk({
            preset:
              card === undefined
                ? undefined
                : {
                    ...(card.purpose === undefined ? undefined : { purpose: card.purpose }),
                    refused: { card, note },
                  },
          });
        }
      }
      return note;
    };
    return sendTaskStart({
      ...(name.length === 0 ? undefined : { name }),
      ...(repository === null ? undefined : { repository }),
      ...(workspaceId === undefined ? undefined : { workspaceId }),
      ...(from.runsOn === undefined || from.handed !== undefined
        ? undefined
        : { runsOn: from.runsOn }),
      ...(from.relations === undefined || from.relations.length === 0
        ? undefined
        : { relations: from.relations }),
      planning: false,
      ...(from.handed === undefined
        ? undefined
        : {
            agent: {
              ...agentRequest(from.handed),
              ...(from.runsOn === undefined ? undefined : { runsOn: from.runsOn }),
            },
          }),
      ...(stays ? { quiet: true } : undefined),
    }).then(
      (answer) => {
        if ("failure" in answer) {
          return refusedWith({
            reason: FAILURE_REASON.OTHER,
            text:
              answer.failure === TASK_CALL_FAILURE.LOCAL_AGENT_REFUSED
                ? localAgentRefusalWords(answer.localAgentRefusal, from.device)
                : startFailureNote(answer.failure),
            cause: answer,
          });
        }
        // Note that an agent's start put the card and whatever stood away as it was pressed, so
        // what stands now is the developer's since, a New task opened again among it, and stays.
        if (stays) {
          if (handed === undefined) setNewTaskAsk(undefined);
          else openAgent(answer.planId, handed, answer.agentStart, from.device);
          const { agentStart } = answer;
          sayStarted(
            answer.planId,
            handed === undefined || (agentStart !== undefined && !("failure" in agentStart)),
          );
          return undefined;
        }
        if (handed === undefined) {
          setNewTaskAsk(undefined);
          setPage((now) => homeRefusedUnder(now));
          place.standBound();
          return undefined;
        }
        letGoOfPage();
        openAgent(answer.planId, handed, answer.agentStart, from.device);
        return undefined;
      },
      (refused: Error) =>
        refusedWith({ reason: FAILURE_REASON.OTHER, text: refused.message, cause: refused }),
    );
  };

  // A task started without opening says so in a toast whose Open opens it
  // as an opening start would, on the agent's tab where its agent started,
  // or on the draft saying why where it did not, which the toast says too,
  // so a narrow room does not lay the plan over it as a list's press does.
  // Note that Open goes to the task first, which asks while a page stands
  // unsaved work, as the sidebar's press does, and reads the opener of the
  // render it is pressed in.
  const sayStarted = (planId: string, agentRan: boolean) =>
    toast({
      replayUnmasked: true,
      words: agentRan ? TASK_STARTED_NOTE : TASK_STARTED_AGENT_REFUSED_NOTE,
      tone: agentRan ? STATUS_TONE.COMPLETE : STATUS_TONE.ATTENTION,
      action: {
        label: OPEN_STARTED_TASK,
        replayUnmasked: true,
        onPress: () => openStarted.current(planId),
      },
    });

  // A task started with an agent opens on the agent's tab, as a landed
  // Start opens it; one whose agent was refused opens on a draft holding
  // the words, the files, the model, and the servers under the start's key, with why
  // under its box, whose Retry is the agent's own Start on the task. Either
  // opens on the agent's tab, the task's Overview beside it, so the side
  // panel stands as it stood on every other task.
  // Note that an answer naming neither is read as one the service never gave.
  const openAgent = (
    planId: string,
    handed: NewTaskAgent,
    started: AgentAgentAnswer | undefined,
    device: MacOffer | undefined,
  ) => {
    if (started !== undefined && !("failure" in started)) {
      agents.onTaskStarted(planId, started.agent);
      showTab(planId, agentTab(started.agent.id));
      return;
    }
    // Note that the refusal keeps the answer that said it, so the draft's tab reports the service's word for it.
    const answer = started ?? { failure: AGENT_CALL_FAILURE.UNANSWERED };
    const refused = { ...agentStartFailureNote(answer, planId, device), cause: answer };
    const { idempotencyKey: id, ...words } = handed;
    agents.onHandDraft(planId, { id, ...words, refused });
    showTab(planId, draftTab(id));
  };

  // Note that New task's start is a steady door, so the dialog handed it holds while nothing it draws moves.
  const steadyStartTask = useSteadyDoor(startTask);

  // New task opens the dialog over whatever stands, an open task and its
  // call included, which stay until a task is started. Note that a press
  // while the dialog stands, as the menu bar's still can, leaves it as it is,
  // because a fresh ask would keep the card's draft under another preset.
  const newTaskWith = (preset: NewTaskPreset | undefined) =>
    setNewTaskAsk((standing) => standing ?? { preset });
  // Home opens on New task's composer, so a plain New task there takes its
  // caret rather than drawing the same card again in a dialog over it. Note
  // that the tab need not be shown, because every New task press brings it
  // forward first.
  const newTask = () => {
    if (place.atHome() && signedIn && newTaskAsk === undefined) setHomeNewTasks((n) => n + 1);
    else newTaskWith(undefined);
  };
  // The dialog is the Tasks tab's, so Settings taking the window puts it
  // away rather than leaving it to stand again on the way back.
  if (!shown && newTaskAsk !== undefined) setNewTaskAsk(undefined);

  // Note that the start's page gives way for good to any place the developer went since, by any door, while it is out;
  // the start's own move there, counted once the window is drawn there, and the host's binding of its task are no such place.
  const arrived = place.arrivals();
  const starting =
    page?.kind === NEW_TASK_PAGE.STARTING && arrived <= page.arrivals ? page : undefined;
  // Note that Home's refused start gives way the same, so Home opened again later opens on its draft alone.
  const homeRefused = homeRefusedUnder(page);
  const homeRefusedNow =
    homeRefused !== undefined && arrived <= homeRefused.arrivals
      ? { opening: homeRefusals, refused: homeRefused.refused }
      : undefined;

  return {
    starting,
    onOpen: newTask,
    onOpenIn: (repository) => newTaskWith({ repository }),
    onOpenRelated: (taskId, kind) => {
      const task = doors.taskOf(taskId);
      if (task === undefined) return;
      newTaskWith({ relation: { kind, task } });
    },
    onOpenForAutomation: () => newTaskWith({ purpose: NEW_TASK_PURPOSE.AUTOMATION }),
    open: newTaskAsk !== undefined,
    preset: newTaskAsk?.preset,
    homeAsks: homeNewTasks,
    homeRefused: homeRefusedNow,
    workspaces,
    workspaceId: doors.workspaceId,
    repositoriesIn,
    start: steadyStartTask,
    models: agents.models,
    devices: agents.macs,
    modelsFailed: agents.modelsFailed,
    modelsRead: agents.modelsRead,
    readModels: agents.readModels,
    onClose: () => setNewTaskAsk(undefined),
    tasks: doors.tasks,
    onShowMention: place.showMention,
  };
}
