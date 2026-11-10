import { agentParts, isDelegation } from "@repo/features/agent-parts";
import type {
  AgentPullRequest,
  AgentStatus,
  AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { GLYPH_STATE, glyphStateWords } from "@repo/features/glyph-state";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import type { CatalogModel, ModelChoice } from "@repo/features/models-wire";
import { agentStillWriting } from "@repo/features/task-agents-model";
import type { DescriptionEditor } from "@repo/features/task-wire";
import { delegationView } from "@repo/features/tool-call-model";
import {
  AVATAR_SIZE,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  ProviderMark,
  RepositoryPicture,
  Time,
  useMinute,
  VisuallyHidden,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import {
  ACTOR_SIZE,
  ActorMark,
  AutomationCard,
  automationActor,
  namedAutomationActor,
  PROVENANCE_VERB,
  ProvenanceRow,
} from "../actor-ref.js";
import { useAutomation } from "../automation-directory.js";
import { usePerson } from "../member-directory.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { type ArchivedByReading, pullRequestNumberLabel } from "./agent-model.js";
import { ModelLabel } from "./model-label.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { useStartingAgent } from "./starting-agent.js";
import { type CopiedTranscript, LATEST_ACTIVITY, latestActivity } from "./transcript-copy.js";
import { WorkingTime } from "./working-time.js";

/**
 * agent-tab-card.tsx -- the card an agent's or a subagent's tab hangs while the pointer rests on it: its whole name, when it last moved, and one line of what it last did.
 *
 * The card stands in the tab's hint's place (`@repo/ui`'s `Tooltip`), so it waits,
 * warms, and goes as a hint does, and an agent's and a subagent's are laid
 * out alike. Its head is the name, wrapped to two lines, or, for a subagent
 * not yet titled, its task on one line faded where it is cut short, as a
 * tab's label is; under the name, the model and the effort it runs at as
 * every place draws the pair (`model-label.tsx`), where they are known; and
 * the time at the head's right: the run's count while the agent works, its
 * tile's mark in its harness's place saying that it works, as a tab's glyph
 * does, with no word beside it but one only a reader hears; and how long ago it last moved once it has
 * ended, in the sidebar's letters, after how it
 * ended where it stopped or failed ("Stopped · 3m"): when its
 * latest turn finished, where the tab holds it, or else when its newest
 * run began, the latest moment its summary knows. Under
 * it stands one line of the latest step, faded where it is cut short as a
 * tab's label is: the agent's last words as plain text, or its last call as
 * the concise copy says it (`transcript-copy.ts`'s `latestActivity`).
 *
 * An agent's card, and a subagent's or a brain's worker's, wears its tile
 * beside its name (`actor-ref.tsx`), its harness giving way to the working
 * mark while it works. Under the head, an agent's card says in provenance
 * rows (`ProvenanceRow`) who started it and when: the coding agent that
 * started it, by its tile and name, where the task list carries it; else the
 * automation whose run started it, by its tile and name, where the window
 * knows it, or by the name it had where the window cannot read it; or else,
 * for a teammate's agent, the teammate's face and name; each hangs its own
 * card over this one. The card says too that it was started from Slack,
 * where it was, and an agent with no task's the repository it works in,
 * which its sidebar row leaves to it. Then its pull request where the place holds one, by
 * its mark, number, and title. An archived agent's says who archived it, the app or another agent on a
 * member's behalf among them, and the reason given. The card has no way to the tab of its own: wherever it hangs, the
 * name it hangs from is what a press opens, so the card only says.
 *
 * The step is read from what a tab already holds, never fetched on hover:
 * the transcript the agent's tab last drew (`HeldTranscript`), while it is
 * still the agent's latest, or a brain's worker's session, which the task
 * holds whole. A card with nothing current to read says the name and the
 * time alone.
 */

/** What a card's head says at its right. */
const CARD_CORNER = {
  /** The agent works: how long its run has gone where its start is known, its tile's mark saying that it works. */
  WORKING: "working",
  /** The agent ended: how it ended where its glyph does not say it, a stop or a failure, and how long ago it last moved, where known. */
  ENDED: "ended",
  NONE: "none",
} as const;

export type CardCorner =
  | { readonly kind: typeof CARD_CORNER.WORKING; readonly startedAt: number | undefined }
  | {
      readonly kind: typeof CARD_CORNER.ENDED;
      readonly state: string | undefined;
      readonly at: number | undefined;
    }
  | { readonly kind: typeof CARD_CORNER.NONE };

/** What parts how an agent ended from how long ago it did. */
const ENDED_SEPARATOR = " · ";

/** The transcript an agent's or a worker's tab last drew, and where the agent stood, since when its run began, and the titles it and its workers bear, as the page it was read from said. */
export interface HeldTranscript {
  readonly messages: readonly AgentTranscriptMessage[];
  readonly status: AgentStatus;
  readonly runStartedAt: number | undefined;
  /** A worker's own title, on a worker's; an agent's is its summary's. */
  readonly title: string | undefined;
  /** Each of an agent's workers' titles, by the call that started it; none on a worker's. */
  readonly subagentTitles: ReadonlyMap<string, string>;
}

/** What a card says, read as it is hung: its corner, the model and effort its agent runs on where known, and the transcript its step is read from, or nothing where none is current. */
export interface CardReading {
  readonly corner: CardCorner;
  readonly choice: ModelChoice | undefined;
  readonly transcript: CopiedTranscript | undefined;
  /** The teammate who started the agent, as the wire names them, drawn "[face] Started by Charles Pan · 3d ago"; none for the reader's own, or a card that is no agent's. */
  readonly startedBy?: DescriptionEditor | undefined;
  /** The automation whose run started the agent, drawn "[tile] Started by Morning Sentry triage · 3d ago" in the starter's place where the window knows it. */
  readonly automationId?: string | undefined;
  /** That automation's name as the run started it, which names it plainly where the window cannot read it: deleted, or a teammate's. */
  readonly automationName?: string | undefined;
  /** The coding agent that started this one, drawn by its tile and name in the starter's place where the task list carries it. */
  readonly startedByAgentId?: string | undefined;
  /** When the agent was started, said after whoever started it, where known. */
  readonly startedAt?: number | undefined;
  /** The agent's own tile, beside its name; none on a card that is no agent's, or of one the place does not hold. */
  readonly tile?: Actor | undefined;
  /** The pull request the agent opened, where the place holds it, on a row of its own under the head. */
  readonly pullRequest?:
    | Pick<AgentPullRequest, "number" | "title" | "state" | "checks">
    | undefined;
  /** Who archived the agent and why, on an archived agent's card where the service said. */
  readonly archivedBy?: ArchivedByReading | undefined;
  /** The repository the agent works in, as `owner/name`, said where its row does not name it: an agent with no task's. */
  readonly repository?: string | undefined;
  /** Whether a member started the agent from Slack. */
  readonly fromSlack?: boolean | undefined;
}

function Corner({ corner }: { corner: CardCorner }): React.JSX.Element | null {
  const now = useMinute();
  switch (corner.kind) {
    case CARD_CORNER.WORKING:
      // Note that no word stands before the count, because the tile's working mark already says it.
      return corner.startedAt === undefined ? null : (
        <WorkingTime startedAt={corner.startedAt} className="" />
      );
    case CARD_CORNER.ENDED:
      return (
        <>
          {corner.state}
          {corner.state === undefined || corner.at === undefined ? null : ENDED_SEPARATOR}
          {corner.at === undefined ? null : <Time at={corner.at} now={now} hint={false} />}
        </>
      );
    case CARD_CORNER.NONE:
      return null;
  }
}

/** Whether a corner says anything: a working one only where it has a start to count from. */
function cornerSays(corner: CardCorner): boolean {
  if (corner.kind === CARD_CORNER.NONE) return false;
  return corner.kind !== CARD_CORNER.WORKING || corner.startedAt !== undefined;
}

/**
 * Who started the agent and when: the coding agent whose `start_agent` did,
 * by its tile and name, which hang its tab's card and open its tab, where
 * the task list carries it (`starting-agent.ts`); else the automation whose
 * run did, by its tile and name, which hang its card and open its page,
 * where the window knows it (`automation-directory.tsx`), or by the name it
 * had where the window cannot read it, deleted or a teammate's; else a
 * teammate, by their face and name, which hang their card; else nobody.
 */
function StartedBy({
  by,
  agentId,
  automationId,
  automationName,
  at,
  models,
}: {
  by: DescriptionEditor | undefined;
  agentId: string | undefined;
  automationId: string | undefined;
  automationName: string | undefined;
  at: number | undefined;
  models: readonly CatalogModel[];
}): React.JSX.Element | null {
  const now = useMinute();
  const person = usePerson(by);
  const starter = useStartingAgent(agentId, models);
  const known = useAutomation(automationId);
  if (starter !== undefined) {
    return (
      <ProvenanceRow
        verb={PROVENANCE_VERB.STARTED}
        actor={starter.actor}
        onOpen={starter.onOpen}
        at={at}
        now={now}
      />
    );
  }
  if (known !== undefined) {
    return (
      <ProvenanceRow
        verb={PROVENANCE_VERB.STARTED}
        actor={automationActor(known.automation)}
        card={<AutomationCard automation={known.automation} workspaceName={known.workspaceName} />}
        onOpen={known.onOpen}
        at={at}
        now={now}
      />
    );
  }
  if (automationId !== undefined || automationName !== undefined) {
    return (
      <ProvenanceRow
        verb={PROVENANCE_VERB.STARTED}
        actor={namedAutomationActor(automationId, automationName)}
        at={at}
        now={now}
      />
    );
  }
  return by === undefined ? null : (
    <ProvenanceRow verb={PROVENANCE_VERB.STARTED} actor={person} at={at} now={now} />
  );
}

/** What the line of an agent started from Slack says. */
const FROM_SLACK_WORDS = "Started from Slack";

/** The repository the agent works in, its owner's picture before it. */
function RepositoryLine({ repository }: { repository: string }): React.JSX.Element {
  const pictures = useRepositoryPictures();
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={
        <RepositoryPicture repository={repository} pictures={pictures} size={AVATAR_SIZE.MARK} />
      }
      label={<ReplayMask>{repository}</ReplayMask>}
    />
  );
}

/** The agent's pull request: its mark, saying where it stands, and its number before its title. */
function PullRequestRow({
  pullRequest,
}: {
  pullRequest: NonNullable<CardReading["pullRequest"]>;
}): React.JSX.Element {
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={<PullRequestMark pullRequest={pullRequest} />}
      label={`${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`}
    />
  );
}

/** Who archived the agent, on one line, and the reason they gave under it. */
function ArchivedByNote({ archivedBy }: { archivedBy: ArchivedByReading }): React.JSX.Element {
  return (
    <>
      <HoverCardNote oneLine>{archivedBy.words}</HoverCardNote>
      {archivedBy.reason === undefined ? null : <HoverCardNote>{archivedBy.reason}</HoverCardNote>}
    </>
  );
}

/** The one line of the latest step, faded at its end where it is cut short. */
function ActivityLine({ transcript }: { transcript: CopiedTranscript }): React.JSX.Element | null {
  const activity = latestActivity(transcript);
  if (activity === undefined) return null;
  return (
    <HoverCardNote oneLine>
      {activity.kind === LATEST_ACTIVITY.WORDS ? (
        activity.text
      ) : (
        <>
          {activity.verb}
          {activity.subject === "" ? null : " "}
          {activity.code ? <code>{activity.subject}</code> : activity.subject}
        </>
      )}
    </HoverCardNote>
  );
}

/**
 * The corner a card wears: working, counted from `startedAt` where it is
 * known and saying nothing where not, while the agent may still write; once it has ended, how it ended
 * where its tab's glyph does not say it (`state`: "Stopped", "Failed"),
 * as the tab's hint said it, and how long ago it last moved, or nothing
 * where neither is known.
 */
export function cardCorner(input: {
  writing: boolean;
  startedAt: number | undefined;
  movedAt: number | undefined;
  state: string | undefined;
}): CardCorner {
  const { writing, startedAt, movedAt, state } = input;
  if (writing) return { kind: CARD_CORNER.WORKING, startedAt };
  return movedAt === undefined && state === undefined
    ? { kind: CARD_CORNER.NONE }
    : { kind: CARD_CORNER.ENDED, state, at: movedAt };
}

/** When the latest of the agent's turns among `messages` answered or ended, where the service said. */
export function lastFinished(
  messages: readonly AgentTranscriptMessage[] | undefined,
): number | undefined {
  return messages?.findLast((message) => message.finishedAt !== undefined)?.finishedAt;
}

/**
 * The model and effort one of an agent's workers runs on, as the call that
 * started it says them among the agent's messages, a half it left out
 * being the agent's own (`own`); nothing where the call is not held.
 */
export function delegatedChoice(
  messages: readonly AgentTranscriptMessage[] | undefined,
  callId: string,
  own: ModelChoice,
): ModelChoice | undefined {
  const call = messages
    ?.flatMap(agentParts)
    .find((part) => isDelegation(part) && part.callId === callId);
  return call === undefined || !isDelegation(call) ? undefined : delegationView(call, own).choice;
}

/**
 * The messages a tab held, while they are still the agent's latest: read on
 * the run the agent is on now, which moves with each turn, and either the
 * tab is the one chosen, whose transcript follows that run, or they were
 * read after the run ended and it has not moved since. Nothing otherwise,
 * so a card never says an earlier turn's step as the latest, even while the
 * chosen tab's first read of a new turn is out or did not answer.
 */
export function heldLatest(
  held: HeldTranscript | undefined,
  now: { writing: boolean; runStartedAt: number | undefined },
  chosen: boolean,
): readonly AgentTranscriptMessage[] | undefined {
  if (held === undefined || held.runStartedAt !== now.runStartedAt) return undefined;
  if (chosen) return held.messages;
  return !agentStillWriting(held.status) && !now.writing ? held.messages : undefined;
}

/** A line a place other than the agent's own tab adds at the card's foot, with its glyph: the task it works on, or whose sandbox a Terminal tab's shells run in. */
export interface CardFoot {
  readonly glyph: React.ReactNode;
  readonly words: React.ReactNode;
}

/** The foot naming the task an agent works on, by the plan's glyph: "On Teammate invitations", "On no task". */
export function taskFoot(words: string): CardFoot {
  return { glyph: <GLYPH.DESCRIPTION />, words };
}

/**
 * The card: the agent's tile, the name, its model under it, and its
 * corner, then who started it and its pull request, the latest step where
 * the tab holds one current, and what a tab of the agent's other than its
 * own adds, as its Terminal tab says whose sandbox it is in.
 */
export function AgentTabCard({
  name,
  untitled = false,
  models,
  read,
  foot,
}: {
  name: string;
  /** Whether the name is a subagent's task standing in until it has a title. */
  untitled?: boolean;
  /** The catalog as last read, which names the model. */
  models: readonly CatalogModel[];
  /** What the card says, read from what the tab holds as the card is hung. */
  read: () => CardReading;
  /** One row at the foot, said by a place other than the agent's own tab. */
  foot?: CardFoot | undefined;
}): React.JSX.Element {
  const {
    corner,
    choice,
    transcript,
    startedBy,
    startedByAgentId,
    automationId,
    automationName,
    startedAt,
    tile,
    pullRequest,
    archivedBy,
    repository,
    fromSlack,
  } = read();
  const head = (
    <HoverCardHead
      mark={tile === undefined ? undefined : <ActorMark actor={tile} size={ACTOR_SIZE.CARD} />}
      name={name}
      oneLine={untitled}
      sub={choice === undefined ? undefined : <ModelLabel choice={choice} models={models} />}
      corner={cornerSays(corner) ? <Corner corner={corner} /> : undefined}
    />
  );
  return (
    <HoverCard data-agent-card="">
      {head}
      {corner.kind === CARD_CORNER.WORKING ? (
        // Note that the word is a reader's alone, because the tile that shows the work hides its mark from a reader and nothing drawn says it.
        <VisuallyHidden>{glyphStateWords(GLYPH_STATE.WORKING, false)}</VisuallyHidden>
      ) : null}
      <StartedBy
        by={startedBy}
        agentId={startedByAgentId}
        automationId={automationId}
        automationName={automationName}
        at={startedAt}
        models={models}
      />
      {fromSlack === true ? (
        <HoverCardRow
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          glyph={<ProviderMark provider={INTEGRATION_PROVIDER.SLACK} />}
          label={FROM_SLACK_WORDS}
        />
      ) : null}
      {repository === undefined ? null : <RepositoryLine repository={repository} />}
      {pullRequest === undefined ? null : <PullRequestRow pullRequest={pullRequest} />}
      {archivedBy === undefined ? null : <ArchivedByNote archivedBy={archivedBy} />}
      {transcript === undefined ? null : <ActivityLine transcript={transcript} />}
      {foot === undefined ? null : (
        <HoverCardRow look={HOVER_CARD_ROW_LOOK.DETAIL} glyph={foot.glyph} label={foot.words} />
      )}
    </HoverCard>
  );
}
