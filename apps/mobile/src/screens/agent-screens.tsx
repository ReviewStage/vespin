// agent-screens.tsx -- one agent's page, its transcript live under the system's header naming it, its held calls answered, its composer, or Unarchive in its place while it is archived, Continue in new agent over it where only a new agent goes on, with its + of Photos and MCP servers and its model chip, whose sheet holds its model, effort, Fast and permission mode, its ⋯ menu, its run actions and its Permanently delete among it, a page it showed, opened whole, and the sheet of its listening ports.

import {
  CONTINUE_AGAIN_LABEL,
  CONTINUE_LABEL,
  continuedByIds,
  endLineOffersContinue,
  endLineReason,
  failedLineWords,
  settledFailure,
} from "@repo/features/agent-continue-model";
import {
  AGENT_PORTS_WORDS,
  PORT_ACT,
  type PortAct,
  type PortRow,
} from "@repo/features/agent-ports-model";
import { messageFailureWords } from "@repo/features/agent-refusal-words";
import {
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentOverviewPullRequest,
  type AgentStatus,
  type AgentTranscriptMessage,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { agentStateWords } from "@repo/features/glyph-state";
import type { AgentThreadsLine } from "@repo/features/inbox-list-model";
import { UNDELIVERED_FILES_LOST } from "@repo/features/inbox-undelivered";
import { iosAppRouteOf, iosRepositoryPullRequestRoute } from "@repo/features/ios-app-links";
import { agentActivity } from "@repo/features/ios-system-activity";
import {
  LINK_DESTINATION,
  linkOf,
  linkWorkspaceStep,
  pullRequestAddressOf,
} from "@repo/features/link-grammar";
import { managerChatLines } from "@repo/features/manager-chat";
import { agentName, modelLabel, providerOf } from "@repo/features/model-label";
import { cardTitle } from "@repo/features/plain-words";
import {
  MERGE_ACTION,
  MERGE_PRESS_WORDS,
  MERGE_WORDS,
  mergeActionFor,
} from "@repo/features/pull-request-model";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { REPLY_BUTTON_ACTION } from "@repo/features/reply-button-wire";
import { RUN_ACTION_WORDS, runActionMenuLabel } from "@repo/features/run-actions-model";
import { MESSAGE_SUGGESTION_REFUSAL, sentOf } from "@repo/features/suggestion-model";
import {
  agentRunsOnWords,
  agentStillWriting,
  RUNS_ON_WORDS,
} from "@repo/features/task-agents-model";
import { TRANSCRIPT_COPY, type TranscriptCopy } from "@repo/features/transcript-copy";
import { MCP_SERVER_LABEL, PATH_OPENS, VERB } from "@repo/features/words";
import {
  type FollowedAgent,
  selectInboxReader,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { PERMISSION_MODE_WORDS } from "@repo/settings";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  AgentTranscript,
  ArchivedBar,
  AskNote,
  AttachedPictures,
  askForName,
  BAR_TITLE,
  type BarSubtitle,
  BUTTON_LOOK,
  CallCardRow,
  COMPOSER_CALL,
  Composer,
  type ComposerCall,
  type ComposerDictation,
  type ComposerMenu,
  ConfirmAsk,
  ContinueLine,
  DeniesWaiting,
  drawnCallIds,
  EditingLine,
  FORM_SPACING,
  footerToneOf,
  GLYPH,
  GlassDock,
  type Glyph,
  glyphSymbol,
  HeldCallBanner,
  ListSection,
  MENU_CHIP_LOOK,
  MentionSuggestions,
  MenuChip,
  MenuRow,
  type MenuRowAct,
  ModelChoiceSheet,
  NO_GROUND,
  NO_TOGGLES,
  openCuts,
  PERMISSION_MODE_GLYPH,
  QueuedLines,
  runsOnGlyph,
  Screen,
  SettingsForm,
  SkillSuggestions,
  StackSubtitle,
  shownFiles,
  shownMediaIds,
  ThreadsLine,
  TRANSCRIPT_ITEM,
  type TranscriptItem,
  type TranscriptReveal,
  type TranscriptToggles,
  toggledAt,
  transcriptItems,
  transcriptOriginOf,
  type UndeliveredLine,
  useAnnounced,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
  withSending,
  withWaitingLine,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useAgentMedia,
  useAgentPullRequests,
  useAgentTranscript,
  useFollowedAgent,
  useOlderPages,
  useSentFiles,
  useShownAgent,
  useTranscriptRetry,
  useWholeParts,
} from "../agents/use-agent.js";
import { useAgentActions } from "../agents/use-agent-actions.js";
import { type AgentApprovals, useAgentApprovals } from "../agents/use-agent-approvals.js";
import {
  type AgentComposer,
  type SuggestedSend,
  type UndeliveredActs,
  undeliveredWhole,
  useAgentComposer,
} from "../agents/use-agent-composer.js";
import { type AgentMode, useAgentMode } from "../agents/use-agent-mode.js";
import { type AgentModelPick, useAgentModelPick } from "../agents/use-agent-model.js";
import { useAgentOrigin } from "../agents/use-agent-origin.js";
import { useAgentHasPorts, useAgentPorts } from "../agents/use-agent-ports.js";
import { useAgentRun } from "../agents/use-agent-run.js";
import { type AgentServers, useAgentServers } from "../agents/use-agent-servers.js";
import { type AgentCommandsPlace, useAgentCommandsPlace } from "../agents/use-agent-tools.js";
import { useManagerChatLooks, useManagersListed } from "../agents/use-managers.js";
import { useMessageActs } from "../agents/use-message-acts.js";
import {
  type OpenedSuggestion,
  useOpenedSuggestion,
  useSuggestionAddress,
  useSuggestionLooks,
  useSuggestionSender,
} from "../agents/use-suggestions.js";
import { useTranscriptCopy } from "../agents/use-transcript-copy.js";
import { useWarmAgent } from "../agents/use-warm-agent.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useAgentThreadsLine } from "../inbox/use-agent-threads.js";
import { useNewestNote } from "../newest-note.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import {
  type PullRequestKey,
  usePullRequestsRead,
  usePullRequestWrites,
} from "../pull-requests/use-pull-request.js";
import { useSheetAtHalf } from "../sheet-stack.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab, useOnTab } from "../tab-route.js";
import { useDevicePlatform } from "../tasks/use-start.js";
import { useDictation } from "../use-dictation.js";
import { useAgentTalk, useStandingCallCard } from "../voice-call.js";
import { openedVersion, PageScreen } from "./page-screens.js";

/** The agent's threads line over its box, and what a press on it opens. */
interface AgentThreadsDock {
  readonly line: AgentThreadsLine;
  readonly onOpen: (threadId: string) => void;
}

/** What an agent is called where neither the task list nor its transcript names it, as the panel's tab names one it cannot find. */
const UNLISTED_AGENT = "Agent";

/** What stands in the transcript's place while it is read, and where it could not be, with what reads it again. */
const TRANSCRIPT_WORDS = {
  READING: "Reading the transcript",
  FAILED: "The transcript could not be read.",
  RETRY: "Try again",
} as const;

/** What the page's ⋯ menu offers, beside Open in browser, as the panel's agent menu words them. */
const MENU_WORDS = {
  MORE: "More",
  COPY_LINK: APP_SHORTCUTS[APP_COMMAND.COPY_LINK].label,
  RENAME: "Rename",
  PIN: "Pin",
  UNPIN: "Unpin",
  ARCHIVE: "Archive",
  UNARCHIVE: "Unarchive",
  DELETE: "Permanently delete",
  OVERVIEW: "Overview",
  SETTINGS: "Settings…",
} as const;

/** What Copy transcript offers, in the panel's words: the transcript concise or whole, copied, and the same words handed to the share sheet. */
const COPY_TRANSCRIPT_WORDS = {
  COPY: "Copy transcript",
  CONCISE: "Concise",
  FULL: "Full",
  SHARE: "Share…",
} as const;

/** What the + offers, as the desktop composer's + does: the photo picker, and the MCP servers the agent is handed. */
const ADD_WORDS = {
  PHOTOS: "Photos",
  /** What the model chip is heard as, which opens the model sheet. */
  MODEL: "Model",
} as const;

/** What Rename asks, in the system's alert a task's Rename asks in too (`askForName`). */
const RENAME_WORDS = {
  TITLE: "Rename agent",
  ACT: "Rename",
} as const;

/** What the model chip says between a model and its effort, as the panel's chip joins them. */
const MODEL_JOINED = " · ";

/** The name a flow finds the composer's model chip by. */
const MODEL_CHIP_ID = "agent-model-chip";

/** What a pull request's card offers beside Review where it may merge now. */
const MERGE_WORD = "Merge";

/** A transcript's messages as its page draws them: a Manager's as its chat (`managerChatLines`), any other agent's whole. */
function chatOrTranscript(
  messages: readonly AgentTranscriptMessage[],
  chat: boolean,
): readonly AgentTranscriptMessage[] {
  return chat ? managerChatLines(messages) : messages;
}

/** The agent's address on vespin.dev, under its workspace and its task, once the agent is read; none before its workspace is known. */
function useAgentAddress(
  agentId: string,
  workspaceId: string | undefined,
  taskId: string | undefined,
): string | undefined {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const step = linkWorkspaceStep(workspaceId, workspaces);

  const place =
    taskId === undefined
      ? { kind: LINK_DESTINATION.AGENT, agentId }
      : { kind: LINK_DESTINATION.AGENT, taskId: taskId, agentId };

  return step === undefined ? undefined : linkOf(place, step);
}

/**
 * A message's address on vespin.dev under its agent, as the panel's Copy
 * link names one (`agentMessagePlace`), by the message's id; none before the
 * agent's workspace is known.
 */
function useMessageLink(
  agentId: string,
  workspaceId: string | undefined,
): ((messageId: string) => string | undefined) | undefined {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const step = linkWorkspaceStep(workspaceId, workspaces);

  if (step === undefined) return undefined;

  return (messageId) => linkOf({ kind: LINK_DESTINATION.MESSAGE, agentId, messageId }, step);
}

/** An automation's address on vespin.dev, under the agent's workspace, which opens in Safari, since the phone draws no Automations; none before the workspace is known. */
function useAutomationAddress(
  automationId: string | undefined,
  workspaceId: string | undefined,
): string | undefined {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const step = linkWorkspaceStep(workspaceId, workspaces);

  if (step === undefined || automationId === undefined) return undefined;

  return linkOf({ kind: LINK_DESTINATION.AUTOMATION, automationId }, step);
}

/** The change a card's Merge sends, by what the pull request offers: merged at once by the first method the repository allows, or queued once ready where it merges through a queue; none where it offers neither. */
function cardMergeOf(pullRequest: AgentOverviewPullRequest | undefined) {
  const action = pullRequest === undefined ? undefined : mergeActionFor(pullRequest);
  const headSha = pullRequest?.merging?.headSha ?? "";
  const method = pullRequest?.merging?.methods[0];

  if (action === MERGE_ACTION.MERGE_WHEN_READY) {
    const request = { action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha } as const;

    return { words: MERGE_WORDS.MERGE_WHEN_READY, request };
  }

  if (action !== MERGE_ACTION.MERGE || method === undefined) return undefined;
  const request = { action: PULL_REQUEST_ACTION.MERGE, method, headSha } as const;

  return { words: MERGE_PRESS_WORDS[method], request };
}

/**
 * The question a card's Merge asks first, as the system's confirmation
 * dialog: the pull request by its number and title, and the merge in the
 * words its own screen's press says. Its answer sends the merge, which the
 * card then draws as GitHub took it; it goes as it is answered.
 */
function CardMergeAsk({
  pullRequestKey,
  pullRequest,
  onDone,
}: {
  readonly pullRequestKey: PullRequestKey;
  readonly pullRequest: AgentOverviewPullRequest;
  readonly onDone: () => void;
}) {
  const writes = usePullRequestWrites(pullRequestKey);
  const merge = cardMergeOf(pullRequest);

  if (merge === undefined) return null;

  return (
    <ConfirmAsk
      title={MERGE_WORDS.MERGE_QUESTION}
      message={`#${pullRequest.number} ${pullRequest.title}`}
      act={merge.words}
      presented
      onAct={() => {
        onDone();
        void writes.write(merge.request);
      }}
      onDismiss={onDone}
    />
  );
}

/** Continue in new agent as the agent page offers it: why the turn failed, and what the press says. */
interface ContinueOffer {
  readonly words: string;
  readonly label: string;
}

/**
 * Where the agent page offers Continue in new agent, as the panel's failed
 * end line does (`endLineOffersContinue`): the agent's last turn failed in a
 * way only a new agent goes on past, or another agent continued it already,
 * when it says Continue again. Note that the phone draws no end line, so the
 * press stands over the composer and in ⋯, and that the end line reads a
 * teammate's refused key as theirs to mend, so it names the starter where
 * the reader did not start the agent.
 */
function continueOffer(
  agent: FollowedAgent | undefined,
  status: AgentStatus | undefined,
  readerId: string | undefined,
): ContinueOffer | undefined {
  if (agent === undefined || status === undefined) return undefined;
  const failure = settledFailure({ status, turn: agent.turn });
  const { startedBy } = agent;

  const starter =
    startedBy === undefined || readerId === undefined || startedBy.userId === readerId
      ? undefined
      : startedBy.name;

  const continued = continuedByIds(agent, undefined, undefined).length > 0;

  const offered = endLineOffersContinue({
    status,
    endReason: endLineReason(failure, starter),
    failure,
    continued,
    boxClosed: false,
  });

  if (!offered) return undefined;

  return {
    words: failedLineWords(failure, starter, true),
    label: continued ? CONTINUE_AGAIN_LABEL : CONTINUE_LABEL,
  };
}

/** The agent's composer at the page's foot: that a message denies the call waiting, a call waiting that no row draws, the queue, the pictures attached, and what did not go over the field, and Stop in Send's place while the agent works. */
function AgentComposerBar({
  composer,
  approvals,
  onShowWaiting,
  addMenu,
  note,
  call,
  otherCall,
  ending,
  tools,
  trailing,
  dictation,
  threads,
}: {
  readonly composer: AgentComposer;
  readonly approvals: Pick<AgentApprovals, "waiting" | "banner">;
  /** Scrolls the transcript to the call waiting; none where no row draws one. */
  readonly onShowWaiting: (() => void) | undefined;
  readonly addMenu: ComposerMenu;
  /** The newest refusal over the field, a send's, a dictation's, or one of the page's menu or its +, as `AgentComposerArea` picks it. */
  readonly note: string | undefined;
  /** Talk, or the call's presses while a call into this agent stands; none while calls are not offered. */
  readonly call: ComposerCall | undefined;
  /** The way back to a call into another agent, which stands over the field since the tab bar steps aside here. */
  readonly otherCall: ReturnType<typeof useStandingCallCard>;
  /** Continue in new agent and why, where only a new agent goes on past the agent's failed turn; none elsewhere. */
  readonly ending: ReactNode;
  /** What leads the row under the field after the +: where the agent works. */
  readonly tools: ReactNode;
  /** What stands at the end of the row under the field, before Send: the model chip. */
  readonly trailing: ReactNode;
  /** Dictate before Send, and its strip while a dictation stands. */
  readonly dictation: ComposerDictation;
  /** The agent's threads line and its press, while it has posted threads. */
  readonly threads: AgentThreadsDock | undefined;
}) {
  const { banner, waiting } = approvals;
  // Note that the bar tells VoiceOver of a call waiting, since it stands while the call's row may lie out of the list's drawn window, and an agent held for an answer waits on the reader wherever they are.
  useAnnounced(waiting === undefined ? undefined : `${waiting.words}, ${waiting.asks}`, true);
  // Note that a message sent now denies the calls waiting only where Send would not queue it behind the turn.
  const denies = waiting !== undefined && !composer.sendQueues;
  // Note that while a `/` or an `@` offers its list, the threads line and the denial's line step aside, so the list stands alone over the field, as Messages' and Slack's suggestions do, and comes back once a pick closes it.
  const picking = composer.skills !== undefined || composer.mentions !== undefined;

  const head =
    threads === undefined &&
    !denies &&
    banner === undefined &&
    composer.cancelMessageEdit === undefined &&
    composer.attached.length === 0 &&
    composer.skills === undefined &&
    composer.mentions === undefined &&
    otherCall === undefined &&
    ending === undefined &&
    note === undefined ? undefined : (
      <>
        {ending}
        {threads === undefined || picking ? null : (
          <ThreadsLine
            words={threads.line.words}
            waiting={threads.line.waiting}
            onOpen={() => threads.onOpen(threads.line.opens.id)}
          />
        )}
        {otherCall === undefined ? null : (
          <CallCardRow call={otherCall.card} onOpen={otherCall.open} />
        )}
        {composer.skills === undefined ? null : (
          <SkillSuggestions
            skills={composer.skills.skills}
            empty={composer.skills.empty}
            onPick={composer.skills.pick}
          />
        )}
        {composer.mentions === undefined ? null : (
          <MentionSuggestions
            groups={composer.mentions.groups}
            empty={composer.mentions.empty}
            onPick={composer.mentions.pick}
          />
        )}
        {composer.cancelMessageEdit === undefined ? null : (
          <EditingLine onCancel={composer.cancelMessageEdit} />
        )}
        {banner === undefined ? null : <HeldCallBanner {...banner} />}
        {denies && !picking ? <DeniesWaiting onShow={onShowWaiting} /> : null}
        <AttachedPictures pictures={composer.attached} onDetach={composer.detach} />
        {note === undefined ? null : <AskNote words={note} />}
      </>
    );

  const props = {
    placeholder: composer.placeholder,
    words: composer.words,
    onWords: composer.onWords,
    sendable: composer.sendable,
    onSend: composer.send,
    addMenu,
    tools,
    trailing,
    dictation,
    onDropPictures: composer.dropPictures,
    onLongPaste: composer.pasteText,
    onStop: composer.stop,
    stopping: composer.stopping,
    call,
    head,
    above:
      composer.queued.length === 0 && composer.paused === undefined ? undefined : (
        <QueuedLines
          lines={composer.queued}
          paused={composer.paused}
          onSteer={composer.steer}
          onDelete={composer.remove}
          onMove={composer.move}
          onResume={composer.resume}
          onEdit={composer.edit}
          onCancelEdit={composer.cancelEdit}
        />
      ),
    saving: composer.saving,
    focusAsk: composer.focusAsk,
    pills: composer.pills,
  };

  return <Composer {...props} />;
}

/** No row of the transcript on screen yet. */
const NONE_SHOWN: readonly TranscriptItem[] = [];

/**
 * The agent's composer as the page's foot holds it, with the questions its
 * queue and its edits ask first: the one place the words typed live, so a
 * keystroke draws the composer alone, never the transcript over it. Note
 * that Edit on a sent line in the transcript reaches it through `editMessage`,
 * which it keeps pointed at its own.
 */
function AgentComposerArea({
  id,
  agent,
  transcript,
  status,
  messageSent,
  suggested,
  editMessage,
  undeliveredActs,
  approvals,
  onShowWaiting,
  servers,
  note,
  call,
  otherCall,
  ending,
  tools,
  trailing,
  onOpenThread,
}: {
  readonly id: string;
  readonly agent: Parameters<typeof useAgentComposer>[1];
  readonly transcript: Parameters<typeof useAgentComposer>[2];
  readonly status: Parameters<typeof useAgentComposer>[3];
  readonly messageSent: Parameters<typeof useAgentComposer>[4];
  readonly suggested: Parameters<typeof useAgentComposer>[5];
  readonly editMessage: RefObject<AgentComposer["editMessage"] | undefined>;
  readonly undeliveredActs: RefObject<UndeliveredActs | undefined>;
  readonly approvals: Pick<AgentApprovals, "waiting" | "banner">;
  readonly onShowWaiting: (() => void) | undefined;
  readonly servers: AgentServers;
  readonly note: string | undefined;
  readonly call: ComposerCall | undefined;
  readonly otherCall: ReturnType<typeof useStandingCallCard>;
  readonly ending: ReactNode;
  /** What leads the row under the field after the +: where the agent works. */
  readonly tools: ReactNode;
  /** What stands at the end of the row under the field, before Send: the model chip. */
  readonly trailing: ReactNode;
  /** Opens one of the agent's Inbox threads by its id. */
  readonly onOpenThread: (threadId: string) => void;
}) {
  const threadsLine = useAgentThreadsLine(id);
  const composer = useAgentComposer(id, agent, transcript, status, messageSent, suggested);
  const dictated = useDictation(composer.words, composer.onWords);
  // Note that one pick holds the newest refusal, a send's, a dictation's or the page's, so an older one never hides why the last act did not go.
  const said = useNewestNote([composer.note, dictated.note, note]);
  useEffect(() => {
    editMessage.current = composer.editMessage;
    undeliveredActs.current = composer.undelivered;
  }, [editMessage, composer.editMessage, undeliveredActs, composer.undelivered]);

  return (
    <>
      <AgentComposerBar
        composer={composer}
        approvals={approvals}
        onShowWaiting={onShowWaiting}
        addMenu={agentAddMenu(composer, servers, agent !== undefined)}
        note={said}
        call={call}
        otherCall={otherCall}
        ending={ending}
        tools={tools}
        trailing={trailing}
        dictation={dictated.dictation}
        threads={
          threadsLine === undefined ? undefined : { line: threadsLine, onOpen: onOpenThread }
        }
      />
      <ConfirmAsk destructive {...composer.removing} />
      <ConfirmAsk destructive {...composer.sendingEdit} />
    </>
  );
}

/**
 * What the composer's + opens, as the desktop composer's + does: Photos,
 * then MCP servers ›, each server the agent is handed led by its
 * provider's mark, checked while it is on, a press switching it, once they are read and where any is connected.
 * The model, its effort, Fast and the permission mode stand once, in the
 * model chip's sheet at the row's end, as the desktop's model chip holds
 * them.
 */
function agentAddMenu(
  composer: AgentComposer,
  servers: AgentServers,
  /** Whether the task list holds the agent, whose servers a switch changes; none are offered before, since a switch then changes nothing. */
  listed: boolean,
): ComposerMenu {
  return {
    actions: [{ label: ADD_WORDS.PHOTOS, symbol: GLYPH.ATTACH, onPress: composer.attach }],
    submenus:
      !listed || !servers.read || servers.servers.length === 0
        ? []
        : [
            {
              label: MCP_SERVER_LABEL.many,
              symbol: GLYPH.MCP_SERVER,
              choices: servers.servers.map((server) => ({
                label: server.name,
                mark: server.provider,
                on: server.on,
                onPress: () => servers.toggle(server.connection, !server.on),
              })),
              actions: [],
            },
          ],
  };
}

/**
 * The model chip at the end of the composer's row, as the desktop's stands
 * at its box's foot: the model and its effort, "Opus 5.5 · High", led by its
 * harness's mark, a press opening the model sheet, where the model, its
 * effort, Fast and the permission mode are chosen; none before the agent's
 * model is known.
 */
function AgentModelChip({
  pick,
  onOpen,
}: {
  readonly pick: AgentModelPick;
  readonly onOpen: (() => void) | undefined;
}) {
  if (pick.model === undefined || onOpen === undefined) return null;

  const model =
    pick.models.find((option) => option.id === pick.model)?.label ?? modelLabel(pick.model);

  const effort =
    pick.efforts.length > 1
      ? pick.efforts.find((option) => option.id === pick.effort)?.label
      : undefined;

  const harness = providerOf(pick.model);

  return (
    <MenuChip
      look={MENU_CHIP_LOOK.COMPOSER}
      label={effort === undefined ? model : `${model}${MODEL_JOINED}${effort}`}
      {...(harness === undefined ? {} : { harness })}
      onOpen={onOpen}
      testId={MODEL_CHIP_ID}
    />
  );
}

/** What the Machine chip's menu heads where commands go, as the panel's place chip names its Default machine row. */
const COMMANDS_WORDS = { LABEL: "Terminal and computer use" } as const;

/** The name a flow finds the composer's Machine chip by. */
const MACHINE_CHIP_ID = "agent-machine-chip";

/**
 * Where the agent works, as the desktop's Machine chip stands after the +:
 * Cloud or its device's name, led by the panel's runs-on mark; its menu,
 * where the agent is offered `run_on_mac`, says where its terminal commands
 * and computer use go, each machine the agent may send them to, the one
 * they go to now checked, a pick setting it (`useAgentCommandsPlace`). A
 * chip with no machine to choose says where the agent works alone.
 */
function AgentMachineChip({
  agent,
  commands,
}: {
  readonly agent: Pick<FollowedAgent, "machine" | "mac">;
  readonly commands: AgentCommandsPlace | undefined;
}) {
  const platform = useDevicePlatform(agent.mac?.deviceId);
  const symbol = runsOnGlyph({ cloud: agent.machine !== AGENT_MACHINE.DEVICE, platform });

  const menu =
    commands === undefined || commands.machines.length === 0
      ? undefined
      : {
          groups: [
            {
              title: COMMANDS_WORDS.LABEL,
              choices: commands.machines.map((machine) => ({
                label: machine.name,
                symbol: runsOnGlyph({ cloud: false }),
                on: machine.id === commands.machine?.id,
                onPress: () => commands.choose(machine.id),
              })),
            },
          ],
        };

  return (
    <MenuChip
      look={MENU_CHIP_LOOK.COMPOSER}
      label={agentRunsOnWords(agent) || RUNS_ON_WORDS.LABEL}
      symbol={symbol}
      {...(menu === undefined ? {} : { menu })}
      testId={MACHINE_CHIP_ID}
    />
  );
}

/**
 * The send a box opened on a message suggestion goes through: the
 * suggestion's words and the send through it, where the page is the running
 * agent it goes to; none for any other page, or once a send of it landed.
 */
function suggestedSendOf(
  opened: OpenedSuggestion | undefined,
  agentId: string,
  sendSuggestion: ReturnType<typeof useSuggestionSender>,
): SuggestedSend | undefined {
  const action = opened?.view.action;

  if (opened === undefined || action?.kind !== REPLY_BUTTON_ACTION.SEND) return undefined;

  if (opened.view.sendTo?.id !== agentId) return undefined;
  const { suggestion } = opened;

  return {
    key: suggestion.buttonId,
    words: action.text,
    send: (text, attachments) =>
      sendSuggestion(
        {
          agentId: suggestion.agentId,
          buttonId: suggestion.buttonId,
          sent: sentOf(suggestion, text, attachments),
        },
        MESSAGE_SUGGESTION_REFUSAL,
      ),
  };
}

/**
 * The line under the agent's name in its bar: where it stands and the model
 * it runs on, as the panel's tab and its model chip say them ("Working ·
 * Opus 5.5"); none before either is known. Note that it is UIKit's own
 * subtitle, which takes no press, so the model is chosen from the composer's
 * model chip.
 */
function agentSubtitle(
  statusWords: string | undefined,
  model: string | undefined,
): BarSubtitle | undefined {
  const words = [statusWords, model]
    .filter((each) => each !== undefined && each !== "")
    .join(" · ");

  return words === "" ? undefined : { words };
}

/**
 * One agent's page: the system's header naming the agent in the ink, as
 * Messages names a conversation, since the transcript opens at its newest
 * row and its head scrolls away, its back button leading to the task, with
 * a ⋯ menu, as the panel's agent menu offers it: Copy link and Open in
 * browser, Rename, typed in the system's alert, Pin or Unpin, a
 * cloud agent's Ports, which opens the sheet of its listening ports, and
 * Run ›, its repository's run actions where its workspace offers them, each
 * run in its sandbox or stopped while it runs, as the panel's narrow ⋯
 * offers them, Archive, asked first, which goes back once the agent is
 * archived, and Permanently delete, red and last, which always asks in the
 * panel's words and goes back once the agent is deleted. Under
 * it, its transcript as one lazy list, its head where the agent stands and
 * the model it runs on, which opens the model sheet, as the composer's
 * model chip does. The transcript
 * is held live while the page is in focus, so a turn under way draws as it
 * moves, and its older pages are read as the reader scrolls up to them; one
 * that could not be read offers Try again. Each call opens in place, and
 * one the agent holds for an answer says so under its line with Deny and
 * Allow, and one whose answer its page carried cut reads it whole as it
 * opens; a fold opens on what it holds, a page the agent showed opens
 * whole, and a pull request it opened opens its own screen, its card
 * offering Review, which opens it on GitHub, and Merge where it may merge
 * now, which asks first. While a call waits, the working line says so
 * ("Waiting on you · 1 approval"), and the call is answered once, on its
 * own row. Its composer floats over the transcript's foot: while a call
 * waits, a line over its field says that a message sent now denies it where
 * Send would not queue it, a press scrolling to the call's row, and a call
 * no row draws, such as a subagent's, is answered by a banner there; a
 * follow-up, with the photos the + attaches, steers the turn under way or
 * waits behind it as the member's Follow-up behavior says, and Stop stands
 * in Send's place while the agent works. The + is a menu (`agentAddMenu`):
 * Photos and MCP servers ›; the model chip at the row's end opens the model
 * sheet, its effort, Fast and the permission mode. A `/` typed offers the
 * task's skills over the field. Opened from a split view's detail, it is
 * pushed on the tab's own stack over the whole window, as a compact window
 * pushes it.
 */
export function AgentScreen() {
  const {
    id = "",
    suggestedBy,
    button,
    brief,
  } = useLocalSearchParams<{
    id: string;
    suggestedBy?: string;
    button?: string;
    /** The words a start sheet started the agent on, naming it until the list or its transcript does. */
    brief?: string;
  }>();

  return <AgentConversation id={id} suggestedBy={suggestedBy} button={button} brief={brief} />;
}

/**
 * One agent's page as `AgentScreen` describes it, by the agent's id and the
 * suggestion a box opened it on, on its tab's stack over the window. A page
 * or a pull request it opens is pushed over it on the same stack.
 */
function AgentConversation({
  id,
  suggestedBy,
  button,
  brief,
}: {
  readonly id: string;
  readonly suggestedBy?: string | undefined;
  readonly button?: string | undefined;
  /** The words a start sheet started the agent on, naming it until the list or its transcript does. */
  readonly brief?: string | undefined;
}) {
  useSurfaceOpen(PRODUCT_SURFACE.AGENT, id);
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const onTab = useOnTab();
  const navigation = useNavigation();
  const colors = useColors();
  const agent = useFollowedAgent(id);
  // Note that an agent the list doesn't hold is named and placed from its own read, while what acts on it reads the list alone.
  const shown = useShownAgent(id);
  const openLink = useOpenLink(shown?.workspaceId);
  const pullRequests = useAgentPullRequests(id);

  const workspaceId = shown?.workspaceId;

  /** A pull request of the agent's by its page on GitHub, as its repository and number name it in the agent's workspace; none while the agent is read. */
  const keyOf = useCallback(
    (url: string): PullRequestKey | undefined => {
      const named = pullRequestAddressOf(url);

      return workspaceId === undefined || named === undefined
        ? undefined
        : { workspaceId, ...named };
    },
    [workspaceId],
  );

  // The transcript's rows on screen, as it tells them, the same rows kept while the same stand.
  const [rowsShown, setRowsShown] = useState<readonly TranscriptItem[]>(NONE_SHOWN);

  const showRows = useCallback(
    (items: readonly TranscriptItem[]) =>
      setRowsShown((held) =>
        items.length === held.length && items.every((item, at) => item === held[at]) ? held : items,
      ),
    [],
  );

  // The pull requests whose cards stand on screen, by their pages.
  const cardsShown = useMemo(
    () =>
      new Set(
        rowsShown.flatMap((item) => (item.kind === TRANSCRIPT_ITEM.PULL_REQUEST ? [item.url] : [])),
      ),
    [rowsShown],
  );

  // Note that only the open pull requests whose cards stand on screen are read for their Merge, so an agent that opened dozens never reads them all at once as its page opens, each a follow of its own.
  const open = useMemo(
    () =>
      pullRequests.flatMap(({ state, url }) => {
        const key =
          state === PULL_REQUEST_STATE.OPEN && cardsShown.has(url) ? keyOf(url) : undefined;

        return key === undefined ? [] : [key];
      }),
    [pullRequests, keyOf, cardsShown],
  );

  const offers = usePullRequestsRead(open);
  // The pull request whose card's Merge is being asked about.
  const [merging, setMerging] = useState<PullRequestKey | undefined>(undefined);
  const asked = merging === undefined ? undefined : offers(merging);
  const held = useAgentTranscript(id);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const address = useAgentAddress(id, shown?.workspaceId, shown?.taskId ?? undefined);
  const messageLink = useMessageLink(id, shown?.workspaceId);
  const [toggles, setToggles] = useState<TranscriptToggles>(NO_TOGGLES);
  const transcript = held?.rows;
  const status = agent?.status ?? transcript?.word?.status ?? shown?.status;
  const messages = transcript?.messages;
  const sending = transcript?.sending;
  const whole = useWholeParts(id);
  // Note that an agent the list doesn't hold still opens on its run's card, from its own read.
  const automated = shown?.automationId !== undefined || shown?.automationName !== undefined;
  const run = useAgentOrigin(id, automated);
  const automationAddress = useAutomationAddress(shown?.automationId, shown?.workspaceId);
  const suggestionAddress = useSuggestionAddress(shown?.workspaceId);

  // Note that the run's card stands on the transcript's first line, so it waits until no older page is left to read.
  const origin = useMemo(
    () =>
      !automated || transcript?.before !== undefined
        ? undefined
        : transcriptOriginOf({
            automationId: shown?.automationId,
            automationName: shown?.automationName,
            automationAddress,
            run,
          }),
    [
      automated,
      transcript?.before,
      shown?.automationId,
      shown?.automationName,
      automationAddress,
      run,
    ],
  );

  // Note that a Manager's page is its chat, never its transcript, as the panel draws it (`managerChatLines`): people's lines and its `send_to_user` words alone.
  const chat = shown?.kind === AGENT_KIND.MANAGER;
  useManagerChatLooks(shown);

  // The member's messages on their way stand as their own lines at the end, as the host draws them.
  const items = useMemo(
    () =>
      transcriptItems(chatOrTranscript(withSending(messages ?? [], sending ?? []), chat), {
        writing: status !== undefined && agentStillWriting(status),
        readerId,
        toggles,
        now: Date.now(),
        pullRequests,
        wholePart: whole.read,
        origin,
        suggestionAddress,
      }),
    [
      messages,
      sending,
      status,
      readerId,
      toggles,
      pullRequests,
      whole.read,
      origin,
      suggestionAddress,
      chat,
    ],
  );

  // A call opened on an answer its page carried cut reads it whole.
  const cuts = useMemo(() => openCuts(items), [items]);
  useEffect(() => whole.ask(cuts), [whole, cuts]);

  // Note that only the pictures and recordings of the rows on screen are read, so a transcript of hundreds of screenshots never holds them all as it opens.
  const mediaIds = useMemo(() => shownMediaIds(rowsShown), [rowsShown]);
  const sentFiles = useSentFiles(useMemo(() => shownFiles(items), [items]));
  const drawn = useMemo(() => drawnCallIds(items), [items]);
  const approvals = useAgentApprovals(agent, id, drawn);
  const waitingWords = approvals.waiting?.words;
  // The rows as the list draws them, the working line saying the agent waits on the member while a call does.
  const rows = useMemo(() => withWaitingLine(items, waitingWords), [items, waitingWords]);
  // The call's row the denial line last asked the list to bring into view.
  const [reveal, setReveal] = useState<TranscriptReveal | undefined>(undefined);
  const waitingCall = approvals.waiting?.callId;

  const showWaiting =
    waitingCall === undefined
      ? undefined
      : () => setReveal((was) => ({ callId: waitingCall, serial: (was?.serial ?? 0) + 1 }));

  const opened = useOpenedSuggestion({ suggestedBy, button });
  const sendSuggestion = useSuggestionSender();
  const suggested = suggestedSendOf(opened, id, sendSuggestion);

  // Note that Edit on a sent line reaches the composer through this one handle, so the page holds none of the composer's state, whose every keystroke would draw the transcript again.
  const editMessage = useRef<AgentComposer["editMessage"] | undefined>(undefined);
  // Note that a refused line's Retry, Edit, and Delete reach the composer the same way.
  const undeliveredActs = useRef<UndeliveredActs | undefined>(undefined);

  // A line of the member's the service refused, marked Not delivered where it went, with why and what mends it, as the panel keeps it.
  const undelivered = useCallback(
    (lineId: string): UndeliveredLine | undefined => {
      const line = sending?.find((each) => each.id === lineId);

      if (line?.refused === undefined) return undefined;
      const whole = undeliveredWhole(line);

      return {
        why: whole ? messageFailureWords(line.refused.failure) : UNDELIVERED_FILES_LOST,
        newThread: false,
        onRetry: whole ? () => undeliveredActs.current?.retry(lineId) : undefined,
        onEdit: () => undeliveredActs.current?.edit(lineId),
        onDelete: () => undeliveredActs.current?.drop(lineId),
      };
    },
    [sending],
  );

  const composer = useMemo(
    () => ({
      editMessage: (line: Parameters<AgentComposer["editMessage"]>[0]) =>
        editMessage.current?.(line),
    }),
    [],
  );

  const suggestion = useSuggestionLooks(items, shown?.workspaceId, shown?.taskId ?? undefined);
  const older = useOlderPages(id, transcript?.before);
  const retry = useTranscriptRetry(id);
  const media = useAgentMedia(id, mediaIds);

  // Note that a title with no words left once read, such as a brief of code alone, falls back to "Agent" rather than a blank bar.
  const title =
    cardTitle(shown === undefined ? (transcript?.word?.title ?? brief ?? "") : agentName(shown)) ||
    UNLISTED_AGENT;

  useScreenActivity((workspaces) =>
    shown === undefined || shown.taskId === null
      ? undefined
      : agentActivity(
          {
            id,
            title,
            workspaceId: shown.workspaceId,
            taskId: shown.taskId,
          },
          workspaces,
        ),
  );
  const failed = held?.failed === true || transcript?.failure !== undefined;

  // Note that the model sheet stands as the page's own beside it, as its asks do, so the model chip and the bar's line open the one sheet.
  const [modelsShown, setModelsShown] = useState(false);
  const openModels = agent === undefined ? undefined : () => setModelsShown(true);

  const statusWords = status === undefined ? undefined : agentStateWords(status);

  const subtitle = agentSubtitle(
    statusWords,
    agent === undefined ? undefined : modelLabel(agent.model),
  );

  // Note that a change of state is told to VoiceOver as it lands, such as Working turning to Finished or Failed, since the bar's line changes out of the reader's sight.
  useAnnounced(statusWords);

  const mode = useAgentMode(id);
  const pick = useAgentModelPick(id);
  const actions = useAgentActions(id, address);
  const transcriptCopy = useTranscriptCopy(id, title, shown?.brief);

  // Note that a copy or share lets the menu's last note go, so an older Rename or Pin refusal never stands over what the copy says.
  const copyTranscript = (way: TranscriptCopy) => {
    actions.clearNote();
    transcriptCopy.copy(way);
  };

  const shareTranscript = (way: TranscriptCopy) => {
    actions.clearNote();
    transcriptCopy.share(way);
  };

  const runActions = useAgentRun(id);
  useWarmAgent(id);
  const hasPorts = useAgentHasPorts(id);
  const openPorts = () => router.push({ pathname: "/agent-ports", params: { agent: id } });

  const askRename = () =>
    askForName({
      title: RENAME_WORDS.TITLE,
      act: RENAME_WORDS.ACT,
      name: actions.title,
      onName: actions.rename,
    });

  // Whether Archive's or Permanently delete's question stands over the page.
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteQuestion = actions.deleteQuestion(title);

  // An agent archived or deleted gives way to where its own stack opened it from, or to the Tasks list it stands in where it was opened first, as from a launch or a notification; nothing moves once the reader has left its page.
  const leave = () => {
    if (!navigation.isFocused()) return;

    if (router.canDismiss()) router.back();
    else router.replace("/tasks");
  };

  const servers = useAgentServers(id);
  const commands = useAgentCommandsPlace(id);

  // Note that the newest refusal of the page's own acts stands over the field, so a server's switch refused after a Pin says its own words rather than the older one's.
  const note = useNewestNote([
    actions.note,
    transcriptCopy.note,
    servers.note,
    mode?.note,
    pick.note,
  ]);

  // Note that Copy transcript waits only for the transcript's first answer, failed or not, since the copy reads the whole transcript itself.
  const copiable = held !== undefined;
  const taskId = shown?.taskId ?? undefined;

  // Note that the agent's task opens as a page pushed over it on the stack the reader stands in, as a thread's path opens its task and the panel's crumbs do. A compact stack's title holds no menu, so Open task leads the ⋯ menu.
  const openTask =
    taskId === undefined
      ? undefined
      : () => router.push(onTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId })));

  // Note that a Manager's overview stands beside its chat on the desktop; here it is pushed from the bar, where the workspace lists its Managers.
  const overviewShown = useManagersListed(shown?.workspaceId) && chat;

  const openSettings = () => router.push({ pathname: "/manager-settings", params: { agent: id } });

  const openOverview = overviewShown
    ? () => router.push({ pathname: onOwnTab("/tasks/agent/[id]/overview"), params: { id } })
    : undefined;

  // Note that ⋯ stands only once it holds something to do, so a page still reading its agent never offers a copy of nothing.
  const copyable = address !== undefined || copiable;
  const openable = address !== undefined || agent !== undefined;
  const talk = useAgentTalk(id, taskId);
  const otherCall = useStandingCallCard(id);

  const messageActs = useMessageActs({
    agentId: id,
    agent: shown,
    transcript,
    readerId,
    composer,
    calling: talk.call?.kind === COMPOSER_CALL.ON_CALL,
  });

  // Note that a regular window's bar stands Pin and Archive as glyphs before ⋯, as Mail stands its acts, and ⋯ keeps the rest; a compact window keeps them all in ⋯.
  const barActs = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR && agent !== undefined;

  // Archive asks first. Note that the question is let go first, so one a dismissal swallowed never leaves Archive asking nothing.
  const askArchive = () => {
    setArchiving(false);
    void actions.archiveAsk.ask(id).then((stands) => {
      if (stands) setArchiving(true);
    });
  };

  const openPage = (item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.PAGE }>) => {
    router.push({
      pathname: onOwnTab("/tasks/agent/[id]/page"),
      params: { id, page: item.page, version: String(item.version), title: item.title },
    });
  };

  // Note that a thread opens on the agent's own tab, pushed over its page, as the Inbox opens one found elsewhere.
  const openThread = (threadId: string) =>
    router.push(onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId: threadId })));

  // Note that a pull request the agent's workspace is not read for yet opens on GitHub, which reads it whoever opened it.
  const openPullRequest = (url: string) => {
    const key = keyOf(url);

    if (key === undefined) {
      openInSafari(url);

      return;
    }

    router.push(onOwnTab(iosRepositoryPullRequestRoute(key, id)));
  };

  // Note that an archived agent takes no message until it is brought back, so its bar stands in the composer's place, as the panel's note stands in its box's.
  const archived = shown?.archivedAt !== undefined;

  const continueOf =
    taskId === undefined || archived ? undefined : continueOffer(shown, status, readerId);

  const continueAgent = () =>
    router.push({ pathname: "/start-agent", params: { task: taskId, continueOf: id } });

  const composerBar = archived ? (
    <ArchivedBar unarchiving={actions.unarchiving} note={note} onUnarchive={actions.unarchive} />
  ) : (
    <AgentComposerArea
      id={id}
      agent={agent}
      transcript={transcript}
      status={status}
      messageSent={approvals.messageSent}
      suggested={suggested}
      editMessage={editMessage}
      undeliveredActs={undeliveredActs}
      approvals={approvals}
      onShowWaiting={showWaiting}
      onOpenThread={openThread}
      servers={servers}
      note={note}
      call={talk.call}
      otherCall={otherCall}
      ending={
        continueOf === undefined ? undefined : (
          <ContinueLine
            words={continueOf.words}
            label={continueOf.label}
            onContinue={continueAgent}
          />
        )
      }
      tools={
        agent === undefined ? undefined : <AgentMachineChip agent={agent} commands={commands} />
      }
      trailing={<AgentModelChip pick={pick} onOpen={openModels} />}
    />
  );

  const transcriptView = (
    <AgentTranscript
      items={rows}
      onRowsShown={showRows}
      reveal={reveal}
      head={null}
      empty={{
        title: failed ? TRANSCRIPT_WORDS.FAILED : TRANSCRIPT_WORDS.READING,
        symbol: failed ? GLYPH.FAILED : GLYPH.COMMENT,
        loading: !failed,
        action: failed
          ? { label: TRANSCRIPT_WORDS.RETRY, look: BUTTON_LOOK.BORDERED, onPress: retry }
          : undefined,
      }}
      older={older}
      heldCall={approvals.heldCall}
      suggestion={suggestion}
      repository={agent?.repository}
      onOpenLink={openLink}
      onToggle={(item) => setToggles((held) => toggledAt(held, item))}
      onOpenPage={openPage}
      mediaSource={(pictureId) => media.sources.get(pictureId)}
      fileSource={sentFiles.source}
      onRetryFile={sentFiles.retry}
      onRetryMedia={media.retry}
      onOpenElsewhere={address === undefined ? undefined : () => openInSafari(address)}
      onOpenAddress={openInSafari}
      messageLink={messageLink}
      messageMore={messageActs.more}
      onOpenThread={openThread}
      undelivered={undelivered}
      onOpenPullRequest={(item) => openPullRequest(item.url)}
      pullRequestActs={(item) => {
        const key = keyOf(item.url);

        return key === undefined || cardMergeOf(offers(key)) === undefined
          ? []
          : [{ label: MERGE_WORD, onPress: () => setMerging(key) }];
      }}
    />
  );

  const asks = (
    <>
      <AgentModelSheet
        pick={pick}
        mode={mode}
        presented={modelsShown}
        onDismiss={() => setModelsShown(false)}
      />
      {merging === undefined || asked === undefined ? null : (
        <CardMergeAsk
          pullRequestKey={merging}
          pullRequest={asked}
          onDone={() => setMerging(undefined)}
        />
      )}
      <ConfirmAsk destructive {...talk.switching} />
      <ConfirmAsk destructive {...messageActs.reverting} />
      <ConfirmAsk
        title={actions.archiveAsk.question.title}
        message={actions.archiveAsk.question.message}
        act={actions.archiveAsk.question.act}
        presented={archiving}
        onAct={() => {
          setArchiving(false);
          actions.archiveAsk.answered(
            () => actions.archive(leave),
            () => setArchiving(true),
          );
        }}
        onDismiss={() => setArchiving(false)}
      />
      <ConfirmAsk
        title={deleteQuestion.title}
        message={deleteQuestion.body}
        act={deleteQuestion.verb}
        destructive
        presented={deleting}
        onAct={() => {
          setDeleting(false);
          actions.remove(leave);
        }}
        onDismiss={() => setDeleting(false)}
      />
    </>
  );

  const barOptions = { title, headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT } };

  return (
    <>
      <Stack.Screen options={barOptions} />
      {/* Note that the agent's state and model stand under its name as the bar's own subtitle, as the panel's tab says them, since the line over the transcript scrolled out of sight as the page opened at its newest row, the model chosen from the composer's model chip. */}
      <StackSubtitle words={subtitle?.words ?? ""} />
      <Stack.Toolbar placement="right">
        {copyable || openable || openTask !== undefined ? (
          <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel={MENU_WORDS.MORE}>
            {openTask === undefined ? null : (
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.TASK)} onPress={openTask}>
                  {PATH_OPENS.TASK}
                </Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            )}
            {openOverview === undefined ? null : (
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.LIST)} onPress={openOverview}>
                  {MENU_WORDS.OVERVIEW}
                </Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            )}
            {/* Note that the groups keep the panel's order (`agentMenuGroups`): the copies, then the name, then where it opens, then archiving, and Permanently delete last and alone. */}
            {copyable ? (
              <Stack.Toolbar.Menu inline>
                {address === undefined ? null : (
                  <Stack.Toolbar.MenuAction
                    icon={glyphSymbol(GLYPH.LINK)}
                    onPress={actions.copyLink}
                  >
                    {MENU_WORDS.COPY_LINK}
                  </Stack.Toolbar.MenuAction>
                )}
                {copiable ? (
                  <Stack.Toolbar.Menu
                    icon={glyphSymbol(GLYPH.COPY)}
                    title={COPY_TRANSCRIPT_WORDS.COPY}
                  >
                    <Stack.Toolbar.MenuAction
                      onPress={() => copyTranscript(TRANSCRIPT_COPY.CONCISE)}
                    >
                      {COPY_TRANSCRIPT_WORDS.CONCISE}
                    </Stack.Toolbar.MenuAction>
                    <Stack.Toolbar.MenuAction onPress={() => copyTranscript(TRANSCRIPT_COPY.FULL)}>
                      {COPY_TRANSCRIPT_WORDS.FULL}
                    </Stack.Toolbar.MenuAction>
                    <Stack.Toolbar.MenuAction
                      icon={glyphSymbol(GLYPH.SHARE)}
                      onPress={() => shareTranscript(TRANSCRIPT_COPY.FULL)}
                    >
                      {COPY_TRANSCRIPT_WORDS.SHARE}
                    </Stack.Toolbar.MenuAction>
                  </Stack.Toolbar.Menu>
                ) : null}
              </Stack.Toolbar.Menu>
            ) : null}
            {agent === undefined ? null : (
              <Stack.Toolbar.Menu inline>
                {/* Note that a Manager is named from its Settings, its one place to configure it, as the desktop's menu offers Settings… in Rename's place. */}
                {chat ? (
                  <Stack.Toolbar.MenuAction
                    icon={glyphSymbol(GLYPH.OPTIONS)}
                    onPress={openSettings}
                  >
                    {MENU_WORDS.SETTINGS}
                  </Stack.Toolbar.MenuAction>
                ) : (
                  <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.RENAME)} onPress={askRename}>
                    {MENU_WORDS.RENAME}
                  </Stack.Toolbar.MenuAction>
                )}
                {barActs ? null : (
                  <Stack.Toolbar.MenuAction
                    icon={glyphSymbol(actions.pinned ? GLYPH.UNPIN : GLYPH.PIN)}
                    onPress={actions.pin}
                  >
                    {actions.pinned ? MENU_WORDS.UNPIN : MENU_WORDS.PIN}
                  </Stack.Toolbar.MenuAction>
                )}
              </Stack.Toolbar.Menu>
            )}
            {openable ? (
              <Stack.Toolbar.Menu inline>
                {address === undefined ? null : (
                  <Stack.Toolbar.MenuAction
                    icon={glyphSymbol(GLYPH.OPEN_EXTERNALLY)}
                    onPress={() => openInSafari(address)}
                  >
                    {VERB.OPEN_IN_BROWSER}
                  </Stack.Toolbar.MenuAction>
                )}
                {agent !== undefined && hasPorts ? (
                  <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.PLUG)} onPress={openPorts}>
                    {AGENT_PORTS_WORDS.PORTS}
                  </Stack.Toolbar.MenuAction>
                ) : null}
                {agent === undefined || runActions.length === 0 ? null : (
                  <Stack.Toolbar.Menu
                    icon={glyphSymbol(GLYPH.RUN)}
                    title={RUN_ACTION_WORDS.SUBMENU}
                  >
                    {runActions.map((offered) => (
                      <Stack.Toolbar.MenuAction
                        key={offered.action.id}
                        icon={glyphSymbol(offered.runs ? GLYPH.STOP : GLYPH.RUN)}
                        subtitle={offered.runs ? RUN_ACTION_WORDS.RUNNING : offered.action.command}
                        onPress={offered.onPress}
                      >
                        {runActionMenuLabel(offered.action, offered.runs)}
                      </Stack.Toolbar.MenuAction>
                    ))}
                  </Stack.Toolbar.Menu>
                )}
              </Stack.Toolbar.Menu>
            ) : null}
            {continueOf === undefined ? null : (
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction
                  icon={glyphSymbol(GLYPH.CONTINUE)}
                  onPress={continueAgent}
                >
                  {continueOf.label}
                </Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            )}
            {agent === undefined || barActs ? null : (
              <Stack.Toolbar.Menu inline>
                {archived ? (
                  <Stack.Toolbar.MenuAction
                    icon={glyphSymbol(GLYPH.UNARCHIVE)}
                    onPress={actions.unarchive}
                  >
                    {MENU_WORDS.UNARCHIVE}
                  </Stack.Toolbar.MenuAction>
                ) : (
                  <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.ARCHIVE)} onPress={askArchive}>
                    {MENU_WORDS.ARCHIVE}
                  </Stack.Toolbar.MenuAction>
                )}
              </Stack.Toolbar.Menu>
            )}
            {agent === undefined ? null : (
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction
                  icon={glyphSymbol(GLYPH.DELETE)}
                  destructive
                  onPress={() => setDeleting(true)}
                >
                  {MENU_WORDS.DELETE}
                </Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            )}
          </Stack.Toolbar.Menu>
        ) : null}
        {/* Note that a right bar's first item stands at its edge, so the ⋯ leads the list and Archive then Pin stand before it, as Mail stands its acts before More. Each glyph is named as the ⋯'s is, since a top bar loads an `xcasset` icon through React Native's image loader, which reads no symbol set, and drew an empty capsule. */}
        {/* Note that a Manager's Overview stands as a glyph in every window, nearest the ⋯, since on the desktop it is never hidden beside the chat. */}
        {openOverview === undefined ? null : (
          <Stack.Toolbar.Button
            icon={glyphSymbol(GLYPH.LIST)}
            accessibilityLabel={MENU_WORDS.OVERVIEW}
            onPress={openOverview}
          />
        )}
        {barActs ? (
          <Stack.Toolbar.Button
            icon={glyphSymbol(archived ? GLYPH.UNARCHIVE : GLYPH.ARCHIVE)}
            accessibilityLabel={archived ? MENU_WORDS.UNARCHIVE : MENU_WORDS.ARCHIVE}
            onPress={archived ? actions.unarchive : askArchive}
          />
        ) : null}
        {barActs ? (
          <Stack.Toolbar.Button
            icon={glyphSymbol(actions.pinned ? GLYPH.UNPIN : GLYPH.PIN)}
            accessibilityLabel={actions.pinned ? MENU_WORDS.UNPIN : MENU_WORDS.PIN}
            onPress={actions.pin}
          />
        ) : null}
      </Stack.Toolbar>
      {/* Note that the transcript stands as the screen's root rather than in its SwiftUI host, since the list is React Native's own and sizes itself to the screen; the composer floats over its foot. */}
      <GlassDock bar={composerBar}>{transcriptView}</GlassDock>
      {asks}
    </>
  );
}

/** A page the agent showed, opened whole, by the agent's task, read once the agent is. */
export function AgentPageScreen() {
  const {
    id = "",
    page = "",
    version = "",
    title = "",
  } = useLocalSearchParams<{
    id: string;
    page: string;
    version: string;
    title: string;
  }>();

  return <AgentPage agentId={id} pageId={page} version={openedVersion(version)} title={title} />;
}

/** A page the agent showed, by the agent, the page, and its version. */
function AgentPage({
  agentId,
  pageId,
  version,
  title,
}: {
  readonly agentId: string;
  readonly pageId: string;
  readonly version: number | undefined;
  readonly title: string;
}) {
  const agent = useFollowedAgent(agentId);

  return (
    <PageScreen
      workspaceId={agent?.workspaceId}
      taskId={agent?.taskId ?? undefined}
      pageId={pageId}
      version={version}
      title={title}
    />
  );
}

/**
 * The agent's model sheet (`ModelChoiceSheet`), as the desktop's model chip
 * opens its menu, each change sent at once and drawn on the agent as it is
 * asked, one the service refused reading back and saying why: its model,
 * among the models New agent offers that its harness runs, each under its
 * harness's mark, its effort right under it, and Fast where the model has a
 * fast version, which take effect from its next step; and last its
 * permission mode, each with its glyph and what it does, where its harness
 * takes one, which takes effect from its next turn. Done closes it.
 */
function AgentModelSheet({
  pick,
  mode,
  presented,
  onDismiss,
}: {
  /** The page's own model and mode, so a change from the sheet clears the one refusal and counts as the one latest change. */
  readonly pick: AgentModelPick;
  readonly mode: AgentMode | undefined;
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
      effort={pick.effort}
      onEffort={pick.pickEffort}
      fast={pick.fast === undefined ? undefined : { on: pick.fast.on, onSwitch: pick.fast.toggle }}
      note={pick.note}
      mode={
        mode === undefined
          ? undefined
          : {
              title: PERMISSION_MODE_WORDS.QUESTION,
              options: mode.modes.map((option) => ({
                ...option,
                symbol: PERMISSION_MODE_GLYPH[option.id],
              })),
              picked: mode.mode,
              onPick: (picked) => {
                const chosen = mode.modes.find((option) => option.id === picked);

                if (chosen !== undefined) mode.choose(chosen.id);
              },
              footer: PERMISSION_MODE_WORDS.APPLIES,
              note: mode.note,
            }
      }
    />
  );
}

/** The glyph each port's act wears in its menu, as the panel's plug wears it. */
const PORT_ACT_SYMBOL = {
  [PORT_ACT.SHARE]: GLYPH.LINK,
  [PORT_ACT.OPEN_LINK]: GLYPH.LINK,
  [PORT_ACT.COPY_LINK]: GLYPH.COPY,
  [PORT_ACT.STOP_SHARING]: GLYPH.UNLINK,
} as const satisfies Record<PortAct, Glyph>;

/** Each port's act's words, in the panel's. */
const PORT_ACT_WORDS = {
  [PORT_ACT.SHARE]: AGENT_PORTS_WORDS.SHARE,
  [PORT_ACT.OPEN_LINK]: AGENT_PORTS_WORDS.OPEN_LINK,
  [PORT_ACT.COPY_LINK]: AGENT_PORTS_WORDS.COPY_LINK,
  [PORT_ACT.STOP_SHARING]: AGENT_PORTS_WORDS.STOP_SHARING,
} as const satisfies Record<PortAct, string>;

/** The Ports sheet's own words: what VoiceOver hears its checkmark as. */
const PORTS_WORDS = { DONE: "Done" } as const;

/**
 * A cloud agent's listening ports, as the panel's plug lists them where it
 * forwards nothing, in a sheet over its page, read every few seconds while
 * it stands: one row per port, ":3000" with what serves it under it, whose
 * press offers Share while no port is shared; the shared one wears a link
 * and Sharing, and offers Open link, which opens it in Safari, Copy link,
 * and Stop sharing; while one is shared, another offers nothing, and where
 * none is listed, the panel's line says why. A share that did not go says
 * why under the list. Its checkmark closes it.
 */
export function AgentPortsScreen({ agentId }: { readonly agentId: string }) {
  const colors = useColors();
  const half = useSheetAtHalf();
  const router = useRouter();
  const ports = useAgentPorts(agentId);

  const actOf = (row: PortRow, act: PortAct): MenuRowAct => {
    const label = PORT_ACT_WORDS[act];
    const symbol = PORT_ACT_SYMBOL[act];
    const url = row.url ?? "";

    switch (act) {
      case PORT_ACT.SHARE:
        return { label, symbol, onPress: () => ports.share(row.port) };
      case PORT_ACT.OPEN_LINK:
        return { label, symbol, onPress: () => openInSafari(url) };
      case PORT_ACT.COPY_LINK:
        return { label, symbol, onPress: () => ports.copy(url) };
      case PORT_ACT.STOP_SHARING:
        return { label, symbol, onPress: () => ports.share(null) };
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: AGENT_PORTS_WORDS.PORTS,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: half ? NO_GROUND : colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CONFIRM)}
          variant="done"
          tintColor={colors.ACCENT}
          accessibilityLabel={PORTS_WORDS.DONE}
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      <Screen clear={half}>
        <SettingsForm clear={half} spacing={FORM_SPACING.COMPACT}>
          <ListSection
            footer={ports.note ?? (ports.rows.length === 0 ? ports.none : ports.linkNote)}
            footerTone={footerToneOf(ports.note)}
          >
            {ports.rows.map((row) => (
              <MenuRow
                key={row.port}
                label={`:${row.port}`}
                symbol={row.url === undefined ? GLYPH.GLOBE : GLYPH.LINK}
                detail={row.label}
                value={row.url === undefined ? undefined : AGENT_PORTS_WORDS.SHARING}
                acts={row.acts.map((act) => actOf(row, act))}
              />
            ))}
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
