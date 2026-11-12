import {
  type AgentPullRequest,
  type AgentPullRequestAnswer,
  CHECK_SUMMARY,
} from "@repo/features/agent-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { MENTION_KIND } from "@repo/features/mention-link";
import {
  CountParts,
  LIST_VARIANT,
  List,
  ListRow,
  linesCount,
  MENU_DETAIL,
  RowHint,
  RowHintOptions,
  SplitBar,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import type { ReactNode } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { LINK_COPY } from "../copy-feedback.js";
import { type MenuAction, rowMenu } from "../desktop/action-menu.js";
import { SHORTCUT_SUBJECT, shortcutSubject } from "../shortcut-target.js";
import {
  checkoutCommand,
  type DockedPullRequest,
  pullRequestStateLabel,
  pullRequestStateWord,
} from "./agent-model.js";
import { MentionChipCard } from "./mention-chip.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { usePullRequestsOnGitHub } from "./pull-request-opens.js";
import { useMentionDoors } from "./task-mentions.js";
import { useLinkStanding } from "./use-link-standing.js";

/**
 * agent-published.tsx -- what an agent published, on its tab: the pull request's row pinned over the box.
 *
 * Once the agent has opened a pull request, its row stands over the box,
 * docked there the way the to-do list is (`agent-tab.tsx`), whether the
 * agent is still at work or has ended, and never in the transcript, so it
 * is always in reach and drawn once. The row wears the pull request's mark
 * (`pull-request-mark.tsx`) and says the number and title, that the checks
 * failed where they did, where the pull request stands only where that
 * changes what the developer would do, and the lines added and removed. A
 * press of it opens its Pull request tab in the side panel
 * (`agent-pull-request-tab.tsx`) where a panel takes it, and GitHub's page
 * otherwise, or where the account opens pull requests on GitHub
 * (`pull-request-opens.ts`); a right-click offers what a press does not:
 * copying its GitHub link, the branch's name, or the command that checks it
 * out, and the pull request wherever the press did not open it, on GitHub
 * or in its tab. The pointer resting on it hangs the
 * card the pull request's chip hangs (`mention-chip.tsx`): its key and
 * state, size, who opened it and when, branches, labels, and counts, as
 * the workspace's GitHub App answers them (`use-link-standing.ts`).
 *
 * A branch pushed with no pull request yet draws nothing here: the box's
 * foot is left to what the next message is sent with, and the branch's
 * name and checkout are the row's copies once its pull request opens.
 * Nothing here is drawn before the service has said what stands, so a tab
 * on an agent still reading the repository wears nothing yet.
 */

/** The doors the row opens: a page of GitHub's in the browser, and the clipboard, its toast reading `label`. */
export interface PublishedDoors {
  openGitHub: (url: string) => void;
  copy: (words: string, label: string) => void;
  /** Opens the agent's pull request in a tab of the side panel's own; none where the view stands in no panel. */
  openPullRequest?: (() => void) | undefined;
  /** Opens another pull request the agent opened, by its number, in that same tab; none where the view stands in no panel. */
  openPullRequestNumber?: ((number: number) => void) | undefined;
}

/** What the segment of the agent's other pull requests names its menu. */
const OTHERS_LABEL = "Other pull requests";

/** The width, in the bar's type size, from which a segment has room for its line counts. */
const SEGMENT_ROOMY_EM = 18;

/** What the pull request's row is, which names its ⋯ and its menu. */
const PUBLISHED_THING = "Pull request";
const CHECKS_FAILING = "Checks failing";

/** A pull request's state and lines, its mark first, a glyph's gap apart. */
export const PUBLISHED_META_CLASS = "agent-published-meta inline-flex items-center gap-icon-gap";

/**
 * What a pull request's ⋯ and right-click offer: its Copy GitHub link,
 * and the branch's name and the command that checks it out, each to the
 * clipboard, where a branch is named; then `opens`, the place a press does
 * not open it in.
 */
function branchActions(
  branch: string | null,
  doors: PublishedDoors,
  pullRequestUrl: string,
  opens: MenuAction | undefined,
): MenuAction[][] {
  const copies: MenuAction[] = [
    commandAction(
      PANEL_COMMAND.COPY_GITHUB_LINK,
      () => doors.copy(pullRequestUrl, LINK_COPY.COPIED),
      undefined,
    ),
    ...(branch === null
      ? []
      : [
          {
            label: "Copy branch name",
            icon: <GLYPH.COPY />,
            onSelect: () => doors.copy(branch, "Branch name copied"),
          },
          {
            label: "Copy checkout command",
            icon: <GLYPH.COPY />,
            onSelect: () => doors.copy(checkoutCommand(branch), "Checkout command copied"),
          },
        ]),
  ];

  const open: MenuAction[] = opens === undefined ? [] : [opens];

  return [copies, open].filter((group) => group.length > 0);
}

type PullRequestPlacesResult = {
  readonly press: () => void;
  readonly other: MenuAction | undefined;
};

/**
 * A pull request's press and the menu's other place: where it opens in its
 * Pull request tab (`inApp`), a press opens the tab and the menu GitHub's
 * page, the other way round where the account opens pull requests on
 * GitHub; where the view stands in no panel, a press opens the page and the
 * menu nothing more.
 */
function pullRequestPlaces(
  url: string,
  inApp: (() => void) | undefined,
  onGitHub: boolean,
  doors: PublishedDoors,
): PullRequestPlacesResult {
  const openGitHub = () => doors.openGitHub(url);

  if (inApp === undefined) return { press: openGitHub, other: undefined };

  return onGitHub
    ? { press: openGitHub, other: commandAction(PANEL_COMMAND.OPEN_IN_APP, inApp, undefined) }
    : {
        press: inApp,
        other: commandAction(
          PANEL_COMMAND.OPEN_ON_GITHUB,
          openGitHub,
          shortcutSubject(SHORTCUT_SUBJECT.GITHUB_PAGE, url),
        ),
      };
}

/** The lines a change adds and removes, as GitHub counts them: green, then red. */
export function LinesChanged({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): React.JSX.Element {
  return (
    <span className="agent-published-lines whitespace-nowrap">
      <CountParts parts={linesCount(additions, deletions)} />
    </span>
  );
}

/** The pull request's row pinned over the box, a card of one row: its number and title, that its checks failed where they did, where it stands if that matters, and the lines it adds and removes; a press opens its tab, or the page on GitHub, a right-click, a long press or the menu key offers the rest, a finger's row drawing no ⋯ so the title keeps its room, and the pointer resting on it hangs the pull request's chip's card, which names it whole. A phone's narrow row gives up its state's word, and any narrow row the checks', then the lines, before the number (tasks.css). */
export function PublishedRow({
  pullRequest,
  branch,
  doors,
}: {
  pullRequest: AgentPullRequest;
  /** The branch the pull request is from, whose name and checkout its menu copies; none where it is not known. */
  branch: string | null;
  doors: PublishedDoors;
}): ReactNode {
  const state = pullRequestStateWord(pullRequest);
  const coarse = useCoarsePointer();

  const places = pullRequestPlaces(
    pullRequest.url,
    doors.openPullRequest,
    usePullRequestsOnGitHub(),
    doors,
  );

  const actions = branchActions(branch, doors, pullRequest.url, places.other);
  const mentionDoors = useMentionDoors();

  const mention = {
    kind: MENTION_KIND.LINK,
    provider: INTEGRATION_PROVIDER.GITHUB,
    url: pullRequest.url,
  } as const;

  const standing = useLinkStanding(mention, {
    taskId: mentionDoors.holder?.taskId,
    workspace: mentionDoors.place.workspace,
  });

  const card = (
    <MentionChipCard
      mention={mention}
      target={pullRequest.url}
      name={pullRequest.title}
      doors={mentionDoors}
      standing={standing}
    />
  );

  return (
    <div className="agent-published">
      <List label="Pull request" variant={LIST_VARIANT.CARD} fingerTall>
        {/* Note that the card stands in the pill's place whatever the title's width, since it names the title whole, the published one where GitHub answered nothing. */}
        <RowHintOptions card={card}>
          <ListRow
            leading={<PullRequestMark pullRequest={pullRequest} />}
            title={pullRequestLabelOf(pullRequest)}
            meta={
              <span className={PUBLISHED_META_CLASS}>
                {pullRequest.checks === CHECK_SUMMARY.FAILING ? (
                  <span className="agent-published-checks text-danger">{CHECKS_FAILING}</span>
                ) : null}
                {state === undefined ? null : (
                  <span className="agent-published-state">{state}</span>
                )}
                <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
              </span>
            }
            hint={{ Hint: RowHint, label: pullRequest.title }}
            onPress={places.press}
            menu={rowMenu(PUBLISHED_THING, actions, undefined, true)}
            more={!coarse}
          />
        </RowHintOptions>
      </List>
    </div>
  );
}

/** Where one of the agent's pull requests opens in the app: the one it stands on in its Pull request tab, another by its number in that tab; none where the view stands in no panel. */
function dockedInApp(docked: DockedPullRequest, doors: PublishedDoors): (() => void) | undefined {
  const { openPullRequest, openPullRequestNumber } = doors;

  if (docked.current && openPullRequest !== undefined) return openPullRequest;

  return openPullRequestNumber === undefined
    ? undefined
    : () => openPullRequestNumber(docked.pullRequest.number);
}

/** One of the agent's pull requests' press and the menu's other place (`pullRequestPlaces`). */
function dockedPlaces(docked: DockedPullRequest, doors: PublishedDoors, onGitHub: boolean) {
  return pullRequestPlaces(docked.pullRequest.url, dockedInApp(docked, doors), onGitHub, doors);
}

/** One pull request's segment of the split bar: its mark and number and title, its line counts where the segment has room, a press opening it, and a right-click offering its page and its link. */
function PublishedSegment({
  docked,
  roomy,
  doors,
}: {
  docked: DockedPullRequest;
  roomy: boolean;
  doors: PublishedDoors;
}): ReactNode {
  const { pullRequest, branch } = docked;
  const places = dockedPlaces(docked, doors, usePullRequestsOnGitHub());
  const actions = branchActions(branch, doors, pullRequest.url, places.other);

  return (
    <ListRow
      leading={<PullRequestMark pullRequest={pullRequest} />}
      title={pullRequestLabelOf(pullRequest)}
      meta={
        roomy ? (
          <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
        ) : undefined
      }
      hint={{ Hint: RowHint, label: pullRequest.title }}
      onPress={places.press}
      menu={rowMenu(PUBLISHED_THING, actions, undefined, true)}
      more={false}
    />
  );
}

/**
 * Every pull request the agent opened, pinned over the box: the one row of
 * the pull request from the branch it stands on where it opened one
 * (`PublishedRow`), and where it opened more, one
 * bar split into an equal segment for each (`SplitBar`), those that do not
 * fit its width folded into a last segment whose press lists them; nothing
 * before it opened one.
 */
export function PublishedBar({
  published,
  docked,
  doors,
}: {
  /** What the agent's tab read of the branch it stands on, which the one row draws. */
  published: AgentPullRequestAnswer | undefined;
  docked: readonly DockedPullRequest[];
  doors: PublishedDoors;
}): ReactNode {
  const onGitHub = usePullRequestsOnGitHub();

  if (docked.length < 2) {
    return published === undefined || published.pullRequest === null ? null : (
      <PublishedRow pullRequest={published.pullRequest} branch={published.branch} doors={doors} />
    );
  }

  return (
    <div className="agent-published">
      <SplitBar
        label={PUBLISHED_THING}
        items={docked}
        keyOf={(each) => each.pullRequest.url}
        roomy={SEGMENT_ROOMY_EM}
        segment={(each, roomy) => <PublishedSegment docked={each} roomy={roomy} doors={doors} />}
        more={{
          icon: <GLYPH.PULL_REQUEST aria-hidden="true" />,
          words: (count) => `${count} more`,
          label: OTHERS_LABEL,
          entries: (folded) =>
            folded.map((each) => ({
              key: each.pullRequest.url,
              label: pullRequestLabelOf(each.pullRequest),
              icon: <PullRequestMark pullRequest={each.pullRequest} />,
              detail: pullRequestStateLabel(each.pullRequest),
              detailPlace: MENU_DETAIL.BESIDE,
              onSelect: dockedPlaces(each, doors, onGitHub).press,
            })),
        }}
      />
    </div>
  );
}
