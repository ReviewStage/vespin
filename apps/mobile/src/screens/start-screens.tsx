// start-screens.tsx -- the two sheets that start work, each a SwiftUI Form: New agent on a task, its words and pictures, model, and effort; and New task, Home's composer: the task described and its pictures, its repository, its model and effort, and where its agent runs.

import { hasWordsOrFiles } from "@repo/features/agent-wire";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AttachRow,
  BAR_TITLE,
  BUZZ,
  buzz,
  ConfirmAsk,
  ListSection,
  MenuPickRow,
  Screen,
  SettingsForm,
  useColors,
  WordsField,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, usePreventRemove, useRouter } from "expo-router";
import { useState } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import {
  CLOUD,
  type ModelPick,
  runsOnOptions,
  type StartAnswer,
  useModelPick,
  useRepositoryPick,
  useStartAgent,
  useStartTask,
} from "../tasks/use-start.js";
import { type AttachedPictures, useAttachedPictures } from "../use-attached-pictures.js";

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

/** The sheet's bar: its name, Cancel at its leading edge, and Start at its trailing one, lit once there are words or pictures to send and while no start is out; and the ask a Cancel or a swipe down raises while the sheet holds a draft. */
function SheetBar({
  title,
  ready,
  onStart,
  kept,
}: {
  readonly title: string;
  readonly ready: boolean;
  readonly onStart: () => void;
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
          headerTintColor: colors.ACCENT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.SIDEBAR },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>{WORDS.CANCEL}</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
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
  pictures,
  note,
  testIds,
}: {
  readonly placeholder: string;
  readonly onWords: (words: string) => void;
  readonly pictures: AttachedPictures;
  readonly note: string | undefined;
  /** The names a flow finds the field and the + by. */
  readonly testIds: SheetTestIds;
}) {
  return (
    <ListSection footer={note}>
      <WordsField placeholder={placeholder} onWords={onWords} autoFocus testId={testIds.WORDS} />
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
 * gives way to its page; on a task made whose agent was refused, to the
 * task's page; on a refusal, the sheet stays with its words and pictures,
 * the refusal said under them. Pictures the service would refuse hold the
 * start, saying why, as the agent's composer holds a send.
 */
function useSheetStart(
  start: () => Promise<StartAnswer>,
  kept: KeptWords,
  refusal: string | undefined,
  setNote: (note: string | undefined) => void,
): {
  readonly starting: boolean;
  readonly go: () => void;
} {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const go = () => {
    if (starting) return;
    if (refusal !== undefined) {
      setNote(refusal);
      buzz(BUZZ.WARNING);
      return;
    }
    setStarting(true);
    setNote(undefined);
    start()
      .then((answer) => {
        if ("refused" in answer) {
          setNote(answer.refused);
          buzz(BUZZ.ERROR);
          return;
        }
        buzz(BUZZ.SUCCESS);
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
  const { starting, go } = useSheetStart(
    () =>
      startAgent({
        prompt: prompt.trim(),
        attachments: pictures.files,
        picked: pick.picked,
        runsOn,
      }),
    kept,
    pictures.refusal,
    setNote,
  );
  return (
    <>
      <SheetBar title={WORDS.NEW_AGENT} ready={drafted && !starting} onStart={go} kept={kept} />
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

/**
 * New task, Home's composer as a sheet: the task described and the pictures
 * that go with it, the repository it works in, the newest one the account's
 * tasks were about until another is picked, its agent's model and effort,
 * and where its agent runs. Start
 * makes the task and starts its agent in one act, as Home does, in the
 * workspace the app works in.
 */
export function NewTaskScreen() {
  const [prompt, setPrompt] = useState("");
  const [runsOn, setRunsOn] = useState(CLOUD);
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const workspace = useChosenWorkspace(workspaces).chosen;
  const repository = useRepositoryPick(workspace);
  const pick = useModelPick();
  const startTask = useStartTask(workspace?.id);
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote);
  const drafted = hasWordsOrFiles(prompt.trim(), pictures.files);
  const kept = useKeptWords(drafted);
  const { starting, go } = useSheetStart(
    () =>
      startTask({
        prompt: prompt.trim(),
        attachments: pictures.files,
        picked: pick.picked,
        runsOn,
        repository: repository.picked,
      }),
    kept,
    pictures.refusal,
    setNote,
  );
  return (
    <>
      <SheetBar title={WORDS.NEW_TASK} ready={drafted && !starting} onStart={go} kept={kept} />
      <Screen>
        <SettingsForm>
          <DraftSection
            placeholder={WORDS.TASK_PLACEHOLDER}
            onWords={setPrompt}
            pictures={pictures}
            note={note}
            testIds={TEST_IDS.NEW_TASK}
          />
          <ListSection
            title={WORDS.REPOSITORY}
            footer={repository.options.length === 0 ? WORDS.NO_REPOSITORIES : undefined}
          >
            {repository.options.length === 0 ? null : (
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
