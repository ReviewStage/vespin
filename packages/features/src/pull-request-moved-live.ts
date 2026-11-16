import { Schema as EffectSchema, Option } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";

/**
 * pull-request-moved-live.ts -- when GitHub last said one pull request moved, as the host follows it for a Pull request tab that names the pull request by its repository and number: the statement the service answers, and what its row says.
 *
 * GitHub's deliveries about a pull request, its reviews, its comments, its
 * review threads, and its checks each note it as moved
 * (`github-webhook-app.ts`), whoever opened it, so the host follows this one
 * row for each such pull request a window holds and asks the tab's parts
 * again as it moves, and its viewed marks as its head does. The service
 * answers one statement, the pull request's row as one or none: none where
 * no delivery has named it yet.
 */

/** When GitHub last said the pull request moved, and its head commit as the latest delivery naming one gave it, null until one has. */
const movedRowSchema = EffectSchema.Struct({
  number: countedNumber,
  headSha: EffectSchema.NullOr(EffectSchema.NonEmptyString),
  movedAt: countedNumber,
});

/**
 * One pull request's moves by its repository and number: one part, its row
 * as one or none, the workspace under `?workspaceId=`, the repository's full
 * name under `&repository=`, and the number under `&number=`. The service
 * reads the row under the repository's GitHub id, which it serves itself
 * (`repositoryId`) once a token minted for the repository confirms the
 * workspace reaches it, as the read of its chapters by repository does
 * (`REPOSITORY_PULL_REQUEST_CHAPTERS_READ`). It refuses a query of no shape
 * as `invalid-request`, answers `not-found` for a workspace the account is
 * not a member of, and `repository-not-reachable` for a repository the
 * workspace no longer reaches.
 */
export const REPOSITORY_PULL_REQUEST_MOVED_READ = liveRead({
  name: LIVE_READ.REPOSITORY_PULL_REQUEST_MOVED,
  path: HOSTED_SERVICE_PATH.LIVE_REPOSITORY_PULL_REQUEST_MOVED,
  params: {
    workspaceId: LIVE_PARAM.TEXT,
    repository: LIVE_PARAM.TEXT,
    number: LIVE_PARAM.TEXT,
    repositoryId: LIVE_PARAM.SERVED,
    [LIVE_USER_QUERY]: LIVE_PARAM.USER,
  },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    moved: liveRows({ row: movedRowSchema, key: "number", order: [["movedAt", ORDER.DESC]] }),
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE),
});

export type RepositoryPullRequestMovedLiveAnswer = LiveReadAnswer<
  typeof REPOSITORY_PULL_REQUEST_MOVED_READ
>;

/** When GitHub last said a pull request moved, and its head as GitHub last named it, null where no delivery has. */
export interface PullRequestMoved {
  readonly movedAt: number;
  readonly headSha: string | null;
}

const readRows = EffectSchema.decodeUnknownOption(
  REPOSITORY_PULL_REQUEST_MOVED_READ.rows.fields.moved,
);

/** Where the pull request stands as the live statement's rows say: its last move, null where no delivery has named it yet; none where the rows are off their shape. */
export function pullRequestMovedOfLive(
  rows: readonly unknown[],
): Option.Option<PullRequestMoved | null> {
  return Option.map(readRows(rows), ([row]) =>
    row === undefined ? null : { movedAt: row.movedAt, headSha: row.headSha },
  );
}
