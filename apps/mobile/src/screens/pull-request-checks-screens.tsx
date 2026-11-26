// pull-request-checks-screens.tsx -- the checks run on one pull request's head, on a screen of their own pushed from the pull request's page: each check where it stands, how long it ran, and the App that runs it, a press opening its run on GitHub.

import { githubAvatarUrl } from "@repo/features/account-picture";
import { PULL_REQUEST_PART } from "@repo/features/agent-view";
import { CHECK_STATE, type PullRequestCheck } from "@repo/features/agent-wire";
import {
  CHECK_WORDS,
  checksLineOf,
  PULL_REQUEST_READ_WORDS,
} from "@repo/features/pull-request-model";
import { workingTime } from "@repo/features/time-format";
import { answerFailed, landedAnswer } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  CHECK_LOOK,
  EmptyState,
  FACE_KIND,
  GLYPH,
  LIST_LOOK,
  ListSection,
  MARK_FACE,
  MarkRow,
  RowList,
  Screen,
  StackSubtitle,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { openInSafari } from "../open-link.js";
import {
  type PullRequestKey,
  usePullRequestParts,
  usePullRequestRetry,
} from "../pull-requests/use-pull-request.js";

/** The screen's title, as the page's row names it. */
const CHECKS_TITLE = "Checks";

/** The one part this screen holds live: the checks. */
const CHECKS_PART = [PULL_REQUEST_PART.CHECKS] as const;

/** The least a check must have run to say how long, as the panel's checks say it. */
const RAN_AT_LEAST_MS = 1_000;

/** What ends a check's row: how long it ran, or where it stands where it ran for no time or runs still. */
function checkDetail(check: PullRequestCheck): string {
  if (
    check.state !== CHECK_STATE.PENDING &&
    check.startedAt !== null &&
    check.completedAt !== null
  ) {
    const ran = check.completedAt - check.startedAt;

    if (ran >= RAN_AT_LEAST_MS) return workingTime(ran);
  }

  return CHECK_WORDS[check.state];
}

/** The App that runs a check, by the logo GitHub's avatar host serves for it, beside the check's mark, as the panel's check rows draw it; none where it has no such avatar. */
function checkFace(check: PullRequestCheck) {
  const picture = githubAvatarUrl(check.avatarUrl);

  if (picture === undefined) return undefined;

  return {
    of: { name: check.app ?? check.name, picture, kind: FACE_KIND.APP },
    stands: MARK_FACE.BESIDE,
  };
}

/**
 * The checks run on a pull request's head, by its workspace, its
 * repository and its number, held live while the screen is in focus and
 * read again on a pull down: each a row with its mark, its name, how long
 * it ran, and the App that runs it, in GitHub's order, as the page listed
 * them before its Checks row stood for them. The bar says under the title
 * how many stand where (`checksLineOf`). A press opens the check's run on
 * GitHub.
 */
export function PullRequestChecksScreen() {
  const {
    workspace = "",
    owner = "",
    name = "",
    number = "",
  } = useLocalSearchParams<{ workspace: string; owner: string; name: string; number: string }>();

  const key: PullRequestKey = {
    workspaceId: workspace,
    repository: `${owner}/${name}`,
    number: Number(number),
  };

  const colors = useColors();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const parts = usePullRequestParts(key, CHECKS_PART);
  const retry = usePullRequestRetry(key);
  const checks = landedAnswer(parts.checks)?.pullRequest?.checks;
  // Each row a press opens, by its id: its check's run.
  const opens = new Set((checks ?? []).flatMap((check) => (check.url === null ? [] : [check.url])));

  const empty =
    checks === undefined ? (
      answerFailed(parts.checks) ? (
        <EmptyState
          title={PULL_REQUEST_READ_WORDS.CHECKS_FAILED}
          symbol={GLYPH.FAILED}
          readFailed
          retry={() => void retry()}
        />
      ) : (
        <EmptyState title={PULL_REQUEST_READ_WORDS.READING_CHECKS} symbol={GLYPH.CHECK} loading />
      )
    ) : checks.length === 0 ? (
      <EmptyState title={PULL_REQUEST_READ_WORDS.NO_CHECKS} symbol={GLYPH.CHECK} />
    ) : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          title: CHECKS_TITLE,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <StackSubtitle
        words={checks === undefined ? "" : (checksLineOf(checks) ?? "")}
        leading={regular}
      />
      <Screen>
        <RowList
          look={LIST_LOOK.PLAIN}
          empty={empty}
          onRefresh={retry}
          onSelect={(row) => {
            if (opens.has(row)) openInSafari(row);
          }}
        >
          <ListSection>
            {(checks ?? []).map((check) => (
              <MarkRow
                key={check.url ?? check.name}
                id={check.url ?? check.name}
                mark={CHECK_LOOK[check.state]}
                title={check.name}
                detail={checkDetail(check)}
                standing={CHECK_WORDS[check.state]}
                face={checkFace(check)}
                opens={check.url ?? undefined}
              />
            ))}
          </ListSection>
        </RowList>
      </Screen>
    </>
  );
}
