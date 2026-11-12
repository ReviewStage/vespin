/**
 * repository-pins-procedures.ts -- the repositories the account pinned in the Mac's sidebar: read them, and pin or unpin one.
 *
 * `GET /api/repository-pins` answers the account's pins, newest pinned
 * first; `PUT` pins or unpins one repository and answers them all as they
 * then stand, so the window draws the service's word rather than its own
 * guess. A pin names a repository and nothing of it, so it asks GitHub
 * nothing: a repository the account no longer reaches groups no task.
 * Every request resolves the bearer before it touches a row, and every row
 * it touches is the bearer's account's own. It stands apart from
 * `/api/plans/*` because that path's rewrite reads its next segment as a
 * task's id.
 */

import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted, writeReceiptMiddleware } from "../orpc/base.js";
import { pinRepository, readRepositoryPins } from "./repository-pins.js";

export interface RepositoryPinsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The pins resource: the account's pins, and one pinned or unpinned (`repository-pins.ts`). */
export function repositoryPinsProcedures(seams: RepositoryPinsProcedureSeams) {
  const pins = hosted.repositoryPins.use(accountMiddleware(seams.resolveUserId));

  return {
    list: pins.list.effect(function* ({ context }) {
      return yield* readRepositoryPins(context.userId);
    }),
    set: pins.set.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      return yield* pinRepository(context.userId, input.repository, input.pinned);
    }),
  };
}
