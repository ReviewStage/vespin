import {
  type AgentChangesPeople,
  type AgentPullRequest,
  CHECK_STATE,
  CHECK_SUMMARY,
  type CheckState,
  type CheckSummary,
  type GitHubPerson,
  PULL_REQUEST_STATE,
  type PullRequestReviewer,
  type PullRequestState,
} from "@repo/features/agent-wire";
import { pullRequestAddressOf } from "@repo/features/link-grammar";
import {
  PULL_REQUEST_MOMENT,
  type PullRequestMoment,
  type StandingPullRequest,
} from "@repo/features/link-standing-model";
import type { CatalogModel } from "@repo/features/models-wire";
import { CHECK_SUMMARY_WORDS, REVIEW_WORDS } from "@repo/features/pull-request-model";
import {
  CheckGlyph,
  GAP,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardRow,
  HoverCardRule,
  Inline,
  STATUS_TONE,
  type StatusTone,
  TIME_LOOK,
  Time,
  useMinute,
} from "@repo/ui";
import { useEffect } from "react";
import { ACTOR_SIZE, ActorMark, ActorRef, PROVENANCE_VERB, ProvenanceRow } from "../actor-ref.js";
import { prefetchPullRequestTab } from "../desktop/pages-on-demand.js";
import { pullRequestNumberLabel, pullRequestStateLabel } from "./agent-model.js";
import { LinesChanged } from "./agent-published.js";
import { AgentActorRef, type AgentSubject } from "./agent-ref.js";
import { PullRequestBranches } from "./pull-request-branches.js";
import { PullRequestLabels } from "./pull-request-labels.js";
import { PULL_REQUEST_TONE, PullRequestMark } from "./pull-request-mark.js";
import { useNamer } from "./pull-request-people.js";
import type { HeldPeople } from "./use-agents.js";
import { usePlaceStanding } from "./use-link-standing.js";

/**
 * pull-request-card.tsx -- the one card a pull request hangs wherever the window names one: its mark and title, its key, age, and where it stands, its checks, its branches and size, its labels, its reviewers, and who opened it.
 *
 * A pull request is named in several kinds of place: the chip beside its
 * agent in the plan's list of agents and a task row's chip, which know
 * what the task's row says of it; its Pull request tab, a pin of that tab,
 * and the chip of a pull request one of the plan's agents opened, which
 * know the agent and, once the tab has read them, who the pull request
 * names; and a link to its page in any words. Each hangs this one card,
 * passes what it knows and the place it stands in, and the card fills
 * every part its place did not pass from what the workspace's GitHub App
 * answered for the pull request's page (`use-link-standing.ts`), read
 * through that place's workspace, so every card of one pull request says
 * the same. It draws only what it knows, so a card read from an older
 * service, which answers little, still draws its head.
 *
 * The head is the mark for where it stands, the title, under it its key and
 * the age of its latest moment, `acme/relay#42 · 3h ago`, and in its corner
 * where it stands in that standing's tone, as the Pull request tab's pill
 * says it (`pull-request-writes.tsx`): Open, Draft, Merged, Closed, or
 * Queued. While it may still merge, its checks stand on a row of their own,
 * the glyph its Checks tab leads each check with (`CheckGlyph`), so a failing
 * one reads red at a glance. Its branches and size are drawn as the tab's
 * header draws them: the branches as its copying chips, `main ← topic`, as
 * GitHub writes them (`PullRequestBranches`), the lines it changes at their
 * end, and its labels as the tab's (`PullRequestLabels`). Its reviewers, where
 * known, are listed under a rule, each row a face and a name with where they
 * stand at its end, every one of them, scrolling past a few rows. At its foot,
 * under a rule as a task card's creator stands, a row says who opened it, the
 * person first, their face and their whole name, "Opened by octo-dev", as the
 * tab's line leads with them; where one of the window's agents opened it for
 * them, a row under it names the agent by its tile, "via Invite flow", and
 * where no person is known the agent alone opened it, "Opened by Invite flow".
 * Every face the card draws is one size, the tab's line's
 * (`ACTOR_SIZE.INLINE`), and every name in it hangs its card and opens what it
 * names: a person their page, an agent its tab.
 */

/** The moment a pull request's state names: merged once merged, closed once closed, and opened while open or a draft. */
const MOMENT_OF_STATE = {
  [PULL_REQUEST_STATE.OPEN]: PULL_REQUEST_MOMENT.OPENED,
  [PULL_REQUEST_STATE.DRAFT]: PULL_REQUEST_MOMENT.OPENED,
  [PULL_REQUEST_STATE.MERGED]: PULL_REQUEST_MOMENT.MERGED,
  [PULL_REQUEST_STATE.CLOSED]: PULL_REQUEST_MOMENT.CLOSED,
} as const satisfies Record<PullRequestState, PullRequestMoment>;

/** The glyph a pull request's checks wear on its card, as its Checks tab leads a check of that standing: none where it has no checks. */
const CHECKS_GLYPH = {
  [CHECK_SUMMARY.PASSING]: CHECK_STATE.PASSED,
  [CHECK_SUMMARY.FAILING]: CHECK_STATE.FAILED,
  [CHECK_SUMMARY.PENDING]: CHECK_STATE.PENDING,
  [CHECK_SUMMARY.NONE]: undefined,
} as const satisfies Record<CheckSummary, CheckState | undefined>;

/** What parts the pieces of a card's line. */
const SEPARATOR = " · ";

/** What the reviewers' list is named for a reader moving between lists. */
const REVIEWERS_LABEL = "Reviewers";

/** A pull request as every place that hangs its card holds one: its number and title, where it stands, its page, and its checks where the place reads them. */
export interface CardedPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: PullRequestState;
  /** True where it is open and GitHub's merge queue holds it. */
  readonly queued?: true;
  /** Its page on GitHub, whose address names its repository; none from a service before it sent one. */
  readonly url?: string | undefined;
  /** How its checks went; none where the place knows nothing of them. */
  readonly checks?: CheckSummary | undefined;
}

/** The agent whose pull request it is, as the place names it, and how its tab opens. */
export interface PullRequestAgent {
  readonly subject: AgentSubject;
  /** The catalog as last read, which names the agent's model on its card. */
  readonly models: readonly CatalogModel[] | undefined;
  readonly onOpen: () => void;
}

/** Who a pull request names, as its tab last read them for that very pull request; none where the tab read them for another, or has not yet. */
export function peopleOf(
  held: HeldPeople | undefined,
  pullRequest: Pick<AgentPullRequest, "url">,
): AgentChangesPeople | undefined {
  return held?.url === pullRequest.url ? held.people : undefined;
}

/**
 * The age the head's line says after the key: the pull request's latest
 * moment, where that moment is the one its state names. Note that a service
 * answering no time for a merge or a close falls back to when it was opened,
 * and an opening age beside "Merged" or "Closed" would read as the age of the
 * merge, so the line says no age then.
 */
function headAge(
  pullRequest: CardedPullRequest,
  when: StandingPullRequest["when"],
): React.JSX.Element | null {
  if (when === undefined || when.moment !== MOMENT_OF_STATE[pullRequest.state]) return null;

  return (
    <>
      {SEPARATOR}
      <Time at={when.at} look={TIME_LOOK.AGO} hint={false} />
    </>
  );
}

/** A pull request's key as its card's head says it: `owner/name#42` where its page names its repository, else `#42`. */
function pullRequestKey(pullRequest: CardedPullRequest): string {
  const repository =
    pullRequest.url === undefined ? undefined : pullRequestAddressOf(pullRequest.url)?.repository;

  return `${repository ?? ""}${pullRequestNumberLabel(pullRequest)}`;
}

/** The tone the head's corner says where it stands in, as the Pull request tab's pill does: the queue's attention while GitHub's merge queue holds it, else GitHub's color for its state. */
function standingTone(pullRequest: CardedPullRequest): StatusTone {
  return pullRequest.queued === true ? STATUS_TONE.ATTENTION : PULL_REQUEST_TONE[pullRequest.state];
}

/** Its checks on a row of their own, their glyph as the Checks tab draws it and their words, while it may still merge; nothing once it merged or closed, or where it has none. */
function ChecksRow({ pullRequest }: { pullRequest: CardedPullRequest }): React.JSX.Element | null {
  const { state, checks } = pullRequest;
  const open = state === PULL_REQUEST_STATE.OPEN || state === PULL_REQUEST_STATE.DRAFT;
  const glyph = checks === undefined ? undefined : CHECKS_GLYPH[checks];

  if (!open || checks === undefined || glyph === undefined) return null;

  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={<CheckGlyph state={glyph} />}
      label={`Checks ${CHECK_SUMMARY_WORDS[checks]}`}
    />
  );
}

/**
 * Its branches and the lines it changes, as the Pull request tab's header
 * draws them on its branch row: each branch a chip that copies its name,
 * `main ← topic`, then the lines; nothing where neither is known. Note that
 * the branches are pulled back by a chip's lead, its inset and hairline,
 * because the chips' glyphs stand that far inside their wash, so the base's
 * glyph stands on the card's glyph column, as the tab's branch row is pulled
 * back onto its line's faces; the lines, wrapped onto a line of their own
 * where the branches fill the row, keep the card's edge.
 */
function BranchRow({
  branches,
  lines,
}: {
  branches: StandingPullRequest["branches"];
  lines: StandingPullRequest["lines"];
}): React.JSX.Element | null {
  if (branches === undefined && lines === undefined) return null;

  return (
    <Inline gap={GAP.CONTROL} className="pull-request-card-branches min-w-0">
      {branches === undefined ? null : (
        <span className="inline-flex min-w-0 -ms-chip-lead">
          <PullRequestBranches base={branches.base} head={branches.head} />
        </span>
      )}
      {lines === undefined ? null : (
        <LinesChanged additions={lines.additions} deletions={lines.deletions} />
      )}
    </Inline>
  );
}

/**
 * Who opened a pull request or a GitHub issue, as every card's provenance
 * row says it (`ProvenanceRow`): their face as its glyph, their name as the
 * window names a GitHub account (a member's own where it is linked to one,
 * else their avatar), which hangs their card, and how long ago it was
 * opened where the service said so, "Opened by octo-dev · 3d ago". Note
 * that the time is the opening alone: once it merged or closed, the age the
 * service answers is the merge's or the close's, so the row names the
 * opener and no time.
 */
export function OpenedByRow({
  opener,
  when,
}: {
  opener: GitHubPerson;
  when?: StandingPullRequest["when"];
}): React.JSX.Element {
  const actor = useNamer()(opener);
  const now = useMinute();

  return (
    <ProvenanceRow
      verb={PROVENANCE_VERB.OPENED}
      actor={actor}
      at={when?.moment === PULL_REQUEST_MOMENT.OPENED ? when.at : undefined}
      now={now}
    />
  );
}

/**
 * The card's foot: who opened the pull request, as a task card says who
 * created a task (`task-card.tsx`'s `CreatorDetail`), the person first as the
 * Pull request tab's line leads with them: their face and "Opened by
 * octo-dev". Where one of the window's agents opened it for them, a row under
 * it names the agent by its tile, "via Invite flow", so the person's name is
 * never cut short for the agent's; where no person is known, the agent's tile
 * and "Opened by Invite flow". Each name hangs its card and opens what it
 * names, the agent its tab and the person their page. No time stands here,
 * since the head's line already says the age.
 */
function OpenedFoot({
  opener,
  agent,
}: {
  opener: GitHubPerson | undefined;
  agent: PullRequestAgent | undefined;
}): React.JSX.Element | null {
  const name = useNamer();
  const person = opener === undefined ? undefined : name(opener);

  const agentRef =
    agent === undefined ? null : (
      <AgentActorRef subject={agent.subject} models={agent.models} onOpen={agent.onOpen} nameOnly />
    );

  const agentMark =
    agent === undefined ? null : <ActorMark actor={agent.subject.tile} size={ACTOR_SIZE.INLINE} />;

  if (person === undefined) {
    return agent === undefined ? null : (
      <HoverCardRow
        data-pull-request-opener=""
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={agentMark}
        label={
          <>
            {"Opened by "}
            {agentRef}
          </>
        }
      />
    );
  }

  return (
    <>
      <HoverCardRow
        data-pull-request-opener=""
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={<ActorMark actor={person} size={ACTOR_SIZE.INLINE} />}
        label={
          <>
            {"Opened by "}
            <ActorRef actor={person} sentence nameOnly />
          </>
        }
      />
      {agent === undefined ? null : (
        <HoverCardRow
          data-pull-request-agent=""
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          glyph={agentMark}
          label={
            <>
              {"via "}
              {agentRef}
            </>
          }
        />
      )}
    </>
  );
}

/** One reviewer's row: their face, their name, which hangs their card and opens their page, and where they stand at the row's end. */
function ReviewerRow({ reviewer }: { reviewer: PullRequestReviewer }): React.JSX.Element {
  const actor = useNamer()(reviewer.by);

  return (
    <li>
      <HoverCardRow
        glyph={<ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />}
        label={<ActorRef actor={actor} nameOnly />}
        end={REVIEW_WORDS[reviewer.state]}
      />
    </li>
  );
}

/**
 * The one card a pull request hangs: its head, then what the place knows
 * of it, each part only where it is known.
 */
export function PullRequestCard({
  pullRequest,
  place,
  agent,
  reviewers,
  ...given
}: {
  pullRequest: CardedPullRequest;
  /** Where the card stands: its task, or on none the workspace named, whose GitHub App fills what the place did not pass. */
  place: { readonly taskId: string | null; readonly workspaceId?: string | undefined };
  /** The lines it adds and removes. */
  lines?: StandingPullRequest["lines"];
  /** When it was last opened, merged, or closed, as its state says. */
  when?: StandingPullRequest["when"];
  branches?: StandingPullRequest["branches"];
  labels?: StandingPullRequest["labels"] | undefined;
  /** Who opened it, where GitHub named them. */
  opener?: GitHubPerson | undefined;
  /** The agent whose pull request it is, where one of the window's opened it. */
  agent?: PullRequestAgent | undefined;
  /** Its reviewers and where each stands, where the place has read them. */
  reviewers?: readonly PullRequestReviewer[] | undefined;
}): React.JSX.Element {
  // An agent's pull request opens in its Pull request tab, a chunk of its own (`pages-on-demand.ts`), and the card hanging is the pointer on what opens it, so the chunk is read now rather than at the press.
  const owned = agent !== undefined;
  useEffect(() => {
    if (owned) prefetchPullRequestTab();
  }, [owned]);
  // What the place passed stands, and the pull request's link standing fills the rest.
  const standing = usePlaceStanding(place, pullRequest.url);
  const read = standing?.pullRequest;
  const lines = given.lines ?? read?.lines;
  const when = given.when ?? read?.when;
  const branches = given.branches ?? read?.branches;
  const labels = given.labels ?? read?.labels ?? [];
  const opener = given.opener ?? standing?.opener;
  const listed = reviewers ?? [];
  const marked = { ...pullRequest, checks: pullRequest.checks ?? CHECK_SUMMARY.NONE };

  return (
    <HoverCard data-pull-request-card="">
      <HoverCardHead
        glyph={<PullRequestMark pullRequest={marked} />}
        name={pullRequest.title}
        sub={
          <span>
            {pullRequestKey(pullRequest)}
            {headAge(pullRequest, when)}
          </span>
        }
        corner={pullRequestStateLabel(pullRequest)}
        cornerTone={standingTone(pullRequest)}
      />
      <ChecksRow pullRequest={pullRequest} />
      <BranchRow branches={branches} lines={lines} />
      <PullRequestLabels labels={labels} />
      {listed.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardList label={REVIEWERS_LABEL}>
            {listed.map((reviewer) => (
              <ReviewerRow key={reviewer.by.login} reviewer={reviewer} />
            ))}
          </HoverCardList>
        </>
      )}
      {opener === undefined && agent === undefined ? null : (
        <>
          <HoverCardRule />
          <OpenedFoot opener={opener} agent={agent} />
        </>
      )}
    </HoverCard>
  );
}
