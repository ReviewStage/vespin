// agent-screens.tsx -- one agent's page, its transcript live under the system's header naming it, its held calls answered, its composer, or Unarchive in its place while it is archived, Continue in new agent over it where only a new agent goes on, with its + of Photos and MCP servers and its model chip, whose sheet holds its model, effort, Fast and permission mode, its ⋯ menu, its run actions, its Move to › and its Permanently delete among it, a page it showed, opened whole, and the sheet of its listening ports.

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
  type AgentOverviewPullRequest,
  type AgentPullRequest,
  type AgentStatus,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { PRODUCT_PICTURE_KIND, PRODUCT_SURFACE } from "@repo/features/analytics";
import { appsInUse } from "@repo/features/apps-in-use";
import { agentGlyphState, agentStateWords, GLYPH_STATE } from "@repo/features/glyph-state";
import { UNDELIVERED_FILES_LOST } from "@repo/features/inbox-undelivered";
import { iosAppRouteOf, iosRepositoryPullRequestRoute } from "@repo/features/ios-app-links";
import { agentActivity } from "@repo/features/ios-system-activity";
import {
  LINK_DESTINATION,
  linkOf,
  linkWorkspaceStep,
  pullRequestAddressOf,
} from "@repo/features/link-grammar";
import { managerChatView } from "@repo/features/manager-chat-view";
import { managerGreeting } from "@repo/features/manager-greeting";
import { agentName, modelLabel } from "@repo/features/model-label";
import { PICTURE_OWNER } from "@repo/features/picture-source-wire";
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
import { SEARCH_FOUND_KIND } from "@repo/features/search-found-model";
import { MESSAGE_SUGGESTION_REFUSAL, sentOf } from "@repo/features/suggestion-model";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { TRANSCRIPT_COPY, type TranscriptCopy } from "@repo/features/transcript-copy";
import { PATH_OPENS, VERB } from "@repo/features/words";
import {
  type FollowedAgent,
  selectInboxReader,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  AgentTranscript,
  ArchivedBar,
  AskNote,
  askForName,
  BAR_TITLE,
  type BarMenu,
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
  drawnCallIds,
  EditingLine,
  FORM_SPACING,
  footerToneOf,
  GLYPH,
  GlassDock,
  type Glyph,
  glyphSymbol,
  ListSection,
  MentionSuggestions,
  MenuRow,
  type MenuRowAct,
  managerChatItems,
  menuOfGroups,
  NO_GROUND,
  NO_TOGGLES,
  openCuts,
  rowsNear,
  Screen,
  SettingsForm,
  SkillSuggestions,
  StackBarMenu,
  StackSubtitle,
  shownFiles,
  shownMediaIds,
  shownPictureIds,
  shownRecordingIds,
  TRANSCRIPT_ITEM,
  type TranscriptItem,
  type TranscriptReveal,
  type TranscriptToggles,
  taskLead,
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
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgentBox } from "../agents/agent-box.js";
import {
  type AgentThreadsDock,
  type AppsDock,
  appsDockMediaIds,
  useAgentDock,
} from "../agents/agent-dock.js";
import { CHANGE_FACE, FaceSheet } from "../agents/face-ask.js";
import {
  useAgentMedia,
  useAgentPullRequests,
  useAgentTranscript,
  useFollowedAgent,
  useManagerChat,
  useManagerChatRetry,
  useOlderChatPages,
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
import { useAgentMove } from "../agents/use-agent-move.js";
import { useAgentOrigin } from "../agents/use-agent-origin.js";
import { useAgentHasPorts, useAgentPorts } from "../agents/use-agent-ports.js";
import { useAgentRun } from "../agents/use-agent-run.js";
import { useChatFaces, useManagerChatLooks, useManagersListed } from "../agents/use-managers.js";
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
import { useTaskListCollections, useTaskListRow } from "../host/host-provider.js";
import { useAgentThreadsLine } from "../inbox/use-agent-threads.js";
import { useNewestNote } from "../newest-note.js";
import { useOpenDrawnCount } from "../open-drawn.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import {
  type PullRequestKey,
  usePullRequestsRead,
  usePullRequestWrites,
} from "../pull-requests/use-pull-request.js";
import { rigBusyRender } from "../rig-busy-render.js";
import { useNoteOpened } from "../search/recent-opened.js";
import { useSheetAtHalf } from "../sheet-stack.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab, useOnTab } from "../tab-route.js";
import { useDictation } from "../use-dictation.js";
import { PicturesProvider, useAgentPictureFiles, usePictures } from "../use-pictures.js";
import { useAgentTalk, useStandingCallCard } from "../voice-call.js";
import { openedVersion, PageScreen } from "./page-screens.js";

/** How many rows on each side of those on screen a transcript reads the pictures of before they scroll in. */
const MEDIA_REACH = 5;

/** The agent's threads line over its box, and what a press on it opens. */
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
  MOVE_TO: "Move to",
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

/** What a pull request's card offers beside Review where it may merge now. */
const MERGE_WORD = "Merge";

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
  pullRequest,
  onOpenPullRequest,
  apps,
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
  /** The pull request the agent opened, which the row over the field opens; none before it opened one. */
  readonly pullRequest: AgentPullRequest | undefined;
  readonly onOpenPullRequest: (url: string) => void;
  /** The apps the agent uses on the reader's Mac this turn, which the row over the field names; none where its turn used none. */
  readonly apps: AppsDock | undefined;
}) {
  const { waiting } = approvals;
  // Note that the bar tells VoiceOver of a call waiting, since it stands while the call's row may lie out of the list's drawn window, and an agent held for an answer waits on the reader wherever they are.
  useAnnounced(waiting === undefined ? undefined : `${waiting.words}, ${waiting.asks}`, true);
  // Note that a message sent now denies the calls waiting only where Send would not queue it behind the turn.
  const denies = waiting !== undefined && !composer.sendQueues;
  // Note that while a `/` or an `@` offers its list, the row of capsules over the composer steps aside, so the list stands alone over the field, as Messages' and Slack's suggestions do, and comes back once a pick closes it.
  const picking = composer.skills !== undefined || composer.mentions !== undefined;

  const dock = useAgentDock(
    {
      composer,
      approvals,
      denies,
      onShowWaiting,
      threads,
      pullRequest,
      onOpenPullRequest,
      apps,
    },
    picking,
  );

  const head =
    composer.cancelMessageEdit === undefined &&
    composer.skills === undefined &&
    composer.mentions === undefined &&
    otherCall === undefined &&
    ending === undefined &&
    note === undefined ? undefined : (
      <>
        {ending}
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
            crumb={composer.mentions.crumb}
            onPick={composer.mentions.pick}
          />
        )}
        {composer.cancelMessageEdit === undefined ? null : (
          <EditingLine onCancel={composer.cancelMessageEdit} />
        )}
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
    above: dock ?? undefined,
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
  submenus,
  note,
  call,
  otherCall,
  ending,
  tools,
  trailing,
  onOpenThread,
  pullRequest,
  onOpenPullRequest,
  apps,
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
  /** The + menu's MCP servers › (`useAgentBox`). */
  readonly submenus: readonly BarMenu[];
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
  /** The pull request the agent opened, which the row over the field opens; none before it opened one. */
  readonly pullRequest: AgentPullRequest | undefined;
  readonly onOpenPullRequest: (url: string) => void;
  /** The apps the agent uses on the reader's Mac this turn; none where its turn used none. */
  readonly apps: AppsDock | undefined;
}) {
  const threadsLine = useAgentThreadsLine(id);
  const composer = useAgentComposer(id, agent, transcript, status, messageSent, suggested);
  rigBusyRender(composer.words !== "");
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
        addMenu={agentAddMenu(composer, submenus)}
        note={said}
        call={call}
        otherCall={otherCall}
        ending={ending}
        tools={tools}
        trailing={trailing}
        dictation={dictated.dictation}
        pullRequest={pullRequest}
        onOpenPullRequest={onOpenPullRequest}
        apps={apps}
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
 * then the agent's MCP servers › (`useAgentBox`). The model, its effort,
 * Fast and the permission mode stand once, in the model chip's choices at
 * the row's end, as the desktop's model chip holds them.
 */
function agentAddMenu(composer: AgentComposer, submenus: readonly BarMenu[]): ComposerMenu {
  return {
    actions: [{ label: ADD_WORDS.PHOTOS, symbol: GLYPH.ATTACH, onPress: composer.attach }],
    submenus,
  };
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

  const listed = useTaskListRow(useTaskListCollections().agents, id || undefined);
  useOpenDrawnCount(PRODUCT_SURFACE.AGENT, listed !== undefined);

  return <AgentConversation id={id} suggestedBy={suggestedBy} button={button} brief={brief} />;
}

/**
 * One agent's page as `AgentScreen` describes it, by the agent's id and the
 * suggestion a box opened it on, on its tab's stack over the window. A page
 * or a pull request it opens is pushed over it on the same stack. Note that
 * it is drawn again only as its own reads move, never as its words in the
 * route are handed again, because the stack draws every screen's route
 * again on each push and pop, and this page stands drawn under the one
 * pushed over it, in the very render the push stands its first frame in.
 */
const AgentConversation = memo(function AgentConversation({
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
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const onTab = useOnTab();
  const navigation = useNavigation();
  const colors = useColors();
  const agent = useFollowedAgent(id);
  // Note that an agent the list doesn't hold is named and placed from its own read, while what acts on it reads the list alone.
  const shown = useShownAgent(id);

  // Note that a Manager's chat counts apart from a coding agent's page, once the read names which it is.
  const surface =
    shown?.kind === AGENT_KIND.MANAGER ? PRODUCT_SURFACE.MANAGER : PRODUCT_SURFACE.AGENT;

  useSurfaceOpen(shown === undefined ? undefined : surface, id);

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

  // Note that a Manager's page is its chat, never its transcript, as the panel draws it: the chat's own rows (`managerChat`), its transcript read only for the work each turn did.
  const chat = shown?.kind === AGENT_KIND.MANAGER;
  useManagerChatLooks(shown);
  const chatFaces = useChatFaces(chat ? shown : undefined, readerId);
  const chatHeld = useManagerChat(id, chat);
  const chatPage = chatHeld?.rows;

  // The calls the agent holds for the member's answer, whose folds stand open so their rows draw them; a subagent's call has no row of its own.
  const pending = agent?.pendingApprovals;

  const waitingCalls = useMemo(
    () =>
      new Set(
        (pending ?? []).flatMap((ask) => (ask.subagentId === undefined ? [ask.toolUseId] : [])),
      ),
    [pending],
  );

  const writing = status !== undefined && agentStillWriting(status);
  // Note that the turn under way is the agent's newest while it may still write, whose work stands under the chat's working line rather than under a message.
  const running = writing ? (agent?.turnId ?? undefined) : undefined;

  // Note that a Manager's chat is its rows alone, with the work of each turn a press away, read from the transcript held beside it.
  const chatItems = useMemo(
    () =>
      chat && chatPage !== undefined
        ? managerChatItems(
            managerChatView(chatPage.messages, messages ?? [], {
              running,
              sending: chatPage.sending ?? [],
            }),
            messages ?? [],
            {
              writing,
              readerId,
              toggles,
              now: Date.now(),
              pullRequests,
              wholePart: whole.read,
              suggestionAddress,
              waitingCalls,
              sending: chatPage.sending,
              managerName: chatFaces?.managerName,
              readerName: chatFaces?.readerName,
              // Note that the greeting stands over the chat's first message, so it waits until no older page is left to read, as the panel draws it above its first message.
              greeting:
                shown !== undefined && chatPage.before === undefined
                  ? managerGreeting(shown.title)
                  : undefined,
            },
          )
        : undefined,
    [
      chat,
      chatPage,
      messages,
      running,
      writing,
      readerId,
      toggles,
      pullRequests,
      whole.read,
      suggestionAddress,
      waitingCalls,
      shown,
      chatFaces,
    ],
  );

  // The member's messages on their way stand as their own lines at the end, as the host draws them.
  const transcriptRows = useMemo(
    () =>
      chat
        ? undefined
        : transcriptItems(withSending(messages ?? [], sending ?? []), {
            writing,
            readerId,
            toggles,
            now: Date.now(),
            pullRequests,
            wholePart: whole.read,
            origin,
            suggestionAddress,
            waitingCalls,
          }),
    [
      chat,
      waitingCalls,
      messages,
      sending,
      writing,
      readerId,
      toggles,
      pullRequests,
      whole.read,
      origin,
      suggestionAddress,
    ],
  );

  const items = chatItems ?? transcriptRows ?? NONE_SHOWN;

  // A call opened on an answer its page carried cut reads it whole.
  const cuts = useMemo(() => openCuts(items), [items]);
  useEffect(() => whole.ask(cuts), [whole, cuts]);

  // The apps the agent uses on the reader's Mac this turn, which stand as capsules over its composer, as the panel's stack floats over its box; their icons and newest windows are read beside the rows'.
  const inUse = useMemo(
    () =>
      messages === undefined
        ? undefined
        : appsInUse(messages, status !== undefined && agentStillWriting(status)),
    [messages, status],
  );

  // Note that only the pictures and recordings of the rows on screen and the few beside them are asked for, so a transcript of hundreds of screenshots never holds them all as it opens, and the next rows to scroll in are drawn as they land: a picture through expo-image's own view, a recording or a clip as the file it plays from, and the apps' capsules' pictures as the files SwiftUI and the viewer read.
  const near = useMemo(() => rowsNear(items, rowsShown, MEDIA_REACH), [items, rowsShown]);
  const pictureIds = useMemo(() => shownPictureIds(near), [near]);
  const dockIds = useMemo(() => appsDockMediaIds(inUse), [inUse]);

  // Note that every picture and recording of the transcript is handed to its row by its id, which it reads where it is drawn, so one landing draws that piece alone and never this page, whose rows may hold an open long-press menu; a sound clip alone is read here, as the file it plays from.
  const addressed = useMemo(
    () => new Set([...shownPictureIds(items), ...shownRecordingIds(items)]),
    [items],
  );

  const mediaIds = useMemo(
    () => shownMediaIds(near).filter((each) => !addressed.has(each)),
    [near, addressed],
  );

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
  const chatSending = chatPage?.sending;

  const undelivered = useCallback(
    (lineId: string): UndeliveredLine | undefined => {
      // Note that a Manager's chat marks its messages the service refused by the key each went under, the host keeping the files each carried, so each is sent again whole.
      if (chat) {
        const sent = chatSending?.find((each) => each.clientKey === lineId);

        return sent?.refused === undefined
          ? undefined
          : {
              why: messageFailureWords(sent.refused.failure),
              newThread: false,
              onRetry: () => undeliveredActs.current?.retry(lineId),
              onEdit: () => undeliveredActs.current?.edit(lineId),
              onDelete: () => undeliveredActs.current?.drop(lineId),
            };
      }

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
    [chat, chatSending, sending],
  );

  const composer = useMemo(
    () => ({
      editMessage: (line: Parameters<AgentComposer["editMessage"]>[0]) =>
        editMessage.current?.(line),
    }),
    [],
  );

  const suggestion = useSuggestionLooks(items, shown?.workspaceId, shown?.taskId ?? undefined);
  const transcriptOlder = useOlderPages(id, chat ? undefined : transcript?.before);
  const chatOlder = useOlderChatPages(id, chat ? chatPage?.before : undefined);
  const older = chat ? chatOlder : transcriptOlder;
  const transcriptRetry = useTranscriptRetry(id);
  const chatRetry = useManagerChatRetry(id);
  const retry = chat ? chatRetry : transcriptRetry;
  const media = useAgentMedia(id, mediaIds);
  const dockFiles = useAgentPictureFiles(id, dockIds);
  const pictures = usePictures(PICTURE_OWNER.AGENT, id, pictureIds);

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
  useNoteOpened(
    shown === undefined
      ? undefined
      : { kind: SEARCH_FOUND_KIND.AGENTS, id, workspaceId: shown.workspaceId },
  );

  const failed = chat
    ? chatHeld?.failed === true
    : held?.failed === true || transcript?.failure !== undefined;

  const statusWords = status === undefined ? undefined : agentStateWords(status);

  const subtitle = agentSubtitle(
    statusWords,
    agent === undefined ? undefined : modelLabel(agent.model),
  );

  // Note that a change of state is told to VoiceOver as it lands, such as Working turning to Finished or Failed, since the bar's line changes out of the reader's sight.
  useAnnounced(statusWords);

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
  const [facePicking, setFacePicking] = useState(false);
  const deleteQuestion = actions.deleteQuestion(title);

  // An agent archived or deleted gives way to where its own stack opened it from, or to the Tasks list it stands in where it was opened first, as from a launch or a notification; nothing moves once the reader has left its page.
  const leave = () => {
    if (!navigation.isFocused()) return;

    if (router.canDismiss()) router.back();
    else router.replace("/tasks");
  };

  // What the composer reads off the agent, read as the Inbox thread's composer reads it, so the two stand alike.
  const box = useAgentBox(id, agent);

  // Note that the newest refusal of the page's own acts stands over the field, so a server's switch refused after a Pin says its own words rather than the older one's.
  const move = useAgentMove(agent);

  const note = useNewestNote([actions.note, move.note, transcriptCopy.note, ...box.notes]);

  // Note that Copy transcript waits only for the transcript's first answer, failed or not, since the copy reads the whole transcript itself.
  const copiable = held !== undefined;
  const taskId = shown?.taskId ?? undefined;
  // Note that Open task leads with the task's status ring, as its rows do, read from the listed tasks.
  const taskStatus = useTaskListRow(useTaskListCollections().tasks, taskId)?.status;

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

  // Each chat message by its row, to the line it went as, which its Edit rewinds to; null for the Manager's own, which went as none.
  const chatLines = useMemo(
    () =>
      chat
        ? new Map((chatPage?.messages ?? []).map((message) => [message.id, message.lineId]))
        : undefined,
    [chat, chatPage?.messages],
  );

  const messageActs = useMessageActs({
    agentId: id,
    agent: shown,
    transcript,
    readerId,
    composer,
    calling: talk.call?.kind === COMPOSER_CALL.ON_CALL,
    chatLines,
  });

  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  // Note that a regular window's bar stands Pin and Archive as glyphs before ⋯, as Mail stands its acts, and ⋯ keeps the rest; a compact window keeps them all in ⋯.
  const barActs = regular && agent !== undefined;

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

  // Note that a chat message's thread opens on its own page pushed over the chat, on iPhone and iPad alike, as Slack's app pushes a thread.
  const openChatThread = (root: string) =>
    router.push({ pathname: onOwnTab("/tasks/agent/[id]/thread/[root]"), params: { id, root } });

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
      apps={
        inUse === undefined ? undefined : { inUse, source: (pictureId) => dockFiles.get(pictureId) }
      }
      pullRequest={pullRequests[0]}
      onOpenPullRequest={openPullRequest}
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
      submenus={box.submenus}
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
      tools={box.tools}
      trailing={box.trailing}
    />
  );

  const transcriptView = (
    <PicturesProvider owner={PICTURE_OWNER.AGENT} ownerId={id} kind={PRODUCT_PICTURE_KIND.AGENT}>
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
        mediaSource={(mediaId) =>
          addressed.has(mediaId) ? pictures.refOf(mediaId) : media.sources.get(mediaId)
        }
        fileSource={sentFiles.source}
        onRetryFile={sentFiles.retry}
        onRetryMedia={(mediaId) =>
          addressed.has(mediaId) ? pictures.retry(mediaId) : media.retry(mediaId)
        }
        onOpenElsewhere={address === undefined ? undefined : () => openInSafari(address)}
        onOpenAddress={openInSafari}
        messageLink={messageLink}
        messageMore={messageActs.more}
        channel={chatFaces?.faces}
        onOpenChatThread={chat ? openChatThread : undefined}
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
    </PicturesProvider>
  );

  const asks = (
    <>
      {box.sheet}
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
      <FaceSheet
        face={agent?.face}
        presented={facePicking}
        onDismiss={() => setFacePicking(false)}
        onPick={actions.changeFace}
      />
    </>
  );

  // Note that the ⋯ is SwiftUI's own menu, as every bar's menu stands (`StackBarMenu`), its groups in the panel's order (`agentMenuGroups`): where it opens its task and its Manager's overview, the copies, then the name, then where it opens, then going on, then moving and archiving, and Permanently delete last and alone.
  const moreMenu =
    copyable || openable || openTask !== undefined
      ? menuOfGroups(MENU_WORDS.MORE, GLYPH.MORE, [
          {
            items:
              openTask === undefined
                ? []
                : [{ label: PATH_OPENS.TASK, ...taskLead(taskStatus), onPress: openTask }],
          },
          {
            items:
              openOverview === undefined
                ? []
                : [{ label: MENU_WORDS.OVERVIEW, symbol: GLYPH.LIST, onPress: openOverview }],
          },
          {
            items: [
              ...(copyable && address !== undefined
                ? [{ label: MENU_WORDS.COPY_LINK, symbol: GLYPH.LINK, onPress: actions.copyLink }]
                : []),
              ...(copyable && copiable
                ? [
                    {
                      label: COPY_TRANSCRIPT_WORDS.COPY,
                      symbol: GLYPH.COPY,
                      choices: [],
                      actions: [
                        {
                          label: COPY_TRANSCRIPT_WORDS.CONCISE,
                          onPress: () => copyTranscript(TRANSCRIPT_COPY.CONCISE),
                        },
                        {
                          label: COPY_TRANSCRIPT_WORDS.FULL,
                          onPress: () => copyTranscript(TRANSCRIPT_COPY.FULL),
                        },
                        {
                          label: COPY_TRANSCRIPT_WORDS.SHARE,
                          symbol: GLYPH.SHARE,
                          onPress: () => shareTranscript(TRANSCRIPT_COPY.FULL),
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
          {
            items:
              agent === undefined
                ? []
                : [
                    // Note that a Manager is named from its Settings, its one place to configure it, as the desktop's menu offers Settings… in Rename's place.
                    chat
                      ? { label: MENU_WORDS.SETTINGS, symbol: GLYPH.OPTIONS, onPress: openSettings }
                      : { label: MENU_WORDS.RENAME, symbol: GLYPH.RENAME, onPress: askRename },
                    // Note that a Manager's face is changed beside its Settings, as the panel's menu offers Change face, its picker over the page; none while it is archived.
                    ...(chat && !archived && agent.face !== undefined
                      ? [
                          {
                            label: CHANGE_FACE,
                            symbol: GLYPH.CHANGE_FACE,
                            onPress: () => setFacePicking(true),
                          },
                        ]
                      : []),
                    ...(barActs
                      ? []
                      : [
                          {
                            label: actions.pinned ? MENU_WORDS.UNPIN : MENU_WORDS.PIN,
                            symbol: actions.pinned ? GLYPH.UNPIN : GLYPH.PIN,
                            onPress: actions.pin,
                          },
                        ]),
                  ],
          },
          {
            items: openable
              ? [
                  ...(address === undefined
                    ? []
                    : [
                        {
                          label: VERB.OPEN_IN_BROWSER,
                          symbol: GLYPH.OPEN_EXTERNALLY,
                          onPress: () => openInSafari(address),
                        },
                      ]),
                  ...(agent !== undefined && hasPorts
                    ? [{ label: AGENT_PORTS_WORDS.PORTS, symbol: GLYPH.PLUG, onPress: openPorts }]
                    : []),
                ]
              : [],
          },
          {
            items:
              openable && agent !== undefined && runActions.length > 0
                ? [
                    {
                      label: RUN_ACTION_WORDS.SUBMENU,
                      symbol: GLYPH.RUN,
                      choices: [],
                      actions: runActions.map((offered) => ({
                        label: runActionMenuLabel(offered.action, offered.runs),
                        symbol: offered.runs ? GLYPH.STOP : GLYPH.RUN,
                        detail: offered.runs ? RUN_ACTION_WORDS.RUNNING : offered.action.command,
                        onPress: offered.onPress,
                      })),
                    },
                  ]
                : [],
          },
          {
            items:
              continueOf === undefined
                ? []
                : [{ label: continueOf.label, symbol: GLYPH.CONTINUE, onPress: continueAgent }],
          },
          {
            // Note that Move to stands before Archive, as the panel's menu stands them.
            items: [
              ...(agent === undefined || move.places === undefined
                ? []
                : [
                    {
                      label: MENU_WORDS.MOVE_TO,
                      symbol: GLYPH.MOVE,
                      choices: [],
                      actions: move.places.map((place) => ({
                        label: place.label,
                        symbol: place.glyph,
                        detail: place.detail,
                        onPress: place.onPress,
                      })),
                    },
                  ]),
              ...(agent === undefined || barActs
                ? []
                : [
                    archived
                      ? {
                          label: MENU_WORDS.UNARCHIVE,
                          symbol: GLYPH.UNARCHIVE,
                          onPress: actions.unarchive,
                        }
                      : { label: MENU_WORDS.ARCHIVE, symbol: GLYPH.ARCHIVE, onPress: askArchive },
                  ]),
            ],
          },
          {
            items:
              agent === undefined
                ? []
                : [
                    {
                      label: MENU_WORDS.DELETE,
                      symbol: GLYPH.DELETE,
                      destructive: true,
                      onPress: () => setDeleting(true),
                    },
                  ],
          },
        ])
      : undefined;

  const barOptions = { title, headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT } };

  return (
    <>
      <Stack.Screen options={barOptions} />
      {/* Note that the agent's state and model stand under its name as the bar's own subtitle, as the panel's tab says them, since the line over the transcript scrolled out of sight as the page opened at its newest row, the model chosen from the composer's model chip. */}
      {/* Note that a regular window stands the name at the bar's leading edge, in the bar's own row, since on an iPad whose tab bar floats in the middle of that row UIKit dropped a centered name into a row of its own over the transcript. */}
      {/* Note that a Manager's name stands after its face, as the panel's page heads it, livelier while it works. */}
      <StackSubtitle
        words={subtitle?.words ?? ""}
        leading={regular}
        face={
          shown?.face === undefined
            ? undefined
            : {
                title,
                face: shown.face,
                working: status !== undefined && agentGlyphState(status) === GLYPH_STATE.WORKING,
              }
        }
      />
      <Stack.Toolbar placement="right">
        {moreMenu === undefined ? null : (
          <Stack.Toolbar.View>
            <StackBarMenu menu={moreMenu} />
          </Stack.Toolbar.View>
        )}
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
});

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
