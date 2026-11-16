import {
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestStackEntry,
} from "@repo/features/agent-wire";
import { pullRequestAddressOf } from "@repo/features/link-grammar";
import { ACT_KIND } from "@repo/host/acts";
import { CHIP_LOOK, Chip, ChipName, dropBelowStart, Tooltip, useMenu } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import { useMutation } from "@tanstack/react-query";
import { LayersIcon } from "lucide-react";
import { pressMutation } from "../act-mutations.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { useOpenPullRequest } from "./open-pull-request.js";
import { PullRequestMark, type PullRequestMarked } from "./pull-request-mark.js";

/**
 * pull-request-stack.tsx -- the stack a pull request stands in, on its header, as stage-cli shows one: "Stack 2/4", whose menu lists the stack from its tip down to its base and opens any of it.
 *
 * The service works the stack out (`pull-request-stack.ts`). Each other
 * pull request of the stack opens in a Pull request tab of its own, by its
 * repository and number, in the panel holding this one
 * (`open-pull-request.ts`), whichever agent's branch it is from or none's;
 * outside a panel, where there is no door, each opens on GitHub.
 */

/** What the menu says beside a pull request that opens on GitHub, as each does outside a panel. */
const ON_GITHUB = "Opens on GitHub";

/** What an entry in GitHub's merge queue says, as its Pull request tab's pill says it. */
const QUEUED = "Queued";

/** The words under an entry: queued where the merge queue holds it, and that it opens on GitHub where the tab stands in no panel and it is not the one shown. */
function entryDetail(
  entry: PullRequestStackEntry,
  current: boolean,
  inApp: boolean,
): string | undefined {
  const onGitHub = current || inApp ? undefined : ON_GITHUB;

  if (entry.queued !== true) return onGitHub;

  return onGitHub === undefined ? QUEUED : `${QUEUED} · ${onGitHub}`;
}

/** What a stacked entry's mark is drawn from: the stack lists open and draft pull requests only, and carries no checks, so its mark says none of them. */
function markOf(entry: PullRequestStackEntry): PullRequestMarked {
  return {
    number: entry.number,
    state: entry.draft ? PULL_REQUEST_STATE.DRAFT : PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.NONE,
    ...(entry.queued === true ? { queued: true } : undefined),
  };
}

/** How a pull request of the stack opens, and whether it opens in the app. */
interface EntryOpener {
  readonly open: (entry: PullRequestStackEntry) => void;
  readonly inApp: boolean;
}

/** How a pull request of the stack opens: in a Pull request tab of its own in the panel holding this one, by its repository and number, else its page on GitHub. */
function useOpenEntry(): EntryOpener {
  const { mutate: openOnGitHub } = useMutation(pressMutation(ACT_KIND.GITHUB_OPEN));
  const openPullRequest = useOpenPullRequest();

  return {
    inApp: openPullRequest !== undefined,
    open: (entry) => {
      const address = pullRequestAddressOf(entry.url);

      if (openPullRequest !== undefined && address !== undefined) openPullRequest(address);
      else openOnGitHub({ url: entry.url });
    },
  };
}

/**
 * The stack the pull request numbered `number` stands in, as a toolbar
 * chip at a control's size saying where in it this one stands, its face
 * lighting only under the pointer and while its menu stands, so the line of
 * facts it stands in stays quiet, ending in the menu's chevron as
 * every trigger of a menu in the header does, whose menu lists the stack tip
 * first, each by its number and title wearing its state's mark at a menu
 * glyph's size, this one checked; nothing where it stands in no stack.
 */
export function PullRequestStack({
  stack,
  number,
}: {
  /** The stack, base first, as the service lists it. */
  stack: readonly PullRequestStackEntry[];
  number: number;
}): React.JSX.Element | null {
  const at = stack.findIndex((entry) => entry.number === number);
  const shown = stack.length > 1 && at !== -1;
  const menu = useMenu(shown);
  const { open, inApp } = useOpenEntry();

  if (!shown) return null;
  const label = `Stack, ${at + 1} of ${stack.length}`;

  const actions: MenuAction[] = [...stack].reverse().map((entry) => {
    const current = entry.number === number;

    return {
      label: pullRequestLabelOf(entry),
      replayMasked: true,
      icon: <PullRequestMark pullRequest={markOf(entry)} className="pull-request-stack-mark" />,
      detail: entryDetail(entry, current, inApp),
      ...(current ? { checked: true } : undefined),
      // Note that the one shown is checked at full strength rather than unavailable, so choosing it closes the menu and opens nothing.
      onSelect: current ? () => undefined : () => open(entry),
    };
  });

  return (
    <>
      {/* Note that the chip keeps its words whole where the row runs short, as the base branch does, because a cut "Sta…" says nothing; the head gives way instead. */}
      <span className="pull-request-stack inline-flex flex-none">
        <Tooltip label={label}>
          <Chip
            look={CHIP_LOOK.TOOLBAR}
            chevron
            aria-label={label}
            {...menu.trigger(dropBelowStart)}
          >
            <LayersIcon aria-hidden="true" />
            <ChipName>
              Stack{" "}
              <span className="text-muted-foreground tabular-nums">
                {at + 1}/{stack.length}
              </span>
            </ChipName>
          </Chip>
        </Tooltip>
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label="Pull requests in the stack"
          heading={<ReplayUnmask>{`${stack.length} pull requests`}</ReplayUnmask>}
          menu={menu.drawn}
          groups={[actions]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
