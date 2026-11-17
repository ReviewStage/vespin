/**
 * taskless-reads.ts -- whether the build asking reads an agent on no task.
 *
 * A build before `HOSTED_API_VERSION` 5 reads every agent with a task, and
 * fails a whole answer on one null `taskId`, so the service keeps an agent
 * on no task, and what stands on one, out of every answer to it. A request
 * that names no version, a build from before the headers, is one of those.
 */

import { presentedClient } from "@repo/features/client-identity";

/** The first hosted API version whose builds read an agent on no task (`client-identity.ts`'s `HOSTED_API_VERSION`). */
const TASKLESS_AGENTS_API_VERSION = 5;

/** Whether the build asking can decode an agent, or an inbox item, on no task in an answer. */
export function readsTasklessAgents(request: Request): boolean {
  const client = presentedClient(request.headers);

  return client !== undefined && client.apiVersion >= TASKLESS_AGENTS_API_VERSION;
}
