import { computerAppsOf, messageWords } from "@repo/features/agent-parts";
import { REPLAY_STEP_KIND, type Replay, type ReplayStep } from "@repo/features/agent-replay";
import { TRANSCRIPT_KIND } from "@repo/features/agent-view";
import type {
  AgentPullRequest,
  AgentSummary,
  AgentTodos,
  AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { AGENT_SENDER } from "@repo/features/agent-wire";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import {
  briefOrigin,
  type CarriedTranscript,
  carriedTranscript,
  earlierMessagesLine,
  earlierStepsLine,
  leftOutLine,
  REPLAY_PAGE,
  type ReplayPage,
  replayCallsServer,
  replayCount,
  replayPage,
  replayTaskTodos,
  replayVerb,
  replayWords,
  STEP_VIEW,
  type StepView,
  stepView,
  summaryLine,
} from "@repo/features/replay-card-model";
import { TOOL_TARGET, type ToolTarget } from "@repo/features/tool-call-model";
import {
  BUTTON_VARIANT,
  Button,
  CHAT_RUN,
  CHAT_SIDE,
  ChatBubble,
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  GlyphSlot,
  Inline,
  MESSAGE_LINE_ALIGN,
  MessageHead,
  MessageLine,
  OneLine,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@repo/ui/actor-model";
import { ICON_SIZE } from "@repo/ui/icons";
import { pullRequestLabelOf, TAB_WORDS } from "@repo/ui/tab-strip-model";
import { MESSAGE_ROLE } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpIcon, SplitIcon, TextQuoteIcon } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActorRef } from "../actor-ref.js";
import { Message, RECEIVED_MESSAGE_CLASS } from "../ai-elements/message.js";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import { useFindOpen } from "../find-in-tab.js";
import { pullRequestPublishedQuery } from "../live-reads.js";
import { useMemberDirectory } from "../member-directory.js";
import { TranscriptAgentOn } from "../reset-credit.js";
import { lineSender, providerOf } from "./agent-model.js";
import {
  AgentPicturesProvider,
  ComputerAppsProvider,
  MessageFileChips,
  MessageFiles,
  useAgentPictureDoor,
} from "./agent-pictures.js";
import { ConnectionNames, useServerName } from "./connection-names.js";
import { CopyMessageAction } from "./copy-message.js";
import { ForkProvider } from "./fork-action.js";
import { CHIP_OR_LINK_FRAME, ChipOrLink, ORIGIN_CHIP } from "./mention-chip.js";
import { RewindProvider } from "./rewind-action.js";
import { SentWords } from "./skill-chip.js";
import { useMentionDoors } from "./task-mentions.js";
import { TranscriptTool, TranscriptWords } from "./transcript-blocks.js";
import { useAgentTranscript } from "./use-agent-transcript.js";
import type { AgentsControl } from "./use-agents.js";
import { useOpenPlace } from "./use-open-link.js";
import { useListedAgent } from "./use-workspace-agents.js";
import { useWholePartDoor, WholePartsProvider } from "./whole-parts.js";

/**
 * replay-card.tsx -- the card an agent started from another opens on: "Continued from" or "Forked from" the source agent, folded over the brief and the steps of the source's work it was handed.
 *
 * The card stands as the description's card does, at a sent message's measure over
 * the line naming who started the agent and when, as any line sent to the
 * agent is named: a teammate by their face and name, the reader's own by
 * the time alone, and its Copy, which copies the replay as it was handed. Its summary row names the source by the chip its tab
 * wears, which opens that tab and hangs its card, and how many of the
 * source's steps were replayed, of how many where the earliest were left
 * out. Opened, it draws first the line the source's work opened on, where
 * the agent's brief is a line rather than a card of its own, at the time
 * the source's chain began, as a branched chat draws the history it was
 * branched from above the marker rather than as a line sent again; then
 * what it holds, our summary of the oldest steps
 * and how many steps were left out where either applies, then the newest
 * steps, each drawn as the live transcript draws it, a line over who sent
 * it, when, and Copy, and a call as a call of its tool, opening onto its
 * words exactly as the agent was handed them, under a row that draws the earlier ones a page at a time,
 * and a foot naming the branch and the pull request the source published,
 * where known. The source's whole transcript is a press of its chip away.
 * Where the source's own session was carried whole rather than its steps
 * replayed, the card holds the source's transcript while its tab shows,
 * reads it to its start, and draws its messages in the steps' place, as
 * the transcript draws them (`carriedTranscript`), its summary row counting
 * their steps, or says in one quiet line that it could not be read.
 * The model is `replay-card-model.ts`.
 */

/**
 * Where an agent's replay card stands: the agents of its task, archived ones
 * among them, which its source is found among, and the doors to that source:
 * its chip's tile and card, its tab, a message of it, and what it published.
 */
export interface ReplayPlace {
  readonly agents: readonly AgentSummary[];
  /** Who started the agent, named under the card unless it is the reader. */
  readonly startedBy: AgentSummary["startedBy"];
  /** The reader's own account id, whose start is named by its time alone (`lineSender`). */
  readonly readerId: string | undefined;
  /** The tile an agent's tab wears; none where the place does not list it. */
  readonly tile: (agentId: string) => Actor | undefined;
  /** The card an agent's tab hangs; none where the place hangs none. */
  readonly card: (agentId: string) => ReactNode;
  /** Opens an agent's tab; none where nothing opens one. */
  readonly onOpen: ((agentId: string) => void) | undefined;
  /** Each agent's pull request, of those that have one. */
  readonly pullRequests: ReadonlyMap<string, AgentPullRequest>;
  /** Reads one agent by its id, as a page that lists only its own agent names the source; none where nothing reads one. */
  readonly readAgent: ((agentId: string) => Promise<AgentSummary | undefined>) | undefined;
  readonly openGitHub: (url: string) => void;
  /** Whether the card's tab is on screen, while which a transcript carried whole holds its source's. */
  readonly shown: boolean;
  /** Draws a message of the source's transcript as the transcript draws its own, for a transcript carried whole. */
  readonly message: (message: AgentTranscriptMessage) => ReactNode;
}

/** No agents listed yet, one array so a render before the first read hands down the same one. */
const NO_AGENTS: readonly AgentSummary[] = [];

/**
 * Where an agent's tab stands its replay card: the task's agents, archived
 * ones among them, and the doors its transcript's rows open an agent by,
 * the tile and card a call about an agent wears and the press that opens
 * its tab.
 */
export function replayPlace(input: {
  agent: AgentSummary;
  control: Pick<AgentsControl, "agents" | "archived" | "pullRequests" | "readAgent" | "me">;
  tile: ((agentId: string) => Actor | undefined) | undefined;
  target: ((target: ToolTarget) => ReactNode) | undefined;
  onOpenTarget: ((target: ToolTarget) => void) | undefined;
  openGitHub: (url: string) => void;
  shown: boolean;
  message: (message: AgentTranscriptMessage) => ReactNode;
}): ReplayPlace {
  const { agent, control, tile, target, onOpenTarget, openGitHub, shown, message } = input;
  const agents = [...(control.agents ?? NO_AGENTS), ...(control.archived ?? NO_AGENTS)];

  return {
    agents,
    startedBy: agent.startedBy,
    readerId: control.me,
    tile: (agentId) => tile?.(agentId),
    card: (agentId) => target?.({ kind: TOOL_TARGET.AGENT, agent: agentId }),
    onOpen:
      onOpenTarget === undefined
        ? undefined
        : (agentId) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: agentId }),
    pullRequests: control.pullRequests,
    readAgent: control.readAgent,
    openGitHub,
    shown,
    message,
  };
}

/** The source agent named on a card, as its chip wears it, when the place does not list it: by its title and its harness's mark where a read found it, the mark of no known harness until then. */
function unlistedActor(agentId: string, read: AgentSummary | undefined): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    agentId,
    name: read?.title ?? TAB_WORDS.AGENT,
    provider: read === undefined ? undefined : providerOf(read.model),
    state: ACTOR_STATE.REST,
  };
}

/**
 * The source agent: as the place lists it, else as the window's task list
 * carries it, or, where neither does, as one might be read on an agent's
 * own page, which lists that agent alone, read once; nothing until it
 * answers, or where it cannot be read.
 */
function useSource(agentId: string, place: ReplayPlace): AgentSummary | undefined {
  const inWindow = useListedAgent(agentId);
  const listed = place.agents.find((each) => each.id === agentId) ?? inWindow;
  const [read, setRead] = useState<AgentSummary | undefined>(undefined);
  const reader = place.readAgent;
  const unlisted = listed === undefined;
  useEffect(() => {
    if (!unlisted || reader === undefined) return;
    let current = true;
    void reader(agentId).then((answer) => {
      if (current) setRead(answer);
    });

    return () => {
      current = false;
    };
  }, [agentId, reader, unlisted]);

  return listed ?? (read?.id === agentId ? read : undefined);
}

/**
 * Who sent a replayed line, as a transcript names a line's sender: a
 * member by their face and name, the app, an automation, GitHub's login, or
 * another agent by their own marks; nobody for the reader's own, as a
 * transcript names nobody over the reader's own lines; and by its name
 * alone where its step's marker named no sender the window can place.
 */
function useLineSender(
  view: Extract<StepView, { kind: typeof STEP_VIEW.LINE }>,
  readerId: string | undefined,
): ReactNode {
  const { members, former } = useMemberDirectory();

  if (view.own) return undefined;

  const actor =
    view.sentBy === undefined ? undefined : lineSender(view.sentBy, readerId, members, former);

  if (actor !== undefined) return <ActorRef actor={actor} />;

  // A member's line the reader sent is theirs; one the window cannot place keeps its name.
  if (readerId !== undefined && view.sentBy?.userId === readerId) return undefined;

  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.INHERIT}
      truncate
      className="message-sender-words"
    >
      {view.sender}
    </Text>
  );
}

/**
 * A replayed line, drawn as a transcript draws a line sent to the agent: a
 * sent message, at the column's left under who sent it where it is anyone's
 * but the reader's, as a transcript's line is, then when, where its marker
 * said, and Copy.
 */
function LineStep({
  view,
  readerId,
}: {
  view: Extract<StepView, { kind: typeof STEP_VIEW.LINE }>;
  readerId: string | undefined;
}): React.JSX.Element {
  const sender = useLineSender(view, readerId);
  const received = sender !== undefined;

  return (
    <Message
      from={received ? MESSAGE_ROLE.ASSISTANT : MESSAGE_ROLE.USER}
      className={received ? RECEIVED_MESSAGE_CLASS : undefined}
      data-replay-step={REPLAY_STEP_KIND.LINE}
    >
      {received ? <MessageHead sender={sender} /> : null}
      <ChatBubble side={received ? CHAT_SIDE.RECEIVED : CHAT_SIDE.SENT} run={CHAT_RUN.ALONE}>
        <TranscriptWords text={view.words} />
      </ChatBubble>
      <MessageLine
        align={received ? MESSAGE_LINE_ALIGN.START : MESSAGE_LINE_ALIGN.END}
        at={view.at}
        actions={<CopyMessageAction words={view.words} />}
      />
    </Message>
  );
}

/**
 * A replayed call, drawn as a transcript draws a call of its tool: its
 * kind's icon or its integration's mark, its command's description, the
 * server it ran on, and the agent it is about by the chip that agent's tab
 * wears, hanging its card, folded onto its input and its result.
 */
function CallStep({
  view,
  place,
}: {
  view: Extract<StepView, { kind: typeof STEP_VIEW.CALL }>;
  place: ReplayPlace;
}): React.JSX.Element {
  const call = view.view;
  const server = useServerName(call);
  const agentId = view.agent?.id;
  const listed = agentId === undefined ? undefined : place.tile(agentId);
  const title = view.agent?.title;

  const agent =
    listed ??
    (title === undefined
      ? undefined
      : {
          kind: ACTOR_KIND.AGENT,
          agentId,
          name: title,
          provider: view.agent?.model === undefined ? undefined : providerOf(view.agent.model),
          state: ACTOR_STATE.REST,
        });

  return (
    <TranscriptTool
      data-replay-step={REPLAY_STEP_KIND.TOOL}
      state={view.state}
      kind={call.kind}
      provider={call.provider}
      server={server}
      connection={call.connection}
      account={call.account}
      subject={call.subject}
      description={call.description}
      files={call.files}
      page={call.page}
      agent={agent}
      agentCard={agentId === undefined ? undefined : place.card(agentId)}
      input={call.input}
      output={call.output}
      errorText={view.errorText}
      refused={call.refused}
    />
  );
}

/**
 * The line the source's work opened on, drawn as a replayed line is but with
 * its files, as the transcript drew it: under whoever sent it, else as the
 * reader's own, when, where known, and its Copy. It offers no Edit nor link,
 * since it is the source's history rather than a line of this transcript.
 */
function BriefStep({
  message,
  sender,
  at,
}: {
  message: AgentTranscriptMessage;
  sender: Actor | undefined;
  at: number | undefined;
}): React.JSX.Element {
  const words = messageWords(message);
  const received = sender !== undefined;

  return (
    <MessageFiles message={message} words={words}>
      <Message
        from={received ? MESSAGE_ROLE.ASSISTANT : MESSAGE_ROLE.USER}
        className={received ? RECEIVED_MESSAGE_CLASS : undefined}
        data-replay-step={REPLAY_STEP_KIND.LINE}
      >
        {received ? <MessageHead sender={<ActorRef actor={sender} />} /> : null}
        <MessageFileChips message={message} />
        {words === "" ? null : (
          <ChatBubble side={received ? CHAT_SIDE.RECEIVED : CHAT_SIDE.SENT} run={CHAT_RUN.ALONE}>
            <SentWords text={words} />
          </ChatBubble>
        )}
        <MessageLine
          align={received ? MESSAGE_LINE_ALIGN.START : MESSAGE_LINE_ALIGN.END}
          at={at}
          actions={<CopyMessageAction words={words} copyable={words !== ""} />}
        />
      </Message>
    </MessageFiles>
  );
}

/**
 * One step, drawn as a transcript draws the same: a line as a sent
 * message, its sender under it unless it is the reader's own; the agent's
 * words as its words; and a call as a call's row, folded onto its input
 * and its result, which run long.
 */
function StepRow({
  step,
  todos,
  place,
}: {
  step: ReplayStep;
  /** The to-do list as it stood after the step, where it is one of Claude Code's task calls (`replayTaskTodos`). */
  todos: AgentTodos["todos"] | undefined;
  place: ReplayPlace;
}): React.JSX.Element {
  const view = stepView(step, todos);

  switch (view.kind) {
    case STEP_VIEW.LINE:
      return <LineStep view={view} readerId={place.readerId} />;
    case STEP_VIEW.SAID:
      return (
        <div data-replay-step={step.kind}>
          <TranscriptWords text={view.words} />
        </div>
      );
    case STEP_VIEW.CALL:
      return <CallStep view={view} place={place} />;
  }
}

/**
 * The summary we wrote of the oldest steps the replay could not keep,
 * folded under one quiet line saying how many it stands for and whose
 * words they are, as a webhook's body folds inside a run's prompt; its
 * words drawn as a transcript's are, once opened.
 */
function SummaryRow({ line, text }: { line: string; text: string }): React.JSX.Element {
  return (
    <Disclosure data-replay-summary="">
      <DisclosureSummary>
        <GlyphSlot size={ICON_SIZE.MEDIUM}>
          <TextQuoteIcon />
        </GlyphSlot>
        {line}
      </DisclosureSummary>
      <DisclosureBody inset={DISCLOSURE_BODY.FLUSH}>
        <TranscriptWords text={text} />
      </DisclosureBody>
    </Disclosure>
  );
}

/**
 * The rows the opened card draws: the newest page of them, under a row
 * drawing the page before as it is pressed, until every row is drawn.
 * The rows land under the row, so what stands above it holds still and the
 * panel stays where it was scrolled; once the last page lands the row goes,
 * and the keys land on the rows it drew rather than on nothing. While a
 * find bar is open every row is drawn, so the find covers them all, as a
 * fold's closed body is drawn for it (`fold.tsx`).
 */
function PagedRows({
  count,
  earlierLine,
  children,
}: {
  count: number;
  /** What the row before the drawn ones says of the page it draws (`earlierStepsLine`). */
  earlierLine: (page: ReplayPage) => string;
  /** Draws the rows from the one given, oldest first. */
  children: (from: number) => ReactNode;
}): React.JSX.Element {
  const finding = useFindOpen();
  const [shown, setShown] = useState(REPLAY_PAGE);
  const list = useRef<HTMLDivElement>(null);
  const page = replayPage(count, finding ? count : shown);

  const drawMore = () => {
    if (page.next === page.from) list.current?.focus({ preventScroll: true });
    setShown(count - page.from + page.next);
  };

  return (
    // No ring: it is focused only by script, to keep the place when Show more is spent.
    <div
      ref={list}
      tabIndex={-1}
      className="replay-steps flex flex-col gap-block-gap outline-none"
      data-replay-steps=""
    >
      {page.from === 0 ? null : (
        <Inline>
          <Button
            variant={BUTTON_VARIANT.QUIET}
            icon={<ChevronsUpIcon aria-hidden="true" />}
            onClick={drawMore}
          >
            {earlierLine(page)}
          </Button>
        </Inline>
      )}
      {children(page.from)}
    </div>
  );
}

/** The replayed steps the opened card draws, a page at a time (`PagedRows`). */
function ReplaySteps({
  steps,
  place,
}: {
  steps: readonly ReplayStep[];
  place: ReplayPlace;
}): React.JSX.Element {
  // Note that the replay's calls stand in its first message's words, which the transcript's own check for a server's call never reads.
  const callsServer = useMemo(() => replayCallsServer(steps), [steps]);
  const todos = useMemo(() => replayTaskTodos(steps), [steps]);

  return (
    <PagedRows count={steps.length} earlierLine={earlierStepsLine}>
      {(from) => (
        <ConnectionNames needed={callsServer}>
          {steps.slice(from).map((step, index) => (
            // Note that a step is keyed by its place among them all, because the replay never changes once handed, and a page landing above keeps the rows below as they were.
            <StepRow key={from + index} step={step} todos={todos.get(from + index)} place={place} />
          ))}
        </ConnectionNames>
      )}
    </PagedRows>
  );
}

/** Where the source's transcript a card carried whole stands: still being read, read, or not to be read. */
const CARRIED_READ = {
  READING: "reading",
  READ: "read",
  UNREAD: "unread",
} as const;

type CarriedRead =
  | { readonly kind: typeof CARRIED_READ.READING }
  | { readonly kind: typeof CARRIED_READ.UNREAD }
  | { readonly kind: typeof CARRIED_READ.READ; readonly transcript: CarriedTranscript };

/** What the card says where the source's transcript could not be read, as where it was deleted or the reader cannot reach it. */
const CARRIED_UNREAD_LINE = "The source agent's transcript could not be read.";

/** No messages drawn, while the source's transcript is being read or could not be. */
const NO_MESSAGES: readonly AgentTranscriptMessage[] = [];

/**
 * The source's transcript where the replay carried it whole: held while
 * the card's tab shows, and read to its start, a page at a time, since a
 * continue carries it whole and a fork's message may stand on any page;
 * nothing for a replay of steps, which holds nothing.
 */
function useCarried(replay: Replay, place: ReplayPlace): CarriedRead | undefined {
  const carried = replay.carried === true;
  const holds = carried && place.shown;
  const { agentId } = replay;

  const read = useAgentTranscript({
    transcript: useMemo(() => ({ kind: TRANSCRIPT_KIND.AGENT, agentId }), [agentId]),
    shown: holds,
  });

  const { messages, pages, hasOlder, loadingOlder, olderFailed, loadOlder, failed } = read;
  const whole = pages > 0 && !hasOlder;

  useEffect(() => {
    if (holds && hasOlder && !loadingOlder && !olderFailed) loadOlder();
  }, [holds, hasOlder, loadingOlder, olderFailed, loadOlder]);

  const transcript = useMemo(
    () => (whole ? carriedTranscript(messages, replay) : undefined),
    [whole, messages, replay],
  );

  if (!carried) return undefined;

  if (failed || olderFailed) return { kind: CARRIED_READ.UNREAD };

  if (!whole) return { kind: CARRIED_READ.READING };

  return transcript === undefined
    ? { kind: CARRIED_READ.UNREAD }
    : { kind: CARRIED_READ.READ, transcript };
}

/**
 * The source's messages a card carried whole draws in its steps' place, a
 * page at a time (`PagedRows`), each as the transcript draws it, under the
 * source rather than the card's own agent, so a picture, a computer call's
 * app, and a reasoning's or a call's cut body are read of the source's, and
 * offering neither a rewind nor a fork, which act on the card's own agent;
 * a quiet line where they could not be read, and nothing while they are.
 */
function CarriedMessages({
  agentId,
  read,
  place,
}: {
  agentId: string;
  read: CarriedRead;
  place: ReplayPlace;
}): React.JSX.Element | null {
  const pictures = useAgentPictureDoor(agentId);
  const wholeParts = useWholePartDoor(agentId);
  const messages = read.kind === CARRIED_READ.READ ? read.transcript.messages : NO_MESSAGES;
  const computerApps = useMemo(() => computerAppsOf(messages), [messages]);

  if (read.kind === CARRIED_READ.READING) return null;

  if (read.kind === CARRIED_READ.UNREAD) {
    return (
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} data-replay-unread="">
        {CARRIED_UNREAD_LINE}
      </Text>
    );
  }

  return (
    <TranscriptAgentOn agentId={agentId} planId={undefined}>
      <AgentPicturesProvider value={pictures}>
        <ComputerAppsProvider value={computerApps}>
          <WholePartsProvider value={wholeParts}>
            <RewindProvider value={undefined}>
              <ForkProvider value={undefined}>
                <PagedRows count={messages.length} earlierLine={earlierMessagesLine}>
                  {(from) =>
                    messages
                      .slice(from)
                      .map((message) => (
                        <Fragment key={message.id}>{place.message(message)}</Fragment>
                      ))
                  }
                </PagedRows>
              </ForkProvider>
            </RewindProvider>
          </WholePartsProvider>
        </ComputerAppsProvider>
      </AgentPicturesProvider>
    </TranscriptAgentOn>
  );
}

/** The foot: the branch and pull request the source published, where known, held by the host while the card's body is drawn (`pullRequestPublishedQuery`); nothing, rule and all, where neither is. */
function ReplayFoot({
  agentId,
  place,
}: {
  agentId: string;
  place: ReplayPlace;
}): React.JSX.Element | null {
  const held = useQuery(pullRequestPublishedQuery(agentId)).data;
  const published = held === undefined || "failure" in held ? undefined : held;
  const doors = useMentionDoors();
  // Note that the task list's pull request stands first, since it moves without a read.
  const pullRequest = place.pullRequests.get(agentId) ?? published?.pullRequest;
  const branch = published?.branch ?? undefined;

  const words =
    pullRequest === undefined || pullRequest === null ? undefined : pullRequestLabelOf(pullRequest);

  if (branch === undefined && words === undefined) return null;

  return (
    // The branch and the pull request, over a dashed rule.
    <div className="flex flex-wrap items-center gap-x-block-gap gap-y-tight-gap border-t border-dashed border-border pt-row-inset text-caption text-muted-foreground *:min-w-0">
      {branch === undefined ? null : (
        <span>
          Builds on <code>{branch}</code>
        </span>
      )}
      {pullRequest === undefined || pullRequest === null || words === undefined ? null : (
        <ChipOrLink
          href={pullRequest.url}
          words={words}
          doors={doors}
          onOpen={place.openGitHub}
          frame={CHIP_OR_LINK_FRAME.ORIGIN}
        />
      )}
    </div>
  );
}

/** The line the source's work opened on, which the card draws ahead of its steps, and who the tab names as having sent it, which the card names where it cannot name the source chain's starter. */
export interface ReplayBrief {
  readonly message: AgentTranscriptMessage;
  readonly sender: Actor | undefined;
}

/**
 * The card: the source's chip and how many steps on its summary row, and,
 * opened, the brief where it is a line, our summary and the steps left out,
 * the newest steps a page at a time, and the foot; the line naming who
 * started the agent and when under it.
 */
export function ReplayCard({
  replay,
  brief,
  sentAt,
  place,
  taskId,
}: {
  replay: Replay;
  /** The line the source's work opened on, drawn first inside the card; none where the brief is drawn as a card of its own over it. */
  brief?: ReplayBrief | undefined;
  /** When the agent's first message was sent, named after who started it; none where the transcript does not know. */
  sentAt?: number | undefined;
  place: ReplayPlace;
  /** The task the agents are of, under which a message of the source is opened; none where they are of none. */
  taskId: string | undefined;
}): React.JSX.Element {
  const { agentId } = replay;
  const source = useSource(agentId, place);
  const listed = place.agents.some((each) => each.id === agentId);
  const tile = place.tile(agentId) ?? unlistedActor(agentId, source);
  const name = actorName(tile);
  const { members, former } = useMemberDirectory();

  const starter =
    place.startedBy === undefined
      ? undefined
      : lineSender(
          { kind: AGENT_SENDER.MEMBER, ...place.startedBy },
          place.readerId,
          members,
          former,
        );

  const openPlace = useOpenPlace();
  const open = place.onOpen;

  // Note that a source the place does not list, as on an agent's own page, opens as a link to it would.
  const openSource =
    listed && open !== undefined
      ? () => open(agentId)
      : openPlace === undefined
        ? undefined
        : () =>
            openPlace(
              taskId === undefined
                ? { kind: LINK_DESTINATION.AGENT, agentId }
                : { kind: LINK_DESTINATION.AGENT, taskId: taskId, agentId },
            );

  // The brief is the first line of the agent the source's chain began at, sent by whoever started it, when it was started.
  const origin = briefOrigin(source, place.agents);

  const briefSender =
    origin === undefined
      ? brief?.sender
      : origin.startedBy === undefined
        ? undefined
        : lineSender(
            { kind: AGENT_SENDER.MEMBER, ...origin.startedBy },
            place.readerId,
            members,
            former,
          );

  const left = leftOutLine(replay);
  const summary = summaryLine(replay);
  const carried = useCarried(replay, place);

  const count =
    carried === undefined
      ? replayCount(replay)
      : carried.kind === CARRIED_READ.READ
        ? carried.transcript.count
        : undefined;

  return (
    <Message from={MESSAGE_ROLE.USER} className="agent-origin">
      <Plan
        data-replay-card=""
        aria-label={replayVerb(replay)}
        actions={
          <span className={ORIGIN_CHIP}>
            <ActorRef actor={tile} card={place.card(agentId)} onOpen={openSource} faceOnly />
          </span>
        }
      >
        <PlanHeader>
          <PlanIcon>
            <SplitIcon />
          </PlanIcon>
          {/* Note that the head names the source in words, its chip standing beside the head, because the head is the card's summary, which holds no control. */}
          <OneLine
            className="flex min-w-0 flex-1 items-center gap-tight-gap overflow-hidden whitespace-nowrap"
            words={`${replayVerb(replay)} ${name}${count === undefined ? "" : ` · ${count}`}`}
          >
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {replayVerb(replay)}{" "}
            </Text>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION}>
              {name}
            </Text>
            {count === undefined ? null : (
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {" "}
                · {count}
              </Text>
            )}
          </OneLine>
        </PlanHeader>
        <PlanContent layout={PLAN_BODY_LAYOUT.STACK}>
          {brief === undefined ? null : (
            <BriefStep message={brief.message} sender={briefSender} at={origin?.createdAt} />
          )}
          {summary === undefined || replay.summary === undefined ? null : (
            <SummaryRow line={summary} text={replay.summary.text} />
          )}
          {left === undefined ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              <em>{left}</em>
            </Text>
          )}
          {carried === undefined ? (
            <ReplaySteps steps={replay.steps} place={place} />
          ) : (
            <CarriedMessages agentId={agentId} read={carried} place={place} />
          )}
          <ReplayFoot agentId={agentId} place={place} />
        </PlanContent>
      </Plan>
      <MessageLine
        sender={starter === undefined ? undefined : <ActorRef actor={starter} />}
        at={sentAt}
        wrap
        actions={<CopyMessageAction words={replayWords(replay)} />}
      />
    </Message>
  );
}
