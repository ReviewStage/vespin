// start-screens.tsx -- the two sheets that start work, each a compose sheet as Mail's stands: New agent on a task, its words and pictures, with its model and effort and where it runs as capsule menus above the keyboard; and New task, Home's composer: the task described and its pictures, its relation to another task picked from the +, and its repository, model and effort, and where its agent runs as capsules, or File for later, which files it with no agent.

import { hasWordsOrFiles } from "@repo/features/agent-wire";
import { FAILURE_REASON } from "@repo/features/failure-remedy";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { agentName } from "@repo/features/model-label";
import { REPLY_BUTTON_ACTION } from "@repo/features/reply-button-wire";
import { type SuggestionRefusal, sentOf, suggestedChoice } from "@repo/features/suggestion-model";
import { NO_REPOSITORY } from "@repo/features/task-list-model";
import { REMOVE_RELATION, TASK_RELATION_MENU } from "@repo/features/task-relation-model";
import { TASK_CREATE_RELATION_WORDS, TASK_STATUS_TONE } from "@repo/features/task-standing-words";
import {
  isTaskSettled,
  TASK_CREATE_RELATION_KIND,
  TASK_STATUS,
  type TaskCreateRelation,
  type TaskCreateRelationKind,
  type TaskSummary,
} from "@repo/features/task-wire";
import { filedTaskOf } from "@repo/features/tasks-model";
import { selectTasks, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  type BarMenu,
  BUZZ,
  buzz,
  Chip,
  type ChipMenuGroup,
  ComposeSheet,
  ConfirmAsk,
  FieldChip,
  GLYPH,
  type Glyph,
  glyphSymbol,
  MenuChip,
  type PickOption,
  runsOnGlyph,
  STATUS_MARK_SYMBOL,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useShownAgent } from "../agents/use-agent.js";
import { type OpenedSuggestion, useSuggestionSender } from "../agents/use-suggestions.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useOnTab } from "../tab-route.js";
import {
  CLOUD,
  inTree,
  type ModelPick,
  type RepositoryPick,
  runsOnOptions,
  type StartAnswer,
  startRefusalWords,
  useFileTask,
  useModelPick,
  useRepositoryPick,
  useStartAgent,
  useStartTask,
} from "../tasks/use-start.js";
import { useAttachedPictures } from "../use-attached-pictures.js";
import { DISCARD_WORDS, type KeptWords, useKeptWords } from "../use-kept-words.js";
import { type SkillsOffered, useSkillOffer } from "../use-skill-offer.js";
import { useWrite } from "../use-write.js";

/** The panel's words for the sheets, their capsules, their menus, and their acts. */
const WORDS = {
  NEW_AGENT: "New agent",
  NEW_TASK: "New task",
  AGENT_PLACEHOLDER: "Ask to make changes",
  TASK_PLACEHOLDER: "Describe the task",
  REPOSITORY: "Repository",
  MODEL: "Model",
  EFFORT: "Effort",
  RUNS_ON: "Runs on",
  START: "Start",
  FILE_FOR_LATER: "File for later",
  PHOTOS: "Photos",
  TASK_RELATION: TASK_RELATION_MENU,
  RELATION: "Relation",
  SWAP_TASK: "Swap task",
  REMOVE_RELATION,
  CANCEL: "Cancel",
  NO_REPOSITORIES: "The workspace's GitHub reaches no repository yet.",
  TRY_AGAIN: "Try again",
  /** The line over a suggestion's draft, naming the agent that suggested it where it is known, as the panel's chip over the box does. */
  SUGGESTED_BY: (agent: string | undefined, label: string) => {
    const by = agent === undefined ? "Suggested" : `Suggested by ${agent}`;

    return label === "" ? by : `${by}: “${label}”`;
  },
} as const;

/** How a capsule joins what it says, as the panel's model chip joins a model and its effort. */
const JOINED = " · ";

/** A suggestion's start refused, said as New agent's own Start says it. */
const START_REFUSAL: SuggestionRefusal = (refused) => ({
  reason: FAILURE_REASON.OTHER,
  text: startRefusalWords(refused),
});

/** The names each sheet's flow finds its words and its + by. */
const TEST_IDS = {
  NEW_AGENT: { WORDS: "new-agent-words", ATTACH: "new-agent-attach" },
  NEW_TASK: { WORDS: "new-task-words", ATTACH: "new-task-attach" },
} as const;

/** File for later, as New task's bar offers it before Start: whether it is lit, and its press. */
interface FileForLater {
  readonly ready: boolean;
  readonly onFile: () => void;
}

/** The sheet's bar: its name, Cancel at its leading edge, and Start at its trailing one, lit once there are words or pictures to send and while no start is out, with File for later before it on New task; and the ask a Cancel or a swipe down raises while the sheet holds a draft. */
function SheetBar({
  title,
  ready,
  onStart,
  file,
  kept,
}: {
  readonly title: string;
  readonly ready: boolean;
  readonly onStart: () => void;
  readonly file?: FileForLater | undefined;
  readonly kept: KeptWords;
}) {
  const colors = useColors();
  const router = useRouter();

  return (
    <>
      {/* Note that the bar has no ground of its own, so the system draws its buttons in glass over the sheet's. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>{WORDS.CANCEL}</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {file === undefined ? null : (
          <Stack.Toolbar.Button
            icon={glyphSymbol(GLYPH.FILE_FOR_LATER)}
            accessibilityLabel={WORDS.FILE_FOR_LATER}
            disabled={!file.ready}
            onPress={file.onFile}
          />
        )}
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.SEND)}
          variant="prominent"
          tintColor={colors.ACCENT}
          accessibilityLabel={WORDS.START}
          disabled={!ready}
          onPress={onStart}
        />
      </Stack.Toolbar>
      <ConfirmAsk
        title={DISCARD_WORDS.QUESTION}
        act={DISCARD_WORDS.DISCARD}
        destructive
        presented={kept.asking}
        onAct={kept.discard}
        onDismiss={kept.stay}
      />
    </>
  );
}

/** A list's options as a capsule menu's choices, the one picked checked. */
function choicesOf(
  options: readonly PickOption[],
  picked: string | undefined,
  onPick: (id: string) => void,
): ChipMenuGroup["choices"] {
  return options.map((option) => ({
    label: option.label,
    on: option.id === picked,
    onPress: () => onPick(option.id),
  }));
}

/** What an option picked is called, where it is one of those offered. */
function labelOf(options: readonly PickOption[], picked: string | undefined): string | undefined {
  return options.find((option) => option.id === picked)?.label;
}

/** Each line under the words that has something to say: what a start said, then why a list could not be read. */
function notesOf(...lines: readonly (string | undefined)[]): readonly string[] {
  return lines.filter((line) => line !== undefined);
}

/**
 * The model and effort an agent starts on, as the panel's model chip says
 * them, "Opus 5.5 · High": a capsule whose menu checks the model under
 * Model and, where the model offers more than one, the effort under Effort;
 * where the models could not be read, Try again in its place, the reason
 * said under the words.
 */
function ModelChip({ pick }: { readonly pick: ModelPick }) {
  if (pick.models.length === 0) {
    return pick.failed === undefined ? null : (
      <Chip label={WORDS.TRY_AGAIN} symbol={GLYPH.RETRY} onPress={pick.retry} />
    );
  }

  const efforts = pick.efforts.length > 1 ? pick.efforts : [];
  const model = labelOf(pick.models, pick.shown?.model) ?? WORDS.MODEL;
  const effort = labelOf(efforts, pick.shown?.effort);

  const groups: ChipMenuGroup[] = [
    { title: WORDS.MODEL, choices: choicesOf(pick.models, pick.shown?.model, pick.pickModel) },
  ];

  if (efforts.length > 0) {
    groups.push({
      title: WORDS.EFFORT,
      choices: choicesOf(efforts, pick.shown?.effort, pick.pickEffort),
    });
  }

  return (
    <MenuChip
      label={effort === undefined ? model : `${model}${JOINED}${effort}`}
      menu={{ groups }}
    />
  );
}

/** Where the agent runs, Cloud or one of the account's devices, as a capsule; none where the account may run an agent on no device of its own. */
function RunsOnChip({
  pick,
  runsOn,
  onRunsOn,
}: {
  readonly pick: ModelPick;
  readonly runsOn: string;
  readonly onRunsOn: (place: string) => void;
}) {
  if (pick.devices.length === 0) return null;
  const options = runsOnOptions(pick.devices);

  // Note that each place leads with the panel's runs-on mark: the cloud's, or its device's by its platform.
  const glyphOf = (place: string) =>
    runsOnGlyph({
      cloud: place === CLOUD,
      platform: pick.devices.find((device) => device.deviceId === place)?.platform,
    });

  return (
    <MenuChip
      label={labelOf(options, runsOn) ?? WORDS.RUNS_ON}
      symbol={glyphOf(runsOn)}
      menu={{
        groups: [
          {
            title: WORDS.RUNS_ON,
            choices: options.map((option) => ({
              label: option.label,
              symbol: glyphOf(option.id),
              on: option.id === runsOn,
              onPress: () => onRunsOn(option.id),
            })),
          },
        ],
      }}
    />
  );
}

/**
 * The repository the task works in, as the panel's repository chip says it:
 * a capsule whose menu checks it among those the workspace's GitHub
 * reaches; read-only where the task joins another's tree, which holds that
 * task's repository, or while the list is read and a start already names
 * one; and Try again where the list could not be read.
 */
function RepositoryChip({
  repository,
  tree,
}: {
  readonly repository: RepositoryPick;
  readonly tree: TaskSummary | undefined;
}) {
  if (tree !== undefined) {
    return <FieldChip label={tree.repository ?? NO_REPOSITORY} symbol={GLYPH.REPOSITORY} />;
  }

  if (repository.options.length > 0) {
    return (
      <MenuChip
        label={labelOf(repository.options, repository.picked) ?? WORDS.REPOSITORY}
        symbol={GLYPH.REPOSITORY}
        menu={{
          groups: [
            {
              title: WORDS.REPOSITORY,
              choices: choicesOf(repository.options, repository.picked, repository.pick),
            },
          ],
        }}
      />
    );
  }

  // Note that the repository a start still names, taken from the account's recent tasks, stands while the list is read or could not be, so it never starts in one the sheet did not show.
  return (
    <>
      {repository.picked === undefined ? null : (
        <FieldChip label={repository.picked} symbol={GLYPH.REPOSITORY} />
      )}
      {repository.failed === undefined ? null : (
        <Chip label={WORDS.TRY_AGAIN} symbol={GLYPH.RETRY} onPress={repository.retry} />
      )}
    </>
  );
}

type UseSheetStartResult = {
  readonly starting: boolean;
  readonly go: (start: () => Promise<StartAnswer>, refusal?: string | undefined) => void;
};

type Started = { answer?: StartAnswer };

/**
 * Sends a start once, while none is out: on an agent started, the sheet
 * gives way to its page; on a task made with no agent, filed for later or
 * whose agent was refused, to the task's page; on a refusal, the sheet stays
 * with its words and pictures, the refusal said under them. Pictures the
 * service would refuse hold a start that carries them, saying why, as the
 * agent's composer holds a send.
 */
function useSheetStart(
  kept: KeptWords,
  setNote: (note: string | undefined) => void,
): UseSheetStartResult {
  const router = useRouter();
  const onTab = useOnTab();
  const write = useWrite();
  const [starting, setStarting] = useState(false);

  const go = (start: () => Promise<StartAnswer>, refusal?: string | undefined) => {
    if (starting) return;

    if (refusal !== undefined) {
      setNote(refusal);
      buzz(BUZZ.WARNING);

      return;
    }

    setStarting(true);
    setNote(undefined);
    const started: Started = {};
    // Note that a start refused says why in the sheet, under its words, rather than in the notice.
    write(
      () =>
        start().then((answer) => {
          started.answer = answer;

          return answer;
        }),
      {
        refused: (answer) => ("refused" in answer ? answer.refused : undefined),
        inPlace: setNote,
        went: BUZZ.SUCCESS,
      },
    )
      .then((went) => {
        const answer = started.answer;

        if (!went || answer === undefined || "refused" in answer) return;
        kept.release();
        router.dismiss();
        router.navigate(
          onTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, planId: answer.taskId })),
        );

        if (answer.agentId !== undefined) router.push(onTab(iosAgentRoute(answer.agentId)));
      })
      .finally(() => setStarting(false));
  };

  return { starting, go };
}

/** The skills a `/` offers, as the compose sheet takes them. */
function offered(skills: SkillsOffered | undefined) {
  return skills === undefined
    ? undefined
    : { skills: skills.skills, empty: skills.empty, onPick: skills.pick };
}

/**
 * New agent on a task, as the panel's draft tab starts one: what to ask of
 * it and the pictures that go with it, the model and effort it runs on, the
 * account's default until another is picked, and where it runs. Opened on a
 * suggestion (`opened`), it starts filled in with the suggestion's brief and
 * model under a line naming who suggested it, offers no Runs on, and its
 * Start goes through the suggestion, once, as the panel's draft sends one.
 */
export function NewAgentScreen({
  taskId,
  opened,
}: {
  readonly taskId: string;
  readonly opened?: OpenedSuggestion | undefined;
}) {
  const action = opened?.view.action;
  const brief = action?.kind === REPLY_BUTTON_ACTION.START ? action.prompt : "";
  const [prompt, setPrompt] = useState(brief);
  const [runsOn, setRunsOn] = useState(CLOUD);
  const pick = useModelPick(action === undefined ? undefined : suggestedChoice(action));
  const startAgent = useStartAgent(taskId);
  const sendSuggestion = useSuggestionSender();
  const suggester = useShownAgent(opened?.suggestion.agentId ?? "");
  // Note that a suggestion's agent starts on its suggester's task, as the service starts it, so Start waits until that task is read.
  const suggestedTask = suggester?.planId;
  const placed = opened === undefined || suggestedTask !== undefined;
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote);
  const drafted = hasWordsOrFiles(prompt.trim(), pictures.files);
  const kept = useKeptWords(drafted);
  const { starting, go } = useSheetStart(kept, setNote);
  const skills = useSkillOffer(prompt, setPrompt, { planId: taskId });

  // Note that a suggestion's start sends its own title and branch beside the words, files, and model the sheet holds.
  const startSuggested = async (
    suggestion: OpenedSuggestion["suggestion"],
  ): Promise<StartAnswer> => {
    const sent = sentOf(suggestion, prompt.trim(), pictures.files ?? [], pick.picked);

    const result = await sendSuggestion(
      { agentId: suggestion.agentId, buttonId: suggestion.buttonId, sent },
      START_REFUSAL,
    );

    return "reached" in result
      ? { agentId: result.reached, taskId: suggestedTask ?? taskId }
      : { refused: result.failure.text };
  };

  const start = () =>
    go(
      () =>
        opened === undefined
          ? startAgent({
              prompt: prompt.trim(),
              attachments: pictures.files,
              picked: pick.picked,
              runsOn,
            })
          : startSuggested(opened.suggestion),
      pictures.refusal,
    );

  return (
    <>
      <SheetBar
        title={WORDS.NEW_AGENT}
        ready={drafted && placed && !starting}
        onStart={start}
        kept={kept}
      />
      <ComposeSheet
        title={
          opened === undefined
            ? undefined
            : WORDS.SUGGESTED_BY(
                suggester === undefined ? undefined : agentName(suggester),
                opened.suggestion.label,
              )
        }
        words={{
          placeholder: WORDS.AGENT_PLACEHOLDER,
          words: prompt,
          onWords: setPrompt,
          testId: TEST_IDS.NEW_AGENT.WORDS,
        }}
        skills={offered(skills)}
        pictures={pictures.attached}
        onDetach={pictures.detach}
        onDropPictures={pictures.drop}
        notes={notesOf(note, pick.failed)}
        add={{ onAdd: pictures.attach, testId: TEST_IDS.NEW_AGENT.ATTACH }}
        chips={
          <>
            <ModelChip pick={pick} />
            {/* Note that a suggestion's agent runs where the member's agents on the task run, so it offers no Runs on, as the panel's draft hides it. */}
            {opened === undefined ? (
              <RunsOnChip pick={pick} runsOn={runsOn} onRunsOn={setRunsOn} />
            ) : null}
          </>
        }
      />
    </>
  );
}

/** What New task opens on in place of an empty sheet: a draft the share sheet kept. */
export interface NewTaskDraft {
  readonly prompt: string;
  /** The workspace it was kept for, where one was picked; the phone's own otherwise. */
  readonly workspaceId?: string | undefined;
  readonly repository?: string | undefined;
  /** The addresses of the JPEGs its pictures were kept in, in the App Group, which New task reads and deletes. */
  readonly pictures?: readonly string[] | undefined;
}

/** No task list read yet. */
const NO_TASKS: readonly TaskSummary[] = [];

/** The kinds New task's relation offers, in the panel's order: a sub-task of another, or one waiting on or holding up another. */
const RELATION_ORDER: readonly TaskCreateRelationKind[] = [
  TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  TASK_CREATE_RELATION_KIND.BLOCKED_BY,
  TASK_CREATE_RELATION_KIND.BLOCKS,
];

/** Each kind's glyph, as the panel's relation menu leads it. */
function relationGlyph(kind: TaskCreateRelationKind): Glyph {
  switch (kind) {
    case TASK_CREATE_RELATION_KIND.SUB_TASK_OF:
      return GLYPH.PARENT_TASK;
    case TASK_CREATE_RELATION_KIND.PARENT_OF:
      return GLYPH.SUB_TASK;
    case TASK_CREATE_RELATION_KIND.BLOCKED_BY:
      return GLYPH.BLOCKED_BY;
    case TASK_CREATE_RELATION_KIND.BLOCKS:
      return GLYPH.BLOCKS;
  }
}

/** What New task's relation holds: the relation it starts in, where one is picked, the task it names, the tasks it may name, and its pickers. */
interface RelationPick {
  readonly relation: TaskCreateRelation | undefined;
  readonly task: TaskSummary | undefined;
  readonly tasks: readonly TaskSummary[];
  readonly pick: (relation: TaskCreateRelation) => void;
  readonly clear: () => void;
}

/**
 * The relation New task starts its task in: none until one is picked from
 * the +, its kind and its task together, or Sub-task of `parent` where a
 * task's New sub-task opened it; the tasks offered are the workspace's not
 * yet settled, and the parent whatever its status.
 */
function useRelationPick(
  listed: readonly TaskSummary[],
  workspaceId: string | undefined,
  parent: string | undefined,
): RelationPick {
  const [relation, setRelation] = useState<TaskCreateRelation | undefined>(
    parent === undefined
      ? undefined
      : { kind: TASK_CREATE_RELATION_KIND.SUB_TASK_OF, taskId: parent },
  );

  const tasks = useMemo(
    () =>
      listed.filter(
        (task) =>
          task.workspaceId === workspaceId &&
          (task.id === parent || task.status === undefined || !isTaskSettled(task.status)),
      ),
    [listed, workspaceId, parent],
  );

  return {
    relation,
    task: listed.find((task) => task.id === relation?.taskId),
    tasks,
    pick: setRelation,
    clear: () => setRelation(undefined),
  };
}

/** The tasks a kind may name, as a menu's choices, the one named checked. */
function taskChoices(pick: RelationPick, kind: TaskCreateRelationKind): ChipMenuGroup["choices"] {
  return pick.tasks.map((task) => ({
    label: task.name,
    symbol: STATUS_MARK_SYMBOL[task.status ?? TASK_STATUS.TODO],
    tone: TASK_STATUS_TONE[task.status ?? TASK_STATUS.TODO],
    on: pick.relation?.kind === kind && pick.relation.taskId === task.id,
    onPress: () => pick.pick({ kind, taskId: task.id }),
  }));
}

/** The + menu's Task relation, as the panel's + offers it: each kind, then the task it names; none while no task may be named. */
function relationMenu(pick: RelationPick): BarMenu | undefined {
  if (pick.tasks.length === 0) return undefined;

  return {
    label: WORDS.TASK_RELATION,
    symbol: GLYPH.RELATIONS,
    choices: [],
    actions: [],
    submenus: RELATION_ORDER.map((kind) => ({
      label: TASK_CREATE_RELATION_WORDS[kind],
      symbol: relationGlyph(kind),
      choices: taskChoices(pick, kind),
      actions: [],
    })),
  };
}

/**
 * The relation picked, over the words as the panel docks it over its card,
 * "Blocked by · Audit invites": a capsule whose menu changes its kind,
 * swaps its task, or removes it; nothing while none is picked.
 */
function RelationChip({ pick }: { readonly pick: RelationPick }) {
  const { relation, task } = pick;

  if (relation === undefined) return null;
  const kind = TASK_CREATE_RELATION_WORDS[relation.kind];

  return (
    <MenuChip
      label={task === undefined ? kind : `${kind}${JOINED}${task.name}`}
      symbol={relationGlyph(relation.kind)}
      menu={{
        groups: [
          {
            title: WORDS.RELATION,
            choices: RELATION_ORDER.map((each) => ({
              label: TASK_CREATE_RELATION_WORDS[each],
              symbol: relationGlyph(each),
              on: each === relation.kind,
              onPress: () => pick.pick({ kind: each, taskId: relation.taskId }),
            })),
          },
        ],
        actions: [
          {
            label: WORDS.REMOVE_RELATION,
            symbol: GLYPH.REMOVE,
            destructive: true,
            onPress: pick.clear,
          },
        ],
        submenus: [
          {
            label: WORDS.SWAP_TASK,
            symbol: GLYPH.TASK,
            choices: taskChoices(pick, relation.kind),
            actions: [],
          },
        ],
      }}
    />
  );
}

/**
 * New task, Home's composer as a compose sheet: the task described and the
 * pictures that go with it, the task it is related to, picked from the +
 * and shown over the words once picked, and, as capsules above the
 * keyboard, the repository it works in, the newest one the account's tasks
 * were about until another is picked, or its parent's in another's tree,
 * its agent's model and effort, and where its agent runs. Start makes the
 * task and starts its agent in one act, as Home does, in the workspace the
 * app works in, or the one a share draft it opens on was kept for; File for
 * later before it files the task in the Backlog under its words with no
 * agent, offered on words alone, since pictures go only with an agent's
 * start. A task's New sub-task opens it as a sub-task of `parent`, in the
 * parent's workspace, which a task opened by a link may hold apart from the
 * one the app works in, since a tree stands in one.
 */
export function NewTaskScreen({
  parent,
  draft,
}: {
  readonly parent?: string | undefined;
  readonly draft?: NewTaskDraft | undefined;
}) {
  const [prompt, setPrompt] = useState(draft?.prompt ?? "");
  const [runsOn, setRunsOn] = useState(CLOUD);
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const listed = view?.tasks ?? NO_TASKS;
  const chosen = useChosenWorkspace(workspaces).chosen;
  const own = workspaces.find(({ id }) => id === draft?.workspaceId) ?? chosen;
  // Note that a sub-task starts in its parent's workspace by the id its row holds, read before the workspace list may be, and holds its start until that row is read.
  const parentIn = listed.find((task) => task.id === parent)?.workspaceId;
  const workspaceId = parent === undefined ? own?.id : parentIn;
  const placed = workspaceId !== undefined || parent === undefined;
  // Note that a sub-task's repositories are its parent's workspace's alone, never the chosen one's, so none is offered until that workspace is read.
  const workspace = parent === undefined ? own : workspaces.find((each) => each.id === workspaceId);
  const repository = useRepositoryPick(workspace, draft?.repository);
  const relation = useRelationPick(listed, workspaceId, parent);
  const pick = useModelPick();
  const startTask = useStartTask(workspaceId);
  const fileTask = useFileTask(workspaceId);
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote, draft?.pictures);
  // Note that a share draft's pictures are read as the sheet opens, and nothing starts or files until they are in, so its words never go without them.
  const drafted = hasWordsOrFiles(prompt.trim(), pictures.files) && !pictures.opening;
  const filed = pictures.files === undefined && !pictures.opening ? filedTaskOf(prompt) : undefined;
  const kept = useKeptWords(drafted);
  const { starting, go } = useSheetStart(kept, setNote);
  const place = { repository: repository.picked, relation: relation.relation };
  const tree = inTree(relation.relation) ? relation.task : undefined;
  // Note that a `/` offers the skills of the repository the task starts in, its tree's where it joins one, as the panel's New task reads them.
  const skillsRepository = tree === undefined ? repository.picked : (tree.repository ?? undefined);

  const skills = useSkillOffer(
    prompt,
    setPrompt,
    workspaceId === undefined
      ? undefined
      : skillsRepository === undefined
        ? { workspaceId }
        : { workspaceId, repository: skillsRepository },
  );

  const unreached =
    tree !== undefined
      ? undefined
      : (repository.failed ??
        (repository.read && repository.options.length === 0 ? WORDS.NO_REPOSITORIES : undefined));

  const related = relationMenu(relation);

  const start = () => {
    if (!drafted) return;
    go(
      () =>
        startTask({
          prompt: prompt.trim(),
          attachments: pictures.files,
          picked: pick.picked,
          runsOn,
          ...place,
        }),
      pictures.refusal,
    );
  };

  const file = () => {
    if (filed !== undefined) go(() => fileTask({ filed, ...place }));
  };

  return (
    <>
      <SheetBar
        title={WORDS.NEW_TASK}
        ready={drafted && placed && !starting}
        onStart={start}
        file={{ ready: filed !== undefined && placed && !starting, onFile: file }}
        kept={kept}
      />
      <ComposeSheet
        head={<RelationChip pick={relation} />}
        words={{
          placeholder: WORDS.TASK_PLACEHOLDER,
          words: prompt,
          onWords: setPrompt,
          testId: TEST_IDS.NEW_TASK.WORDS,
        }}
        skills={offered(skills)}
        pictures={pictures.attached}
        onDetach={pictures.detach}
        onDropPictures={pictures.drop}
        notes={notesOf(note, unreached, pick.failed)}
        add={{
          menu: {
            actions: [{ label: WORDS.PHOTOS, symbol: GLYPH.ATTACH, onPress: pictures.attach }],
            submenus: related === undefined ? [] : [related],
          },
          testId: TEST_IDS.NEW_TASK.ATTACH,
        }}
        chips={
          <>
            <RepositoryChip repository={repository} tree={tree} />
            <ModelChip pick={pick} />
            <RunsOnChip pick={pick} runsOn={runsOn} onRunsOn={setRunsOn} />
          </>
        }
      />
    </>
  );
}
