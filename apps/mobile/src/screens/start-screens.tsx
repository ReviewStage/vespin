// start-screens.tsx -- the two sheets that start work, each a SwiftUI Form: New agent on a task, its words and pictures, model, and effort; and New task, Home's composer: the task described and its pictures, its relation to another task, its repository, its model and effort, and where its agent runs, or File for later, which files it with no agent.

import { hasWordsOrFiles } from "@repo/features/agent-wire";
import { NO_REPOSITORY } from "@repo/features/task-list-model";
import { TASK_CREATE_RELATION_WORDS } from "@repo/features/task-standing-words";
import {
  isTaskSettled,
  TASK_CREATE_RELATION_KIND,
  type TaskCreateRelation,
  type TaskCreateRelationKind,
  type TaskSummary,
} from "@repo/features/task-wire";
import { filedTaskOf } from "@repo/features/tasks-model";
import { selectTasks, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AttachRow,
  BAR_TITLE,
  BUZZ,
  buzz,
  ConfirmAsk,
  ListSection,
  MenuPickRow,
  type PickOption,
  Screen,
  SettingsForm,
  useColors,
  ValueRow,
  WordsField,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, usePreventRemove, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import {
  CLOUD,
  inTree,
  type ModelPick,
  runsOnOptions,
  type StartAnswer,
  useFileTask,
  useModelPick,
  useRepositoryPick,
  useStartAgent,
  useStartTask,
} from "../tasks/use-start.js";
import { type AttachedPictures, useAttachedPictures } from "../use-attached-pictures.js";
import { useWrite } from "../use-write.js";

/** The panel's words for the sheets, their fields, and their acts. */
const WORDS = {
  NEW_AGENT: "New agent",
  NEW_TASK: "New task",
  AGENT_PLACEHOLDER: "Ask to make changes",
  TASK_PLACEHOLDER: "Describe the task",
  REPOSITORY: "Repository",
  AGENT: "Agent",
  MODEL: "Model",
  EFFORT: "Effort",
  RUNS_ON: "Runs on",
  START: "Start",
  FILE_FOR_LATER: "File for later",
  TASK_RELATION: "Task relation",
  RELATION: "Relation",
  TASK: "Task",
  NO_RELATION: "None",
  CANCEL: "Cancel",
  DISCARD_QUESTION: "Discard draft?",
  DISCARD: "Discard draft",
  NO_REPOSITORIES: "The workspace's GitHub reaches no repository yet.",
} as const;

/** The names each sheet's flow finds its words and its + by. */
const TEST_IDS = {
  NEW_AGENT: { WORDS: "new-agent-words", ATTACH: "new-agent-attach" },
  NEW_TASK: { WORDS: "new-task-words", ATTACH: "new-task-attach" },
} as const;

type SheetTestIds = (typeof TEST_IDS)[keyof typeof TEST_IDS];

/** What keeps a sheet's draft, its words typed and pictures attached: whether it asks before they go, and its answers. */
interface KeptWords {
  /** Whether the sheet asks whether to discard its draft, after a Cancel or a swipe down. */
  readonly asking: boolean;
  /** Lets the sheet go, its draft with it, as the ask's Discard draft does. */
  readonly discard: () => void;
  /** Keeps the sheet and its draft, as the ask's Cancel does. */
  readonly stay: () => void;
  /** Lets the sheet go without asking, as a start taken does. */
  readonly release: () => void;
}

/**
 * Keeps a sheet's draft while it holds one, words typed or a picture
 * attached, as Mail keeps a draft: the swipe down is held, and Cancel or a
 * swipe asks first whether to discard it. Note that a swipe the system held
 * comes back as a removal the stack prevented, so one ask answers both.
 */
function useKeptWords(drafted: boolean): KeptWords {
  const [letGo, setLetGo] = useState(false);
  const [leave, setLeave] = useState<(() => void) | undefined>(undefined);
  const disable = usePreventRemove(drafted && !letGo, ({ repeat }) => setLeave(() => repeat));
  return {
    asking: leave !== undefined,
    discard: () => {
      setLetGo(true);
      setLeave(undefined);
      leave?.();
    },
    stay: () => setLeave(undefined),
    release: () => {
      setLetGo(true);
      disable();
    },
  };
}

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
          contentStyle: { backgroundColor: colors.SIDEBAR },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>{WORDS.CANCEL}</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {file === undefined ? null : (
          <Stack.Toolbar.Button
            icon="tray.and.arrow.down"
            accessibilityLabel={WORDS.FILE_FOR_LATER}
            disabled={!file.ready}
            onPress={file.onFile}
          />
        )}
        <Stack.Toolbar.Button
          icon="arrow.up"
          variant="prominent"
          tintColor={colors.ACCENT}
          accessibilityLabel={WORDS.START}
          disabled={!ready}
          onPress={onStart}
        />
      </Stack.Toolbar>
      <ConfirmAsk
        title={WORDS.DISCARD_QUESTION}
        act={WORDS.DISCARD}
        destructive
        presented={kept.asking}
        onAct={kept.discard}
        onDismiss={kept.stay}
      />
    </>
  );
}

/** The agent's section: its model and effort, and where it runs where the account may run one on its own device. */
function AgentSection({
  pick,
  runsOn,
  onRunsOn,
}: {
  readonly pick: ModelPick;
  readonly runsOn: string;
  readonly onRunsOn: (place: string) => void;
}) {
  return (
    <ListSection title={WORDS.AGENT}>
      <MenuPickRow
        label={WORDS.MODEL}
        options={pick.models}
        picked={pick.shown?.model}
        onPick={pick.pickModel}
      />
      {pick.efforts.length <= 1 ? null : (
        <MenuPickRow
          label={WORDS.EFFORT}
          options={pick.efforts}
          picked={pick.shown?.effort}
          onPick={pick.pickEffort}
        />
      )}
      {pick.devices.length === 0 ? null : (
        <MenuPickRow
          label={WORDS.RUNS_ON}
          options={runsOnOptions(pick.devices)}
          picked={runsOn}
          onPick={onRunsOn}
        />
      )}
    </ListSection>
  );
}

/** The sheet's words and, under them, the + and the pictures attached, with what a start, the picker, or a bound said under both. */
function DraftSection({
  placeholder,
  onWords,
  initialWords,
  pictures,
  note,
  testIds,
}: {
  readonly placeholder: string;
  readonly onWords: (words: string) => void;
  readonly initialWords?: string | undefined;
  readonly pictures: AttachedPictures;
  readonly note: string | undefined;
  /** The names a flow finds the field and the + by. */
  readonly testIds: SheetTestIds;
}) {
  return (
    <ListSection footer={note}>
      <WordsField
        placeholder={placeholder}
        onWords={onWords}
        initialWords={initialWords}
        autoFocus
        testId={testIds.WORDS}
      />
      <AttachRow
        pictures={pictures.attached}
        onAdd={pictures.attach}
        onDetach={pictures.detach}
        onDropPictures={pictures.drop}
        testId={testIds.ATTACH}
      />
    </ListSection>
  );
}

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
): {
  readonly starting: boolean;
  readonly go: (start: () => Promise<StartAnswer>, refusal?: string | undefined) => void;
} {
  const router = useRouter();
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
    const started: { answer?: StartAnswer } = {};
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
        router.navigate(`/tasks/${encodeURIComponent(answer.taskId)}`);
        if (answer.agentId !== undefined) {
          router.push(`/tasks/agent/${encodeURIComponent(answer.agentId)}`);
        }
      })
      .finally(() => setStarting(false));
  };
  return { starting, go };
}

/**
 * New agent on a task, as the panel's draft tab starts one: what to ask of
 * it and the pictures that go with it, the model and effort it runs on, the
 * account's default until another is picked, and where it runs.
 */
export function NewAgentScreen({ taskId }: { readonly taskId: string }) {
  const [prompt, setPrompt] = useState("");
  const [runsOn, setRunsOn] = useState(CLOUD);
  const pick = useModelPick();
  const startAgent = useStartAgent(taskId);
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote);
  const drafted = hasWordsOrFiles(prompt.trim(), pictures.files);
  const kept = useKeptWords(drafted);
  const { starting, go } = useSheetStart(kept, setNote);
  const start = () =>
    go(
      () =>
        startAgent({
          prompt: prompt.trim(),
          attachments: pictures.files,
          picked: pick.picked,
          runsOn,
        }),
      pictures.refusal,
    );
  return (
    <>
      <SheetBar title={WORDS.NEW_AGENT} ready={drafted && !starting} onStart={start} kept={kept} />
      <Screen>
        <SettingsForm>
          <DraftSection
            placeholder={WORDS.AGENT_PLACEHOLDER}
            onWords={setPrompt}
            pictures={pictures}
            note={note}
            testIds={TEST_IDS.NEW_AGENT}
          />
          <AgentSection pick={pick} runsOn={runsOn} onRunsOn={setRunsOn} />
        </SettingsForm>
      </Screen>
    </>
  );
}

/** What New task opens on in place of an empty sheet: a draft the share sheet kept. */
export interface NewTaskDraft {
  readonly prompt: string;
  /** The workspace it was kept for, where one was picked; the phone's own otherwise. */
  readonly workspaceId?: string | undefined;
  readonly repository?: string | undefined;
}

/** No task list read yet. */
const NO_TASKS: readonly TaskSummary[] = [];

/** No relation picked, beside each kind New task may start its task in. */
const NO_RELATION = "none";

/** The kinds New task's relation offers, in the panel's order: a sub-task of another, or one waiting on or holding up another. */
const RELATION_ORDER: readonly TaskCreateRelationKind[] = [
  TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  TASK_CREATE_RELATION_KIND.BLOCKED_BY,
  TASK_CREATE_RELATION_KIND.BLOCKS,
];

/** The relation's kinds as its menu offers them: None first. */
const RELATION_OPTIONS: readonly PickOption[] = [
  { id: NO_RELATION, label: WORDS.NO_RELATION },
  ...RELATION_ORDER.map((kind) => ({ id: kind, label: TASK_CREATE_RELATION_WORDS[kind] })),
];

/** Whether a menu's pick names one of the relation's kinds. */
function isRelationKind(id: string): id is TaskCreateRelationKind {
  return RELATION_ORDER.some((kind) => kind === id);
}

/** What New task's relation holds: the relation it starts in, where both a kind and a task are picked, its pickers, and the task it names. */
interface RelationPick {
  readonly relation: TaskCreateRelation | undefined;
  readonly kind: string;
  readonly taskId: string | undefined;
  readonly tasks: readonly TaskSummary[];
  readonly pickKind: (kind: string) => void;
  readonly pickTask: (taskId: string) => void;
}

/**
 * The relation New task starts its task in, as its rows pick one: none
 * until one is picked, or Sub-task of `parent` where a task's New sub-task
 * opened it; the tasks offered are the workspace's not yet settled, and
 * the parent whatever its status, the first offered standing in until
 * another is picked.
 */
function useRelationPick(
  listed: readonly TaskSummary[],
  workspaceId: string | undefined,
  parent: string | undefined,
): RelationPick {
  const [kind, setKind] = useState<string>(
    parent === undefined ? NO_RELATION : TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  );
  const [picked, setPicked] = useState<string | undefined>(parent);
  const tasks = useMemo(
    () =>
      listed.filter(
        (task) =>
          task.workspaceId === workspaceId &&
          (task.id === parent || task.status === undefined || !isTaskSettled(task.status)),
      ),
    [listed, workspaceId, parent],
  );
  const taskId = picked ?? tasks[0]?.id;
  return {
    relation: isRelationKind(kind) && taskId !== undefined ? { kind, taskId } : undefined,
    kind,
    taskId,
    tasks,
    pickKind: setKind,
    pickTask: setPicked,
  };
}

/** New task's relation: its kind, and the task it names once a kind is picked. */
function RelationSection({ pick }: { readonly pick: RelationPick }) {
  return (
    <ListSection title={WORDS.TASK_RELATION}>
      <MenuPickRow
        label={WORDS.RELATION}
        options={RELATION_OPTIONS}
        picked={pick.kind}
        onPick={pick.pickKind}
      />
      {pick.kind === NO_RELATION ? null : (
        <MenuPickRow
          label={WORDS.TASK}
          options={pick.tasks.map((task) => ({ id: task.id, label: task.name }))}
          picked={pick.taskId}
          onPick={pick.pickTask}
        />
      )}
    </ListSection>
  );
}

/**
 * New task, Home's composer as a sheet: the task described and the pictures
 * that go with it, the task it is related to, where one is picked, the
 * repository it works in, the newest one the account's tasks were about
 * until another is picked, or its parent's in another's tree, its agent's
 * model and effort, and where its agent runs. Start makes the task and
 * starts its agent in one act, as Home does, in the workspace the app works
 * in, or the one a share draft it opens on was kept for; File for later
 * before it files the task in the Backlog under its
 * words with no agent, offered on words alone, since pictures go only with
 * an agent's start. A task's New sub-task opens it as a sub-task of
 * `parent`, in the parent's workspace, which a task opened by a link may
 * hold apart from the one the app works in, since a tree stands in one.
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
  const pictures = useAttachedPictures(setNote);
  const drafted = hasWordsOrFiles(prompt.trim(), pictures.files);
  const filed = pictures.files === undefined ? filedTaskOf(prompt) : undefined;
  const kept = useKeptWords(drafted);
  const { starting, go } = useSheetStart(kept, setNote);
  const place = { repository: repository.picked, relation: relation.relation };
  // Note that a relation picked holds the start until it names a task, so the task never starts unrelated.
  const relationReady = relation.kind === NO_RELATION || relation.relation !== undefined;
  const tree = inTree(relation.relation)
    ? relation.tasks.find((task) => task.id === relation.taskId)
    : undefined;
  const start = () =>
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
  const file = () => {
    if (filed !== undefined) go(() => fileTask({ filed, ...place }));
  };
  return (
    <>
      <SheetBar
        title={WORDS.NEW_TASK}
        ready={drafted && placed && relationReady && !starting}
        onStart={start}
        file={{
          ready: filed !== undefined && placed && relationReady && !starting,
          onFile: file,
        }}
        kept={kept}
      />
      <Screen>
        <SettingsForm>
          <DraftSection
            placeholder={WORDS.TASK_PLACEHOLDER}
            onWords={setPrompt}
            initialWords={draft?.prompt}
            pictures={pictures}
            note={note}
            testIds={TEST_IDS.NEW_TASK}
          />
          <RelationSection pick={relation} />
          <ListSection
            title={WORDS.REPOSITORY}
            footer={
              tree === undefined && repository.options.length === 0
                ? WORDS.NO_REPOSITORIES
                : undefined
            }
          >
            {tree !== undefined ? (
              <ValueRow label={WORDS.REPOSITORY} value={tree.repository ?? NO_REPOSITORY} />
            ) : repository.options.length === 0 ? null : (
              <MenuPickRow
                label={WORDS.REPOSITORY}
                options={repository.options}
                picked={repository.picked}
                onPick={repository.pick}
              />
            )}
          </ListSection>
          <AgentSection pick={pick} runsOn={runsOn} onRunsOn={setRunsOn} />
        </SettingsForm>
      </Screen>
    </>
  );
}
