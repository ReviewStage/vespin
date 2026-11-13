// agent-screens.tsx -- one agent's page, its transcript live under the system's header naming it, its held calls answered, its composer's + and its ⋯ menu, its run actions and its Permanently delete among it, a page it showed, opened whole, the sheet of its options: its model, effort, Fast, permission mode, and MCP servers, and the sheet of its listening ports.

import {
  AGENT_PERMISSION_MODE,
  type AgentPermissionMode,
} from "@repo/features/agent-approval-wire";
import {
  AGENT_PORTS_WORDS,
  PORT_ACT,
  type PortAct,
  type PortRow,
} from "@repo/features/agent-ports-model";
import { type AgentOverviewPullRequest, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { agentActivity } from "@repo/features/ios-system-activity";
import { LINK_DESTINATION, linkOf, linkWorkspaceStep } from "@repo/features/link-grammar";
import { agentName, modelLabel } from "@repo/features/model-label";
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
import { agentStillWriting } from "@repo/features/task-agents-model";
import { TRANSCRIPT_COPY, type TranscriptCopy } from "@repo/features/transcript-copy";
import { MCP_SERVER_LABEL, VERB } from "@repo/features/words";
import { selectInboxReader, selectWorkspaces } from "@repo/host/app-state-reads";
import { PERMISSION_MODE_WORDS } from "@repo/settings";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  AgentHead,
  AgentTranscript,
  AskNote,
  AttachedPictures,
  BAR_TITLE,
  BUTTON_LOOK,
  Composer,
  type ComposerMenu,
  ConfirmAsk,
  DeniesWaiting,
  drawnCallIds,
  GLYPH,
  GlassDock,
  type Glyph,
  glyphSymbol,
  HeldCallBanner,
  ListSection,
  MenuPickRow,
  MenuRow,
  type MenuRowAct,
  NO_TOGGLES,
  openCuts,
  PickRows,
  QueuedLines,
  RenameAsk,
  Screen,
  SettingsForm,
  SkillSuggestions,
  SwitchRow,
  shownMediaIds,
  type TRANSCRIPT_ITEM,
  type TranscriptItem,
  type TranscriptReveal,
  type TranscriptToggles,
  toggledAt,
  transcriptItems,
  transcriptOriginOf,
  useAnnounced,
  useColors,
  withSending,
  withWaitingLine,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  useAgentMedia,
  useAgentPullRequests,
  useAgentTranscript,
  useFollowedAgent,
  useOlderPages,
  useShownAgent,
  useTranscriptRetry,
  useWholeParts,
} from "../agents/use-agent.js";
import { useAgentActions } from "../agents/use-agent-actions.js";
import { type AgentApprovals, useAgentApprovals } from "../agents/use-agent-approvals.js";
import {
  type AgentComposer,
  type SuggestedSend,
  useAgentComposer,
} from "../agents/use-agent-composer.js";
import { type AgentMode, useAgentMode } from "../agents/use-agent-mode.js";
import { type AgentModelPick, useAgentModelPick } from "../agents/use-agent-model.js";
import { useAgentOrigin } from "../agents/use-agent-origin.js";
import { useAgentHasPorts, useAgentPorts } from "../agents/use-agent-ports.js";
import { useAgentRun } from "../agents/use-agent-run.js";
import { useAgentServers } from "../agents/use-agent-servers.js";
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
import { openInSafari, useOpenLink } from "../open-link.js";
import { usePullRequestsRead, usePullRequestWrites } from "../pull-requests/use-pull-request.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab } from "../tab-route.js";
import { useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";
import { PageScreen } from "./page-screens.js";

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
  DELETE: "Permanently delete",
} as const;

/** What Copy transcript offers, in the panel's words: the transcript concise or whole, copied, and the same words handed to the share sheet. */
const COPY_TRANSCRIPT_WORDS = {
  COPY: "Copy transcript",
  CONCISE: "Concise",
  FULL: "Full",
  SHARE: "Share…",
} as const;

/** What the + offers beside the options: the photo picker, and the sheet of every option. */
const ADD_WORDS = {
  PHOTOS: "Photos",
  OPTIONS: "Options",
} as const;

/** What Rename asks, as the system's alert asks for a name. */
const RENAME_WORDS = {
  TITLE: "Rename agent",
  ACT: "Rename",
  PLACEHOLDER: "Agent name",
} as const;

/** The options sheet's words: its name, its rows, its close, and when a change reaches the agent, as the panel's chip applies one. */
const OPTIONS_WORDS = {
  TITLE: "Options",
  MODEL: "Model",
  EFFORT: "Effort",
  FAST: "Fast",
  DONE: "Done",
  APPLIES: "Takes effect from the agent's next step.",
  READING_SERVERS: "Reading your MCP servers",
  NO_SERVERS: "No MCP server is connected. Connect one in Settings.",
  MORE_SERVERS: "Connect another in Settings.",
} as const;

/** The glyph each permission mode wears, the panel's own: a hand, a shield round an ellipsis, a shield round a "!". */
const MODE_SYMBOL = {
  [AGENT_PERMISSION_MODE.ASK]: GLYPH.ASK_FIRST,
  [AGENT_PERMISSION_MODE.AUTO]: GLYPH.AUTO_APPROVE,
  [AGENT_PERMISSION_MODE.FULL_ACCESS]: GLYPH.FULL_ACCESS,
} as const satisfies Record<AgentPermissionMode, Glyph>;

/** What a pull request's card offers beside Review where it may merge now, and what that asks first. */
const MERGE_WORD = "Merge";
const MERGE_QUESTION = "Merge this pull request?";

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
      : { kind: LINK_DESTINATION.AGENT, planId: taskId, agentId };

  return step === undefined ? undefined : linkOf(place, step);
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
  agentId,
  pullRequest,
  onDone,
}: {
  readonly agentId: string;
  readonly pullRequest: AgentOverviewPullRequest;
  readonly onDone: () => void;
}) {
  const writes = usePullRequestWrites({ agentId, number: pullRequest.number });
  const merge = cardMergeOf(pullRequest);

  if (merge === undefined) return null;

  return (
    <ConfirmAsk
      title={MERGE_QUESTION}
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

/** The agent's composer at the page's foot: that a message denies the call waiting, a call waiting that no row draws, the queue, the pictures attached, and what did not go over the field, and Stop in Send's place while the agent works. */
function AgentComposerBar({
  composer,
  approvals,
  onShowWaiting,
  addMenu,
  note,
}: {
  readonly composer: AgentComposer;
  readonly approvals: Pick<AgentApprovals, "waiting" | "banner">;
  /** Scrolls the transcript to the call waiting; none where no row draws one. */
  readonly onShowWaiting: (() => void) | undefined;
  readonly addMenu: ComposerMenu;
  /** What the last act of the page's menu or the + that did not take said, where the composer's own says nothing. */
  readonly note: string | undefined;
}) {
  const said = composer.note ?? note;
  const { banner, waiting } = approvals;
  // Note that the bar tells VoiceOver of a call waiting, since it stands while the call's row may lie out of the list's drawn window, and an agent held for an answer waits on the reader wherever they are.
  useAnnounced(waiting === undefined ? undefined : `${waiting.words}, ${waiting.asks}`, true);
  // Note that a message sent now denies the calls waiting only where Send would not queue it behind the turn.
  const denies = waiting !== undefined && !composer.sendQueues;

  const head =
    !denies &&
    banner === undefined &&
    composer.queued.length === 0 &&
    composer.paused === undefined &&
    composer.attached.length === 0 &&
    composer.skills === undefined &&
    said === undefined ? undefined : (
      <>
        {composer.skills === undefined ? null : (
          <SkillSuggestions
            skills={composer.skills.skills}
            empty={composer.skills.empty}
            onPick={composer.skills.pick}
          />
        )}
        {banner === undefined ? null : <HeldCallBanner {...banner} />}
        {denies ? <DeniesWaiting onShow={onShowWaiting} /> : null}
        <QueuedLines
          lines={composer.queued}
          paused={composer.paused}
          onSteer={composer.steer}
          onDelete={composer.remove}
        />
        <AttachedPictures pictures={composer.attached} onDetach={composer.detach} />
        {said === undefined ? null : <AskNote words={said} />}
      </>
    );

  return (
    <Composer
      placeholder={composer.placeholder}
      words={composer.words}
      onWords={composer.onWords}
      sendable={composer.sendable}
      onSend={composer.send}
      addMenu={addMenu}
      onDropPictures={composer.dropPictures}
      onStop={composer.stop}
      stopping={composer.stopping}
      head={head}
    />
  );
}

/**
 * What the composer's + opens, as the panel's + and model chip offer them,
 * the less frequent of them in one native menu rather than chips along the
 * field: Photos, then Options, the sheet of every option, then the agent's
 * permission mode as a menu of its modes where its harness takes one, and
 * Fast as a switch where its model has a fast version.
 */
function agentAddMenu(
  composer: AgentComposer,
  mode: AgentMode | undefined,
  pick: AgentModelPick,
  openOptions: (() => void) | undefined,
): ComposerMenu {
  return {
    actions: [
      { label: ADD_WORDS.PHOTOS, symbol: GLYPH.ATTACH, onPress: composer.attach },
      ...(openOptions === undefined
        ? []
        : [
            {
              label: ADD_WORDS.OPTIONS,
              symbol: GLYPH.OPTIONS,
              onPress: openOptions,
            },
          ]),
    ],
    submenus:
      mode === undefined
        ? []
        : [
            {
              label: PERMISSION_MODE_WORDS.GROUP,
              symbol: MODE_SYMBOL[mode.mode],
              choices: mode.modes.map((option) => ({
                label: option.label,
                symbol: MODE_SYMBOL[option.id],
                on: option.id === mode.mode,
                onPress: () => mode.choose(option.id),
              })),
              actions: [],
            },
          ],
    switches:
      pick.fast === undefined
        ? []
        : [{ label: OPTIONS_WORDS.FAST, on: pick.fast.on, onPress: pick.fast.toggle }],
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
 * One agent's page: the system's header naming the agent in the ink, as
 * Messages names a conversation, since the transcript opens at its newest
 * row and its head scrolls away, its back button leading to the task, with
 * a ⋯ menu, as the panel's agent menu offers it: Copy link and Open in
 * browser, Rename, typed in the system's alert, Pin or Unpin, Options, a
 * cloud agent's Ports, which opens the sheet of its listening ports, and
 * Run ›, its repository's run actions where its workspace offers them, each
 * run in its sandbox or stopped while it runs, as the panel's narrow ⋯
 * offers them, Archive, asked first, which goes back once the agent is
 * archived, and Permanently delete, red and last, which always asks in the
 * panel's words and goes back once the agent is deleted. Under
 * it, its transcript as one lazy list, its head where the agent stands and
 * the model it runs on, which opens the options sheet, as the menu's
 * Options and the composer's + do. The transcript
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
 * Photos, Options, the permission mode, and Fast. A `/` typed offers the
 * task's skills over the field.
 */
export function AgentScreen() {
  const {
    id = "",
    suggestedBy,
    button,
  } = useLocalSearchParams<{ id: string; suggestedBy?: string; button?: string }>();

  useSurfaceOpen(PRODUCT_SURFACE.AGENT, id);
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const navigation = useNavigation();
  const openLink = useOpenLink();
  const colors = useColors();
  const agent = useFollowedAgent(id);
  // Note that an agent the list doesn't hold is named and placed from its own read, while what acts on it reads the list alone.
  const shown = useShownAgent(id);
  const pullRequests = useAgentPullRequests(id);

  const open = useMemo(
    () =>
      pullRequests
        .filter(({ state }) => state === PULL_REQUEST_STATE.OPEN)
        .map(({ number }) => number),
    [pullRequests],
  );

  const offers = usePullRequestsRead(id, open);
  // The pull request whose card's Merge is being asked about.
  const [merging, setMerging] = useState<number | undefined>(undefined);
  const asked = merging === undefined ? undefined : offers.get(merging);
  const held = useAgentTranscript(id);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const address = useAgentAddress(id, shown?.workspaceId, shown?.planId);
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

  // The member's messages on their way stand as their own lines at the end, as the host draws them.
  const items = useMemo(
    () =>
      transcriptItems(withSending(messages ?? [], sending ?? []), {
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
    ],
  );

  // A call opened on an answer its page carried cut reads it whole.
  const cuts = useMemo(() => openCuts(items), [items]);
  useEffect(() => whole.ask(cuts), [whole, cuts]);

  const mediaIds = useMemo(() => shownMediaIds(items), [items]);
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

  const composer = useAgentComposer(
    id,
    agent,
    transcript,
    status,
    approvals.messageSent,
    suggested,
  );

  const suggestion = useSuggestionLooks(items, shown?.workspaceId, shown?.planId);
  const older = useOlderPages(id, transcript?.before);
  const retry = useTranscriptRetry(id);
  const media = useAgentMedia(id, mediaIds);

  const title = cardTitle(
    shown === undefined ? (transcript?.word?.title ?? UNLISTED_AGENT) : agentName(shown),
  );

  useScreenActivity((workspaces) =>
    shown === undefined
      ? undefined
      : agentActivity(
          {
            id,
            title,
            workspaceId: shown.workspaceId,
            taskId: shown.planId,
          },
          workspaces,
        ),
  );
  const failed = held?.failed === true || transcript?.failure !== undefined;

  const openOptions =
    agent === undefined
      ? undefined
      : () => router.push({ pathname: "/agent-model", params: { agent: id } });

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
  // Whether Rename's alert, or Archive's or Permanently delete's question, stands over the page.
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteQuestion = actions.deleteQuestion(title);

  // An agent archived or deleted gives way to where its own stack opened it from, or to the Tasks list it stands in where it was opened first, as from a launch or a notification; nothing moves once the reader has left its page.
  const leave = () => {
    if (!navigation.isFocused()) return;

    if (router.canDismiss()) router.back();
    else router.replace("/tasks");
  };

  const addMenu = agentAddMenu(composer, mode, pick, openOptions);

  // Note that a regular window's bar stands Pin and Archive as glyphs before ⋯, as Mail stands its acts, and ⋯ keeps the rest; a compact window keeps them all in ⋯.
  const barActs = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR && agent !== undefined;

  // Archive asks first. Note that the question is let go first, so one a dismissal swallowed never leaves Archive asking nothing.
  const askArchive = () => {
    setArchiving(false);
    void actions.archiveAsk.ask(id).then((stands) => {
      if (stands) setArchiving(true);
    });
  };

  const openPage = (item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.PAGE }>) =>
    router.push({
      pathname: onOwnTab("/tasks/agent/[id]/page"),
      params: { id, page: item.page, version: String(item.version), title: item.title },
    });

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel={MENU_WORDS.MORE}>
          {address === undefined ? null : (
            <Stack.Toolbar.Menu inline>
              <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.LINK)} onPress={actions.copyLink}>
                {MENU_WORDS.COPY_LINK}
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon={glyphSymbol(GLYPH.OPEN_EXTERNALLY)}
                onPress={() => openInSafari(address)}
              >
                {VERB.OPEN_IN_BROWSER}
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          )}
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.COPY)} title={COPY_TRANSCRIPT_WORDS.COPY}>
              <Stack.Toolbar.MenuAction onPress={() => copyTranscript(TRANSCRIPT_COPY.CONCISE)}>
                {COPY_TRANSCRIPT_WORDS.CONCISE}
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction onPress={() => copyTranscript(TRANSCRIPT_COPY.FULL)}>
                {COPY_TRANSCRIPT_WORDS.FULL}
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon="square.and.arrow.up"
                onPress={() => shareTranscript(TRANSCRIPT_COPY.FULL)}
              >
                {COPY_TRANSCRIPT_WORDS.SHARE}
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar.Menu>
          {agent === undefined ? null : (
            <Stack.Toolbar.Menu inline>
              <Stack.Toolbar.MenuAction
                icon={glyphSymbol(GLYPH.RENAME)}
                onPress={() => setRenaming(true)}
              >
                {MENU_WORDS.RENAME}
              </Stack.Toolbar.MenuAction>
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
          {openOptions === undefined ? null : (
            <Stack.Toolbar.Menu inline>
              <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.OPTIONS)} onPress={openOptions}>
                {ADD_WORDS.OPTIONS}
              </Stack.Toolbar.MenuAction>
              {hasPorts ? (
                <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.PLUG)} onPress={openPorts}>
                  {AGENT_PORTS_WORDS.PORTS}
                </Stack.Toolbar.MenuAction>
              ) : null}
              {runActions.length === 0 ? null : (
                <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.RUN)} title={RUN_ACTION_WORDS.SUBMENU}>
                  {runActions.map((offered) => (
                    <Stack.Toolbar.MenuAction
                      key={offered.action.id}
                      icon={glyphSymbol(offered.runs ? GLYPH.STOP : GLYPH.RUN)}
                      subtitle={offered.action.command}
                      onPress={offered.onPress}
                    >
                      {runActionMenuLabel(offered.action, offered.runs)}
                    </Stack.Toolbar.MenuAction>
                  ))}
                </Stack.Toolbar.Menu>
              )}
            </Stack.Toolbar.Menu>
          )}
          {agent === undefined || barActs ? null : (
            <Stack.Toolbar.Menu inline>
              <Stack.Toolbar.MenuAction
                icon={glyphSymbol(GLYPH.ARCHIVE)}
                destructive
                onPress={askArchive}
              >
                {MENU_WORDS.ARCHIVE}
              </Stack.Toolbar.MenuAction>
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
        {/* Note that a right bar's first item stands at its edge, so the ⋯ leads the list and Archive then Pin stand before it, as Mail stands its acts before More. Each glyph is named as the ⋯'s is, since a top bar loads an `xcasset` icon through React Native's image loader, which reads no symbol set, and drew an empty capsule. */}
        {barActs ? (
          <Stack.Toolbar.Button
            icon={glyphSymbol(GLYPH.ARCHIVE)}
            accessibilityLabel={MENU_WORDS.ARCHIVE}
            onPress={askArchive}
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
      <GlassDock
        bar={
          <AgentComposerBar
            composer={composer}
            approvals={approvals}
            onShowWaiting={showWaiting}
            addMenu={addMenu}
            note={actions.note ?? transcriptCopy.note ?? mode?.note ?? pick.note}
          />
        }
      >
        <AgentTranscript
          items={rows}
          reveal={reveal}
          head={
            <AgentHead
              model={agent === undefined ? undefined : modelLabel(agent.model)}
              status={status}
              onModel={openOptions}
            />
          }
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
          mediaSource={(pictureId) => media.get(pictureId)}
          onOpenElsewhere={address === undefined ? undefined : () => openInSafari(address)}
          onOpenAddress={openInSafari}
          onOpenPullRequest={(item) =>
            router.push({
              pathname: onOwnTab("/tasks/agent/[id]/pull/[number]"),
              params: { id, number: String(item.number) },
            })
          }
          pullRequestActs={(item) =>
            cardMergeOf(offers.get(item.number)) === undefined
              ? []
              : [{ label: MERGE_WORD, onPress: () => setMerging(item.number) }]
          }
        />
      </GlassDock>
      {asked === undefined ? null : (
        <CardMergeAsk agentId={id} pullRequest={asked} onDone={() => setMerging(undefined)} />
      )}
      <RenameAsk
        title={RENAME_WORDS.TITLE}
        act={RENAME_WORDS.ACT}
        name={actions.title}
        placeholder={RENAME_WORDS.PLACEHOLDER}
        presented={renaming}
        onRename={(name) => {
          setRenaming(false);
          actions.rename(name);
        }}
        onDismiss={() => setRenaming(false)}
      />
      <ConfirmAsk
        title={actions.archiveAsk.question.title}
        message={actions.archiveAsk.question.message}
        act={actions.archiveAsk.question.act}
        destructive
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

  const agent = useFollowedAgent(id);

  return (
    <PageScreen
      workspaceId={agent?.workspaceId}
      taskId={agent?.planId}
      pageId={page}
      version={Number(version)}
      title={title}
    />
  );
}

/**
 * The agent's options, as the panel's model chip and + menu change them, in
 * a sheet over its page, each change sent at once and drawn on the agent as
 * it is asked, one the service refused reading back and saying why under its
 * section: its model, effort, and Fast, which take effect from its next
 * step, the models New agent offers that its harness runs and the efforts
 * the model lists, Fast only where the model has a fast version; its
 * permission mode, each with what it does, where its harness takes one,
 * which takes effect from its next turn; and the connected MCP servers it is
 * handed, each with its switch, a server connected in Settings. Done closes
 * it.
 */
export function AgentOptionsScreen({ agentId }: { readonly agentId: string }) {
  const colors = useColors();
  const router = useRouter();
  const pick = useAgentModelPick(agentId);
  const mode = useAgentMode(agentId);
  const servers = useAgentServers(agentId);

  const serversFooter =
    servers.note ??
    (!servers.read
      ? OPTIONS_WORDS.READING_SERVERS
      : servers.servers.length === 0
        ? OPTIONS_WORDS.NO_SERVERS
        : OPTIONS_WORDS.MORE_SERVERS);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: OPTIONS_WORDS.TITLE,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={OPTIONS_WORDS.DONE}
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      <Screen>
        <SettingsForm>
          <ListSection footer={pick.note ?? OPTIONS_WORDS.APPLIES}>
            <MenuPickRow
              label={OPTIONS_WORDS.MODEL}
              options={pick.models}
              picked={pick.model}
              onPick={pick.pickModel}
            />
            {pick.efforts.length <= 1 ? null : (
              <MenuPickRow
                label={OPTIONS_WORDS.EFFORT}
                options={pick.efforts}
                picked={pick.effort}
                onPick={pick.pickEffort}
              />
            )}
            {pick.fast === undefined ? null : (
              <SwitchRow
                label={OPTIONS_WORDS.FAST}
                on={pick.fast.on}
                onSwitch={pick.fast.toggle}
                testId="options-fast"
              />
            )}
          </ListSection>
          {mode === undefined ? null : (
            <ListSection
              title={PERMISSION_MODE_WORDS.GROUP}
              footer={mode.note ?? PERMISSION_MODE_WORDS.APPLIES}
            >
              <PickRows
                options={mode.modes}
                picked={mode.mode}
                onPick={(picked) => {
                  const chosen = mode.modes.find((option) => option.id === picked);

                  if (chosen !== undefined) mode.choose(chosen.id);
                }}
              />
            </ListSection>
          )}
          <ListSection title={MCP_SERVER_LABEL.many} footer={serversFooter}>
            {servers.servers.map((server) => (
              <SwitchRow
                key={server.connection}
                label={server.name}
                on={server.on}
                onSwitch={(on) => servers.toggle(server.connection, on)}
              />
            ))}
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
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

/** The Ports sheet's own words: its close. */
const PORTS_WORDS = { DONE: "Done" } as const;

/**
 * A cloud agent's listening ports, as the panel's plug lists them where it
 * forwards nothing, in a sheet over its page, read every few seconds while
 * it stands: one row per port, ":3000" with what serves it under it, whose
 * press offers Share while no port is shared; the shared one wears a link
 * and Sharing, and offers Open link, which opens it in Safari, Copy link,
 * and Stop sharing; while one is shared, another offers nothing, and where
 * none is listed, the panel's line says why. A share that did not go says
 * why under the list. Done closes it.
 */
export function AgentPortsScreen({ agentId }: { readonly agentId: string }) {
  const colors = useColors();
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
          contentStyle: { backgroundColor: colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={PORTS_WORDS.DONE}
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      <Screen>
        <SettingsForm>
          <ListSection
            footer={ports.note ?? (ports.rows.length === 0 ? ports.none : ports.linkNote)}
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
