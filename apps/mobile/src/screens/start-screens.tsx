// start-screens.tsx -- the two sheets that start work, each a SwiftUI Form: New agent on a task, its words, model, and effort; and New task, Home's composer: the task described, its repository, its model and effort, and where its agent runs.

import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  ListSection,
  MenuPickRow,
  Screen,
  SettingsForm,
  useColors,
  WordsField,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { NotificationFeedbackType, notificationAsync } from "expo-haptics";
import { Stack, useRouter } from "expo-router";
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
  NO_REPOSITORIES: "The workspace's GitHub reaches no repository yet.",
} as const;

/** Buzzes the phone as the system does for a start taken, or refused. */
function buzz(type: NotificationFeedbackType): void {
  notificationAsync(type).catch((error: unknown) => console.error("The buzz did not go.", error));
}

/** The sheet's bar: its name, Cancel at its leading edge, and Start at its trailing one, lit once there are words to send and while no start is out. */
function SheetBar({
  title,
  ready,
  onStart,
}: {
  readonly title: string;
  readonly ready: boolean;
  readonly onStart: () => void;
}) {
  const colors = useColors();
  const router = useRouter();
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerTintColor: colors.ACCENT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerStyle: { backgroundColor: colors.SIDEBAR },
          headerShadowVisible: false,
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

/**
 * Sends a start once, while none is out: on an agent started, the sheet
 * gives way to its page; on a task made whose agent was refused, to the
 * task's page; on a refusal, the sheet stays with its words, the refusal
 * said under them.
 */
function useSheetStart(start: () => Promise<StartAnswer>): {
  readonly starting: boolean;
  readonly note: string | undefined;
  readonly go: () => void;
} {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const go = () => {
    if (starting) return;
    setStarting(true);
    setNote(undefined);
    start()
      .then((answer) => {
        if ("refused" in answer) {
          setNote(answer.refused);
          buzz(NotificationFeedbackType.Error);
          return;
        }
        buzz(NotificationFeedbackType.Success);
        router.dismiss();
        router.navigate(`/tasks/${encodeURIComponent(answer.taskId)}`);
        if (answer.agentId !== undefined) {
          router.push(`/tasks/agent/${encodeURIComponent(answer.agentId)}`);
        }
      })
      .finally(() => setStarting(false));
  };
  return { starting, note, go };
}

/**
 * New agent on a task, as the panel's draft tab starts one: what to ask of
 * it, the model and effort it runs on, the account's default until another
 * is picked, and where it runs.
 */
export function NewAgentScreen({ taskId }: { readonly taskId: string }) {
  const [prompt, setPrompt] = useState("");
  const [runsOn, setRunsOn] = useState(CLOUD);
  const pick = useModelPick();
  const startAgent = useStartAgent(taskId);
  const { starting, note, go } = useSheetStart(() =>
    startAgent({ prompt: prompt.trim(), picked: pick.picked, runsOn }),
  );
  return (
    <>
      <SheetBar title={WORDS.NEW_AGENT} ready={prompt.trim() !== "" && !starting} onStart={go} />
      <Screen>
        <SettingsForm>
          <ListSection footer={note}>
            <WordsField
              placeholder={WORDS.AGENT_PLACEHOLDER}
              onWords={setPrompt}
              autoFocus
              testId="new-agent-words"
            />
          </ListSection>
          <AgentSection pick={pick} runsOn={runsOn} onRunsOn={setRunsOn} />
        </SettingsForm>
      </Screen>
    </>
  );
}

/**
 * New task, Home's composer as a sheet: the task described, the repository
 * it works in, the newest one the account's tasks were about until another
 * is picked, its agent's model and effort, and where its agent runs. Start
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
  const { starting, note, go } = useSheetStart(() =>
    startTask({
      prompt: prompt.trim(),
      picked: pick.picked,
      runsOn,
      repository: repository.picked,
    }),
  );
  return (
    <>
      <SheetBar title={WORDS.NEW_TASK} ready={prompt.trim() !== "" && !starting} onStart={go} />
      <Screen>
        <SettingsForm>
          <ListSection footer={note}>
            <WordsField
              placeholder={WORDS.TASK_PLACEHOLDER}
              onWords={setPrompt}
              autoFocus
              testId="new-task-words"
            />
          </ListSection>
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
