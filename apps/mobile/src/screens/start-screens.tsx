// start-screens.tsx -- the two pages that start work, each a new conversation's page over the agent page's composer: New agent on a task, its words and pictures, with its model and effort and where it runs as capsule menus under the composer's field; and New task, Home's composer: the task described and its pictures, its relation to another task picked from the +, and its repository, model and effort, and where its agent runs as capsules.

import { type AgentFork, FORK_WORDS, forkChoice } from "@repo/features/agent-fork-model";
import { hasWordsOrFiles } from "@repo/features/agent-wire";
import { FAILURE_REASON } from "@repo/features/failure-remedy";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { agentName, providerOf } from "@repo/features/model-label";
import { cardTitle } from "@repo/features/plain-words";
import { REPLY_BUTTON_ACTION } from "@repo/features/reply-button-wire";
import { type SuggestionRefusal, sentOf, suggestedChoice } from "@repo/features/suggestion-model";
import { NO_REPOSITORY } from "@repo/features/task-list-model";
import { REMOVE_RELATION, TASK_RELATION_MENU } from "@repo/features/task-relation-model";
import {
  TASK_CREATE_RELATION_WORDS,
  TASK_STATUS_TONE,
  TASK_STATUS_WORDS,
} from "@repo/features/task-standing-words";
import {
  isTaskSettled,
  TASK_CREATE_RELATION_KIND,
  TASK_STATUS,
  type TaskCreateRelation,
  type TaskCreateRelationKind,
  type TaskSummary,
} from "@repo/features/task-wire";
import type { VoiceCallInto } from "@repo/features/voice-call-session";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  type BarMenu,
  BUZZ,
  buzz,
  Chip,
  type ChipMenuGroup,
  ConfirmAsk,
  FieldChip,
  GLYPH,
  type Glyph,
  glyphSymbol,
  MENU_CHIP_LOOK,
  MenuChip,
  ModelChoiceSheet,
  type PickOption,
  runsOnGlyph,
  STATUS_MARK_SYMBOL,
  StartPage,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useNavigation, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useShownAgent } from "../agents/use-agent.js";
import { type OpenedSuggestion, useSuggestionSender } from "../agents/use-suggestions.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { useCloseSheet } from "../close-sheet.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useListedTasks } from "../host/host-provider.js";
import { useOnTab } from "../tab-route.js";
import {
  CLOUD,
  inTree,
  type ModelPick,
  type RepositoryPick,
  runsOnOptions,
  type StartAnswer,
  startRefusalWords,
  useModelPick,
  useRepositoryPick,
  useStartAgent,
  useStartFork,
  useStartTask,
} from "../tasks/use-start.js";
import { useAttachedPictures } from "../use-attached-pictures.js";
import { DISCARD_WORDS, type KeptWords, useKeptWords } from "../use-kept-words.js";
import { type SkillsOffered, useSkillOffer } from "../use-skill-offer.js";
import { useWrite } from "../use-write.js";
import { type NewAgentTalk, useNewAgentTalk } from "../voice-call.js";

/** The panel's words for the sheets, their capsules, their menus, and their acts. */
const WORDS = {
  NEW_AGENT: "New agent",
  /** What VoiceOver hears for the task New agent starts on, which the capsule says with its ring and name alone. */
  STARTS_ON: (task: string, status: string) => `Starts on ${task}, ${status}`,
  NEW_TASK: "New task",
  AGENT_PLACEHOLDER: "Ask to make changes",
  TASK_PLACEHOLDER: "Describe the task",
  REPOSITORY: "Repository",
  MODEL: "Model",
  EFFORT: "Effort",
  RUNS_ON: "Machine",
  PHOTOS: "Photos",
  TASK_RELATION: TASK_RELATION_MENU,
  RELATION: "Relation",
  SWAP_TASK: "Swap task",
  REMOVE_RELATION,
  CANCEL: "Cancel",
  NO_REPOSITORIES: "The workspace's GitHub reaches no repository yet.",
  TRY_AGAIN: "Try again",
  /** The line over a fork's draft, naming its source where it is known and quoting the message it forks at, as the panel's chip over the box does. */
  FORK_OF: (agent: string | undefined, opening: string) => {
    const of = `${FORK_WORDS.OF} ${agent ?? AGENT_WORD}`;

    return opening === "" ? of : `${of} ${FORK_WORDS.AT} “${opening}”`;
  },
  /** The line over a suggestion's draft, naming the agent that suggested it where it is known, as the panel's chip over the box does. */
  SUGGESTED_BY: (agent: string | undefined, label: string) => {
    const by = agent === undefined ? "Suggested" : `Suggested by ${agent}`;

    return label === "" ? by : `${by}: “${label}”`;
  },
} as const;

/** A fork that names no agent, which New agent opened as no fork never sends. */
const NO_FORK: AgentFork = { agentId: "", opening: "" };

/** What a fork's source is named while it is read, as the panel names an agent of no name. */
const AGENT_WORD = "agent";

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

/** Where a closing start lands once it went: on its task's page, or on to the agent it started. */
const LANDING = {
  TASK: "task",
  AGENT: "agent",
} as const;

type Landing = (typeof LANDING)[keyof typeof LANDING];

/**
 * The page's bar: its name, and the system's ✕ at its leading edge (Cancel
 * to VoiceOver), as a new conversation's page closes; and the ask the ✕
 * raises while the page holds a draft, and the question Talk asks first
 * while another call stands. Start and Talk stand at the composer's end,
 * as Send and Talk do on an agent's page.
 */
function SheetBar({
  title,
  kept,
  talk,
}: {
  readonly title: string;
  readonly kept: KeptWords;
  /** Talk where the page offers it, whose question stands here; none where it offers none. */
  readonly talk?: NewAgentTalk | undefined;
}) {
  const colors = useColors();
  const close = useCloseSheet(kept);

  // Note that the options are made once for their title and colors, because the stack sets a screen's options again whenever a new object comes, which a key typed would make.
  const options = useMemo(
    () => ({
      headerShown: true,
      title,
      headerTintColor: colors.TEXT,
      headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.GROUND },
    }),
    [title, colors],
  );

  return (
    <>
      {/* Note that the bar has no ground of its own, so the system draws its buttons in glass over the sheet's. */}
      <Stack.Screen options={options} />
      <Stack.Toolbar placement="left">
        {/* Note that the page closes with the system's ✕, as a new conversation's page does, its word kept for VoiceOver. */}
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={WORDS.CANCEL}
          onPress={close}
        />
      </Stack.Toolbar>
      {talk === undefined ? null : <ConfirmAsk destructive {...talk.switching} />}
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
    id: option.id,
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
 * them, "Opus 5.5 · High", led by its harness's mark: a capsule that opens
 * the model sheet (`StartModelSheet`) on a tap; where the models could not
 * be read, Try again in its place, the reason said under the words.
 */
function ModelChip({ pick, onOpen }: { readonly pick: ModelPick; readonly onOpen: () => void }) {
  if (pick.models.length === 0) {
    return pick.failed === undefined ? null : (
      <Chip label={WORDS.TRY_AGAIN} symbol={GLYPH.RETRY} onPress={pick.retry} />
    );
  }

  const efforts = pick.efforts.length > 1 ? pick.efforts : [];
  const model = labelOf(pick.models, pick.model) ?? WORDS.MODEL;
  const effort = labelOf(efforts, pick.shown?.effort);
  const harness = pick.model === undefined ? undefined : providerOf(pick.model);

  return (
    <MenuChip
      look={MENU_CHIP_LOOK.COMPOSER}
      label={effort === undefined ? model : `${model}${JOINED}${effort}`}
      {...(harness === undefined ? {} : { harness })}
      onOpen={onOpen}
    />
  );
}

/**
 * The model sheet a start opens from its model capsule, as the agent's page
 * opens it: the models under each harness's mark, the effort right under the
 * model, and Fast where the model has a fast version. It offers no
 * permission mode, since a start takes none and a new agent runs on the
 * account's default. A pick takes as it is pressed, so Done only closes it.
 */
function StartModelSheet({
  pick,
  presented,
  onDismiss,
}: {
  readonly pick: ModelPick;
  readonly presented: boolean;
  readonly onDismiss: () => void;
}) {
  const models = pick.models.flatMap((option) => {
    const provider = providerOf(option.id);

    return provider === undefined ? [] : [{ ...option, provider }];
  });

  return (
    <ModelChoiceSheet
      presented={presented}
      onDismiss={onDismiss}
      models={models}
      model={pick.model}
      onModel={pick.pickModel}
      efforts={pick.efforts}
      effort={pick.shown?.effort}
      onEffort={pick.pickEffort}
      fast={pick.fast === undefined ? undefined : { on: pick.fast.on, onSwitch: pick.fast.toggle }}
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
      look={MENU_CHIP_LOOK.COMPOSER}
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

/** What leads a repository's capsule, as the panel's repository chip leads: the picked repository's owner's picture, or the glyph standing for none. */
function repositoryLead(
  repository: string | undefined,
): { readonly repository: string } | { readonly symbol: Glyph } {
  return repository === undefined ? { symbol: GLYPH.NO_REPOSITORY } : { repository };
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
    return (
      <MenuChip
        look={MENU_CHIP_LOOK.COMPOSER}
        label={tree.repository ?? NO_REPOSITORY}
        {...repositoryLead(tree.repository ?? undefined)}
      />
    );
  }

  if (repository.options.length > 0) {
    return (
      <MenuChip
        look={MENU_CHIP_LOOK.COMPOSER}
        label={labelOf(repository.options, repository.picked) ?? WORDS.REPOSITORY}
        {...repositoryLead(repository.picked)}
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
        <MenuChip
          look={MENU_CHIP_LOOK.COMPOSER}
          label={repository.picked}
          {...repositoryLead(repository.picked)}
        />
      )}
      {repository.failed === undefined ? null : (
        <Chip label={WORDS.TRY_AGAIN} symbol={GLYPH.RETRY} onPress={repository.retry} />
      )}
    </>
  );
}

type UseSheetStartResult = {
  readonly starting: boolean;
  readonly go: (
    start: () => Promise<StartAnswer>,
    refusal?: string | undefined,
    brief?: string | undefined,
    /** Talk's call, opened on the agent the start made once it lands; none for a start on words. */
    called?: ((into: VoiceCallInto) => void) | undefined,
  ) => void;
};

type Started = { answer?: StartAnswer };

/** A route in a navigator's state, as React Navigation hands it: its key, its params, and the navigator under it. */
type RouteNode = {
  readonly key?: string | undefined;
  readonly params?: object | undefined;
  readonly state?: NavigatorState | undefined;
};

/** A navigator's state, as React Navigation hands it. */
type NavigatorState = {
  readonly index?: number | undefined;
  readonly routes: readonly RouteNode[];
};

/** Where the reader stands: the focused route by its key, and its params as written, which a split view's pick moves. */
type Standing = { readonly key: string | undefined; readonly params: string | undefined };

/** The route focused inside `route`, as `getCurrentRoute` descends to it. */
function focusedIn(route: RouteNode | undefined): RouteNode | undefined {
  const state = route?.state;

  if (state === undefined) return route;

  return focusedIn(state.routes[state.index ?? state.routes.length - 1]);
}

/** A navigator, as React Navigation hands it, read only for its state and the navigator over it. */
type Navigator = {
  readonly getState: () => NavigatorState;
  readonly getParent: () => Navigator | undefined;
};

/**
 * The navigator a sheet was presented on: the first, from the sheet's own up,
 * with a route beneath its top. Note that it is found by walking up, because
 * a sheet may stand in a stack of its own, as New task's layout does.
 */
function presentingNavigator(own: Navigator): Navigator {
  const state = own.getState();
  const parent = own.getParent();

  return (state.index ?? 0) > 0 || parent === undefined ? own : presentingNavigator(parent);
}

/** Where the reader stands in a navigator, `back` routes below its top: the focused route there, by key and params. */
function standingIn(navigator: Navigator, back: number): Standing {
  const state = navigator.getState();
  const at = (state.index ?? state.routes.length - 1) - back;

  return standingOf(at < 0 ? undefined : focusedIn(state.routes[at]));
}

/** Where a route stands, by its key and its params, which React Navigation keeps serializable. */
function standingOf(route: RouteNode | undefined): Standing {
  return { key: route?.key, params: JSON.stringify(route?.params) };
}

/** Whether the reader stands where they stood: the same route, with the same row selected. */
function sameStanding(was: Standing, now: Standing): boolean {
  return was.key === now.key && was.params === now.params;
}

/**
 * Sends a start once, while none is out: on an agent started, the sheet
 * gives way to its page; on a task made whose agent was refused, to the task's page; on a refusal, the sheet stays
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

  const go = (
    start: () => Promise<StartAnswer>,
    refusal?: string | undefined,
    brief?: string | undefined,
  ) => {
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
          onTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId: answer.taskId })),
        );

        // Note that the agent's page is handed the title its brief reads as, which names it in the bar until the task list does, rather than a bare "Agent"; the title alone travels in the route, never the brief's whole words.
        const title = brief === undefined ? "" : cardTitle(brief);

        if (answer.agentId !== undefined) {
          router.push({
            pathname: onTab(iosAgentRoute(answer.agentId)),
            params: title === "" ? {} : { brief: title },
          });
        }
      })
      .finally(() => setStarting(false));
  };

  return { starting, go };
}

/**
 * New task's and New agent's start, as the panel's sends it: the sheet
 * closes the moment Start is pressed, and the start goes on as a write,
 * opening the task's page once it lands, where its new agent stands among
 * its agents; New agent's then opens the new agent's page over it, titled
 * by its brief, as the panel's New agent lands on the agent it started. A start refused is said in the failure notice, whose Try again
 * sends the same start again. Note that this never makes a second task or
 * agent, because the task's id and its agent's key are minted once per sheet
 * (`useStartTask`, `useStartAgent`), and the service answers
 * a start it already made with the same one. Pictures the service would
 * refuse still hold the sheet, saying why under its words.
 */
function useClosingStart(
  kept: KeptWords,
  setNote: (note: string | undefined) => void,
  landing: Landing,
): UseSheetStartResult {
  const router = useRouter();
  const navigation: Navigator = useNavigation();
  const onTab = useOnTab();
  const write = useWrite();
  // Note that a start goes once, so a second press while the sheet slides away sends nothing.
  const [sent, setSent] = useState(false);

  const go = (
    start: () => Promise<StartAnswer>,
    refusal?: string | undefined,
    brief?: string | undefined,
    called?: ((into: VoiceCallInto) => void) | undefined,
  ) => {
    if (sent) return;

    if (refusal !== undefined) {
      setNote(refusal);
      buzz(BUZZ.WARNING);

      return;
    }

    setSent(true);
    // Note that where the reader stands is kept as Start is pressed, in the navigator the sheet was presented on: the sheet, and the route it uncovers.
    const presenting = presentingNavigator(navigation);
    const sheet = standingIn(presenting, 0);
    const uncovered = standingIn(presenting, 1);
    kept.release();
    router.dismiss();
    const started: Started = {};

    void write(
      () =>
        start().then((answer) => {
          started.answer = answer;

          return answer;
        }),
      {
        refused: (answer) => ("refused" in answer ? answer.refused : undefined),
        retry: true,
        went: BUZZ.SUCCESS,
        // Note that the landing runs once the start went, on its first send or a Try again, so a start taken on Try again opens its task too.
        done: () => {
          const answer = started.answer;

          if (answer === undefined || "refused" in answer) return;

          // Note that Talk's call opens on the agent it started wherever the reader went meanwhile, since the call's way back reaches it from any screen.
          if (called !== undefined && answer.agentId !== undefined) {
            called({ agentId: answer.agentId, taskId: answer.taskId });
          }

          // Note that the task opens only while the reader stands where Start left them, on the same route with the same row selected, so a page they opened or a row they picked meanwhile stands.
          const now = standingIn(presenting, 0);

          if (!sameStanding(sheet, now) && !sameStanding(uncovered, now)) return;
          router.navigate(
            onTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId: answer.taskId })),
          );

          // Note that New task lands on the task's page alone, its new agent standing in its Agents section, while New agent and Talk go on to the agent it started, titled by its brief as the sheet's start names it, so Back returns to the task.
          if ((landing !== LANDING.AGENT && called === undefined) || answer.agentId === undefined) {
            return;
          }

          const title = brief === undefined ? "" : cardTitle(brief);
          router.push({
            pathname: onTab(iosAgentRoute(answer.agentId)),
            params: title === "" ? {} : { brief: title },
          });
        },
      },
    );
  };

  return { starting: sent, go };
}

/** The skills a `/` offers, as the start page takes them. */
function offered(skills: SkillsOffered | undefined) {
  return skills === undefined
    ? undefined
    : { skills: skills.skills, empty: skills.empty, onPick: skills.pick };
}

/**
 * New agent on a task, as the panel's draft tab starts one: the task it
 * starts on, named over the words, what to ask of it and the pictures that
 * go with it, the model and effort it runs on, the
 * account's default until another is picked, and where it runs. Opened on a
 * suggestion (`opened`), it starts filled in with the suggestion's brief and
 * model under a line naming who suggested it, offers no Runs on, and its
 * Start goes through the suggestion, once, as the panel's draft sends one.
 * Opened as a fork of an agent at one of its messages (`fork`), it is the
 * panel's forked draft: headed by the source and the message's opening
 * words, on the source's model until another is picked, running where the
 * source runs, so it offers no Runs on and no Talk, and its Start goes with
 * the box empty, the new agent handed the transcript up to that message.
 */
export function NewAgentScreen({
  taskId,
  opened,
  fork,
}: {
  readonly taskId: string;
  readonly opened?: OpenedSuggestion | undefined;
  readonly fork?: AgentFork | undefined;
}) {
  const action = opened?.view.action;
  const brief = action?.kind === REPLY_BUTTON_ACTION.START ? action.prompt : "";
  const [prompt, setPrompt] = useState(brief);
  const [runsOn, setRunsOn] = useState(CLOUD);
  const source = useShownAgent(fork?.agentId ?? "");

  const pick = useModelPick(
    action !== undefined
      ? suggestedChoice(action)
      : source === undefined
        ? undefined
        : forkChoice(source),
  );

  const [modelsShown, setModelsShown] = useState(false);
  const startAgent = useStartAgent(taskId);
  const startFork = useStartFork(taskId, fork ?? NO_FORK);
  const sendSuggestion = useSuggestionSender();
  const suggester = useShownAgent(opened?.suggestion.agentId ?? "");
  // Note that a suggestion's agent starts on its suggester's task, as the service starts it, so Start waits until that task is read.
  const suggestedTask = suggester?.taskId;
  const placed = opened === undefined || suggestedTask !== undefined;
  const listed = useListedTasks();
  const startsOn = listed.find((task) => task.id === (suggestedTask ?? taskId));
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote);
  const drafted = hasWordsOrFiles(prompt.trim(), pictures.files);
  const kept = useKeptWords(drafted);
  const sheet = useSheetStart(kept, setNote);
  const closing = useClosingStart(kept, setNote, LANDING.AGENT);
  const starting = sheet.starting || closing.starting;
  const skills = useSkillOffer(prompt, setPrompt, { taskId: taskId });

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

  // Talk starts the agent blank on the sheet's chips and calls it once it lands; a suggestion's sheet offers none.
  const talk = useNewAgentTalk(
    () =>
      new Promise<VoiceCallInto | undefined>((called) =>
        closing.go(
          () =>
            startAgent({ prompt: undefined, attachments: undefined, picked: pick.picked, runsOn }),
          undefined,
          undefined,
          called,
        ),
      ),
  );

  // Note that New agent's own start closes the sheet at once, as New task's does, while a suggestion's keeps it up until the service answers, since it goes through the suggestion once, as the panel's draft sends one.
  const start = () =>
    fork !== undefined
      ? closing.go(
          () =>
            startFork({ prompt: prompt.trim(), attachments: pictures.files, picked: pick.picked }),
          pictures.refusal,
          prompt.trim(),
        )
      : opened === undefined
        ? closing.go(
            () =>
              startAgent({
                prompt: prompt.trim(),
                attachments: pictures.files,
                picked: pick.picked,
                runsOn,
              }),
            pictures.refusal,
            prompt.trim(),
          )
        : sheet.go(
            () => startSuggested(opened.suggestion),
            pictures.refusal,
            // Note that a suggestion's start is named by its own title where it has one, as the service names the agent.
            opened.suggestion.title ?? prompt.trim(),
          );

  return (
    <>
      <SheetBar
        title={WORDS.NEW_AGENT}
        kept={kept}
        talk={opened === undefined && fork === undefined ? talk : undefined}
      />
      <StartModelSheet
        pick={pick}
        presented={modelsShown}
        onDismiss={() => setModelsShown(false)}
      />
      <StartPage
        title={
          fork !== undefined
            ? WORDS.FORK_OF(source === undefined ? undefined : agentName(source), fork.opening)
            : opened === undefined
              ? undefined
              : WORDS.SUGGESTED_BY(
                  suggester === undefined ? undefined : agentName(suggester),
                  opened.suggestion.label,
                )
        }
        head={startsOn === undefined ? undefined : <StartsOnChip task={startsOn} />}
        words={{
          placeholder: WORDS.AGENT_PLACEHOLDER,
          words: prompt,
          onWords: setPrompt,
          onLongPaste: pictures.pasteText,
        }}
        skills={offered(skills)}
        pictures={pictures.attached}
        onDetach={pictures.detach}
        onDropPictures={pictures.drop}
        notes={notesOf(note, pick.failed)}
        add={{ onAdd: pictures.attach }}
        // Note that a fork goes with the box empty, as the panel's forks alone.
        ready={(drafted || fork !== undefined) && placed && !starting}
        onStart={start}
        onTalk={
          talk === undefined ||
          opened !== undefined ||
          fork !== undefined ||
          !talk.ready ||
          starting
            ? undefined
            : talk.onTalk
        }
        testIds={{ field: TEST_IDS.NEW_AGENT.WORDS, add: TEST_IDS.NEW_AGENT.ATTACH }}
        trailing={<ModelChip pick={pick} onOpen={() => setModelsShown(true)} />}
        chips={
          <>
            {/* Note that a suggestion's agent runs where the member's agents on the task run, so it offers no Runs on, as the panel's draft hides it. */}
            {/* Note that a fork runs where its source runs, as the panel's forked draft starts it unless another place is picked. */}
            {opened === undefined && fork === undefined ? (
              <RunsOnChip pick={pick} runsOn={runsOn} onRunsOn={setRunsOn} />
            ) : null}
          </>
        }
      />
    </>
  );
}

/**
 * The task New agent starts on, over its words as a capsule with the task's
 * ring and name. Note that the panel starts an agent from a draft tab on the
 * task's own page, which names the task, while this sheet covers that page,
 * so it says which task the agent works on; it takes no press, since an agent
 * starts only on the task it was opened from.
 */
function StartsOnChip({ task }: { readonly task: TaskSummary }) {
  const status = task.status ?? TASK_STATUS.TODO;

  return (
    <FieldChip
      label={task.name}
      status={status}
      heard={WORDS.STARTS_ON(task.name, TASK_STATUS_WORDS[status])}
    />
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

/** What a menu of tasks to relate to reads of the pick: the tasks it may name, the one named, and how to name one. */
type RelationChoices = Pick<RelationPick, "tasks" | "relation" | "pick">;

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
function taskChoices(
  pick: RelationChoices,
  kind: TaskCreateRelationKind,
): ChipMenuGroup["choices"] {
  return pick.tasks.map((task) => ({
    label: task.name,
    id: task.id,
    symbol: STATUS_MARK_SYMBOL[task.status ?? TASK_STATUS.TODO],
    tone: TASK_STATUS_TONE[task.status ?? TASK_STATUS.TODO],
    on: pick.relation?.kind === kind && pick.relation.taskId === task.id,
    onPress: () => pick.pick({ kind, taskId: task.id }),
  }));
}

/** The + menu's Task relation, as the panel's + offers it: each kind, then the task it names; none while no task may be named. */
function relationMenu(pick: RelationChoices): BarMenu | undefined {
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
 * New task, Home's composer as a page of its own: the task described and the
 * pictures that go with it, the task it is related to, picked from the +
 * and shown at the page's head once picked, and, as capsules under the
 * composer's field, the repository it works in, the newest one the account's tasks
 * were about until another is picked, or its parent's in another's tree,
 * its agent's model and effort, and where its agent runs. Start makes the
 * task and starts its agent in one act, as Home does, in the workspace the
 * app works in, or the one a share draft it opens on was kept for. A task's New sub-task opens it as a sub-task of `parent`, in the
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
  const listed = useListedTasks();
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
  const [modelsShown, setModelsShown] = useState(false);
  const startTask = useStartTask(workspaceId);
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote, draft?.pictures);
  // Note that a share draft's pictures are read as the sheet opens, and nothing starts until they are in, so its words never go without them.
  const drafted = hasWordsOrFiles(prompt.trim(), pictures.files) && !pictures.opening;
  const kept = useKeptWords(drafted);
  const { starting, go } = useClosingStart(kept, setNote, LANDING.TASK);
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

  // Note that the relation picked, whose Swap task lists every open task, is drawn again only as the pick or the tasks change, never on a key typed; its acts set the pick, which never changes.
  const head = useMemo(
    () => <RelationChip pick={relation} />,
    [relation.relation, relation.task, relation.tasks],
  );

  // Note that the relation menu, a choice for each open task under each kind, is made again only as the tasks or the pick change, never on a key typed.
  const related = useMemo(
    () => relationMenu({ tasks: relation.tasks, relation: relation.relation, pick: relation.pick }),
    [relation.tasks, relation.relation, relation.pick],
  );

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
      prompt.trim(),
    );
  };

  // Talk starts the task and its agent blank on the sheet's chips and calls the agent once it lands.
  const talk = useNewAgentTalk(
    () =>
      new Promise<VoiceCallInto | undefined>((called) =>
        go(
          // Note that a task made whose agent was refused is said as a refusal, with Try again, since Talk has no agent to call without one.
          () =>
            startTask({
              prompt: undefined,
              attachments: undefined,
              picked: pick.picked,
              runsOn,
              ...place,
            }).then((answer) =>
              "taskId" in answer && answer.agentId === undefined && answer.note !== undefined
                ? { refused: answer.note }
                : answer,
            ),
          undefined,
          undefined,
          called,
        ),
      ),
  );

  return (
    <>
      <SheetBar title={WORDS.NEW_TASK} kept={kept} talk={talk} />
      <StartModelSheet
        pick={pick}
        presented={modelsShown}
        onDismiss={() => setModelsShown(false)}
      />
      <StartPage
        head={head}
        words={{
          placeholder: WORDS.TASK_PLACEHOLDER,
          words: prompt,
          onWords: setPrompt,
          onLongPaste: pictures.pasteText,
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
        }}
        ready={drafted && placed && !starting}
        onStart={start}
        onTalk={
          talk === undefined || pictures.opening || !talk.ready || !placed || starting
            ? undefined
            : talk.onTalk
        }
        testIds={{ field: TEST_IDS.NEW_TASK.WORDS, add: TEST_IDS.NEW_TASK.ATTACH }}
        trailing={<ModelChip pick={pick} onOpen={() => setModelsShown(true)} />}
        chips={
          <>
            <RepositoryChip repository={repository} tree={tree} />
            <RunsOnChip pick={pick} runsOn={runsOn} onRunsOn={setRunsOn} />
          </>
        }
      />
    </>
  );
}
