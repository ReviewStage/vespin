/**
 * taskless-reads.ts -- whether the build asking reads an agent on no task.
 *
 * A build before `HOSTED_API_VERSION` 6 reads every agent with a task, and
 * fails a whole answer on one null `taskId`, so the service keeps an agent
 * on no task, and what stands on one, out of every answer to it. A request
 * that names no version, a build from before the headers, is one of those.
 */

import { presentedClient } from "@repo/features/client-identity";

/** The first hosted API version whose builds read an agent on no task (`client-identity.ts`'s `HOSTED_API_VERSION`). */
const TASKLESS_AGENTS_API_VERSION = 6;

/** Whether the build asking can decode an agent, or an inbox item, on no task in an answer. */
export function readsTasklessAgents(request: Request): boolean {
  const client = presentedClient(request.headers);

  return client !== undefined && client.apiVersion >= TASKLESS_AGENTS_API_VERSION;
}

/** Whether a live read carries what stands on no task, as a param the service binds from the build asking (`LIVE_PARAM.SERVED`), since a param is text. */
export const TASKLESS_LIVE = {
  CARRIED: "carried",
  LEFT_OUT: "leftOut",
} as const;

/** Whether a live read carries what stands on no task to the build asking (`readsTasklessAgents`), as the param it binds. */
export function tasklessLiveParam(
  request: Request,
): (typeof TASKLESS_LIVE)[keyof typeof TASKLESS_LIVE] {
  return readsTasklessAgents(request) ? TASKLESS_LIVE.CARRIED : TASKLESS_LIVE.LEFT_OUT;
}
